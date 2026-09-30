//! The multi-view stream proxy: a loopback HTTP server that fetches a live
//! stream on the Rust side and hands it to the webview WITH a CORS header.
//!
//! WHY IT EXISTS. Multi-view plays in the webview (mpegts.js feeding Media
//! Source Extensions), and mpegts.js reads the stream with fetch, so the
//! provider has to send Access-Control-Allow-Origin or the browser refuses
//! the response. Adam's provider did on 2026-09-13 and stopped: on his first
//! real multi-view run (v0.9.100) every tile failed on a 302 with no CORS
//! header, Cartoon Network as much as the 4K event feed, and the codecs
//! were never the question. mpv never hits this, being native. Neither does
//! this: reqwest follows the redirect and the header is ours to add.
//!
//! THE SHAPE:
//! - `open(url)` stores the upstream URL under a random 128-bit token and
//!   returns `http://127.0.0.1:{port}/mv/{token}`. The server never takes a
//!   URL from a request, so it is not an open proxy, and the webview never
//!   holds a URL with the provider's credentials in it (Chromium printed
//!   them in full in its own CORS errors).
//! - `close(local)` forgets the token and ends whatever it is serving: the
//!   tile calls it when it goes, and the provider connection goes with it
//!   at once, not when the webview gets round to closing its socket.
//! - One server, started on first use, on its own thread and runtime, bound
//!   to 127.0.0.1 only. Its own thread so it outlives whatever called it,
//!   which is also what lets the tests below drive it for real.
//! - The upstream body is passed through as it arrives. When the tile goes,
//!   the webview drops the connection, hyper drops the body, and the
//!   upstream response goes with it: a closed tile must hand its provider
//!   connection back at once, because the line's cap counts it (Adam's is 3).
//! - A LIVE STREAM NEVER ENDS CLEANLY here. However it stops (the provider
//!   closes, goes silent, ffmpeg exits), the body ends with an error, so the
//!   tile hears a dropped stream and reconnects. A clean end read as a
//!   finished one, and the tile froze on its last frame (plan 018, R2).
//!
//! HEVC IS CONVERTED HERE, when the tile asks (mvconvert.rs). The webview
//! cannot decode it without a Store package; the first packets say whether
//! a stream is HEVC, and if so ffmpeg turns it into H.264 on the way
//! through. Still one provider connection per tile.
//!
//! HLS TOO, since v0.10.67 (`open_hls`; Adam picked this over an hls.js
//! loader on a native fetch, which would carry every segment of up to four
//! tiles across the IPC bridge). hls.js fetches a playlist and then every
//! URI in it, each needing the same CORS header. A playlist served for an
//! HLS route has every URI in it (variants, renditions, segments, keys, init
//! maps) rewritten to `/mv/{token}/{n}`, a child of the same route, minted
//! here and nowhere else, so the server still never takes a URL from a
//! request. Segments are finite, so they end cleanly, byte ranges included.
//!
//! NEVER LOGS A PATH OR QUERY. Xtream live URLs carry the username and
//! password in the path; only the origin is printed, as in http_get.

use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use futures_util::future::{select, Either};
use futures_util::{stream, Stream, StreamExt};
use http_body_util::{combinators::BoxBody, BodyExt, Empty, Full, StreamBody};
use hyper::body::{Bytes, Frame, Incoming};
use hyper::header::{self, HeaderValue};
use hyper::{Method, Request, Response, StatusCode};

type Body = BoxBody<Bytes, std::io::Error>;

use crate::mvconvert::{self, Sniff};

struct Proxy {
    port: u16,
    routes: Mutex<HashMap<String, Route>>,
}

/// What a token stands for.
struct Route {
    url: String,
    /// The tile's webview cannot play HEVC: convert it if that is what
    /// this turns out to be.
    convert_hevc: bool,
    /// Held here only. `close` drops the route and with it this, which is
    /// what tells every response serving the token to stop (`closed`).
    live: Arc<tokio::sync::watch::Sender<()>>,
    /// An HLS route's children: every URI its playlists named.
    hls: Option<Children>,
}

/// The URIs an HLS route's playlists named, by the number each has in its
/// loopback URL. A live playlist names new segments every few seconds and
/// the same ones again on each reload, so a URI keeps its number. Past CAP,
/// the ones no playlist has named for longest are forgotten, never one the
/// playlist being served names: a VOD playlist can name thousands at once.
#[derive(Default)]
struct Children {
    by_id: HashMap<u64, String>,
    /// Each URI's number, and the playlist that last named it.
    by_url: HashMap<String, (u64, u64)>,
    next: u64,
    /// Playlists served so far.
    served: u64,
}

impl Children {
    /// Hours of a live stream's segments; a few hundred bytes each.
    const CAP: usize = 4096;

    /// A playlist is being served: what `mint` names from here is its.
    fn begin(&mut self) {
        self.served += 1;
    }

    fn mint(&mut self, url: &str) -> u64 {
        if let Some(e) = self.by_url.get_mut(url) {
            e.1 = self.served;
            return e.0;
        }
        let id = self.next;
        self.next += 1;
        self.by_id.insert(id, url.to_string());
        self.by_url.insert(url.to_string(), (id, self.served));
        id
    }

    /// Back to CAP, oldest first, after a playlist is served.
    fn trim(&mut self) {
        let over = self.by_url.len().saturating_sub(Self::CAP);
        if over == 0 {
            return;
        }
        let mut old: Vec<(u64, u64)> = self
            .by_url
            .values()
            .filter(|&&(_, at)| at < self.served)
            .map(|&(id, at)| (at, id))
            .collect();
        old.sort_unstable();
        for (_, id) in old.into_iter().take(over) {
            if let Some(url) = self.by_id.remove(&id) {
                self.by_url.remove(&url);
            }
        }
    }
}

static PROXY: OnceLock<Result<Proxy, String>> = OnceLock::new();

/// The same browser User-Agent as `http_client` in lib.rs, so the provider
/// sees the client it already answers for the playlist.
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                  (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/// NOT the shared `http_client`: that one has a 30s TOTAL timeout, which
/// would cut every live stream at the 30-second mark. A live stream has no
/// end, so the limits here are on connecting and on silence.
fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            // A live stream that says nothing for 20s is dead. The tile
            // reports the error rather than sitting black.
            .read_timeout(Duration::from_secs(20))
            .user_agent(UA)
            .http1_only()
            // Followed by hand in `fetch`, so a failure can say which hop.
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("failed to build the stream proxy's HTTP client")
    })
}

fn proxy() -> Result<&'static Proxy, String> {
    PROXY.get_or_init(start).as_ref().map_err(|e| e.clone())
}

fn start() -> Result<Proxy, String> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| format!("stream proxy could not bind: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    std::thread::Builder::new()
        .name("mvproxy".into())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .thread_name("mvproxy-rt")
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    eprintln!("[mvproxy] no runtime: {e}");
                    return;
                }
            };
            rt.block_on(serve(listener, port));
        })
        .map_err(|e| e.to_string())?;
    println!("[mvproxy] listening on 127.0.0.1:{port}");
    Ok(Proxy {
        port,
        routes: Mutex::new(HashMap::new()),
    })
}

async fn serve(listener: std::net::TcpListener, port: u16) {
    let listener = match tokio::net::TcpListener::from_std(listener) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[mvproxy] listener: {e}");
            return;
        }
    };
    // A connection that hasn't sent a whole request head in HEADER_TIMEOUT
    // is closed, the idle wait between requests included. There was no
    // timeout at all: 501 of 501 idle sockets were still held after 40s
    // (plan 018, N3). hyper only runs one with a timer.
    let mut http = hyper::server::conn::http1::Builder::new();
    http.timer(hyper_util::rt::TokioTimer::new())
        .header_read_timeout(HEADER_TIMEOUT);
    loop {
        let Ok((tcp, _)) = listener.accept().await else {
            // A lasting accept error (out of handles, say) would otherwise
            // spin this thread flat out.
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            continue;
        };
        let http = http.clone();
        tokio::spawn(async move {
            let svc = hyper::service::service_fn(move |req| handle(req, port));
            let _ = http
                .serve_connection(hyper_util::rt::TokioIo::new(tcp), svc)
                .await;
        });
    }
}

/// How long a connection may take to send a request head. The webview
/// sends its GET at once; this is for sockets that send nothing. A second
/// under test, so the test doesn't wait ten.
const HEADER_TIMEOUT: Duration = if cfg!(test) {
    Duration::from_secs(1)
} else {
    Duration::from_secs(10)
};

/// Register an upstream URL and get the loopback URL that serves it.
/// `convert_hevc`: the caller cannot play HEVC, so convert it (mvconvert.rs).
pub fn open(url: &str, convert_hevc: bool) -> Result<String, String> {
    register(url, convert_hevc, None)
}

/// Register an HLS playlist URL: the same loopback URL, and every playlist
/// it serves has its URIs pointed back here.
pub fn open_hls(url: &str) -> Result<String, String> {
    register(url, false, Some(Children::default()))
}

fn register(url: &str, convert_hevc: bool, hls: Option<Children>) -> Result<String, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "not a URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!("won't proxy a {}: URL", parsed.scheme()));
    }
    let p = proxy()?;
    let mut raw = [0u8; 16];
    getrandom::fill(&mut raw).map_err(|e| format!("no randomness: {e}"))?;
    let token: String = raw.iter().map(|b| format!("{b:02x}")).collect();
    p.routes
        .lock()
        .map_err(|_| "stream proxy state poisoned".to_string())?
        .insert(
            token.clone(),
            Route {
                url: url.to_string(),
                convert_hevc,
                live: Arc::new(tokio::sync::watch::channel(()).0),
                hls,
            },
        );
    Ok(format!("http://127.0.0.1:{}/mv/{}", p.port, token))
}

/// Forget a loopback URL `open` returned, and end what it is serving.
/// Unknown URLs are ignored.
///
/// ENDING IT HERE, not when the webview closes its socket: mpegts.js on a
/// stream that has gone quiet waits for the next chunk before it lets go,
/// and the provider connection stayed held for about 20 seconds, long
/// enough for the tile replacing it to be refused on a full line (plan 018,
/// R5).
pub fn close(local: &str) {
    let Some(Ok(p)) = PROXY.get() else { return };
    // A child's URL (`/mv/{token}/{n}`) closes its whole route.
    if let Some(token) = local
        .split("/mv/")
        .nth(1)
        .map(|t| t.split('/').next().unwrap_or(t))
    {
        if let Ok(mut routes) = p.routes.lock() {
            routes.remove(token);
        }
    }
}

fn empty() -> Body {
    Empty::<Bytes>::new()
        .map_err(|never: Infallible| match never {})
        .boxed()
}

/// A bare reply: no CORS. Anything not about a live route (an unknown
/// token, a rebound hostname, a method nobody sends) gets one, so a web
/// page in any browser on this machine can't read that the proxy is here
/// (plan 018, N4). Every reply used to say `Access-Control-Allow-Origin:
/// *`, 404s included.
fn reply(status: StatusCode) -> Response<Body> {
    let mut res = Response::new(empty());
    *res.status_mut() = status;
    res
}

/// A reply about a live route's stream, which the tile reads: CORS on.
fn stream_reply(status: StatusCode) -> Response<Body> {
    let mut res = reply(status);
    cors(&mut res);
    res
}

fn cors(res: &mut Response<Body>) {
    let h = res.headers_mut();
    h.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
}

fn origin_of(url: &str) -> String {
    reqwest::Url::parse(url)
        .map(|u| u.origin().ascii_serialization())
        .unwrap_or_else(|_| "(unparseable)".into())
}

/// "a" when the stream came from where it was asked for, "a -> b" when a
/// redirect moved it. Origins only: the paths carry the line's credentials.
fn route_of(asked: &str, landed: &reqwest::Url) -> String {
    let from = origin_of(asked);
    let to = landed.origin().ascii_serialization();
    if to != from {
        format!("{from} -> {to}")
    } else {
        from
    }
}

/// Why `fetch` gave up, with the hop it was on.
struct Failed {
    at: reqwest::Url,
    kind: &'static str,
    cause: Option<reqwest::Error>,
}

/// GET with redirects followed here rather than inside reqwest. reqwest
/// follows them in its tower layer, and an error on a later hop still
/// carries the FIRST URL, so "could not connect" could not say to where.
/// Adam's event channels 302 from a provider host that was answering to
/// somewhere that was not (v0.9.101). Every hop stays a GET; a 3xx with no
/// usable Location is returned as it is, and passed through as a status.
async fn fetch(url: &str, range: Option<&HeaderValue>) -> Result<reqwest::Response, Failed> {
    let mut at = reqwest::Url::parse(url).map_err(|_| Failed {
        at: reqwest::Url::parse("http://invalid/").expect("static URL"),
        kind: "not a URL",
        cause: None,
    })?;
    for _ in 0..=10 {
        let mut get = client().get(at.clone()).header(header::ACCEPT, "*/*");
        if let Some(r) = range {
            get = get.header(header::RANGE, r.clone());
        }
        let res = get.send().await.map_err(|e| Failed {
            at: at.clone(),
            kind: if e.is_timeout() {
                "timed out"
            } else if e.is_connect() {
                "could not connect"
            } else {
                "request failed"
            },
            cause: Some(e),
        })?;
        if !res.status().is_redirection() {
            return Ok(res);
        }
        let next = res
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|loc| at.join(loc).ok())
            .filter(|u| matches!(u.scheme(), "http" | "https"));
        match next {
            Some(n) => at = n,
            None => return Ok(res),
        }
    }
    Err(Failed {
        at,
        kind: "too many redirects",
        cause: None,
    })
}

/// The innermost cause of a reqwest error, which is the part that says WHY
/// (a DNS miss, a refused port, a certificate Windows does not trust).
/// reqwest's own top-level message is the URL, so it is skipped, and every
/// URL and path this request touched is cut from what is left.
fn root_cause(e: &reqwest::Error, asked: &str, at: &reqwest::Url) -> String {
    let mut deepest: &dyn std::error::Error = e;
    while let Some(next) = deepest.source() {
        deepest = next;
    }
    let mut msg = if std::ptr::addr_eq(deepest, e as &dyn std::error::Error) {
        String::new()
    } else {
        deepest.to_string()
    };
    for u in [asked.to_string(), at.to_string()] {
        if let Ok(parsed) = reqwest::Url::parse(&u) {
            msg = msg.replace(&u, "[url]");
            if parsed.path().len() > 1 {
                msg = msg.replace(parsed.path(), "[path]");
            }
            if let Some(q) = parsed.query().filter(|q| !q.is_empty()) {
                msg = msg.replace(q, "[query]");
            }
        }
    }
    msg
}

/// A 502 whose reason phrase says what went wrong, so the tile's console
/// line carries it (mpegts.js reports the status text). Printable ASCII
/// only, which is all a reason phrase may hold.
fn bad_gateway(why: &str) -> Response<Body> {
    let mut res = stream_reply(StatusCode::BAD_GATEWAY);
    let text: String = format!("Bad Gateway: {why}")
        .chars()
        .map(|c| {
            if c.is_ascii_graphic() || c == ' ' {
                c
            } else {
                ' '
            }
        })
        .take(200)
        .collect();
    if let Ok(reason) = hyper::ext::ReasonPhrase::try_from(text) {
        res.extensions_mut().insert(reason);
    }
    res
}

async fn handle(req: Request<Incoming>, port: u16) -> Result<Response<Body>, Infallible> {
    // Only ever addressed as 127.0.0.1:{port}. Anything else is a page that
    // rebound its own hostname onto loopback; the token would stop it too,
    // but it has no business getting as far as the lookup.
    let host_ok = req
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .is_some_and(|h| h == format!("127.0.0.1:{port}"));
    if !host_ok {
        return Ok(reply(StatusCode::MISDIRECTED_REQUEST));
    }
    // The route first: only a live one's replies carry CORS (N4). An HLS
    // route's children are `/mv/{token}/{n}`, and only ever a number the
    // route minted.
    let upstream = req.uri().path().strip_prefix("/mv/").and_then(|rest| {
        let (token, child) = match rest.split_once('/') {
            Some((t, n)) => (t, Some(n.parse::<u64>().ok()?)),
            None => (rest, None),
        };
        let p = proxy().ok()?;
        let routes = p.routes.lock().ok()?;
        let r = routes.get(token)?;
        let url = match child {
            Some(n) => r.hls.as_ref()?.by_id.get(&n)?.clone(),
            None => r.url.clone(),
        };
        Some((
            token.to_string(),
            url,
            child.is_some(),
            r.hls.is_some(),
            r.convert_hevc,
            r.live.subscribe(),
        ))
    });
    let Some((token, url, is_child, is_hls, convert_hevc, live)) = upstream else {
        return Ok(reply(StatusCode::NOT_FOUND));
    };
    if req.method() == Method::OPTIONS {
        let mut res = stream_reply(StatusCode::NO_CONTENT);
        let h = res.headers_mut();
        h.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET, OPTIONS"),
        );
        h.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("*"),
        );
        h.insert(
            header::ACCESS_CONTROL_MAX_AGE,
            HeaderValue::from_static("600"),
        );
        return Ok(res);
    }
    if req.method() != Method::GET {
        return Ok(reply(StatusCode::METHOD_NOT_ALLOWED));
    }
    if is_hls {
        let range = req.headers().get(header::RANGE).cloned();
        return Ok(hls(&token, &url, is_child, range, port).await);
    }

    let res = match fetch(&url, None).await {
        Ok(r) => r,
        Err(f) => return Ok(failed(&url, &f)),
    };
    let status = res.status();
    println!(
        "[mvproxy] {}: {}",
        route_of(&url, res.url()),
        status.as_u16()
    );
    if !status.is_success() {
        // Passed through, so the tile's console line names the real code:
        // a 403 from the provider and a dead proxy are different problems.
        return Ok(stream_reply(
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
        ));
    }
    let mut res = res;
    // What was read to see what the stream is: the first bytes of whatever
    // is sent on, converted or not.
    let mut head = Vec::new();
    if convert_hevc {
        // PAT and PMT repeat several times a second, so this is seconds of
        // stream. A stream whose map never shows is passed through.
        const LOOK: usize = 2 * 1024 * 1024;
        let verdict = loop {
            match mvconvert::sniff(&head) {
                Sniff::NeedMore if head.len() < LOOK => match res.chunk().await {
                    Ok(Some(b)) => head.extend_from_slice(&b),
                    _ => break Sniff::Other,
                },
                Sniff::NeedMore => break Sniff::Other,
                v => break v,
            }
        };
        if verdict == Sniff::Hevc {
            return Ok(convert(Bytes::from(head), res, live).await);
        }
    }
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| HeaderValue::from_bytes(v.as_bytes()).ok())
        .unwrap_or_else(|| HeaderValue::from_static("video/mp2t"));

    // Chunks as they arrive. A read error ends the body; hyper then closes
    // the connection and mpegts.js reports it like any dropped stream.
    let head = (!head.is_empty()).then(|| Ok(Bytes::from(head)));
    let chunks = stream::iter(head).chain(stream::unfold(Some(res), |state| async move {
        let mut r = state?;
        match r.chunk().await {
            Ok(Some(b)) => Some((Ok(b), Some(r))),
            Ok(None) => None,
            Err(_) => Some((Err(std::io::Error::other("upstream read failed")), None)),
        }
    }));
    let body = live_body(chunks, live).map(|chunk| chunk.map(Frame::data));
    let mut out = Response::new(BodyExt::boxed(StreamBody::new(body)));
    out.headers_mut().insert(header::CONTENT_TYPE, content_type);
    cors(&mut out);
    Ok(out)
}

/// A 502 for a fetch that failed: WHERE (a redirect can move the stream to
/// another server) and WHY. v0.9.101 said only "could not connect", on a
/// provider whose own host was answering at the same moment.
fn failed(url: &str, f: &Failed) -> Response<Body> {
    let route = route_of(url, &f.at);
    let cause = f
        .cause
        .as_ref()
        .map(|e| root_cause(e, url, &f.at))
        .unwrap_or_default();
    let why = if cause.is_empty() {
        format!("{} ({route})", f.kind)
    } else {
        format!("{} ({route}): {cause}", f.kind)
    };
    println!("[mvproxy] {why}");
    bad_gateway(&why)
}

/// The most a playlist may be. A live one is a few KB; a long VOD one with
/// byte ranges runs to hundreds.
const PLAYLIST_CAP: usize = 8 * 1024 * 1024;

/// An HLS route's request: a playlist, its URIs pointed back here, or
/// anything one names (a segment, a key, an init map), passed through and
/// ended cleanly, since each is a file. Only the route's own playlist is
/// logged; its segments come every few seconds.
async fn hls(
    token: &str,
    url: &str,
    is_child: bool,
    range: Option<HeaderValue>,
    port: u16,
) -> Response<Body> {
    let res = match fetch(url, range.as_ref()).await {
        Ok(r) => r,
        Err(f) => return failed(url, &f),
    };
    let status = res.status();
    if !is_child || !status.is_success() {
        println!(
            "[mvproxy] hls {}: {}",
            route_of(url, res.url()),
            status.as_u16()
        );
    }
    if !status.is_success() {
        return stream_reply(
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
        );
    }
    let content_type = res.headers().get(reqwest::header::CONTENT_TYPE).cloned();
    if says_playlist(content_type.as_ref(), res.url()) {
        let base = res.url().clone();
        let mut res = res;
        let mut body = Vec::new();
        loop {
            match res.chunk().await {
                Ok(Some(b)) if body.len() + b.len() <= PLAYLIST_CAP => body.extend_from_slice(&b),
                Ok(Some(_)) => return bad_gateway("playlist too large"),
                Ok(None) => break,
                Err(_) => return bad_gateway("playlist read failed"),
            }
        }
        let text = std::str::from_utf8(&body).ok().filter(|t| {
            t.trim_start_matches('\u{feff}')
                .trim_start()
                .starts_with("#EXTM3U")
        });
        let out = match text {
            Some(text) => {
                let Some(p) = proxy().ok() else {
                    return reply(StatusCode::NOT_FOUND);
                };
                let Ok(mut routes) = p.routes.lock() else {
                    return reply(StatusCode::NOT_FOUND);
                };
                // Closed while the playlist was on its way.
                let Some(children) = routes.get_mut(token).and_then(|r| r.hls.as_mut()) else {
                    return reply(StatusCode::NOT_FOUND);
                };
                children.begin();
                let text = rewrite_playlist(text, &base, |abs| {
                    format!("http://127.0.0.1:{port}/mv/{token}/{}", children.mint(abs))
                });
                children.trim();
                Bytes::from(text)
            }
            // Said it was a playlist and isn't one: sent on as it came.
            None => Bytes::from(body),
        };
        let mut res = Response::new(
            Full::new(out)
                .map_err(|never: Infallible| match never {})
                .boxed(),
        );
        res.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/vnd.apple.mpegurl"),
        );
        cors(&mut res);
        return res;
    }
    let content_range = res.headers().get(reqwest::header::CONTENT_RANGE).cloned();
    let chunks = stream::unfold(Some(res), |state| async move {
        let mut r = state?;
        match r.chunk().await {
            Ok(Some(b)) => Some((Ok(b), Some(r))),
            Ok(None) => None,
            Err(_) => Some((Err(std::io::Error::other("upstream read failed")), None)),
        }
    });
    let mut out = Response::new(BodyExt::boxed(StreamBody::new(
        chunks.map(|chunk| chunk.map(Frame::data)),
    )));
    *out.status_mut() = StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK);
    let h = out.headers_mut();
    h.insert(
        header::CONTENT_TYPE,
        content_type.unwrap_or_else(|| HeaderValue::from_static("application/octet-stream")),
    );
    if let Some(cr) = content_range {
        h.insert(header::CONTENT_RANGE, cr);
        h.insert(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            HeaderValue::from_static("Content-Range"),
        );
    }
    cors(&mut out);
    out
}

/// A playlist by its type, or by its name when the server doesn't say.
fn says_playlist(content_type: Option<&HeaderValue>, at: &reqwest::Url) -> bool {
    let by_type = content_type
        .and_then(|v| v.to_str().ok())
        .is_some_and(|t| t.to_ascii_lowercase().contains("mpegurl"));
    let path = at.path().to_ascii_lowercase();
    by_type || path.ends_with(".m3u8") || path.ends_with(".m3u")
}

/// Every URI a playlist names, through `mint`: the URI lines (variants,
/// segments) and the URI="…" attribute of any #EXT tag (EXT-X-KEY,
/// EXT-X-MAP, EXT-X-MEDIA, EXT-X-I-FRAME-STREAM-INF, EXT-X-PART,
/// EXT-X-PRELOAD-HINT, EXT-X-RENDITION-REPORT, EXT-X-SESSION-KEY and
/// -DATA). Relative ones resolve against `base`, the URL the playlist came
/// from after its redirects. A URI that isn't http(s) (a DRM `skd:`) is
/// left as it is. A byte-order mark goes: read as a URI line, it would be
/// rewritten and the playlist would no longer start #EXTM3U.
fn rewrite_playlist(
    body: &str,
    base: &reqwest::Url,
    mut mint: impl FnMut(&str) -> String,
) -> String {
    let body = body.strip_prefix('\u{feff}').unwrap_or(body);
    let absolute = |uri: &str| {
        base.join(uri)
            .ok()
            .filter(|u| matches!(u.scheme(), "http" | "https"))
            .map(|u| u.to_string())
    };
    let mut out = String::with_capacity(body.len() + 512);
    for line in body.lines() {
        let t = line.trim();
        if t.is_empty() {
            out.push_str(line);
        } else if t.starts_with("#EXT") {
            let mut rest = line;
            while let Some(i) = rest.find("URI=\"") {
                // An attribute starts the list or follows a comma.
                let at_start = i > 0 && matches!(rest.as_bytes()[i - 1], b':' | b',');
                let (head, tail) = rest.split_at(i + 5);
                out.push_str(head);
                let Some(end) = tail.find('"') else {
                    rest = tail;
                    break;
                };
                let value = &tail[..end];
                match absolute(value).filter(|_| at_start) {
                    Some(abs) => out.push_str(&mint(&abs)),
                    None => out.push_str(value),
                }
                rest = &tail[end..];
            }
            out.push_str(rest);
        } else if t.starts_with('#') {
            out.push_str(line);
        } else {
            match absolute(t) {
                Some(abs) => out.push_str(&mint(&abs)),
                None => out.push_str(line),
            }
        }
        out.push('\n');
    }
    out
}

/// An HEVC stream, through ffmpeg. The tile hears nothing until ffmpeg has
/// produced its first bytes, so a conversion that cannot start is a 502 that
/// says why rather than a stream that ends at once.
async fn convert(
    head: Bytes,
    res: reqwest::Response,
    live: tokio::sync::watch::Receiver<()>,
) -> Response<Body> {
    let started = std::time::Instant::now();
    let input = stream::unfold(Some(res), |state| async move {
        let mut r = state?;
        match r.chunk().await {
            Ok(Some(b)) => Some((b, Some(r))),
            _ => None,
        }
    });
    let converted = match mvconvert::caps().await {
        Ok(caps) => mvconvert::start(caps, head, input)
            .await
            .map(|body| (caps.encoder, body)),
        Err(e) => Err(e),
    };
    match converted {
        Ok((encoder, body)) => {
            println!(
                "[mvproxy] HEVC -> H.264 on {encoder}, first bytes after {}ms",
                started.elapsed().as_millis()
            );
            let mut out = Response::new(BodyExt::boxed(StreamBody::new(
                live_body(body, live).map(|chunk| chunk.map(Frame::data)),
            )));
            out.headers_mut()
                .insert(header::CONTENT_TYPE, HeaderValue::from_static("video/mp2t"));
            cors(&mut out);
            out
        }
        Err(why) => {
            println!("[mvproxy] can't convert HEVC: {why}");
            bad_gateway(&format!("can't convert HEVC: {why}"))
        }
    }
}

/// What a tile is served: `inner` until the route is closed, and never a
/// clean end. A live stream has none, so one that stops (the provider closed
/// it, went quiet past the read timeout, ffmpeg exited) ends with an error:
/// hyper then cuts the connection rather than finishing the body, and the
/// tile hears a dropped stream, not a finished one (plan 018, R2).
fn live_body<S>(
    inner: S,
    live: tokio::sync::watch::Receiver<()>,
) -> impl Stream<Item = Result<Bytes, std::io::Error>> + Send + 'static
where
    S: Stream<Item = Result<Bytes, std::io::Error>> + Send + 'static,
{
    stream::unfold(Some((Box::pin(inner), live)), |state| async move {
        let (mut inner, mut live) = state?;
        let next = {
            let gone = std::pin::pin!(closed(&mut live));
            match select(gone, inner.next()).await {
                Either::Left(_) => None,
                Either::Right((next, _)) => Some(next),
            }
        };
        match next {
            None => Some((
                Err(std::io::Error::other("the tile closed the stream")),
                None,
            )),
            Some(Some(Ok(b))) => Some((Ok(b), Some((inner, live)))),
            Some(Some(Err(e))) => Some((Err(e), None)),
            Some(None) => Some((Err(std::io::Error::other("the stream ended")), None)),
        }
    })
}

/// Resolves when the route is closed: its sender, held only by the route,
/// has gone. Nothing is ever sent on it.
async fn closed(live: &mut tokio::sync::watch::Receiver<()>) {
    while live.changed().await.is_ok() {}
}

#[cfg(test)]
mod tests {
    //! Driven for real: a fake provider on one loopback port, the proxy on
    //! another, and raw HTTP between them, so what is asserted is the bytes
    //! a webview would see.
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    /// A provider that behaves like Adam's: the stream URL answers 302 with
    /// no CORS header, and the target serves MPEG-TS packets until the
    /// reader goes away. `/forbidden` is a 403. `/dead/…` redirects to a
    /// port nothing listens on, the shape of his event channels' failure.
    /// `hung_up` flips when a stream write fails, which is how a test sees
    /// the upstream released.
    fn fake_provider() -> (String, Arc<AtomicBool>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", l.local_addr().unwrap());
        // Bound and dropped, so the port is known to be closed.
        let closed = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let hung_up = Arc::new(AtomicBool::new(false));
        let flag = hung_up.clone();
        std::thread::spawn(move || {
            for conn in l.incoming() {
                let Ok(mut conn) = conn else { continue };
                let flag = flag.clone();
                std::thread::spawn(move || {
                    let mut line = String::new();
                    let mut reader = BufReader::new(conn.try_clone().unwrap());
                    reader.read_line(&mut line).unwrap();
                    loop {
                        let mut h = String::new();
                        if reader.read_line(&mut h).unwrap() <= 2 {
                            break;
                        }
                    }
                    let path = line.split_whitespace().nth(1).unwrap_or("").to_string();
                    if path.starts_with("/live/") {
                        let _ = conn.write_all(
                            b"HTTP/1.1 302 Found\r\nLocation: /cdn/stream.ts\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        );
                    } else if path.starts_with("/dead/") {
                        let _ = write!(
                            conn,
                            "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{closed}/edge/secret-token.ts\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        );
                    } else if path.starts_with("/short/") {
                        // A stream the provider ends: some packets, then
                        // the connection closed cleanly.
                        let _ = conn.write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nConnection: close\r\n\r\n",
                        );
                        let mut packet = [0u8; 188];
                        packet[0] = 0x47;
                        for _ in 0..50 {
                            let _ = conn.write_all(&packet);
                        }
                    } else if path.starts_with("/quiet/") {
                        // Some packets, then silence with the socket held
                        // open. `hung_up` flips when the proxy lets go of
                        // it: the read sees the connection closed.
                        let _ = conn.write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nConnection: close\r\n\r\n",
                        );
                        let mut packet = [0u8; 188];
                        packet[0] = 0x47;
                        for _ in 0..50 {
                            let _ = conn.write_all(&packet);
                        }
                        let mut one = [0u8; 1];
                        loop {
                            match conn.read(&mut one) {
                                Ok(0) | Err(_) => {
                                    flag.store(true, Ordering::SeqCst);
                                    break;
                                }
                                Ok(_) => {}
                            }
                        }
                    } else if path == "/cdn/stream.ts" {
                        let _ = conn.write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nConnection: close\r\n\r\n",
                        );
                        let mut packet = [0u8; 188];
                        packet[0] = 0x47; // the MPEG-TS sync byte
                        loop {
                            if conn.write_all(&packet).is_err() {
                                flag.store(true, Ordering::SeqCst);
                                break;
                            }
                            std::thread::sleep(Duration::from_millis(5));
                        }
                    } else {
                        let _ = conn.write_all(
                            b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        );
                    }
                });
            }
        });
        (base, hung_up)
    }

    /// One raw request; returns the status, the headers (lowercased names),
    /// and the open reader positioned at the body.
    fn get(
        local: &str,
        method: &str,
        host: Option<&str>,
    ) -> (u16, HashMap<String, String>, BufReader<TcpStream>) {
        request(local, method, host, "")
    }

    /// `get` with more header lines, each ending "\r\n".
    fn request(
        local: &str,
        method: &str,
        host: Option<&str>,
        extra: &str,
    ) -> (u16, HashMap<String, String>, BufReader<TcpStream>) {
        let rest = local.strip_prefix("http://").unwrap();
        let (addr, path) = rest.split_at(rest.find('/').unwrap());
        let mut s = TcpStream::connect(addr).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        let host = host.unwrap_or(addr);
        write!(
            s,
            "{method} {path} HTTP/1.1\r\nHost: {host}\r\nOrigin: http://tauri.localhost\r\n{extra}\r\n"
        )
        .unwrap();
        let mut r = BufReader::new(s);
        let mut status = String::new();
        r.read_line(&mut status).unwrap();
        let code = status.split_whitespace().nth(1).unwrap().parse().unwrap();
        let mut headers = HashMap::new();
        // The reason phrase, under a key no real header can have.
        let reason = status.trim_end().splitn(3, ' ').nth(2).unwrap_or("");
        headers.insert(":reason".to_string(), reason.to_string());
        loop {
            let mut h = String::new();
            r.read_line(&mut h).unwrap();
            let h = h.trim_end();
            if h.is_empty() {
                break;
            }
            let (k, v) = h.split_once(':').unwrap();
            headers.insert(k.to_ascii_lowercase(), v.trim().to_string());
        }
        (code, headers, r)
    }

    #[test]
    fn follows_the_redirect_and_adds_the_cors_header() {
        let (base, _) = fake_provider();
        let local = open(&format!("{base}/live/user/pass/1.ts"), false).unwrap();
        assert!(local.starts_with("http://127.0.0.1:"), "{local}");
        assert!(
            !local.contains("user") && !local.contains("pass"),
            "{local}"
        );
        let (code, headers, mut body) = get(&local, "GET", None);
        assert_eq!(code, 200);
        assert_eq!(
            headers
                .get("access-control-allow-origin")
                .map(String::as_str),
            Some("*")
        );
        assert_eq!(
            headers.get("content-type").map(String::as_str),
            Some("video/mp2t")
        );
        // Chunked, so skip the size line and read the first packet's sync byte.
        let mut size = String::new();
        body.read_line(&mut size).unwrap();
        let mut first = [0u8; 1];
        body.read_exact(&mut first).unwrap();
        assert_eq!(first[0], 0x47);
    }

    #[test]
    fn a_closed_tile_hands_the_provider_connection_back() {
        let (base, hung_up) = fake_provider();
        let local = open(&format!("{base}/live/a/b/2.ts"), false).unwrap();
        let (code, _, body) = get(&local, "GET", None);
        assert_eq!(code, 200);
        std::thread::sleep(Duration::from_millis(200));
        drop(body); // the tile goes away
        let t = std::time::Instant::now();
        while !hung_up.load(Ordering::SeqCst) && t.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(
            hung_up.load(Ordering::SeqCst),
            "upstream still held after the reader left"
        );
    }

    /// A chunked body to its end: the bytes, and whether it FINISHED (the
    /// terminating zero-size chunk) rather than being cut off.
    fn to_end(r: &mut BufReader<TcpStream>) -> (Vec<u8>, bool) {
        let mut out = Vec::new();
        loop {
            let mut size = String::new();
            match r.read_line(&mut size) {
                Ok(0) | Err(_) => return (out, false),
                Ok(_) => {}
            }
            let Ok(n) = usize::from_str_radix(size.trim(), 16) else {
                return (out, false);
            };
            if n == 0 {
                return (out, true);
            }
            let mut chunk = vec![0u8; n + 2];
            if r.read_exact(&mut chunk).is_err() {
                return (out, false);
            }
            chunk.truncate(n);
            out.extend(chunk);
        }
    }

    #[test]
    fn a_stream_the_provider_ends_reaches_the_tile_as_a_drop() {
        // Plan 018, R2: a clean end read as a finished stream, and the tile
        // froze on its last frame. A live one never finishes.
        let (base, _) = fake_provider();
        let local = open(&format!("{base}/short/a/b/11.ts"), false).unwrap();
        let (code, _, mut body) = get(&local, "GET", None);
        assert_eq!(code, 200);
        let (bytes, finished) = to_end(&mut body);
        assert!(bytes.len() >= 188, "{} bytes", bytes.len());
        assert!(!finished, "the body finished cleanly");
    }

    #[test]
    fn closing_the_route_lets_a_quiet_provider_go_at_once() {
        // Plan 018, R5: close() only forgot the token, and a quiet stream's
        // provider connection stayed held until the 20s read timeout.
        let (base, hung_up) = fake_provider();
        let local = open(&format!("{base}/quiet/a/b/12.ts"), false).unwrap();
        let (code, _, mut body) = get(&local, "GET", None);
        assert_eq!(code, 200);
        body_bytes(&mut body, 188);
        close(&local);
        let t = std::time::Instant::now();
        while !hung_up.load(Ordering::SeqCst) && t.elapsed() < Duration::from_secs(2) {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(
            hung_up.load(Ordering::SeqCst),
            "the provider was still held after close"
        );
        // And the tile, still reading, hears a drop, not an end.
        assert!(!to_end(&mut body).1);
    }

    #[test]
    fn passes_a_provider_refusal_through() {
        let (base, _) = fake_provider();
        let local = open(&format!("{base}/forbidden"), false).unwrap();
        let (code, headers, _) = get(&local, "GET", None);
        assert_eq!(code, 403);
        assert_eq!(
            headers
                .get("access-control-allow-origin")
                .map(String::as_str),
            Some("*")
        );
    }

    #[test]
    fn unknown_and_closed_tokens_are_not_found() {
        let (base, _) = fake_provider();
        let local = open(&format!("{base}/live/a/b/3.ts"), false).unwrap();
        let port = local.split(':').nth(2).unwrap().split('/').next().unwrap();
        let (code, headers, _) = get(&format!("http://127.0.0.1:{port}/mv/nope"), "GET", None);
        assert_eq!(code, 404);
        // Nothing a web page could read: no CORS on what isn't a stream (N4).
        assert!(!headers.contains_key("access-control-allow-origin"));
        let (code, headers, _) = get(&format!("http://127.0.0.1:{port}/mv/nope"), "OPTIONS", None);
        assert_eq!(code, 404);
        assert!(!headers.contains_key("access-control-allow-origin"));
        close(&local);
        let (code, headers, _) = get(&local, "GET", None);
        assert_eq!(code, 404);
        assert!(!headers.contains_key("access-control-allow-origin"));
    }

    #[test]
    fn a_connection_that_sends_nothing_is_closed() {
        // N3: there was no timeout at all, and every idle socket was held.
        let (base, _) = fake_provider();
        let local = open(&format!("{base}/live/a/b/9.ts"), false).unwrap();
        let port: u16 = local
            .split(':')
            .nth(2)
            .unwrap()
            .split('/')
            .next()
            .unwrap()
            .parse()
            .unwrap();
        let mut idle = TcpStream::connect(("127.0.0.1", port)).unwrap();
        idle.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let t = std::time::Instant::now();
        let mut buf = [0u8; 64];
        // Closed from the far end: a read of nothing, or a reset.
        let closed =
            matches!(idle.read(&mut buf), Ok(0) | Err(_)) && t.elapsed() < Duration::from_secs(4);
        assert!(closed, "still open after {:?}", t.elapsed());
    }

    #[test]
    fn answers_a_preflight() {
        let (base, _) = fake_provider();
        let local = open(&format!("{base}/live/a/b/4.ts"), false).unwrap();
        let (code, headers, _) = get(&local, "OPTIONS", None);
        assert_eq!(code, 204);
        assert_eq!(
            headers
                .get("access-control-allow-origin")
                .map(String::as_str),
            Some("*")
        );
        assert!(headers
            .get("access-control-allow-methods")
            .is_some_and(|m| m.contains("GET")));
    }

    #[test]
    fn refuses_a_rebound_hostname() {
        let (base, _) = fake_provider();
        let local = open(&format!("{base}/live/a/b/5.ts"), false).unwrap();
        let (code, _, _) = get(&local, "GET", Some("evil.example"));
        assert_eq!(code, 421);
    }

    #[test]
    fn says_which_server_failed_and_why_without_the_path() {
        let (base, _) = fake_provider();
        let local = open(&format!("{base}/dead/user/pass/6.ts"), false).unwrap();
        let (code, headers, _) = get(&local, "GET", None);
        assert_eq!(code, 502);
        let reason = &headers[":reason"];
        // Where: the redirect's target, not just the provider asked.
        assert!(reason.contains("could not connect"), "{reason}");
        assert!(reason.contains(" -> http://127.0.0.1:"), "{reason}");
        // Why: something past reqwest's own top-level message.
        assert!(reason.contains("): "), "no cause in {reason}");
        // Never a path: the first hop's carries the credentials.
        for secret in ["user", "pass", "secret-token", "/edge/", "/dead/"] {
            assert!(!reason.contains(secret), "{secret} leaked: {reason}");
        }
    }

    // ------------------------------------------------ HLS

    #[test]
    fn a_playlist_rewrite_touches_only_its_uris() {
        let base = reqwest::Url::parse("https://cdn.example/a/b/index.m3u8?sig=1").unwrap();
        let body = "\u{feff}#EXTM3U\r\n\
            #EXT-X-KEY:METHOD=AES-128,URI=\"k.bin\",IV=0x1\r\n\
            #EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"skd://drm-id\",KEYFORMAT=\"com.apple.streamingkeydelivery\"\r\n\
            #EXT-X-MAP:URI=\"/init.mp4\",BYTERANGE=\"720@0\"\r\n\
            #EXT-X-FOO:XURI=\"x.ts\"\r\n\
            # URI=\"c.ts\" in a comment\r\n\
            #EXTINF:4,\r\n\
            seg.ts?n=1\r\n\
            \r\n  ../up/seg.ts  \r\n\
            #EXTINF:4,\r\n\
            https://other.example/s.ts\r\n\
            seg.ts?n=1\r\n";
        let mut named = Vec::new();
        let out = rewrite_playlist(body, &base, |abs| {
            named.push(abs.to_string());
            format!("<{abs}>")
        });
        assert_eq!(
            out,
            "#EXTM3U\n\
             #EXT-X-KEY:METHOD=AES-128,URI=\"<https://cdn.example/a/b/k.bin>\",IV=0x1\n\
             #EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"skd://drm-id\",KEYFORMAT=\"com.apple.streamingkeydelivery\"\n\
             #EXT-X-MAP:URI=\"<https://cdn.example/init.mp4>\",BYTERANGE=\"720@0\"\n\
             #EXT-X-FOO:XURI=\"x.ts\"\n\
             # URI=\"c.ts\" in a comment\n\
             #EXTINF:4,\n\
             <https://cdn.example/a/b/seg.ts?n=1>\n\
             \n\
             <https://cdn.example/a/up/seg.ts>\n\
             #EXTINF:4,\n\
             <https://other.example/s.ts>\n\
             <https://cdn.example/a/b/seg.ts?n=1>\n"
        );
        assert_eq!(named.len(), 6, "{named:?}");
    }

    #[test]
    fn a_uri_keeps_its_number_and_only_stale_ones_are_forgotten() {
        let mut c = Children::default();
        c.begin();
        let first = c.mint("https://x/first.ts");
        assert_eq!(c.mint("https://x/first.ts"), first);
        // One playlist naming more than CAP (a long VOD): every URI in it
        // stays, the one only the last playlist named goes.
        c.begin();
        let big: Vec<u64> = (0..Children::CAP + 100)
            .map(|i| c.mint(&format!("https://x/{i}.ts")))
            .collect();
        c.trim();
        assert!(!c.by_id.contains_key(&first));
        assert!(big.iter().all(|id| c.by_id.contains_key(id)));
        // The next reload names only its window: back to CAP, and the window
        // (named again, so fresh) keeps its numbers.
        c.begin();
        let window: Vec<u64> = (Children::CAP + 90..Children::CAP + 100)
            .map(|i| c.mint(&format!("https://x/{i}.ts")))
            .collect();
        c.trim();
        assert_eq!(window, big[Children::CAP + 90..]);
        assert_eq!(c.by_id.len(), Children::CAP);
        assert_eq!(c.by_url.len(), Children::CAP);
        assert!(window.iter().all(|id| c.by_id.contains_key(id)));
        assert!(!c.by_id.contains_key(&big[0]));
    }

    /// A segment: 1000 bytes, so a range out of it is its own.
    fn segment() -> Vec<u8> {
        (0..1000u32).map(|i| (i % 251) as u8).collect()
    }

    /// A provider's HLS. The master playlist redirects to the CDN's copy,
    /// so relative URIs resolve against where it landed. The media playlist
    /// comes as text/plain, the way some servers send it, known by its
    /// name. A segment answers a byte range with a 206.
    fn fake_hls() -> String {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", l.local_addr().unwrap());
        let host = base.clone();
        std::thread::spawn(move || {
            for conn in l.incoming() {
                let Ok(mut conn) = conn else { continue };
                let host = host.clone();
                std::thread::spawn(move || {
                    let mut reader = BufReader::new(conn.try_clone().unwrap());
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    let mut range = None;
                    loop {
                        let mut h = String::new();
                        if reader.read_line(&mut h).unwrap() <= 2 {
                            break;
                        }
                        let h = h.trim_end().to_ascii_lowercase();
                        if let Some(r) = h.strip_prefix("range: bytes=") {
                            let (a, b) = r.split_once('-').unwrap();
                            range =
                                Some((a.parse::<usize>().unwrap(), b.parse::<usize>().unwrap()));
                        }
                    }
                    let path = line.split_whitespace().nth(1).unwrap_or("").to_string();
                    let mut send = |status: &str, ty: &str, extra: &str, body: &[u8]| {
                        let _ = write!(
                            conn,
                            "HTTP/1.1 {status}\r\nContent-Type: {ty}\r\nContent-Length: {}\r\n{extra}Connection: close\r\n\r\n",
                            body.len()
                        );
                        let _ = conn.write_all(body);
                    };
                    let mpegurl = "application/vnd.apple.mpegurl";
                    match path.as_str() {
                        "/hls/user/pass/master.m3u8" => send(
                            "302 Found",
                            "text/plain",
                            "Location: /cdn/tok/master.m3u8\r\n",
                            b"",
                        ),
                        "/cdn/tok/master.m3u8" => send(
                            "200 OK",
                            mpegurl,
                            "",
                            format!(
                                "#EXTM3U\n\
                                 #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"aud\",NAME=\"English\",URI=\"audio/en.m3u8\"\n\
                                 #EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS=\"avc1.4d401f,mp4a.40.2\",AUDIO=\"aud\"\n\
                                 low/index.m3u8?sig=secret\n\
                                 #EXT-X-STREAM-INF:BANDWIDTH=3000000,AUDIO=\"aud\"\n\
                                 {host}/cdn/tok/high/index.m3u8\n"
                            )
                            .as_bytes(),
                        ),
                        "/cdn/tok/low/index.m3u8?sig=secret" => send(
                            "200 OK",
                            "text/plain",
                            "",
                            b"#EXTM3U\n\
                              #EXT-X-TARGETDURATION:4\n\
                              #EXT-X-KEY:METHOD=AES-128,URI=\"../keys/k1.bin\",IV=0x1\n\
                              #EXT-X-MAP:URI=\"init.mp4\"\n\
                              #EXTINF:4.0,\n\
                              seg1.ts\n\
                              #EXTINF:4.0,\n\
                              /cdn/tok/low/seg2.ts\n",
                        ),
                        "/cdn/tok/keys/k1.bin" => {
                            send("200 OK", "application/octet-stream", "", b"KEY1")
                        }
                        "/cdn/tok/low/seg1.ts" => match range {
                            Some((a, b)) => send(
                                "206 Partial Content",
                                "video/mp2t",
                                &format!("Content-Range: bytes {a}-{b}/1000\r\n"),
                                &segment()[a..=b],
                            ),
                            None => send("200 OK", "video/mp2t", "", &segment()),
                        },
                        _ => send("403 Forbidden", "text/plain", "", b""),
                    }
                });
            }
        });
        base
    }

    /// A whole body: chunked or by Content-Length.
    fn whole(headers: &HashMap<String, String>, r: &mut BufReader<TcpStream>) -> Vec<u8> {
        match headers.get("content-length") {
            Some(n) => {
                let mut out = vec![0u8; n.parse().unwrap()];
                r.read_exact(&mut out).unwrap();
                out
            }
            None => {
                let (out, finished) = to_end(r);
                assert!(finished, "a file's body was cut off");
                out
            }
        }
    }

    #[test]
    fn an_hls_route_points_every_uri_in_its_playlists_back_here() {
        let base = fake_hls();
        let local = open_hls(&format!("{base}/hls/user/pass/master.m3u8")).unwrap();
        let (code, headers, mut body) = get(&local, "GET", None);
        assert_eq!(code, 200);
        assert_eq!(
            headers
                .get("access-control-allow-origin")
                .map(String::as_str),
            Some("*")
        );
        assert_eq!(
            headers.get("content-type").map(String::as_str),
            Some("application/vnd.apple.mpegurl")
        );
        let master = String::from_utf8(whole(&headers, &mut body)).unwrap();
        // Nothing of the provider's reaches the webview: not its host, not
        // the path with the line's credentials, not a signed query.
        let provider = format!("{base}/");
        for secret in [provider.as_str(), "user", "pass", "secret", "/cdn/", "tok"] {
            assert!(!master.contains(secret), "{secret} in {master}");
        }
        // The tags themselves are untouched.
        assert!(master.contains(
            "#EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS=\"avc1.4d401f,mp4a.40.2\",AUDIO=\"aud\"\n"
        ));
        let child = format!("{local}/");
        let uris: Vec<&str> = master.lines().filter(|l| !l.starts_with('#')).collect();
        assert_eq!(uris.len(), 2, "{master}");
        assert!(uris.iter().all(|u| u.starts_with(&child)), "{master}");
        assert!(master.contains(&format!("URI=\"{child}")), "{master}");

        // The variant: a playlist by its name alone, rewritten the same way.
        let (code, headers, mut body) = get(uris[0], "GET", None);
        assert_eq!(code, 200);
        let media = String::from_utf8(whole(&headers, &mut body)).unwrap();
        assert!(
            !media.contains(&provider) && !media.contains("seg1"),
            "{media}"
        );
        let key = media
            .split("URI=\"")
            .nth(1)
            .and_then(|s| s.split('"').next())
            .unwrap()
            .to_string();
        let segs: Vec<&str> = media.lines().filter(|l| !l.starts_with('#')).collect();
        assert_eq!(segs.len(), 2, "{media}");

        // "../keys/k1.bin" resolved against the variant's own URL.
        let (code, headers, mut body) = get(&key, "GET", None);
        assert_eq!(code, 200);
        assert_eq!(whole(&headers, &mut body), b"KEY1");

        // A segment: its bytes as they came, and a clean end.
        let (code, headers, mut body) = get(segs[0], "GET", None);
        assert_eq!(code, 200);
        assert_eq!(
            headers.get("content-type").map(String::as_str),
            Some("video/mp2t")
        );
        assert_eq!(whole(&headers, &mut body), segment());

        // A byte range: a 206 whose Content-Range the webview may read.
        let (code, headers, mut body) = request(segs[0], "GET", None, "Range: bytes=100-199\r\n");
        assert_eq!(code, 206);
        assert_eq!(
            headers.get("content-range").map(String::as_str),
            Some("bytes 100-199/1000")
        );
        assert_eq!(
            headers
                .get("access-control-expose-headers")
                .map(String::as_str),
            Some("Content-Range")
        );
        assert_eq!(whole(&headers, &mut body), &segment()[100..200]);

        // A reload names the same segments by the same numbers.
        let (_, headers, mut body) = get(uris[0], "GET", None);
        assert_eq!(
            String::from_utf8(whole(&headers, &mut body)).unwrap(),
            media
        );

        // Only numbers the route minted, and only on an HLS route.
        let (code, headers, _) = get(&format!("{local}/999999"), "GET", None);
        assert_eq!(code, 404);
        assert!(!headers.contains_key("access-control-allow-origin"));
        let (code, _, _) = get(&format!("{local}/../mv"), "GET", None);
        assert_eq!(code, 404);
        let plain = open(&format!("{base}/cdn/tok/low/seg1.ts"), false).unwrap();
        let (code, _, _) = get(&format!("{plain}/0"), "GET", None);
        assert_eq!(code, 404);

        // Closing by any of its URLs ends the whole route.
        close(segs[1]);
        for gone in [local.as_str(), uris[0], segs[0]] {
            let (code, _, _) = get(gone, "GET", None);
            assert_eq!(code, 404, "{gone}");
        }
    }

    // ------------------------------------------------ HEVC, converted
    //
    // These run the real ffmpeg: BLAMMYTV_FFMPEG, which CI points at the
    // build the app bundles (scripts/fetch-ffmpeg.mjs). One at a time, so
    // `mvconvert::running()` counts only the test's own conversion.

    static SERIAL: Mutex<()> = Mutex::new(());

    fn ffmpeg() -> String {
        std::env::var("BLAMMYTV_FFMPEG")
            .expect("set BLAMMYTV_FFMPEG to an ffmpeg with libx264 and libx265")
    }

    /// Four seconds of test picture and tone in `codec`, as MPEG-TS.
    fn clip(codec: &str) -> Vec<u8> {
        let out = std::process::Command::new(ffmpeg())
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=320x240:r=25",
                "-f",
                "lavfi",
                "-i",
                "sine=f=440:r=48000",
                "-t",
                "4",
                "-c:v",
                codec,
                "-preset",
                "ultrafast",
                "-x265-params",
                "log-level=error",
                "-c:a",
                "aac",
                "-f",
                "mpegts",
                "pipe:1",
            ])
            .output()
            .expect("ffmpeg did not run");
        assert!(
            out.status.success() && out.stdout.len() > 10_000,
            "no {codec} clip"
        );
        out.stdout
    }

    /// A provider serving `clip` at about live pace, then null packets until
    /// the reader goes (`hung_up`).
    fn serving(clip: Vec<u8>) -> (String, Arc<AtomicBool>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", l.local_addr().unwrap());
        let hung_up = Arc::new(AtomicBool::new(false));
        let flag = hung_up.clone();
        let clip = Arc::new(clip);
        std::thread::spawn(move || {
            for conn in l.incoming() {
                let Ok(mut conn) = conn else { continue };
                let (flag, clip) = (flag.clone(), clip.clone());
                std::thread::spawn(move || {
                    let mut reader = BufReader::new(conn.try_clone().unwrap());
                    loop {
                        let mut h = String::new();
                        if reader.read_line(&mut h).unwrap_or(0) <= 2 {
                            break;
                        }
                    }
                    let _ = conn.write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nConnection: close\r\n\r\n",
                    );
                    let mut null = [0u8; 188];
                    null[..4].copy_from_slice(&[0x47, 0x1f, 0xff, 0x10]);
                    let mut sent = clip.chunks(188 * 32);
                    loop {
                        let wrote = match sent.next() {
                            Some(c) => conn.write_all(c),
                            None => conn.write_all(&null),
                        };
                        if wrote.is_err() {
                            flag.store(true, Ordering::SeqCst);
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(10));
                    }
                });
            }
        });
        (base, hung_up)
    }

    /// Up to `want` bytes of a chunked body.
    fn body_bytes(r: &mut BufReader<TcpStream>, want: usize) -> Vec<u8> {
        let mut out = Vec::new();
        while out.len() < want {
            let mut size = String::new();
            if r.read_line(&mut size).unwrap_or(0) == 0 {
                break;
            }
            let n = usize::from_str_radix(size.trim(), 16).unwrap_or(0);
            if n == 0 {
                break;
            }
            let mut chunk = vec![0u8; n + 2];
            r.read_exact(&mut chunk).unwrap();
            chunk.truncate(n);
            out.extend(chunk);
        }
        out
    }

    #[test]
    fn converts_hevc_for_a_tile_that_asks() {
        let _one = SERIAL.lock().unwrap_or_else(|p| p.into_inner());
        let (base, _) = serving(clip("libx265"));
        let local = open(&format!("{base}/live/u/p/7.ts"), true).unwrap();
        let (code, headers, mut body) = get(&local, "GET", None);
        assert_eq!(code, 200, "{:?}", headers.get(":reason"));
        assert_eq!(
            headers.get("content-type").map(String::as_str),
            Some("video/mp2t")
        );
        assert_eq!(
            headers
                .get("access-control-allow-origin")
                .map(String::as_str),
            Some("*")
        );
        let out = body_bytes(&mut body, 64 * 1024);
        let types = mvconvert::stream_types(&out).expect("no programme map in what came out");
        // H.264 video and AAC audio, and no HEVC left.
        assert!(types.contains(&0x1b) && types.contains(&0x0f), "{types:x?}");
        assert!(!types.contains(&0x24), "{types:x?}");
    }

    #[test]
    fn leaves_h264_exactly_as_it_came_even_when_asked() {
        let _one = SERIAL.lock().unwrap_or_else(|p| p.into_inner());
        let source = clip("libx264");
        let (base, _) = serving(source.clone());
        let local = open(&format!("{base}/live/u/p/8.ts"), true).unwrap();
        let (code, _, mut body) = get(&local, "GET", None);
        assert_eq!(code, 200);
        let out = body_bytes(&mut body, 188 * 200);
        assert!(out.len() >= 188 * 200);
        assert_eq!(
            out[..188 * 200],
            source[..188 * 200],
            "the bytes were touched"
        );
        assert_eq!(mvconvert::running(), 0, "an ffmpeg started for H.264");
    }

    #[test]
    fn passes_hevc_through_when_the_tile_did_not_ask() {
        let _one = SERIAL.lock().unwrap_or_else(|p| p.into_inner());
        let (base, _) = serving(clip("libx265"));
        let local = open(&format!("{base}/live/u/p/9.ts"), false).unwrap();
        let (_, _, mut body) = get(&local, "GET", None);
        let out = body_bytes(&mut body, 64 * 1024);
        let types = mvconvert::stream_types(&out).expect("no programme map");
        assert!(types.contains(&0x24), "{types:x?}");
    }

    #[test]
    fn a_closed_converted_tile_takes_its_ffmpeg_and_the_connection() {
        let _one = SERIAL.lock().unwrap_or_else(|p| p.into_inner());
        let (base, hung_up) = serving(clip("libx265"));
        let local = open(&format!("{base}/live/u/p/10.ts"), true).unwrap();
        let (code, _, mut body) = get(&local, "GET", None);
        assert_eq!(code, 200);
        body_bytes(&mut body, 16 * 1024);
        assert_eq!(mvconvert::running(), 1);
        drop(body); // the tile goes away
        let t = std::time::Instant::now();
        while (mvconvert::running() > 0 || !hung_up.load(Ordering::SeqCst))
            && t.elapsed() < Duration::from_secs(10)
        {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(mvconvert::running(), 0, "ffmpeg outlived its tile");
        assert!(
            hung_up.load(Ordering::SeqCst),
            "upstream still held after the tile left"
        );
    }

    /// A provider serving `clip` at about live pace, then closing: a stream
    /// that ends.
    fn serving_once(clip: Vec<u8>) -> String {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", l.local_addr().unwrap());
        std::thread::spawn(move || {
            for conn in l.incoming() {
                let Ok(mut conn) = conn else { continue };
                let clip = clip.clone();
                std::thread::spawn(move || {
                    let mut reader = BufReader::new(conn.try_clone().unwrap());
                    loop {
                        let mut h = String::new();
                        if reader.read_line(&mut h).unwrap_or(0) <= 2 {
                            break;
                        }
                    }
                    let _ = conn.write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nConnection: close\r\n\r\n",
                    );
                    for c in clip.chunks(188 * 32) {
                        if conn.write_all(c).is_err() {
                            return;
                        }
                        std::thread::sleep(Duration::from_millis(10));
                    }
                });
            }
        });
        base
    }

    #[test]
    fn a_converted_stream_that_ends_reaches_the_tile_as_a_drop() {
        let _one = SERIAL.lock().unwrap_or_else(|p| p.into_inner());
        let base = serving_once(clip("libx265"));
        let local = open(&format!("{base}/live/u/p/13.ts"), true).unwrap();
        let (code, headers, mut body) = get(&local, "GET", None);
        assert_eq!(code, 200, "{:?}", headers.get(":reason"));
        let (bytes, finished) = to_end(&mut body);
        assert!(bytes.len() > 16 * 1024, "{} bytes", bytes.len());
        assert!(!finished, "the converted body finished cleanly");
    }

    #[test]
    fn a_tile_gone_before_the_first_picture_lets_the_provider_go() {
        // Plan 018, R6: closed while ffmpeg was starting, the feeding task
        // was only detached, and it held the provider's response until the
        // 20s read timeout.
        let _one = SERIAL.lock().unwrap_or_else(|p| p.into_inner());
        std::env::set_var("BLAMMYTV_FFMPEG", ffmpeg());
        // What the machine can do is asked first, so the drop below lands
        // with ffmpeg running and waiting on its input.
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(mvconvert::caps())
            .expect("no ffmpeg caps");
        // The start of an HEVC stream (its map, and not enough for ffmpeg to
        // produce anything), then silence with the socket held.
        let head: Vec<u8> = clip("libx265").into_iter().take(188 * 64).collect();
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", l.local_addr().unwrap());
        let hung_up = Arc::new(AtomicBool::new(false));
        let flag = hung_up.clone();
        std::thread::spawn(move || {
            let Ok((mut conn, _)) = l.accept() else {
                return;
            };
            let mut reader = BufReader::new(conn.try_clone().unwrap());
            loop {
                let mut h = String::new();
                if reader.read_line(&mut h).unwrap_or(0) <= 2 {
                    break;
                }
            }
            let _ = conn.write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nConnection: close\r\n\r\n",
            );
            let _ = conn.write_all(&head);
            let mut one = [0u8; 1];
            loop {
                match conn.read(&mut one) {
                    Ok(0) | Err(_) => {
                        flag.store(true, Ordering::SeqCst);
                        break;
                    }
                    Ok(_) => {}
                }
            }
        });
        let local = open(&format!("{base}/live/u/p/14.ts"), true).unwrap();
        let rest = local.strip_prefix("http://").unwrap();
        let (addr, path) = rest.split_at(rest.find('/').unwrap());
        let mut tile = TcpStream::connect(addr).unwrap();
        write!(tile, "GET {path} HTTP/1.1\r\nHost: {addr}\r\n\r\n").unwrap();
        std::thread::sleep(Duration::from_millis(1500));
        drop(tile); // the tile goes, before any picture
        let t = std::time::Instant::now();
        while !hung_up.load(Ordering::SeqCst) && t.elapsed() < Duration::from_secs(4) {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(
            hung_up.load(Ordering::SeqCst),
            "the provider was still held after the tile left"
        );
    }

    #[test]
    fn will_not_proxy_what_is_not_http() {
        assert!(open("file:///etc/passwd", false).is_err());
        assert!(open("not a url", false).is_err());
    }
}

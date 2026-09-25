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
//! - `close(local)` forgets the token. The tile calls it on unmount.
//! - One server, started on first use, on its own thread and runtime, bound
//!   to 127.0.0.1 only. Its own thread so it outlives whatever called it,
//!   which is also what lets the tests below drive it for real.
//! - The upstream body is passed through as it arrives. When the tile goes,
//!   the webview drops the connection, hyper drops the body, and the
//!   upstream response goes with it: a closed tile must hand its provider
//!   connection back at once, because the line's cap counts it (Adam's is 3).
//!
//! HEVC IS CONVERTED HERE, when the tile asks (mvconvert.rs). The webview
//! cannot decode it without a Store package; the first packets say whether
//! a stream is HEVC, and if so ffmpeg turns it into H.264 on the way
//! through. Still one provider connection per tile.
//!
//! NEVER LOGS A PATH OR QUERY. Xtream live URLs carry the username and
//! password in the path; only the origin is printed, as in http_get.

use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use futures_util::{stream, StreamExt};
use http_body_util::{combinators::BoxBody, BodyExt, Empty, StreamBody};
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
#[derive(Clone)]
struct Route {
    url: String,
    /// The tile's webview cannot play HEVC: convert it if that is what
    /// this turns out to be.
    convert_hevc: bool,
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
    loop {
        let Ok((tcp, _)) = listener.accept().await else {
            continue;
        };
        tokio::spawn(async move {
            let svc = hyper::service::service_fn(move |req| handle(req, port));
            let _ = hyper::server::conn::http1::Builder::new()
                .serve_connection(hyper_util::rt::TokioIo::new(tcp), svc)
                .await;
        });
    }
}

/// Register an upstream URL and get the loopback URL that serves it.
/// `convert_hevc`: the caller cannot play HEVC, so convert it (mvconvert.rs).
pub fn open(url: &str, convert_hevc: bool) -> Result<String, String> {
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
            },
        );
    Ok(format!("http://127.0.0.1:{}/mv/{}", p.port, token))
}

/// Forget a loopback URL `open` returned. Unknown URLs are ignored.
pub fn close(local: &str) {
    let Some(Ok(p)) = PROXY.get() else { return };
    if let Some(token) = local.rsplit("/mv/").next() {
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

fn reply(status: StatusCode) -> Response<Body> {
    let mut res = Response::new(empty());
    *res.status_mut() = status;
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
async fn fetch(url: &str) -> Result<reqwest::Response, Failed> {
    let mut at = reqwest::Url::parse(url).map_err(|_| Failed {
        at: reqwest::Url::parse("http://invalid/").expect("static URL"),
        kind: "not a URL",
        cause: None,
    })?;
    for _ in 0..=10 {
        let res = client()
            .get(at.clone())
            .header(header::ACCEPT, "*/*")
            .send()
            .await
            .map_err(|e| Failed {
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
    let mut res = reply(StatusCode::BAD_GATEWAY);
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
    if req.method() == Method::OPTIONS {
        let mut res = reply(StatusCode::NO_CONTENT);
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
    let Some(token) = req.uri().path().strip_prefix("/mv/") else {
        return Ok(reply(StatusCode::NOT_FOUND));
    };
    let upstream = proxy()
        .ok()
        .and_then(|p| p.routes.lock().ok()?.get(token).cloned());
    let Some(Route { url, convert_hevc }) = upstream else {
        return Ok(reply(StatusCode::NOT_FOUND));
    };

    let res = match fetch(&url).await {
        Ok(r) => r,
        Err(f) => {
            // WHERE it failed (a redirect can move the stream to another
            // server) and WHY. v0.9.101 said only "could not connect", on a
            // provider whose own host was answering at the same moment.
            let route = route_of(&url, &f.at);
            let cause = f
                .cause
                .as_ref()
                .map(|e| root_cause(e, &url, &f.at))
                .unwrap_or_default();
            let why = if cause.is_empty() {
                format!("{} ({route})", f.kind)
            } else {
                format!("{} ({route}): {cause}", f.kind)
            };
            println!("[mvproxy] {why}");
            return Ok(bad_gateway(&why));
        }
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
        return Ok(reply(
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
            return Ok(convert(Bytes::from(head), res).await);
        }
    }
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| HeaderValue::from_bytes(v.as_bytes()).ok())
        .unwrap_or_else(|| HeaderValue::from_static("video/mp2t"));

    // Chunks as they arrive. A read error ends the body; hyper then closes
    // the connection and mpegts.js reports it like any dropped stream.
    let head = (!head.is_empty()).then(|| Ok(Frame::data(Bytes::from(head))));
    let chunks = stream::iter(head).chain(stream::unfold(Some(res), |state| async move {
        let mut r = state?;
        match r.chunk().await {
            Ok(Some(b)) => Some((Ok(Frame::data(b)), Some(r))),
            Ok(None) => None,
            Err(_) => Some((Err(std::io::Error::other("upstream read failed")), None)),
        }
    }));
    let mut out = Response::new(BodyExt::boxed(StreamBody::new(chunks)));
    out.headers_mut().insert(header::CONTENT_TYPE, content_type);
    cors(&mut out);
    Ok(out)
}

/// An HEVC stream, through ffmpeg. The tile hears nothing until ffmpeg has
/// produced its first bytes, so a conversion that cannot start is a 502 that
/// says why rather than a stream that ends at once.
async fn convert(head: Bytes, res: reqwest::Response) -> Response<Body> {
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
                body.map(|chunk| chunk.map(Frame::data)),
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
        let rest = local.strip_prefix("http://").unwrap();
        let (addr, path) = rest.split_at(rest.find('/').unwrap());
        let mut s = TcpStream::connect(addr).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        let host = host.unwrap_or(addr);
        write!(
            s,
            "{method} {path} HTTP/1.1\r\nHost: {host}\r\nOrigin: http://tauri.localhost\r\n\r\n"
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
        let (code, _, _) = get(&format!("http://127.0.0.1:{port}/mv/nope"), "GET", None);
        assert_eq!(code, 404);
        close(&local);
        let (code, _, _) = get(&local, "GET", None);
        assert_eq!(code, 404);
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

    #[test]
    fn will_not_proxy_what_is_not_http() {
        assert!(open("file:///etc/passwd", false).is_err());
        assert!(open("not a url", false).is_err());
    }
}

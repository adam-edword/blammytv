//! How a file's open went, for the one that never opened.
//!
//! A debrid link that answers 403, one that is gone, one that has expired
//! into a web page: mpv gives up on each of them within a few milliseconds of
//! the `loadfile` and falls back to idle, and its own word for it is "loading
//! failed", which never says the HTTP status. Two things are kept here so the
//! player can say more and say it sooner.
//!
//! WHEN the in-app player was last asked for a file (`Loaded`). mpv_status
//! sends how long ago, and that is what lets the frontend tell an idle that
//! FOLLOWS a load from the stale idle of the file before it, which reads the
//! same until `loadfile` lands. Only native knows when that is.
//!
//! WHAT that address answers now (`probe`): one request for a single byte, and
//! the status and content type that come back. The address is a credential
//! (a debrid link carries the account's key), so nothing here ever puts it, or
//! a piece of it, in an answer or an error.
//!
//! Its own file so the host crate (scripts/mvproxy-host) can run its tests;
//! lib.rs pulls in tauri and cannot be built on Linux.

use std::time::{Duration, Instant};

/// How long the probe waits for the address to answer. The frontend shows the
/// card first and the reason when it lands, so this is how long a reason can
/// take to arrive, not how long anyone waits on it.
pub const PROBE_WAIT: Duration = Duration::from_secs(5);

/// The load the in-app player was last asked for: when, which address, and the
/// User-Agent it was asked with, if the playlist has one of its own.
pub struct Loaded {
    at: Instant,
    url: String,
    agent: Option<String>,
}

impl Loaded {
    pub fn new(url: &str, at: Instant) -> Self {
        Self {
            at,
            url: url.to_string(),
            agent: None,
        }
    }

    /// The same, opened with this User-Agent (mpvagent.rs): what the probe asks
    /// with, since a provider that refuses the wrong agent refuses it for the
    /// probe as it did for mpv.
    pub fn with_agent(mut self, agent: Option<String>) -> Self {
        self.agent = agent;
        self
    }

    /// Whole milliseconds from the load to `now`. Never negative: an `at`
    /// after `now` reads 0.
    pub fn since_ms(&self, now: Instant) -> u64 {
        now.saturating_duration_since(self.at).as_millis() as u64
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    pub fn agent(&self) -> Option<&str> {
        self.agent.as_deref()
    }
}

/// What the address answered, or why it did not. This is the whole of what
/// leaves native about it: the page gets these three fields and nothing else.
#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    /// The HTTP status, after redirects (mpv follows them too).
    pub status: Option<u16>,
    /// The content type as the server sent it, down to `type/subtype`.
    pub content_type: Option<String>,
    /// When it did not answer: "timeout", "refused", "dns" or "network".
    pub failure: Option<&'static str>,
    /// The request carried the Jellyfin sign-in, the way mpv's did, so a 401
    /// or a 403 is the server refusing that sign-in and not a link that needs
    /// none. A bare flag: the sign-in itself never leaves native. Left out of
    /// the answer when false, so every other file's answer is what it was.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub signed_in_to_jellyfin: bool,
}

/// `text/html; charset=UTF-8` as `text/html`: the media type alone, lower
/// case. None for anything that is not one, so a header with something odd in
/// it goes no further.
fn media_type(raw: &str) -> Option<String> {
    let essence = raw.split(';').next()?.trim().to_ascii_lowercase();
    let plain = essence
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'.' | b'+' | b'-' | b'_'));
    let one_slash = essence.matches('/').count() == 1;
    let sane = !essence.is_empty() && essence.len() <= 100 && plain && one_slash;
    sane.then_some(essence)
}

/// A server that answered: its status, and its content type if it sent one.
pub fn answered(status: u16, content_type: Option<&str>) -> Answer {
    Answer {
        status: Some(status),
        content_type: content_type.and_then(media_type),
        failure: None,
        signed_in_to_jellyfin: false,
    }
}

/// A server that did not.
pub fn failed(kind: &'static str) -> Answer {
    Answer {
        status: None,
        content_type: None,
        failure: Some(kind),
        signed_in_to_jellyfin: false,
    }
}

/// Why a request got no answer, as one of four words. reqwest's own text for
/// it names the address, so the error is read for its kind and never printed.
pub fn failure_kind(e: &reqwest::Error) -> &'static str {
    if e.is_timeout() {
        return "timeout";
    }
    let mut dns = false;
    let mut cause = std::error::Error::source(e);
    while let Some(c) = cause {
        if let Some(io) = c.downcast_ref::<std::io::Error>() {
            if io.kind() == std::io::ErrorKind::ConnectionRefused {
                return "refused";
            }
        }
        // hyper-util's own word for a lookup that failed. The io error under
        // it says different things on different systems.
        if c.to_string() == "dns error" {
            dns = true;
        }
        cause = c.source();
    }
    if dns {
        "dns"
    } else {
        "network"
    }
}

/// `probe_signed` with no sign-in, as the tests below drive it.
#[cfg(test)]
pub async fn probe_as(
    client: &reqwest::Client,
    url: &str,
    wait: Duration,
    user_agent: Option<&str>,
) -> Answer {
    probe_signed(client, url, wait, user_agent, None).await
}

/// Ask `url` for its first byte and report what came back. Only the head of
/// the answer is read: a server that ignores the range and starts sending the
/// whole film is dropped as soon as its headers are in. `client` is the app's
/// shared one, so the request goes out the way `http_get`'s do, over the same
/// TLS stack.
///
/// `user_agent` is the playlist's own, when it has one: sent over the client's,
/// which `.header` replaces (the way `http_get` merges its headers). Without
/// one the request is the one it always was.
///
/// `authorization` is the value mpv was given for a Jellyfin stream that needs
/// the sign-in (jf.rs `auth_header_for`), so the question is asked the way mpv
/// asked it. Without it a stream that wants the token answers 401 to the probe
/// whatever went wrong in the player. The value is marked sensitive (kept out
/// of any debug print), and reqwest drops `Authorization` on a redirect to
/// another origin, which is where the stream check (`jf_prepare_stream`)
/// already refuses to give a token.
pub async fn probe_signed(
    client: &reqwest::Client,
    url: &str,
    wait: Duration,
    user_agent: Option<&str>,
    authorization: Option<&str>,
) -> Answer {
    let mut get = client.get(url).header(reqwest::header::RANGE, "bytes=0-0");
    if let Some(agent) = crate::mpvagent::header_value(user_agent) {
        get = get.header(reqwest::header::USER_AGENT, agent);
    }
    let mut signed = false;
    if let Some(mut v) = authorization.and_then(|a| reqwest::header::HeaderValue::from_str(a).ok()) {
        v.set_sensitive(true);
        get = get.header(reqwest::header::AUTHORIZATION, v);
        signed = true;
    }
    let sent = get.timeout(wait).send().await;
    let mut answer = match sent {
        Ok(res) => answered(
            res.status().as_u16(),
            res.headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok()),
        ),
        Err(e) => failed(failure_kind(&e)),
    };
    answer.signed_in_to_jellyfin = signed;
    answer
}

/// `probe_as` with no agent of its own, which is what the tests below drive.
#[cfg(test)]
pub async fn probe(client: &reqwest::Client, url: &str, wait: Duration) -> Answer {
    probe_as(client, url, wait, None).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// No tokio `macros` feature in the app's tree: a runtime by hand, as
    /// mvproxy's tests do.
    fn run<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(f)
    }

    const KEY: &str = "secret-key-8f3a21";

    /// A server for the probe. A request for `/403` is answered 403, and so on;
    /// every request head it reads is kept.
    struct Fake {
        port: u16,
        heads: Arc<Mutex<Vec<String>>>,
    }

    impl Fake {
        async fn start() -> Fake {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let heads = Arc::new(Mutex::new(Vec::new()));
            let seen = heads.clone();
            tokio::spawn(async move {
                loop {
                    let Ok((mut sock, _)) = listener.accept().await else {
                        return;
                    };
                    let seen = seen.clone();
                    tokio::spawn(async move {
                        let mut head = Vec::new();
                        let mut buf = [0u8; 1024];
                        while !head.windows(4).any(|w| w == b"\r\n\r\n") {
                            match sock.read(&mut buf).await {
                                Ok(0) | Err(_) => return,
                                Ok(n) => head.extend_from_slice(&buf[..n]),
                            }
                        }
                        let head = String::from_utf8_lossy(&head).into_owned();
                        let path = head
                            .split_whitespace()
                            .nth(1)
                            .unwrap_or("/")
                            .split('?')
                            .next()
                            .unwrap_or("/")
                            .to_string();
                        seen.lock().unwrap().push(head);
                        let reply = match path.as_str() {
                            "/403" => "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: 0\r\n\r\n".to_string(),
                            "/404" => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".to_string(),
                            "/500" => "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n".to_string(),
                            "/html" => "HTTP/1.1 200 OK\r\nContent-Type: Text/HTML; charset=UTF-8\r\nContent-Length: 0\r\n\r\n".to_string(),
                            "/video" => "HTTP/1.1 206 Partial Content\r\nContent-Type: video/mp4\r\nContent-Range: bytes 0-0/1000\r\nContent-Length: 1\r\n\r\nx".to_string(),
                            // A server that ignores the range and means to send
                            // all of it: headers, then a body that never ends.
                            "/endless" => {
                                let _ = sock
                                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: video/x-matroska\r\nContent-Length: 1000000000\r\n\r\n")
                                    .await;
                                loop {
                                    tokio::time::sleep(Duration::from_secs(60)).await;
                                }
                            }
                            // Nothing, ever.
                            "/silent" => loop {
                                tokio::time::sleep(Duration::from_secs(60)).await;
                            },
                            "/go" => "HTTP/1.1 302 Found\r\nLocation: /403\r\nContent-Length: 0\r\n\r\n".to_string(),
                            _ => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".to_string(),
                        };
                        let _ = sock.write_all(reply.as_bytes()).await;
                        let _ = sock.shutdown().await;
                    });
                }
            });
            Fake { port, heads }
        }

        fn url(&self, path: &str) -> String {
            format!("http://127.0.0.1:{}{path}", self.port)
        }
    }

    fn client() -> reqwest::Client {
        reqwest::Client::new()
    }

    #[test]
    fn the_stamp_says_how_long_ago_and_keeps_the_address() {
        let at = Instant::now();
        let l = Loaded::new("http://host/a/b?k=1", at);
        assert_eq!(l.url(), "http://host/a/b?k=1");
        assert_eq!(l.since_ms(at), 0);
        assert_eq!(l.since_ms(at + Duration::from_millis(999)), 999);
        assert_eq!(l.since_ms(at + Duration::from_millis(1500)), 1500);
        assert_eq!(l.since_ms(at + Duration::from_secs(3600)), 3_600_000);
        // A `now` from before the stamp is 0, not a wrapped number.
        let later = Loaded::new("http://host/x", at + Duration::from_secs(5));
        assert_eq!(later.since_ms(at), 0);
    }

    #[test]
    fn a_status_goes_through_as_it_came() {
        for code in [200, 206, 301, 401, 403, 404, 410, 416, 429, 500, 503] {
            let a = answered(code, None);
            assert_eq!(a.status, Some(code));
            assert_eq!((a.content_type, a.failure), (None, None));
        }
    }

    #[test]
    fn a_content_type_is_cut_to_its_media_type() {
        for (raw, want) in [
            ("text/html", "text/html"),
            ("Text/HTML; charset=UTF-8", "text/html"),
            ("  video/mp4  ", "video/mp4"),
            ("video/x-matroska", "video/x-matroska"),
            (
                "application/vnd.apple.mpegurl",
                "application/vnd.apple.mpegurl",
            ),
            (
                "application/octet-stream; boundary=x",
                "application/octet-stream",
            ),
        ] {
            assert_eq!(
                answered(200, Some(raw)).content_type.as_deref(),
                Some(want),
                "{raw:?}"
            );
        }
    }

    #[test]
    fn something_that_is_not_a_media_type_goes_no_further() {
        let long = format!("text/{}", "a".repeat(200));
        for raw in [
            "",
            "html",
            "text/html/extra",
            "text/ht ml",
            "https://host/a?k=1",
            "text/html\r\nSet-Cookie: x=1",
            "tëxt/html",
            long.as_str(),
        ] {
            assert_eq!(answered(200, Some(raw)).content_type, None, "{raw:?}");
        }
    }

    #[test]
    fn the_answer_reaches_the_page_in_camel_case() {
        assert_eq!(
            serde_json::to_string(&answered(403, Some("text/html"))).unwrap(),
            r#"{"status":403,"contentType":"text/html","failure":null}"#
        );
        assert_eq!(
            serde_json::to_string(&failed("timeout")).unwrap(),
            r#"{"status":null,"contentType":null,"failure":"timeout"}"#
        );
    }

    #[test]
    fn it_asks_for_one_byte_and_reports_each_kind_of_answer() {
        run(async {
            let fake = Fake::start().await;
            for (path, status, ctype) in [
                ("/403", 403, Some("text/plain")),
                ("/404", 404, None),
                ("/500", 500, None),
                ("/html", 200, Some("text/html")),
                ("/video", 206, Some("video/mp4")),
            ] {
                let a = probe(&client(), &fake.url(path), Duration::from_secs(5)).await;
                assert_eq!(
                    (a.status, a.content_type.as_deref(), a.failure),
                    (Some(status), ctype, None),
                    "{path}"
                );
            }
            let heads = fake.heads.lock().unwrap();
            assert_eq!(heads.len(), 5, "one request each");
            for h in heads.iter() {
                assert!(h.starts_with("GET "), "{h}");
                assert!(
                    h.to_ascii_lowercase().contains("range: bytes=0-0\r\n"),
                    "no one-byte range: {h}"
                );
            }
        });
    }

    const AGENT: &str = "TestApp/9.1 (Provider Check)";

    /// The User-Agent line of a request head, lower-cased name and all.
    fn agent_of(head: &str) -> Option<String> {
        head.lines().find_map(|l| {
            let (k, v) = l.split_once(':')?;
            k.eq_ignore_ascii_case("user-agent")
                .then(|| v.trim().to_string())
        })
    }

    #[test]
    fn the_stamp_keeps_the_agent_the_file_was_opened_with_and_none_by_default() {
        let at = Instant::now();
        assert_eq!(Loaded::new("http://host/x", at).agent(), None);
        let l = Loaded::new("http://host/x", at).with_agent(Some(AGENT.to_string()));
        assert_eq!(l.agent(), Some(AGENT));
        assert_eq!(l.url(), "http://host/x");
        assert_eq!(l.since_ms(at), 0);
        assert_eq!(
            Loaded::new("http://host/x", at).with_agent(None).agent(),
            None
        );
    }

    #[test]
    fn it_asks_with_the_playlists_own_agent_when_it_has_one() {
        run(async {
            let fake = Fake::start().await;
            // A client with an agent of its own, as the app's shared one has.
            let app = reqwest::Client::builder()
                .user_agent("Browser/126")
                .build()
                .unwrap();
            let a = probe_as(&app, &fake.url("/403"), Duration::from_secs(5), Some(AGENT)).await;
            assert_eq!(a.status, Some(403));
            let b = probe_as(&app, &fake.url("/403"), Duration::from_secs(5), None).await;
            assert_eq!(b.status, Some(403));
            let c = probe_as(&app, &fake.url("/403"), Duration::from_secs(5), Some("  ")).await;
            assert_eq!(c.status, Some(403));
            let heads = fake.heads.lock().unwrap();
            // The playlist's agent replaces the client's; without one, or with
            // a blank, the client's own goes, as it always did.
            assert_eq!(agent_of(&heads[0]).as_deref(), Some(AGENT), "{}", heads[0]);
            assert_eq!(
                agent_of(&heads[1]).as_deref(),
                Some("Browser/126"),
                "{}",
                heads[1]
            );
            assert_eq!(
                agent_of(&heads[2]).as_deref(),
                Some("Browser/126"),
                "{}",
                heads[2]
            );
            // The one-byte range still rides with it.
            assert!(
                heads[0]
                    .to_ascii_lowercase()
                    .contains("range: bytes=0-0\r\n"),
                "{}",
                heads[0]
            );
        });
    }

    #[test]
    fn it_asks_with_the_jellyfin_sign_in_when_it_is_given_one_and_says_so() {
        run(async {
            let fake = Fake::start().await;
            let value = "MediaBrowser Token=\"tok-12345678\"";
            let a = probe_signed(
                &client(),
                &fake.url("/403"),
                Duration::from_secs(5),
                None,
                Some(value),
            )
            .await;
            assert_eq!(a.status, Some(403));
            assert!(a.signed_in_to_jellyfin);
            let b = probe_signed(&client(), &fake.url("/403"), Duration::from_secs(5), None, None).await;
            assert!(!b.signed_in_to_jellyfin);
            let heads = fake.heads.lock().unwrap();
            let lower = heads[0].to_ascii_lowercase();
            assert!(
                lower.contains("authorization: mediabrowser token=\"tok-12345678\"\r\n"),
                "{}",
                heads[0]
            );
            assert!(!heads[1].to_ascii_lowercase().contains("authorization:"), "{}", heads[1]);
        });
    }

    #[test]
    fn the_sign_in_is_not_in_the_answer_only_that_it_was_sent() {
        run(async {
            let fake = Fake::start().await;
            let a = probe_signed(
                &client(),
                &fake.url("/403"),
                Duration::from_secs(5),
                None,
                Some("MediaBrowser Token=\"tok-12345678\""),
            )
            .await;
            let wire = serde_json::to_string(&a).unwrap();
            assert!(!wire.contains("tok-12345678") && !wire.contains("MediaBrowser"), "{wire}");
            assert!(wire.contains("\"signedInToJellyfin\":true"), "{wire}");
        });
    }

    #[test]
    fn a_value_that_is_not_a_header_is_not_sent_and_not_claimed() {
        run(async {
            let fake = Fake::start().await;
            let a = probe_signed(
                &client(),
                &fake.url("/403"),
                Duration::from_secs(5),
                None,
                Some("bad\r\nvalue"),
            )
            .await;
            assert_eq!(a.status, Some(403));
            assert!(!a.signed_in_to_jellyfin);
            assert!(!fake.heads.lock().unwrap()[0].to_ascii_lowercase().contains("authorization:"));
        });
    }

    #[test]
    fn the_agent_is_not_in_the_answer() {
        run(async {
            let fake = Fake::start().await;
            let a = probe_as(
                &client(),
                &fake.url("/403"),
                Duration::from_secs(5),
                Some(AGENT),
            )
            .await;
            let wire = serde_json::to_string(&a).unwrap();
            assert!(
                !wire.contains("TestApp") && !wire.contains("Provider"),
                "{wire}"
            );
        });
    }

    #[test]
    fn it_follows_a_redirect_as_mpv_does() {
        run(async {
            let fake = Fake::start().await;
            let a = probe(&client(), &fake.url("/go"), Duration::from_secs(5)).await;
            assert_eq!(a.status, Some(403));
        });
    }

    #[test]
    fn it_reads_the_head_and_not_the_body() {
        run(async {
            let fake = Fake::start().await;
            let t0 = Instant::now();
            let a = probe(&client(), &fake.url("/endless"), Duration::from_secs(5)).await;
            assert_eq!(a.status, Some(200));
            assert_eq!(a.content_type.as_deref(), Some("video/x-matroska"));
            assert!(t0.elapsed() < Duration::from_secs(3), "{:?}", t0.elapsed());
        });
    }

    #[test]
    fn a_server_that_never_answers_is_a_timeout_after_the_wait_it_was_given() {
        run(async {
            let fake = Fake::start().await;
            let t0 = Instant::now();
            let a = probe(&client(), &fake.url("/silent"), Duration::from_millis(400)).await;
            assert_eq!(a, failed("timeout"));
            assert!(t0.elapsed() < Duration::from_secs(5), "{:?}", t0.elapsed());
            // The app's wait is five seconds, which is what the card is
            // promised.
            assert_eq!(PROBE_WAIT, Duration::from_secs(5));
        });
    }

    #[test]
    fn the_request_wait_beats_the_clients_own() {
        run(async {
            // The shared client gives a call thirty seconds. The probe's own
            // wait has to win over that, or "five seconds" is thirty.
            let fake = Fake::start().await;
            let long = reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .unwrap();
            let t0 = Instant::now();
            let a = probe(&long, &fake.url("/silent"), Duration::from_millis(400)).await;
            assert_eq!(a, failed("timeout"));
            assert!(t0.elapsed() < Duration::from_secs(5), "{:?}", t0.elapsed());
        });
    }

    #[test]
    fn a_closed_port_is_refused() {
        run(async {
            let closed = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = closed.local_addr().unwrap().port();
            drop(closed);
            let a = probe(
                &client(),
                &format!("http://127.0.0.1:{port}/a"),
                Duration::from_secs(5),
            )
            .await;
            assert_eq!(a, failed("refused"));
        });
    }

    struct NoSuchHost;
    impl reqwest::dns::Resolve for NoSuchHost {
        fn resolve(&self, _: reqwest::dns::Name) -> reqwest::dns::Resolving {
            Box::pin(async { Err("no such host".into()) })
        }
    }

    #[test]
    fn a_name_that_does_not_resolve_is_dns() {
        run(async {
            let c = reqwest::Client::builder()
                .dns_resolver(Arc::new(NoSuchHost))
                .build()
                .unwrap();
            let a = probe(&c, "http://gone.example/a", Duration::from_secs(5)).await;
            assert_eq!(a, failed("dns"));
        });
    }

    #[test]
    fn a_server_that_hangs_up_is_a_network_failure() {
        run(async {
            let hangs_up = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = hangs_up.local_addr().unwrap().port();
            tokio::spawn(async move {
                loop {
                    let _ = hangs_up.accept().await;
                }
            });
            let a = probe(
                &client(),
                &format!("http://127.0.0.1:{port}/a"),
                Duration::from_secs(5),
            )
            .await;
            assert_eq!(a, failed("network"));
        });
    }

    #[test]
    fn no_answer_holds_the_address_or_anything_from_it() {
        run(async {
            let fake = Fake::start().await;
            let closed = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let gone = closed.local_addr().unwrap().port();
            drop(closed);
            let no_host = reqwest::Client::builder()
                .dns_resolver(Arc::new(NoSuchHost))
                .build()
                .unwrap();
            let secret = format!("/{KEY}/file.mkv?token={KEY}");
            let mut seen = vec![
                probe(
                    &client(),
                    &format!("http://127.0.0.1:{}{secret}", fake.port),
                    Duration::from_secs(5),
                )
                .await,
                probe(
                    &client(),
                    &format!("http://127.0.0.1:{gone}{secret}"),
                    Duration::from_secs(5),
                )
                .await,
                probe(
                    &client(),
                    &fake.url(&format!("/silent?token={KEY}")),
                    Duration::from_millis(300),
                )
                .await,
                probe(
                    &no_host,
                    &format!("http://gone.example{secret}"),
                    Duration::from_secs(5),
                )
                .await,
            ];
            seen.push(
                probe(
                    &client(),
                    &fake.url(&format!("/403?token={KEY}")),
                    Duration::from_secs(5),
                )
                .await,
            );
            for a in seen {
                let wire = serde_json::to_string(&a).unwrap();
                assert!(
                    !wire.contains(KEY)
                        && !wire.contains("127.0.0.1")
                        && !wire.contains("gone.example")
                        && !wire.contains("mkv"),
                    "{wire}"
                );
            }
        });
    }
}

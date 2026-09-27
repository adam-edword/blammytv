//! MyAnimeList (plan 021): sign-in in the browser, with a one-shot listener
//! on localhost for MAL's redirect, the user's tokens in the OS vault, and
//! every MAL call made from here, as Trakt's are (trakt.rs), so a token
//! never reaches the page or localStorage.
//!
//! No Tauri in this file: lib.rs wraps it in commands, and the host crate
//! (scripts/mvproxy-host) includes it as it is and runs its tests against a
//! fake MAL.
//!
//! What MAL does, and this follows (plan 021: its hosts are blocked from the
//! build box, so read from mirrors of its docs and from clients that use it
//! today):
//! - OAuth with PKCE, the "plain" method only: S256 is taken at the
//!   authorize step and then fails at the token step. So the challenge IS
//!   the verifier.
//! - An app of type "other" has a client id and no secret.
//! - The redirect must match the registered one exactly:
//!   http://localhost:47391/.
//! - Refresh tokens rotate, but the old one keeps working until it runs out
//!   (unlike Trakt's). A refresh still goes through the token lock, so there
//!   is only ever one.
//! - The access token's life is `expires_in`: the docs say an hour, real
//!   answers 31 days. Neither is assumed.
//! - No documented rate limit, and a ban comes back as an HTML page. Every
//!   call is held a second apart, as the desktop clients do.

use crate::trakt::{Status, Tokens, Vault};
use http_body_util::Full;
use hyper::body::Bytes;
use hyper::{Request, Response};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

/// Where MAL is and who the app is. The app builds this from build-time
/// values; the tests point it at a fake.
#[derive(Clone)]
pub struct Config {
    pub client_id: String,
    /// `https://api.myanimelist.net/v2`
    pub api_base: String,
    /// `https://myanimelist.net/v1/oauth2`
    pub auth_base: String,
    /// The registered redirect is `http://localhost:{this}/`.
    pub redirect_port: u16,
    /// How long a sign-in waits for the browser to come back.
    pub sign_in_for: Duration,
    pub user_agent: String,
}

/// Where the sign-in is, for the page's poll.
#[derive(Serialize, Debug, PartialEq, Clone, Default)]
#[serde(tag = "at", rename_all = "snake_case")]
pub enum SignIn {
    /// Nothing started, or it was cancelled.
    #[default]
    Idle,
    /// The browser is on MAL's page, and the listener waits for it.
    Waiting,
    Approved,
    /// The user said no on MAL's page.
    Denied,
    /// Nobody came back in time.
    Expired,
    /// MAL refused the code, or never answered.
    Failed {
        note: String,
    },
}

/// A MAL answer, handed to the page as data: a 4xx is not an error here.
#[derive(Serialize, Debug)]
pub struct Reply {
    pub status: u16,
    pub body: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
}

/// The sign-in under way, if any.
#[derive(Default)]
struct Attempt {
    /// Bumped by every start, cancel and disconnect, so a late redirect for
    /// an earlier attempt does nothing.
    id: u64,
    state: SignIn,
    /// A redirect with a code has arrived and is being traded; the timer
    /// leaves it alone.
    claimed: bool,
    /// The listeners and the timer.
    tasks: Vec<JoinHandle<()>>,
}

pub struct Mal {
    cfg: Config,
    http: reqwest::Client,
    vault: Box<dyn Vault>,
    /// The session. Held across a refresh, so there is only ever one.
    tokens: Mutex<Option<Tokens>>,
    attempt: std::sync::Mutex<Attempt>,
    last_call: Mutex<Option<Instant>>,
}

/// Calls at most this often.
const GAP: Duration = Duration::from_millis(1000);
/// Refresh this long before the token runs out, not after a failed call.
const EARLY: u64 = 300;

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn random_hex(bytes: usize) -> Result<String, String> {
    let mut raw = vec![0u8; bytes];
    getrandom::fill(&mut raw).map_err(|e| format!("no randomness: {e}"))?;
    Ok(raw.iter().map(|b| format!("{b:02x}")).collect())
}

/// What went wrong, from MAL's JSON error if it sent one.
fn why(status: u16, body: &str) -> String {
    let v: serde_json::Value = serde_json::from_str(body).unwrap_or(serde_json::Value::Null);
    match v["error"].as_str().or(v["message"].as_str()) {
        Some(e) => format!("HTTP {status}, {e}"),
        None => format!("HTTP {status}"),
    }
}

fn tokens_from(body: &str) -> Result<Tokens, String> {
    let t: TokenResponse = serde_json::from_str(body).map_err(|e| e.to_string())?;
    Ok(Tokens {
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        expires_at: now() + t.expires_in,
    })
}

/// The page the browser shows once MAL sends it back here.
fn page(status: u16, title: &str, line: &str) -> Response<Full<Bytes>> {
    let html = format!(
        "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\">\
         <meta name=\"viewport\" content=\"width=device-width\"><title>{title}</title>\
         <style>body{{margin:0;min-height:100vh;display:grid;place-items:center;\
         font:16px/1.5 system-ui,sans-serif;background:#0b0b0c;color:#ededed}}\
         main{{max-width:28rem;padding:1.5rem}}h1{{font-size:1.25rem;margin:0 0 .5rem}}\
         p{{margin:0;color:#a1a1aa}}@media (prefers-color-scheme:light){{\
         body{{background:#fafafa;color:#18181b}}p{{color:#52525b}}}}</style>\
         <main><h1>{title}</h1><p>{line}</p></main>"
    );
    Response::builder()
        .status(status)
        .header("content-type", "text/html; charset=utf-8")
        .header("cache-control", "no-store")
        .body(Full::new(Bytes::from(html)))
        .unwrap()
}

/// One sign-in's listener: what it checks the redirect against.
struct Listening {
    mal: Arc<Mal>,
    id: u64,
    nonce: String,
    verifier: String,
}

impl Listening {
    async fn answer(&self, req: Request<hyper::body::Incoming>) -> Response<Full<Bytes>> {
        if req.method() != hyper::Method::GET || req.uri().path() != "/" {
            return page(
                404,
                "Nothing here",
                "This address is BlammyTV's, for signing in.",
            );
        }
        let query = req.uri().query().unwrap_or("");
        let q: BTreeMap<String, String> =
            reqwest::Url::parse(&format!("http://localhost/?{query}"))
                .map(|u| u.query_pairs().into_owned().collect())
                .unwrap_or_default();
        // The nonce went out in the link BlammyTV opened, so only MAL's
        // redirect for this sign-in carries it; any other page poking the
        // port gets nothing.
        if q.get("state") != Some(&self.nonce) {
            return page(
                400,
                "This sign-in is out of date",
                "Start again from BlammyTV: Settings, then Accounts.",
            );
        }
        if let Some(error) = q.get("error") {
            let state = if error == "access_denied" {
                SignIn::Denied
            } else {
                SignIn::Failed {
                    note: format!("MyAnimeList said {error}"),
                }
            };
            self.mal.end(self.id, state, false);
            return page(
                200,
                "Not signed in",
                "Nothing was connected. You can close this tab.",
            );
        }
        let Some(code) = q.get("code") else {
            return page(
                400,
                "No sign-in here",
                "MyAnimeList sent no code. Start again from BlammyTV.",
            );
        };
        if !self.mal.claim(self.id) {
            return page(
                200,
                "Already done",
                "This sign-in has already been handled. You can close this tab.",
            );
        }
        match self.mal.exchange(code, &self.verifier).await {
            Ok(tokens) => {
                if self.mal.keep(self.id, tokens).await {
                    page(
                        200,
                        "Signed in to MyAnimeList",
                        "You can close this tab and go back to BlammyTV.",
                    )
                } else {
                    page(
                        500,
                        "Not signed in",
                        "BlammyTV couldn't keep the sign-in. Try again from Settings.",
                    )
                }
            }
            Err(note) => {
                self.mal.end(self.id, SignIn::Failed { note }, true);
                page(
                    502,
                    "Not signed in",
                    "MyAnimeList didn't finish the sign-in. Try again from BlammyTV's Settings.",
                )
            }
        }
    }
}

impl Mal {
    pub fn new(cfg: Config, http: reqwest::Client, vault: Box<dyn Vault>) -> Arc<Self> {
        let saved = vault.load();
        Arc::new(Self {
            cfg,
            http,
            vault,
            tokens: Mutex::new(saved),
            attempt: std::sync::Mutex::new(Attempt::default()),
            last_call: Mutex::new(None),
        })
    }

    fn configured(&self) -> bool {
        !self.cfg.client_id.is_empty()
    }

    fn redirect_uri(&self) -> String {
        format!("http://localhost:{}/", self.cfg.redirect_port)
    }

    pub async fn status(&self) -> Status {
        Status {
            configured: self.configured(),
            connected: self.tokens.lock().await.is_some(),
        }
    }

    /// Start signing in: listen for MAL's redirect, and hand back the link
    /// to open in the browser.
    pub async fn sign_in_start(self: &Arc<Self>) -> Result<String, String> {
        if !self.configured() {
            return Err("this build has no MyAnimeList key".into());
        }
        let id = self.stop_attempt().await;
        let port = self.cfg.redirect_port;
        let v4 = tokio::net::TcpListener::bind(("127.0.0.1", port))
            .await
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::AddrInUse {
                    format!("another program is using port {port}, which MyAnimeList sends the sign-in back to")
                } else {
                    format!("couldn't listen on port {port}: {e}")
                }
            })?;
        // The browser may try "localhost" as ::1 first. Where there is one,
        // listen there too; where there isn't, 127.0.0.1 is enough.
        let v6 = tokio::net::TcpListener::bind(("::1", port)).await.ok();
        let verifier = random_hex(48)?;
        let nonce = random_hex(16)?;
        let url = reqwest::Url::parse_with_params(
            &format!("{}/authorize", self.cfg.auth_base),
            &[
                ("response_type", "code"),
                ("client_id", self.cfg.client_id.as_str()),
                ("code_challenge", verifier.as_str()),
                ("code_challenge_method", "plain"),
                ("state", nonce.as_str()),
                ("redirect_uri", self.redirect_uri().as_str()),
            ],
        )
        .map_err(|e| e.to_string())?;

        let ctx = Arc::new(Listening {
            mal: self.clone(),
            id,
            nonce,
            verifier,
        });
        let mut tasks = Vec::new();
        for listener in std::iter::once(v4).chain(v6) {
            let ctx = ctx.clone();
            tasks.push(tokio::spawn(async move {
                loop {
                    let Ok((stream, _)) = listener.accept().await else {
                        tokio::time::sleep(Duration::from_millis(50)).await;
                        continue;
                    };
                    let ctx = ctx.clone();
                    tokio::spawn(async move {
                        let svc = hyper::service::service_fn(
                            move |req: Request<hyper::body::Incoming>| {
                                let ctx = ctx.clone();
                                async move {
                                    Ok::<_, std::convert::Infallible>(ctx.answer(req).await)
                                }
                            },
                        );
                        let _ = hyper::server::conn::http1::Builder::new()
                            .keep_alive(false)
                            .serve_connection(hyper_util::rt::TokioIo::new(stream), svc)
                            .await;
                    });
                }
            }));
        }
        let mal = self.clone();
        let wait = self.cfg.sign_in_for;
        tasks.push(tokio::spawn(async move {
            tokio::time::sleep(wait).await;
            mal.end(id, SignIn::Expired, false);
        }));

        let mut a = self.attempt.lock().unwrap();
        if a.id != id {
            // Cancelled or started again while this one was binding.
            tasks.iter().for_each(|t| t.abort());
            return Err("cancelled".into());
        }
        a.state = SignIn::Waiting;
        a.claimed = false;
        a.tasks = tasks;
        Ok(url.into())
    }

    pub fn sign_in_poll(&self) -> SignIn {
        self.attempt.lock().unwrap().state.clone()
    }

    /// Stop waiting for the browser, and give the port back.
    pub async fn sign_in_cancel(&self) {
        self.stop_attempt().await;
    }

    /// End whatever sign-in there is, and wait until its listeners have let
    /// go of the port, so the next one can take it. Returns the new id.
    async fn stop_attempt(&self) -> u64 {
        let (id, tasks) = {
            let mut a = self.attempt.lock().unwrap();
            a.id += 1;
            a.state = SignIn::Idle;
            a.claimed = false;
            (a.id, std::mem::take(&mut a.tasks))
        };
        for t in tasks {
            t.abort();
            let _ = t.await;
        }
        id
    }

    /// A code has arrived for attempt `id`: take it, once.
    fn claim(&self, id: u64) -> bool {
        let mut a = self.attempt.lock().unwrap();
        if a.id != id || a.state != SignIn::Waiting || a.claimed {
            return false;
        }
        a.claimed = true;
        true
    }

    /// Close attempt `id` with `state`, if it is still the one waiting (and
    /// claimed, or not, as the caller expects), and stop its listeners.
    fn end(&self, id: u64, state: SignIn, claimed: bool) -> bool {
        let mut a = self.attempt.lock().unwrap();
        if a.id != id || a.state != SignIn::Waiting || a.claimed != claimed {
            return false;
        }
        a.state = state;
        a.tasks.iter().for_each(|t| t.abort());
        true
    }

    /// Keep the session from attempt `id`, unless it was cancelled or signed
    /// out meanwhile. Under the token lock, so a disconnect is either before
    /// (and this keeps nothing) or after (and clears it).
    async fn keep(&self, id: u64, tokens: Tokens) -> bool {
        let mut slot = self.tokens.lock().await;
        {
            let a = self.attempt.lock().unwrap();
            if a.id != id || a.state != SignIn::Waiting || !a.claimed {
                return false;
            }
        }
        match self.vault.save(&tokens) {
            Ok(()) => {
                *slot = Some(tokens);
                self.end(id, SignIn::Approved, true)
            }
            Err(note) => {
                self.end(id, SignIn::Failed { note }, true);
                false
            }
        }
    }

    /// Trade the redirect's code for a session.
    async fn exchange(&self, code: &str, verifier: &str) -> Result<Tokens, String> {
        let redirect = self.redirect_uri();
        let res = self
            .http
            .post(format!("{}/token", self.cfg.auth_base))
            .header(reqwest::header::USER_AGENT, &self.cfg.user_agent)
            .form(&[
                ("client_id", self.cfg.client_id.as_str()),
                ("grant_type", "authorization_code"),
                ("code", code),
                ("code_verifier", verifier),
                ("redirect_uri", redirect.as_str()),
            ])
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = res.status().as_u16();
        let body = res.text().await.map_err(|e| e.to_string())?;
        if status != 200 {
            return Err(why(status, &body));
        }
        tokens_from(&body)
    }

    /// Trade the refresh token for a new pair. Called with the token lock
    /// held, so it cannot run twice at once. A refused refresh signs the user
    /// out: the only way back is signing in again.
    async fn refresh_locked(&self, slot: &mut Option<Tokens>) -> Result<(), String> {
        let Some(cur) = slot.clone() else {
            return Err("signed out".into());
        };
        let res = self
            .http
            .post(format!("{}/token", self.cfg.auth_base))
            .header(reqwest::header::USER_AGENT, &self.cfg.user_agent)
            .form(&[
                ("client_id", self.cfg.client_id.as_str()),
                ("grant_type", "refresh_token"),
                ("refresh_token", cur.refresh_token.as_str()),
            ])
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = res.status().as_u16();
        let body = res.text().await.map_err(|e| e.to_string())?;
        if status == 200 {
            let tokens = tokens_from(&body)?;
            self.vault.save(&tokens)?;
            *slot = Some(tokens);
            return Ok(());
        }
        if status == 400 || status == 401 {
            self.vault.clear();
            *slot = None;
            return Err("signed out".into());
        }
        Err(format!("refresh: {}", why(status, &body)))
    }

    /// The access token to use now, refreshed first if it is about to run
    /// out. None when signed out.
    async fn fresh_token(&self) -> Result<Option<String>, String> {
        let mut slot = self.tokens.lock().await;
        match slot.as_ref() {
            None => return Ok(None),
            Some(t) if t.expires_at > now() + EARLY => return Ok(Some(t.access_token.clone())),
            Some(_) => {}
        }
        self.refresh_locked(&mut slot).await?;
        Ok(slot.as_ref().map(|t| t.access_token.clone()))
    }

    /// After a 401 on `used`: refresh, unless someone already has.
    async fn refresh_after_401(&self, used: &str) -> Result<Option<String>, String> {
        let mut slot = self.tokens.lock().await;
        match slot.as_ref() {
            None => return Ok(None),
            Some(t) if t.access_token != used => return Ok(Some(t.access_token.clone())),
            Some(_) => {}
        }
        self.refresh_locked(&mut slot).await?;
        Ok(slot.as_ref().map(|t| t.access_token.clone()))
    }

    /// A call to the API. `path` is MAL's own (`/users/@me/animelist`),
    /// never a URL: the token only ever goes to api_base. `form` is the
    /// query on a GET and the form-encoded body on anything else, which is
    /// how MAL takes a list update.
    pub async fn request(
        &self,
        method: &str,
        path: &str,
        form: Option<BTreeMap<String, String>>,
    ) -> Result<Reply, String> {
        if !path.starts_with('/')
            || path.starts_with("//")
            || path.contains("://")
            || path.contains('\\')
        {
            return Err("not a MyAnimeList path".into());
        }
        let method =
            reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "bad method".to_string())?;
        if !self.configured() {
            return Err("this build has no MyAnimeList key".into());
        }
        self.pace().await;
        let token = self.fresh_token().await?;
        let mut reply = self
            .send(&method, path, form.as_ref(), token.as_deref())
            .await?;
        if reply.status == 401 {
            if let Some(used) = token {
                if let Some(t) = self.refresh_after_401(&used).await? {
                    self.pace().await;
                    reply = self.send(&method, path, form.as_ref(), Some(&t)).await?;
                }
            }
        }
        Ok(reply)
    }

    /// Hold calls a second apart.
    async fn pace(&self) {
        let mut last = self.last_call.lock().await;
        if let Some(at) = *last {
            let since = at.elapsed();
            if since < GAP {
                tokio::time::sleep(GAP - since).await;
            }
        }
        *last = Some(Instant::now());
    }

    async fn send(
        &self,
        method: &reqwest::Method,
        path: &str,
        form: Option<&BTreeMap<String, String>>,
        token: Option<&str>,
    ) -> Result<Reply, String> {
        let mut req = self
            .http
            .request(method.clone(), format!("{}{}", self.cfg.api_base, path))
            .header(reqwest::header::USER_AGENT, &self.cfg.user_agent);
        if let Some(t) = token {
            req = req.header(reqwest::header::AUTHORIZATION, format!("Bearer {t}"));
        }
        if let Some(f) = form {
            req = if method == reqwest::Method::GET {
                req.query(f)
            } else {
                req.form(f)
            };
        }
        let res = req.send().await.map_err(|e| e.to_string())?;
        let status = res.status().as_u16();
        let body = res.text().await.map_err(|e| e.to_string())?;
        Ok(Reply { status, body })
    }

    /// Sign out here. MAL has no revoke, so the session is simply forgotten.
    pub async fn disconnect(&self) {
        self.stop_attempt().await;
        *self.tokens.lock().await = None;
        self.vault.clear();
    }
}

/// The session in Windows Credential Manager (credman.rs), as two
/// credentials: each of MAL's tokens is about a kilobyte, and one blob holds
/// 2,560 bytes. `{target}/access` holds the access token, `{target}/refresh`
/// the refresh token and when the access token runs out.
#[cfg(windows)]
pub struct WindowsVault {
    pub target: String,
}

#[cfg(windows)]
#[derive(Serialize, Deserialize)]
struct Refresh {
    refresh_token: String,
    expires_at: u64,
}

#[cfg(windows)]
impl WindowsVault {
    fn access(&self) -> String {
        format!("{}/access", self.target)
    }
    fn refresh(&self) -> String {
        format!("{}/refresh", self.target)
    }
}

#[cfg(windows)]
impl Vault for WindowsVault {
    fn load(&self) -> Option<Tokens> {
        let access = String::from_utf8(crate::credman::read(&self.access())?).ok()?;
        let r: Refresh = serde_json::from_slice(&crate::credman::read(&self.refresh())?).ok()?;
        Some(Tokens {
            access_token: access,
            refresh_token: r.refresh_token,
            expires_at: r.expires_at,
        })
    }

    fn save(&self, t: &Tokens) -> Result<(), String> {
        let r = serde_json::to_vec(&Refresh {
            refresh_token: t.refresh_token.clone(),
            expires_at: t.expires_at,
        })
        .map_err(|e| e.to_string())?;
        crate::credman::write(&self.access(), t.access_token.as_bytes())?;
        crate::credman::write(&self.refresh(), &r)
    }

    fn clear(&self) {
        crate::credman::delete(&self.access());
        crate::credman::delete(&self.refresh());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trakt::MemoryVault;
    use http_body_util::BodyExt;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn run<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(f)
    }

    /// (method, path and query, content type, body, authorization)
    type Seen = (String, String, String, String, String);

    /// A fake MAL: the token route and the API, recording what it was sent.
    #[derive(Default)]
    struct Fake {
        /// Every form the token route was sent.
        token_forms: std::sync::Mutex<Vec<BTreeMap<String, String>>>,
        refreshes: AtomicUsize,
        gen: AtomicUsize,
        /// The access token the API accepts.
        live_access: std::sync::Mutex<String>,
        /// Refresh tokens given out; MAL's stay valid after a rotation.
        issued: std::sync::Mutex<Vec<String>>,
        refuse_refresh: bool,
        api_seen: std::sync::Mutex<Vec<Seen>>,
    }

    fn form_of(s: &str) -> BTreeMap<String, String> {
        reqwest::Url::parse(&format!("http://x/?{s}"))
            .unwrap()
            .query_pairs()
            .into_owned()
            .collect()
    }

    async fn serve(fake: Arc<Fake>) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let (stream, _) = listener.accept().await.unwrap();
                let fake = fake.clone();
                tokio::spawn(async move {
                    let svc = hyper::service::service_fn(
                        move |req: Request<hyper::body::Incoming>| {
                            let fake = fake.clone();
                            async move { Ok::<_, std::convert::Infallible>(route(&fake, req).await) }
                        },
                    );
                    let _ = hyper::server::conn::http1::Builder::new()
                        .serve_connection(hyper_util::rt::TokioIo::new(stream), svc)
                        .await;
                });
            }
        });
        format!("http://{addr}")
    }

    fn json(status: u16, body: serde_json::Value) -> Response<Full<Bytes>> {
        Response::builder()
            .status(status)
            .header("content-type", "application/json")
            .body(Full::new(Bytes::from(body.to_string())))
            .unwrap()
    }

    fn pair(fake: &Fake, n: usize) -> Response<Full<Bytes>> {
        *fake.live_access.lock().unwrap() = format!("A{n}");
        fake.issued.lock().unwrap().push(format!("R{n}"));
        json(
            200,
            serde_json::json!({
                "token_type": "Bearer", "expires_in": 2_678_400,
                "access_token": format!("A{n}"), "refresh_token": format!("R{n}"),
            }),
        )
    }

    async fn route(fake: &Fake, req: Request<hyper::body::Incoming>) -> Response<Full<Bytes>> {
        let path = req
            .uri()
            .path_and_query()
            .map(|p| p.to_string())
            .unwrap_or_default();
        let method = req.method().to_string();
        let header = |n: &str| {
            req.headers()
                .get(n)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_string()
        };
        let auth = header("authorization");
        let ctype = header("content-type");
        let body = req.into_body().collect().await.unwrap().to_bytes();
        let body = String::from_utf8_lossy(&body).to_string();
        if path == "/token" {
            let f = form_of(&body);
            fake.token_forms.lock().unwrap().push(f.clone());
            return match f.get("grant_type").map(String::as_str) {
                Some("authorization_code") if f.get("code").map(String::as_str) == Some("C1") => {
                    pair(fake, 0)
                }
                Some("refresh_token") => {
                    fake.refreshes.fetch_add(1, Ordering::SeqCst);
                    let known = fake
                        .issued
                        .lock()
                        .unwrap()
                        .contains(f.get("refresh_token").unwrap_or(&String::new()));
                    if fake.refuse_refresh || !known {
                        return json(400, serde_json::json!({ "error": "invalid_grant" }));
                    }
                    let n = fake.gen.fetch_add(1, Ordering::SeqCst) + 1;
                    pair(fake, n)
                }
                _ => json(400, serde_json::json!({ "error": "invalid_grant" })),
            };
        }
        fake.api_seen
            .lock()
            .unwrap()
            .push((method, path.clone(), ctype, body, auth.clone()));
        let live = fake.live_access.lock().unwrap().clone();
        if auth != format!("Bearer {live}") {
            return json(401, serde_json::json!({ "error": "invalid_token" }));
        }
        if path == "/banned" {
            return Response::builder()
                .status(403)
                .header("content-type", "text/html")
                .body(Full::new(Bytes::from("<html>Forbidden</html>")))
                .unwrap();
        }
        json(200, serde_json::json!({ "name": "adam" }))
    }

    fn free_port() -> u16 {
        std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    }

    fn cfg(base: &str, port: u16) -> Config {
        Config {
            client_id: "ID".into(),
            api_base: base.into(),
            auth_base: base.into(),
            redirect_port: port,
            sign_in_for: Duration::from_secs(60),
            user_agent: "BlammyTV/test".into(),
        }
    }

    fn signed_in(fake: &Fake, base: &str, expires_at: u64) -> Arc<Mal> {
        *fake.live_access.lock().unwrap() = "A0".into();
        fake.issued.lock().unwrap().push("R0".into());
        let vault = MemoryVault::default();
        vault
            .save(&Tokens {
                access_token: "A0".into(),
                refresh_token: "R0".into(),
                expires_at,
            })
            .unwrap();
        Mal::new(
            cfg(base, free_port()),
            reqwest::Client::new(),
            Box::new(vault),
        )
    }

    /// What the browser does with MAL's redirect.
    async fn browse(port: u16, query: &str) -> (u16, String) {
        let r = reqwest::Client::new()
            .get(format!("http://127.0.0.1:{port}{query}"))
            .send()
            .await
            .unwrap();
        (r.status().as_u16(), r.text().await.unwrap())
    }

    /// The port is given back once a sign-in ends (its listeners go away
    /// on the runtime's next turn).
    async fn port_is_free(port: u16) -> bool {
        for _ in 0..40 {
            if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        false
    }

    #[test]
    fn the_browser_sign_in_keeps_the_session() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let port = free_port();
            let m = Mal::new(
                cfg(&base, port),
                reqwest::Client::new(),
                Box::new(MemoryVault::default()),
            );
            assert!(!m.status().await.connected);
            let url = reqwest::Url::parse(&m.sign_in_start().await.unwrap()).unwrap();
            assert_eq!(url.path(), "/authorize");
            let q: BTreeMap<String, String> = url.query_pairs().into_owned().collect();
            assert_eq!(q["response_type"], "code");
            assert_eq!(q["client_id"], "ID");
            assert_eq!(q["code_challenge_method"], "plain");
            assert_eq!(q["code_challenge"].len(), 96);
            assert_eq!(q["redirect_uri"], format!("http://localhost:{port}/"));
            assert_eq!(m.sign_in_poll(), SignIn::Waiting);

            // The browser asks for its icon first; that is not the redirect.
            assert_eq!(browse(port, "/favicon.ico").await.0, 404);
            assert_eq!(m.sign_in_poll(), SignIn::Waiting);

            let (status, html) = browse(port, &format!("/?code=C1&state={}", q["state"])).await;
            assert_eq!(status, 200);
            assert!(html.contains("Signed in to MyAnimeList"), "{html}");
            assert_eq!(m.sign_in_poll(), SignIn::Approved);
            assert!(m.status().await.connected);

            // The code was traded with the verifier, which is the challenge
            // (plain), and the same redirect, and no secret.
            let forms = fake.token_forms.lock().unwrap().clone();
            assert_eq!(forms.len(), 1);
            assert_eq!(forms[0]["grant_type"], "authorization_code");
            assert_eq!(forms[0]["code"], "C1");
            assert_eq!(forms[0]["code_verifier"], q["code_challenge"]);
            assert_eq!(forms[0]["redirect_uri"], q["redirect_uri"]);
            assert_eq!(forms[0]["client_id"], "ID");
            assert!(!forms[0].contains_key("client_secret"));

            assert!(port_is_free(port).await);
            let r = m.request("GET", "/users/@me", None).await.unwrap();
            assert_eq!(r.status, 200);
        })
    }

    #[test]
    fn a_forged_redirect_is_refused_and_a_decline_says_so() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let port = free_port();
            let m = Mal::new(
                cfg(&base, port),
                reqwest::Client::new(),
                Box::new(MemoryVault::default()),
            );
            let url = reqwest::Url::parse(&m.sign_in_start().await.unwrap()).unwrap();
            let q: BTreeMap<String, String> = url.query_pairs().into_owned().collect();

            // Another page poking the port, without this sign-in's nonce.
            assert_eq!(browse(port, "/?code=C1&state=guess").await.0, 400);
            assert_eq!(browse(port, "/?code=C1").await.0, 400);
            assert_eq!(m.sign_in_poll(), SignIn::Waiting);
            assert!(fake.token_forms.lock().unwrap().is_empty());

            let (status, html) =
                browse(port, &format!("/?error=access_denied&state={}", q["state"])).await;
            assert_eq!(status, 200);
            assert!(html.contains("Not signed in"), "{html}");
            assert_eq!(m.sign_in_poll(), SignIn::Denied);
            assert!(!m.status().await.connected);
            assert!(port_is_free(port).await);
        })
    }

    #[test]
    fn a_refused_code_fails_with_mals_reason() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let port = free_port();
            let m = Mal::new(
                cfg(&base, port),
                reqwest::Client::new(),
                Box::new(MemoryVault::default()),
            );
            let url = reqwest::Url::parse(&m.sign_in_start().await.unwrap()).unwrap();
            let q: BTreeMap<String, String> = url.query_pairs().into_owned().collect();
            let (status, _) = browse(port, &format!("/?code=WRONG&state={}", q["state"])).await;
            assert_eq!(status, 502);
            assert_eq!(
                m.sign_in_poll(),
                SignIn::Failed {
                    note: "HTTP 400, invalid_grant".into()
                }
            );
            assert!(!m.status().await.connected);
        })
    }

    #[test]
    fn a_sign_in_nobody_finishes_expires_and_frees_the_port() {
        run(async {
            let port = free_port();
            let mut c = cfg("http://127.0.0.1:9", port);
            c.sign_in_for = Duration::from_millis(150);
            let m = Mal::new(c, reqwest::Client::new(), Box::new(MemoryVault::default()));
            m.sign_in_start().await.unwrap();
            tokio::time::sleep(Duration::from_millis(400)).await;
            assert_eq!(m.sign_in_poll(), SignIn::Expired);
            assert!(port_is_free(port).await);
        })
    }

    #[test]
    fn a_taken_port_is_named() {
        run(async {
            let held = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let port = held.local_addr().unwrap().port();
            let m = Mal::new(
                cfg("http://127.0.0.1:9", port),
                reqwest::Client::new(),
                Box::new(MemoryVault::default()),
            );
            let e = m.sign_in_start().await.unwrap_err();
            assert!(e.contains(&port.to_string()), "{e}");
            assert_eq!(m.sign_in_poll(), SignIn::Idle);
        })
    }

    #[test]
    fn starting_again_takes_the_port_over_and_the_old_link_goes_stale() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let port = free_port();
            let m = Mal::new(
                cfg(&base, port),
                reqwest::Client::new(),
                Box::new(MemoryVault::default()),
            );
            let first = reqwest::Url::parse(&m.sign_in_start().await.unwrap()).unwrap();
            let old: BTreeMap<String, String> = first.query_pairs().into_owned().collect();
            // Straight away: the first one's listeners must have let go.
            m.sign_in_start().await.unwrap();
            assert_eq!(
                browse(port, &format!("/?code=C1&state={}", old["state"]))
                    .await
                    .0,
                400
            );
            assert_eq!(m.sign_in_poll(), SignIn::Waiting);
            m.sign_in_cancel().await;
            assert_eq!(m.sign_in_poll(), SignIn::Idle);
            assert!(port_is_free(port).await);
        })
    }

    #[test]
    fn a_call_carries_the_token_and_a_form() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let m = signed_in(&fake, &base, now() + 86_400);
            let form = |p: &[(&str, &str)]| {
                Some(
                    p.iter()
                        .map(|(k, v)| (k.to_string(), v.to_string()))
                        .collect::<BTreeMap<_, _>>(),
                )
            };
            let r = m
                .request(
                    "PATCH",
                    "/anime/21/my_list_status",
                    form(&[("status", "watching"), ("num_watched_episodes", "12")]),
                )
                .await
                .unwrap();
            assert_eq!(r.status, 200);
            m.request(
                "GET",
                "/users/@me/animelist",
                form(&[("fields", "list_status"), ("limit", "1000")]),
            )
            .await
            .unwrap();
            let seen = fake.api_seen.lock().unwrap().clone();
            assert_eq!(seen[0].0, "PATCH");
            assert_eq!(seen[0].1, "/anime/21/my_list_status");
            assert_eq!(seen[0].2, "application/x-www-form-urlencoded");
            assert_eq!(
                form_of(&seen[0].3),
                form(&[("status", "watching"), ("num_watched_episodes", "12")]).unwrap()
            );
            assert_eq!(seen[0].4, "Bearer A0");
            assert_eq!(seen[1].0, "GET");
            assert_eq!(
                seen[1].1,
                "/users/@me/animelist?fields=list_status&limit=1000"
            );
            assert_eq!(fake.refreshes.load(Ordering::SeqCst), 0);
        })
    }

    #[test]
    fn a_token_about_to_run_out_is_refreshed_first() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let m = signed_in(&fake, &base, now() + 10);
            let r = m.request("GET", "/users/@me", None).await.unwrap();
            assert_eq!(r.status, 200);
            assert_eq!(fake.refreshes.load(Ordering::SeqCst), 1);
            assert_eq!(fake.api_seen.lock().unwrap().len(), 1);
            let forms = fake.token_forms.lock().unwrap().clone();
            assert_eq!(forms[0]["refresh_token"], "R0");
            assert_eq!(forms[0]["client_id"], "ID");
        })
    }

    #[test]
    fn a_401_refreshes_once_and_retries() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let m = signed_in(&fake, &base, now() + 86_400);
            *fake.live_access.lock().unwrap() = "OTHER".into();
            let r = m.request("GET", "/users/@me", None).await.unwrap();
            assert_eq!(r.status, 200);
            assert_eq!(fake.refreshes.load(Ordering::SeqCst), 1);
            assert_eq!(fake.api_seen.lock().unwrap().len(), 2);
        })
    }

    #[test]
    fn two_calls_on_an_expired_token_refresh_it_once() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let m = signed_in(&fake, &base, now() + 10);
            let (a, b) = futures_util::future::join(
                m.request("GET", "/users/@me", None),
                m.request("GET", "/users/@me/animelist", None),
            )
            .await;
            assert_eq!(a.unwrap().status, 200);
            assert_eq!(b.unwrap().status, 200);
            assert_eq!(fake.refreshes.load(Ordering::SeqCst), 1);
        })
    }

    #[test]
    fn a_refused_refresh_signs_out() {
        run(async {
            let fake = Arc::new(Fake {
                refuse_refresh: true,
                ..Default::default()
            });
            let base = serve(fake.clone()).await;
            let m = signed_in(&fake, &base, now() + 10);
            let r = m.request("GET", "/users/@me", None).await;
            assert_eq!(r.unwrap_err(), "signed out");
            assert!(!m.status().await.connected);
        })
    }

    #[test]
    fn calls_are_held_a_second_apart() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let m = signed_in(&fake, &base, now() + 86_400);
            let t0 = Instant::now();
            m.request("GET", "/a", None).await.unwrap();
            m.request("GET", "/b", None).await.unwrap();
            assert!(
                t0.elapsed() >= Duration::from_millis(950),
                "{:?}",
                t0.elapsed()
            );
        })
    }

    #[test]
    fn a_ban_page_comes_back_as_data() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let m = signed_in(&fake, &base, now() + 86_400);
            let r = m.request("GET", "/banned", None).await.unwrap();
            assert_eq!(r.status, 403);
            assert!(r.body.starts_with("<html>"));
        })
    }

    #[test]
    fn the_token_only_goes_to_mal() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let m = signed_in(&fake, &base, now() + 86_400);
            for bad in [
                "https://evil.example/x",
                "users/@me",
                "//evil.example/x",
                "/x\\y",
            ] {
                assert!(m.request("GET", bad, None).await.is_err(), "{bad}");
            }
            assert!(fake.api_seen.lock().unwrap().is_empty());
        })
    }

    #[test]
    fn disconnect_forgets() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let m = signed_in(&fake, &base, now() + 86_400);
            m.disconnect().await;
            assert!(!m.status().await.connected);
            let r = m.request("GET", "/users/@me", None).await.unwrap();
            assert_eq!(r.status, 401);
            assert_eq!(fake.api_seen.lock().unwrap()[0].4, "");
        })
    }

    #[test]
    fn a_build_without_a_key_is_not_configured() {
        run(async {
            let mut c = cfg("http://127.0.0.1:9", free_port());
            c.client_id.clear();
            let m = Mal::new(c, reqwest::Client::new(), Box::new(MemoryVault::default()));
            assert_eq!(
                m.status().await,
                Status {
                    configured: false,
                    connected: false
                }
            );
            assert!(m.sign_in_start().await.is_err());
        })
    }

    #[cfg(windows)]
    #[test]
    fn the_windows_vault_keeps_two_kilobyte_tokens() {
        let v = WindowsVault {
            target: format!("BlammyTV/mal-test-{}", std::process::id()),
        };
        v.clear();
        assert_eq!(v.load(), None);
        // Too big for one credential together (2,560 bytes).
        let t = Tokens {
            access_token: "a".repeat(1500),
            refresh_token: "r".repeat(1500),
            expires_at: 42,
        };
        v.save(&t).unwrap();
        assert_eq!(v.load(), Some(t));
        v.clear();
        assert_eq!(v.load(), None);
    }
}

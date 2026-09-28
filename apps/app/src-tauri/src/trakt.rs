//! Trakt (plan 015): sign-in by the device flow, the user's tokens in the
//! OS vault, and every Trakt call made from here, so a token never reaches
//! the page or localStorage (decision D4 a).
//!
//! No Tauri in this file: lib.rs wraps it in commands, and the host crate
//! (scripts/mvproxy-host) includes it as it is and runs its tests against a
//! fake Trakt on Linux, where the app crate itself will not build.
//!
//! What Trakt's own API source says, and this follows (read 2026-09-27):
//! - Every OAuth call goes to auth.trakt.tv, the API to api.trakt.tv.
//! - The client secret is required to finish the sign-in, to refresh and to
//!   revoke. It is compiled in (build.rs, from apps/app/.env.local), never
//!   committed and never sent to the page.
//! - REFRESH TOKENS ARE SINGLE-USE: a refresh returns a new one and kills
//!   the old. Two refreshes at once would sign the user out, so a refresh
//!   only ever happens under the token lock, and a request that got a 401
//!   refreshes only if nobody replaced the token it used in the meantime.
//! - The access token's life is `expires_in`: 7 days in the device guide,
//!   24 hours in the March 2025 announcement. Neither is assumed.
//! - Writes are held to one a second per user (AUTHED_API_POST_LIMIT).

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

/// Where Trakt is and who the app is. The app builds this from build-time
/// values; the tests point it at a fake.
#[derive(Clone)]
pub struct Config {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub api_base: String,
    pub auth_base: String,
    pub user_agent: String,
}

/// The user's session, as kept in the vault.
#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: String,
    /// Unix seconds.
    pub expires_at: u64,
}

/// Where the tokens live between runs.
pub trait Vault: Send + Sync {
    fn load(&self) -> Option<Tokens>;
    fn save(&self, t: &Tokens) -> Result<(), String>;
    fn clear(&self);
}

/// For the tests, and for any build that is not Windows.
#[cfg(any(test, not(windows)))]
#[derive(Default)]
pub struct MemoryVault(std::sync::Mutex<Option<Tokens>>);

#[cfg(any(test, not(windows)))]
impl Vault for MemoryVault {
    fn load(&self) -> Option<Tokens> {
        self.0.lock().unwrap().clone()
    }
    fn save(&self, t: &Tokens) -> Result<(), String> {
        *self.0.lock().unwrap() = Some(t.clone());
        Ok(())
    }
    fn clear(&self) {
        *self.0.lock().unwrap() = None;
    }
}

/// What the page is shown while the user approves the sign-in elsewhere.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DeviceCode {
    pub user_code: String,
    pub verification_url: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Deserialize)]
struct DeviceCodeFull {
    device_code: String,
    user_code: String,
    verification_url: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
    created_at: Option<u64>,
}

/// One poll of the sign-in, in Trakt's status codes' words.
#[derive(Serialize, Debug, PartialEq, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum Poll {
    Approved,
    Pending,
    /// 404: this code is not one Trakt gave out.
    Invalid,
    /// 409: already used.
    Used,
    /// 410: too late, start again.
    Expired,
    /// 418: the user said no.
    Denied,
    /// 429: polling too fast.
    SlowDown,
    /// Nothing started, or the app has no Trakt keys.
    Idle,
}

/// A Trakt answer, handed to the page as data: a 4xx is not an error here,
/// the page decides what a 420 or a 409 means for what it asked.
#[derive(Serialize, Debug)]
pub struct Reply {
    pub status: u16,
    pub body: String,
    /// Seconds, from `Retry-After` on a 429.
    pub retry_after: Option<u64>,
    /// `X-Account-Limit` on a 420 (a free account's cap).
    pub account_limit: Option<u64>,
    /// `X-Upgrade-URL`, for the VIP sign-up on a 420 or 426.
    pub upgrade_url: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Status {
    /// The build carries Trakt keys.
    pub configured: bool,
    /// A session is in the vault.
    pub connected: bool,
}

pub struct Trakt {
    cfg: Config,
    http: reqwest::Client,
    vault: Box<dyn Vault>,
    /// The session. Held across a refresh, so there is only ever one.
    tokens: Mutex<Option<Tokens>>,
    pending: Mutex<Option<String>>,
    last_write: Mutex<Option<Instant>>,
}

/// Writes at most this often (AUTHED_API_POST_LIMIT: one a second).
const WRITE_GAP: Duration = Duration::from_millis(1000);
/// Refresh this long before the token runs out, not after a failed call.
const EARLY: u64 = 300;

/// Hold a new session, then write it to the vault. In that order: Trakt's
/// refresh tokens are single-use, so a new pair dropped because the write
/// failed left the spent token in hand, and the next refresh signed the
/// user out. A failed write costs the session at the next launch, not now.
fn keep(vault: &dyn Vault, slot: &mut Option<Tokens>, tokens: Tokens) {
    if let Err(e) = vault.save(&tokens) {
        eprintln!("[trakt] could not save the session: {e}");
    }
    *slot = Some(tokens);
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl Trakt {
    pub fn new(cfg: Config, http: reqwest::Client, vault: Box<dyn Vault>) -> Arc<Self> {
        let saved = vault.load();
        Arc::new(Self {
            cfg,
            http,
            vault,
            tokens: Mutex::new(saved),
            pending: Mutex::new(None),
            last_write: Mutex::new(None),
        })
    }

    fn configured(&self) -> bool {
        !self.cfg.client_id.is_empty() && !self.cfg.client_secret.is_empty()
    }

    pub async fn status(&self) -> Status {
        Status {
            configured: self.configured(),
            connected: self.tokens.lock().await.is_some(),
        }
    }

    async fn post_auth(
        &self,
        path: &str,
        body: serde_json::Value,
    ) -> Result<reqwest::Response, String> {
        self.http
            .post(format!("{}{}", self.cfg.auth_base, path))
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .header(reqwest::header::USER_AGENT, &self.cfg.user_agent)
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| e.to_string())
    }

    /// Ask Trakt for a sign-in code. The device code stays here; the page
    /// gets what it shows the user.
    pub async fn device_start(&self) -> Result<DeviceCode, String> {
        if !self.configured() {
            return Err("this build has no Trakt keys".into());
        }
        let res = self
            .post_auth(
                "/oauth/device/code",
                serde_json::json!({ "client_id": self.cfg.client_id }),
            )
            .await?;
        if !res.status().is_success() {
            return Err(format!("HTTP {}", res.status().as_u16()));
        }
        let text = res.text().await.map_err(|e| e.to_string())?;
        let full: DeviceCodeFull = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        *self.pending.lock().await = Some(full.device_code);
        Ok(DeviceCode {
            user_code: full.user_code,
            verification_url: full.verification_url,
            expires_in: full.expires_in,
            interval: full.interval,
        })
    }

    /// One poll, at the interval `device_start` gave. The page does the
    /// waiting, so closing Settings stops it.
    pub async fn device_poll(&self) -> Result<Poll, String> {
        let Some(code) = self.pending.lock().await.clone() else {
            return Ok(Poll::Idle);
        };
        let res = self
            .post_auth(
                "/oauth/device/token",
                serde_json::json!({
                    "code": code,
                    "client_id": self.cfg.client_id,
                    "client_secret": self.cfg.client_secret,
                }),
            )
            .await?;
        let poll = match res.status().as_u16() {
            200 => {
                let text = res.text().await.map_err(|e| e.to_string())?;
                let t: TokenResponse = serde_json::from_str(&text).map_err(|e| e.to_string())?;
                self.store(t).await?;
                Poll::Approved
            }
            400 => Poll::Pending,
            404 => Poll::Invalid,
            409 => Poll::Used,
            410 => Poll::Expired,
            418 => Poll::Denied,
            429 => Poll::SlowDown,
            s => return Err(format!("HTTP {s}")),
        };
        if !matches!(poll, Poll::Pending | Poll::SlowDown) {
            *self.pending.lock().await = None;
        }
        Ok(poll)
    }

    async fn store(&self, t: TokenResponse) -> Result<(), String> {
        let tokens = Tokens {
            access_token: t.access_token,
            refresh_token: t.refresh_token,
            expires_at: t.created_at.unwrap_or_else(now) + t.expires_in,
        };
        let mut slot = self.tokens.lock().await;
        keep(&*self.vault, &mut slot, tokens);
        Ok(())
    }

    /// Trade the refresh token for a new pair. Called with the token lock
    /// held, so it cannot run twice at once. A refused refresh (the token
    /// was revoked, or already used) signs the user out: there is no other
    /// way back in than signing in again.
    async fn refresh_locked(&self, slot: &mut Option<Tokens>) -> Result<(), String> {
        let Some(cur) = slot.clone() else {
            return Err("signed out".into());
        };
        let res = self
            .post_auth(
                "/oauth/token",
                serde_json::json!({
                    "refresh_token": cur.refresh_token,
                    "client_id": self.cfg.client_id,
                    "client_secret": self.cfg.client_secret,
                    "redirect_uri": self.cfg.redirect_uri,
                    "grant_type": "refresh_token",
                }),
            )
            .await?;
        let status = res.status().as_u16();
        if status == 200 {
            let text = res.text().await.map_err(|e| e.to_string())?;
            let t: TokenResponse = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            let tokens = Tokens {
                access_token: t.access_token,
                refresh_token: t.refresh_token,
                expires_at: t.created_at.unwrap_or_else(now) + t.expires_in,
            };
            keep(&*self.vault, slot, tokens);
            return Ok(());
        }
        // Refused: the refresh token is spent or revoked, and the only way
        // back is signing in again. Anything else (a 429, a 403 challenge
        // in front of auth.trakt.tv, a timeout) says nothing about the
        // session, which is kept and tried again on the next call.
        if status == 400 || status == 401 {
            self.vault.clear();
            *slot = None;
            return Err("signed out".into());
        }
        Err(format!("refresh: HTTP {status}"))
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

    /// A call to the API. `path` is Trakt's own (`/sync/history`), never a
    /// URL: the token only ever goes to api_base.
    pub async fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<String>,
    ) -> Result<Reply, String> {
        if !path.starts_with('/')
            || path.starts_with("//")
            || path.contains("://")
            || path.contains('\\')
        {
            return Err("not a Trakt path".into());
        }
        let method =
            reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "bad method".to_string())?;
        if !self.configured() {
            return Err("this build has no Trakt keys".into());
        }
        let write = method != reqwest::Method::GET;
        if write {
            self.pace().await;
        }
        let token = self.fresh_token().await?;
        let mut reply = self
            .send(&method, path, body.as_deref(), token.as_deref())
            .await?;
        if reply.0 == 401 {
            if let Some(used) = token {
                if let Some(t) = self.refresh_after_401(&used).await? {
                    if write {
                        self.pace().await;
                    }
                    reply = self.send(&method, path, body.as_deref(), Some(&t)).await?;
                }
            }
        }
        Ok(reply.1)
    }

    /// Hold writes one second apart.
    async fn pace(&self) {
        let mut last = self.last_write.lock().await;
        if let Some(at) = *last {
            let since = at.elapsed();
            if since < WRITE_GAP {
                tokio::time::sleep(WRITE_GAP - since).await;
            }
        }
        *last = Some(Instant::now());
    }

    async fn send(
        &self,
        method: &reqwest::Method,
        path: &str,
        body: Option<&str>,
        token: Option<&str>,
    ) -> Result<(u16, Reply), String> {
        let mut req = self
            .http
            .request(method.clone(), format!("{}{}", self.cfg.api_base, path))
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .header(reqwest::header::USER_AGENT, &self.cfg.user_agent)
            .header("trakt-api-version", "2")
            .header("trakt-api-key", &self.cfg.client_id);
        if let Some(t) = token {
            req = req.header(reqwest::header::AUTHORIZATION, format!("Bearer {t}"));
        }
        if let Some(b) = body {
            req = req.body(b.to_string());
        }
        let res = req.send().await.map_err(|e| e.to_string())?;
        let status = res.status().as_u16();
        let header = |name: &str| {
            res.headers()
                .get(name)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string)
        };
        let retry_after = header("retry-after").and_then(|v| v.trim().parse().ok());
        let account_limit = header("x-account-limit").and_then(|v| v.trim().parse().ok());
        let upgrade_url = header("x-upgrade-url");
        let body = res.text().await.map_err(|e| e.to_string())?;
        Ok((
            status,
            Reply {
                status,
                body,
                retry_after,
                account_limit,
                upgrade_url,
            },
        ))
    }

    /// Sign out: ask Trakt to forget the token (best effort), and forget it
    /// here whatever Trakt says.
    pub async fn disconnect(&self) {
        let token = self.tokens.lock().await.take();
        self.vault.clear();
        *self.pending.lock().await = None;
        if let Some(t) = token {
            let _ = self
                .post_auth(
                    "/oauth/revoke",
                    serde_json::json!({
                        "token": t.access_token,
                        "client_id": self.cfg.client_id,
                        "client_secret": self.cfg.client_secret,
                    }),
                )
                .await;
        }
    }
}

/// The tokens in Windows Credential Manager, as one generic credential
/// holding the JSON above (credman.rs). Per user, on this machine only.
#[cfg(windows)]
pub struct WindowsVault {
    pub target: String,
}

#[cfg(windows)]
impl Vault for WindowsVault {
    fn load(&self) -> Option<Tokens> {
        serde_json::from_slice(&crate::credman::read(&self.target)?).ok()
    }

    fn save(&self, t: &Tokens) -> Result<(), String> {
        let blob = serde_json::to_vec(t).map_err(|e| e.to_string())?;
        crate::credman::write(&self.target, &blob)
    }

    fn clear(&self) {
        crate::credman::delete(&self.target)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use http_body_util::{BodyExt, Full};
    use hyper::body::Bytes;
    use hyper::{Request, Response};
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// No tokio `macros` feature in the app's tree: a runtime by hand, as
    /// mvproxy's tests do.
    fn run<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(f)
    }

    /// A fake Trakt: the OAuth routes and one API route, counting what it
    /// was asked.
    #[derive(Default)]
    struct Fake {
        polls: AtomicUsize,
        /// Polls answered 400 (pending) before the approval.
        pending_for: usize,
        /// What the poll answers once it stops pending.
        poll_end: u16,
        refreshes: AtomicUsize,
        /// The one refresh token still valid; used ones are refused.
        live_refresh: std::sync::Mutex<String>,
        /// The access token the API accepts.
        live_access: std::sync::Mutex<String>,
        /// The access token every refresh hands out next.
        gen: AtomicUsize,
        api_seen: std::sync::Mutex<Vec<(String, String, Option<String>, Option<String>)>>,
        revoked: std::sync::Mutex<Vec<String>>,
        /// Make the refresh route refuse, as for a revoked token.
        refuse_refresh: bool,
        /// Make the refresh route answer this instead (a 429, a 403
        /// challenge): trouble on Trakt's side, not a verdict.
        refresh_trouble: Option<u16>,
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

    async fn route(fake: &Fake, req: Request<hyper::body::Incoming>) -> Response<Full<Bytes>> {
        let path = req.uri().path().to_string();
        let method = req.method().to_string();
        let header = |n: &str| {
            req.headers()
                .get(n)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string)
        };
        let auth = header("authorization");
        let key = header("trakt-api-key");
        let version = header("trakt-api-version");
        let body = req.into_body().collect().await.unwrap().to_bytes();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
        match path.as_str() {
            "/oauth/device/code" => json(
                200,
                serde_json::json!({
                    "device_code": "DEV", "user_code": "ABCD1234",
                    "verification_url": "https://trakt.tv/activate",
                    "expires_in": 600, "interval": 5,
                }),
            ),
            "/oauth/device/token" => {
                assert_eq!(v["code"], "DEV");
                assert_eq!(v["client_secret"], "SECRET");
                let n = fake.polls.fetch_add(1, Ordering::SeqCst);
                if n < fake.pending_for {
                    return json(400, serde_json::Value::Null);
                }
                if fake.poll_end != 200 {
                    return json(fake.poll_end, serde_json::Value::Null);
                }
                *fake.live_access.lock().unwrap() = "A0".into();
                *fake.live_refresh.lock().unwrap() = "R0".into();
                json(
                    200,
                    serde_json::json!({
                        "access_token": "A0", "token_type": "bearer", "expires_in": 604800,
                        "refresh_token": "R0", "scope": "public", "created_at": now(),
                    }),
                )
            }
            "/oauth/token" => {
                fake.refreshes.fetch_add(1, Ordering::SeqCst);
                assert_eq!(v["grant_type"], "refresh_token");
                if let Some(code) = fake.refresh_trouble {
                    return json(code, serde_json::Value::Null);
                }
                let mut live = fake.live_refresh.lock().unwrap();
                if fake.refuse_refresh || v["refresh_token"] != *live {
                    return json(400, serde_json::json!({ "error": "invalid_grant" }));
                }
                let n = fake.gen.fetch_add(1, Ordering::SeqCst) + 1;
                *live = format!("R{n}");
                *fake.live_access.lock().unwrap() = format!("A{n}");
                json(
                    200,
                    serde_json::json!({
                        "access_token": format!("A{n}"), "token_type": "bearer", "expires_in": 604800,
                        "refresh_token": format!("R{n}"), "scope": "public", "created_at": now(),
                    }),
                )
            }
            "/oauth/revoke" => {
                fake.revoked
                    .lock()
                    .unwrap()
                    .push(v["token"].as_str().unwrap_or("").into());
                json(200, serde_json::Value::Null)
            }
            _ => {
                fake.api_seen
                    .lock()
                    .unwrap()
                    .push((method, path.clone(), key, version));
                let live = fake.live_access.lock().unwrap().clone();
                if auth.as_deref() != Some(&format!("Bearer {live}")) {
                    return json(401, serde_json::Value::Null);
                }
                if path == "/limit" {
                    return Response::builder()
                        .status(420)
                        .header("x-account-limit", "250")
                        .header("x-upgrade-url", "https://trakt.tv/vip")
                        .body(Full::new(Bytes::new()))
                        .unwrap();
                }
                json(200, serde_json::json!({ "ok": true }))
            }
        }
    }

    fn cfg(base: &str) -> Config {
        Config {
            client_id: "ID".into(),
            client_secret: "SECRET".into(),
            redirect_uri: "urn:ietf:wg:oauth:2.0:oob".into(),
            api_base: base.into(),
            auth_base: base.into(),
            user_agent: "BlammyTV/test".into(),
        }
    }

    /// A client already signed in, with the fake agreeing on the tokens.
    fn signed_in(fake: &Fake, base: &str, expires_at: u64) -> Arc<Trakt> {
        *fake.live_access.lock().unwrap() = "A0".into();
        *fake.live_refresh.lock().unwrap() = "R0".into();
        let vault = MemoryVault::default();
        vault
            .save(&Tokens {
                access_token: "A0".into(),
                refresh_token: "R0".into(),
                expires_at,
            })
            .unwrap();
        Trakt::new(cfg(base), reqwest::Client::new(), Box::new(vault))
    }

    #[test]
    fn the_device_flow_waits_then_keeps_the_session() {
        run(async {
            let fake = Arc::new(Fake {
                pending_for: 2,
                poll_end: 200,
                ..Default::default()
            });
            let base = serve(fake.clone()).await;
            let t = Trakt::new(
                cfg(&base),
                reqwest::Client::new(),
                Box::new(MemoryVault::default()),
            );
            assert_eq!(
                t.status().await,
                Status {
                    configured: true,
                    connected: false
                }
            );
            let code = t.device_start().await.unwrap();
            assert_eq!(code.user_code, "ABCD1234");
            assert_eq!(code.interval, 5);
            assert_eq!(t.device_poll().await.unwrap(), Poll::Pending);
            assert_eq!(t.device_poll().await.unwrap(), Poll::Pending);
            assert_eq!(t.device_poll().await.unwrap(), Poll::Approved);
            assert_eq!(
                t.status().await,
                Status {
                    configured: true,
                    connected: true
                }
            );
            // The code is spent: another poll has nothing to ask about.
            assert_eq!(t.device_poll().await.unwrap(), Poll::Idle);
        })
    }

    #[test]
    fn a_denied_or_expired_sign_in_says_so_and_stops() {
        run(async {
            for (code, want) in [
                (418, Poll::Denied),
                (410, Poll::Expired),
                (409, Poll::Used),
                (404, Poll::Invalid),
            ] {
                let fake = Arc::new(Fake {
                    poll_end: code,
                    ..Default::default()
                });
                let base = serve(fake.clone()).await;
                let t = Trakt::new(
                    cfg(&base),
                    reqwest::Client::new(),
                    Box::new(MemoryVault::default()),
                );
                t.device_start().await.unwrap();
                assert_eq!(t.device_poll().await.unwrap(), want);
                assert_eq!(t.device_poll().await.unwrap(), Poll::Idle);
                assert!(!t.status().await.connected);
            }
        })
    }

    #[test]
    fn a_call_carries_trakts_headers_and_the_token() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let t = signed_in(&fake, &base, now() + 86_400);
            let r = t
                .request("GET", "/sync/last_activities", None)
                .await
                .unwrap();
            assert_eq!(r.status, 200);
            let seen = fake.api_seen.lock().unwrap().clone();
            assert_eq!(
                seen[0],
                (
                    "GET".into(),
                    "/sync/last_activities".into(),
                    Some("ID".into()),
                    Some("2".into())
                )
            );
            assert_eq!(fake.refreshes.load(Ordering::SeqCst), 0);
        })
    }

    #[test]
    fn a_token_about_to_run_out_is_refreshed_first() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let t = signed_in(&fake, &base, now() + 10);
            let r = t.request("GET", "/sync/watched/shows", None).await.unwrap();
            assert_eq!(r.status, 200);
            assert_eq!(fake.refreshes.load(Ordering::SeqCst), 1);
            // No 401 was needed: one API call.
            assert_eq!(fake.api_seen.lock().unwrap().len(), 1);
        })
    }

    #[test]
    fn a_401_refreshes_once_and_retries() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let t = signed_in(&fake, &base, now() + 86_400);
            // Trakt has moved on (the token was refreshed elsewhere in its view).
            *fake.live_access.lock().unwrap() = "OTHER".into();
            let r = t.request("GET", "/sync/playback", None).await.unwrap();
            assert_eq!(r.status, 200);
            assert_eq!(fake.refreshes.load(Ordering::SeqCst), 1);
            assert_eq!(fake.api_seen.lock().unwrap().len(), 2);
        })
    }

    #[test]
    fn two_calls_on_an_expired_token_refresh_it_once() {
        run(async {
            // Refresh tokens are single-use: a second refresh with the same one
            // is refused, which would sign the user out.
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let t = signed_in(&fake, &base, now() + 10);
            let (a, b) = futures_util::future::join(
                t.request("GET", "/sync/watched/shows", None),
                t.request("GET", "/sync/playback", None),
            )
            .await;
            assert_eq!(a.unwrap().status, 200);
            assert_eq!(b.unwrap().status, 200);
            assert_eq!(fake.refreshes.load(Ordering::SeqCst), 1);
            assert!(t.status().await.connected);
        })
    }

    #[test]
    fn two_calls_that_hit_a_401_together_refresh_once() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let t = signed_in(&fake, &base, now() + 86_400);
            *fake.live_access.lock().unwrap() = "OTHER".into();
            let (a, b) = futures_util::future::join(
                t.request("GET", "/sync/watched/shows", None),
                t.request("GET", "/sync/playback", None),
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
            let t = signed_in(&fake, &base, now() + 10);
            let r = t.request("GET", "/sync/playback", None).await;
            assert_eq!(r.unwrap_err(), "signed out");
            assert!(!t.status().await.connected);
        })
    }

    #[test]
    fn trouble_on_trakts_side_during_a_refresh_keeps_the_session() {
        run(async {
            for code in [429, 403, 408, 500] {
                let fake = Arc::new(Fake {
                    refresh_trouble: Some(code),
                    ..Default::default()
                });
                let base = serve(fake.clone()).await;
                let t = signed_in(&fake, &base, now() + 10);
                assert!(
                    t.request("GET", "/sync/playback", None).await.is_err(),
                    "{code}"
                );
                assert!(t.status().await.connected, "{code} signed the user out");
            }
        })
    }

    /// A vault whose first write fails.
    struct FailOnce(std::sync::Mutex<bool>, MemoryVault);
    impl Vault for FailOnce {
        fn load(&self) -> Option<Tokens> {
            self.1.load()
        }
        fn save(&self, t: &Tokens) -> Result<(), String> {
            if std::mem::replace(&mut *self.0.lock().unwrap(), false) {
                return Err("CredWriteW failed".into());
            }
            self.1.save(t)
        }
        fn clear(&self) {
            self.1.clear()
        }
    }

    #[test]
    fn a_failed_vault_write_keeps_the_new_tokens() {
        run(async {
            // Refresh tokens are single-use: dropping the new pair because
            // the write failed would leave the spent one, and the next
            // refresh would sign the user out.
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            *fake.live_access.lock().unwrap() = "A0".into();
            *fake.live_refresh.lock().unwrap() = "R0".into();
            let inner = MemoryVault::default();
            inner
                .save(&Tokens {
                    access_token: "A0".into(),
                    refresh_token: "R0".into(),
                    expires_at: now() + 10,
                })
                .unwrap();
            let vault = FailOnce(std::sync::Mutex::new(true), inner);
            let t = Trakt::new(cfg(&base), reqwest::Client::new(), Box::new(vault));
            assert_eq!(t.request("GET", "/a", None).await.unwrap().status, 200);
            // Trakt now holds R1 as the only live refresh token. Expire the
            // access token and refresh again with what the app kept.
            t.tokens.lock().await.as_mut().unwrap().expires_at = now() + 10;
            assert_eq!(t.request("GET", "/b", None).await.unwrap().status, 200);
            assert_eq!(fake.refreshes.load(Ordering::SeqCst), 2);
            assert!(t.status().await.connected);
        })
    }

    #[test]
    fn writes_are_held_a_second_apart() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let t = signed_in(&fake, &base, now() + 86_400);
            let t0 = Instant::now();
            t.request("POST", "/scrobble/start", Some("{}".into()))
                .await
                .unwrap();
            t.request("POST", "/scrobble/stop", Some("{}".into()))
                .await
                .unwrap();
            assert!(
                t0.elapsed() >= Duration::from_millis(950),
                "{:?}",
                t0.elapsed()
            );
            // Reads are not held.
            let t1 = Instant::now();
            t.request("GET", "/a", None).await.unwrap();
            t.request("GET", "/b", None).await.unwrap();
            assert!(
                t1.elapsed() < Duration::from_millis(500),
                "{:?}",
                t1.elapsed()
            );
        })
    }

    #[test]
    fn a_free_accounts_cap_comes_back_as_data() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let t = signed_in(&fake, &base, now() + 86_400);
            let r = t
                .request("POST", "/limit", Some("{}".into()))
                .await
                .unwrap();
            assert_eq!(r.status, 420);
            assert_eq!(r.account_limit, Some(250));
            assert_eq!(r.upgrade_url.as_deref(), Some("https://trakt.tv/vip"));
        })
    }

    #[test]
    fn the_token_only_goes_to_trakt() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let t = signed_in(&fake, &base, now() + 86_400);
            for bad in [
                "https://evil.example/x",
                "sync/history",
                "//evil.example/x",
                "/x\\y",
            ] {
                assert!(t.request("GET", bad, None).await.is_err(), "{bad}");
            }
            assert!(fake.api_seen.lock().unwrap().is_empty());
        })
    }

    #[test]
    fn disconnect_revokes_and_forgets() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let t = signed_in(&fake, &base, now() + 86_400);
            t.disconnect().await;
            assert!(!t.status().await.connected);
            assert_eq!(fake.revoked.lock().unwrap().clone(), vec!["A0".to_string()]);
            // Signed out, a call goes without a token.
            let r = t.request("GET", "/sync/playback", None).await.unwrap();
            assert_eq!(r.status, 401);
        })
    }

    #[test]
    fn a_build_without_keys_is_not_configured() {
        run(async {
            let mut c = cfg("http://127.0.0.1:9");
            c.client_id.clear();
            let t = Trakt::new(c, reqwest::Client::new(), Box::new(MemoryVault::default()));
            assert_eq!(
                t.status().await,
                Status {
                    configured: false,
                    connected: false
                }
            );
            assert!(t.device_start().await.is_err());
        })
    }

    #[cfg(windows)]
    #[test]
    fn the_windows_vault_keeps_and_forgets_a_session() {
        let v = WindowsVault {
            target: format!("BlammyTV/trakt-test-{}", std::process::id()),
        };
        v.clear();
        assert_eq!(v.load(), None);
        let t = Tokens {
            access_token: "a".repeat(64),
            refresh_token: "r".repeat(64),
            expires_at: 42,
        };
        v.save(&t).unwrap();
        assert_eq!(v.load(), Some(t));
        v.clear();
        assert_eq!(v.load(), None);
    }
}

//! AIOStreams' Jellyfin side (plan 023): sign-in by Quick Connect, the
//! session in the OS vault, and every call made from here, so the token never
//! reaches the page or localStorage (decision D5), as Trakt's and MAL's
//! (trakt.rs, mal.rs) never do.
//!
//! No Tauri in this file: lib.rs wraps it in commands, and the host crate
//! (scripts/mvproxy-host) includes it as it is and runs its tests against a
//! fake AIOStreams on Linux, where the app crate itself will not build.
//!
//! What AIOStreams' own source says, and this follows (v2.35.9, read
//! 2026-10-04; paths under packages/):
//! - Every configuration is a Jellyfin-compatible server at `/jellyfin`
//!   (server/src/app.ts:243-246), so the base is the manifest URL's origin
//!   and prefix, with `/jellyfin` where `/stremio/...` was. The token names
//!   the configuration, so no uuid goes in the path.
//! - `GET /System/Info/Public` needs no sign-in and carries an `aiostreams`
//!   object, which a real Jellyfin server has not (routes/jellyfin/system.ts).
//!   An instance on an older release, or with its Jellyfin side off (every
//!   route then answers 404), has none.
//! - Quick Connect: `POST /QuickConnect/Initiate` gives a code and a secret,
//!   good for 10 minutes. The user approves the code on their configure page.
//!   `GET /QuickConnect/Connect?secret=` says when, and `POST
//!   /Users/AuthenticateWithQuickConnect` trades the secret for a token, once
//!   (core/src/jellyfin/auth.ts:137-209, routes/jellyfin/users.ts:485-528).
//! - The identity is the `Authorization: MediaBrowser` header. Its values are
//!   percent-decoded by the server (auth.ts:67-121), so they are encoded here.
//!   The DeviceId is made once per sign-in: without a stable one every
//!   install shares one AIOStreams watch session
//!   (core/src/watch-state/sessions.ts:23-31).
//! - The token never expires (auth.ts:10-45). It dies when the configuration's
//!   password changes, when the user's PIN changes, or when the user is
//!   deleted, and the next call says 401: that signs the app out here.
//! - `POST /Sessions/Logout` answers 204 and does nothing (users.ts:714), so
//!   signing out forgets the token here and does not revoke it there.
//! - THE TRAP: `GET /Items/{id}` on a film or an episode with no `Fields`, or
//!   with `Fields` naming `MediaSources`, runs AIOStreams' whole stream search,
//!   debrid checks included, the same work as pressing play
//!   (routes/jellyfin/items.ts:702-713, library.ts:100-106). So does
//!   `GET /Items?Ids=<one id>&Fields=MediaSources` (library.ts:454). The page
//!   asks by path, and `guard` refuses these whatever the page asks.
//! - Calls are rate limited by kind and answer 429 (routes/jellyfin/index.ts).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Mutex as AsyncMutex;

/// What the app is, for the header. The tests set their own.
#[derive(Clone)]
pub struct Config {
    /// The app's version.
    pub app_version: String,
    /// The computer's name. Empty is "Windows".
    pub device_name: String,
}

/// The session, as kept in the vault: one blob, and a credential holds at
/// most 2,560 bytes (credman.rs), which this stays well under.
#[derive(Clone, Serialize, Deserialize, PartialEq)]
pub struct Session {
    /// `https://host[/prefix]/jellyfin`, never a path past that.
    pub base: String,
    pub token: String,
    pub user_id: String,
    pub user_name: String,
    pub server_id: String,
    /// Made at sign-in and sent on every call.
    pub device_id: String,
}

/// Debug prints everything but the token, so a stray `{:?}` is not a leak.
impl std::fmt::Debug for Session {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Session")
            .field("base", &crate::mvproxy::origin_of(&self.base))
            .field("token", &"(hidden)")
            .field("user_name", &self.user_name)
            .field("device_id", &self.device_id)
            .finish_non_exhaustive()
    }
}

/// Where the session lives between runs.
pub trait Vault: Send + Sync {
    fn load(&self) -> Option<Session>;
    fn save(&self, s: &Session) -> Result<(), String>;
    fn clear(&self);
}

/// For the tests, and for any build that is not Windows.
#[cfg(any(test, not(windows)))]
#[derive(Default)]
pub struct MemoryVault(Mutex<Option<Session>>);

#[cfg(any(test, not(windows)))]
impl Vault for MemoryVault {
    fn load(&self) -> Option<Session> {
        self.0.lock().unwrap().clone()
    }
    fn save(&self, s: &Session) -> Result<(), String> {
        *self.0.lock().unwrap() = Some(s.clone());
        Ok(())
    }
    fn clear(&self) {
        *self.0.lock().unwrap() = None;
    }
}

/// What the page is shown while the user approves the sign-in elsewhere.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    /// The 6 digits to approve.
    pub code: String,
    /// Seconds the code is good for.
    pub expires_in: u64,
    /// Where the code is approved: the user's AIOStreams configure page.
    pub configure_url: String,
}

/// One poll of the sign-in.
#[derive(Serialize, Debug, PartialEq, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum Poll {
    /// Signed in, and the session is kept.
    Approved,
    /// Not approved yet.
    Pending,
    /// The code ran out (AIOStreams no longer knows its secret).
    Expired,
    /// The sign-in cannot finish: nothing was started, AIOStreams refused
    /// the trade, its answer made no sense, or the session could not be
    /// saved. Start again.
    Error,
}

/// Who is signed in, for the Settings row. No token.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub connected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_name: Option<String>,
    /// AIOStreams' id for the user: Jellyfin calls that take a `userId` take
    /// this one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
}

/// An AIOStreams answer, handed to the page as data: a 4xx is not an error
/// here, the page decides what a 404 means for what it asked.
#[derive(Serialize, Debug)]
pub struct Reply {
    pub status: u16,
    pub body: String,
}

/// What `start` fails with when the address is not an AIOStreams with its
/// Jellyfin side on (older than 2.35, or switched off). The page tells this
/// one apart by the `unsupported:` it starts with, and no other failure
/// starts that way.
pub const UNSUPPORTED: &str =
    "unsupported: Your AIOStreams needs version 2.35 or later, with its Jellyfin side on";

/// Seconds a Quick Connect code lives (auth.ts QUICK_CONNECT_TTL).
const QUICK_CONNECT_TTL: u64 = 600;
/// A credential blob holds at most this many bytes (credman.rs).
#[cfg(any(windows, test))]
const BLOB_MAX: usize = 2560;
/// The longest `Retry-After` a 429 is waited out for. Past it the 429 goes
/// back to the page, which can choose to try later.
const MAX_RETRY_WAIT: u64 = 15;
/// How long sign-out waits on AIOStreams. It is best effort.
const LOGOUT_WAIT: Duration = Duration::from_secs(5);

const JSON: &str = "application/json";
const BAD_ANSWER: &str = "AIOStreams sent an answer this app does not understand";
const NOT_A_PATH: &str = "refused: not an AIOStreams path";

/// Where the sign-in and the session are, behind one lock that is never held
/// across a request.
#[derive(Default)]
struct State {
    session: Option<Session>,
    attempt: Option<Attempt>,
    /// Bumped by every start and disconnect, so a poll that was on the wire
    /// when one happened keeps nothing.
    epoch: u64,
}

/// A sign-in under way. The secret and the base stay here, never returned.
#[derive(Clone)]
struct Attempt {
    base: String,
    secret: String,
    device_id: String,
}

pub struct Aiojf {
    cfg: Config,
    http: reqwest::Client,
    vault: Box<dyn Vault>,
    state: Mutex<State>,
    /// One poll at a time, so two cannot both trade the one-use secret.
    polling: AsyncMutex<()>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Initiated {
    code: String,
    secret: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Connected {
    #[serde(default)]
    authenticated: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Authenticated {
    user: AuthUser,
    access_token: String,
    #[serde(default)]
    server_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct AuthUser {
    id: String,
    #[serde(default)]
    name: String,
}

fn random_hex(bytes: usize) -> Result<String, String> {
    let mut raw = vec![0u8; bytes];
    getrandom::fill(&mut raw).map_err(|e| format!("no randomness: {e}"))?;
    Ok(raw.iter().map(|b| format!("{b:02x}")).collect())
}

/// A network failure in words that carry no URL: reqwest's own text names
/// it, and a Quick Connect poll's URL holds the secret.
fn describe(e: reqwest::Error) -> String {
    let e = e.without_url();
    if e.is_timeout() {
        "timed out".into()
    } else if e.is_connect() {
        "could not connect".into()
    } else {
        e.to_string()
    }
}

/// A header value the way AIOStreams reads one: it percent-decodes them
/// (and reads `+` as a space), so a quote, a comma, a percent sign or a plus
/// in a computer's name must not go out raw. Letters, digits, `-_.~` and the
/// space stay as they are.
fn esc(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    for b in v.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b' ' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// What a manifest URL tells: the Jellyfin base and the configure page.
#[derive(Debug, PartialEq)]
struct Derived {
    base: String,
    configure_url: String,
}

/// `https://host[/prefix]/stremio/<uuid>/<password>/manifest.json` gives
/// `https://host[/prefix]/jellyfin` and the same address ending `/configure`.
/// http or https only, as everything handed to mpv is (mpvurl.rs). The last
/// `/stremio/` is the one, so a prefix that holds the word is safe. A user
/// name in the address is refused: the Authorization header is the token's,
/// and AIOStreams' own login is not something this holds.
fn derive(manifest_url: &str) -> Result<Derived, String> {
    let bad = || "not an AIOStreams manifest address".to_string();
    crate::mpvurl::http_only(manifest_url).map_err(|_| bad())?;
    let mut url = reqwest::Url::parse(manifest_url).map_err(|_| bad())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("the AIOStreams address cannot carry a user name or password".into());
    }
    let head = url
        .path()
        .strip_suffix("/manifest.json")
        .ok_or_else(bad)?
        .to_string();
    let at = head.rfind("/stremio/").ok_or_else(bad)?;
    let origin = url.origin().ascii_serialization();
    let base = format!("{origin}{}/jellyfin", &head[..at]);
    url.set_path(&format!("{head}/configure"));
    url.set_fragment(None);
    Ok(Derived {
        base,
        configure_url: url.to_string(),
    })
}

/// Ok when `path` is plain: relative to the base, one slash at a time, and
/// nothing a server or a proxy could read another way (a query or fragment,
/// an escape, a backslash, `..`, a space, anything past ASCII). The query
/// goes in its own argument, so what `guard` reads is what is sent.
fn plain_path(path: &str) -> Result<(), String> {
    let odd = !path.starts_with('/')
        || path.contains("//")
        || path.contains("..")
        || path
            .chars()
            .any(|c| !c.is_ascii_graphic() || matches!(c, '\\' | '?' | '#' | '%'));
    if odd {
        Err(NOT_A_PATH.into())
    } else {
        Ok(())
    }
}

/// Paths that fetch or resolve streams, whatever else is asked of them
/// (lower case, with the slash that opens the segment).
const STREAM_PATHS: [&str; 6] = [
    "playbackinfo",
    "mediasources",
    "/videos",
    "/audio",
    "/download",
    "/file",
];

/// `/Items/<word>` that are not items: AIOStreams sends these on to other
/// routes (library.ts RESERVED_ITEM_IDS).
const NOT_ITEMS: [&str; 8] = [
    "filters",
    "filters2",
    "counts",
    "latest",
    "resume",
    "intros",
    "root",
    "suggestions",
];

/// What `Fields` asks for, as AIOStreams reads it: any key case, repeated,
/// split on commas and bars (context.ts qlist).
fn fields_of(query: &HashMap<String, String>) -> Vec<String> {
    query
        .iter()
        .filter(|(k, _)| k.eq_ignore_ascii_case("fields"))
        .flat_map(|(_, v)| v.split([',', '|']))
        .map(|f| f.trim().to_ascii_lowercase())
        .filter(|f| !f.is_empty())
        .collect()
}

/// Ok when the call cannot make AIOStreams search for streams. `method` is
/// upper case. Refuses, with nothing sent:
/// - a path that is not plain (`plain_path`);
/// - PlaybackInfo, MediaSources, Videos, Audio, Download, File, in any case,
///   and behind the `/emby` and `/mediabrowser` prefixes the server drops;
/// - `Fields` naming MediaSources, on any path;
/// - a single item GET (`/Items/<id>`, `/Users/<uid>/Items/<id>`) with no
///   `Fields`, which AIOStreams answers by resolving streams.
fn guard(method: &str, path: &str, query: &HashMap<String, String>) -> Result<(), String> {
    plain_path(path)?;
    let refused = |why: &str| Err(format!("refused: {why}"));
    let lower = path.to_ascii_lowercase();
    if STREAM_PATHS.iter().any(|p| lower.contains(p)) {
        return refused("that path makes AIOStreams search for streams");
    }
    let fields = fields_of(query);
    if fields.iter().any(|f| f.contains("mediasources")) {
        return refused("Fields names MediaSources, which makes AIOStreams search for streams");
    }
    if method == "GET" {
        let mut segs: Vec<&str> = lower.split('/').filter(|s| !s.is_empty()).collect();
        while matches!(segs.first(), Some(&"emby" | &"mediabrowser")) {
            segs.remove(0);
        }
        let item = match segs.as_slice() {
            ["items", id] | ["users", _, "items", id] => Some(*id),
            _ => None,
        };
        if let Some(id) = item {
            if !NOT_ITEMS.contains(&id) && fields.is_empty() {
                return refused("a single item needs Fields, or AIOStreams searches for streams");
            }
        }
    }
    Ok(())
}

/// Seconds, from a `Retry-After` that gives them (not the date form).
fn retry_after(res: &reqwest::Response) -> Option<u64> {
    res.headers()
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse()
        .ok()
}

#[cfg(any(windows, test))]
fn encode(s: &Session) -> Result<Vec<u8>, String> {
    let blob = serde_json::to_vec(s).map_err(|e| e.to_string())?;
    if blob.len() > BLOB_MAX {
        return Err(format!(
            "the session is {} bytes and Credential Manager keeps {BLOB_MAX}",
            blob.len()
        ));
    }
    Ok(blob)
}

impl Aiojf {
    pub fn new(cfg: Config, http: reqwest::Client, vault: Box<dyn Vault>) -> Arc<Self> {
        let saved = vault.load();
        Arc::new(Self {
            cfg,
            http,
            vault,
            state: Mutex::new(State {
                session: saved,
                ..Default::default()
            }),
            polling: AsyncMutex::new(()),
        })
    }

    /// The identity header, with the token once there is one.
    fn header(&self, device_id: &str, token: Option<&str>) -> String {
        let device = match self.cfg.device_name.trim() {
            "" => "Windows",
            name => name,
        };
        let mut h = format!(
            "MediaBrowser Client=\"BlammyTV\", Device=\"{}\", DeviceId=\"{}\", Version=\"{}\"",
            esc(device),
            esc(device_id),
            esc(&self.cfg.app_version)
        );
        if let Some(t) = token {
            h.push_str(&format!(", Token=\"{}\"", esc(t)));
        }
        h
    }

    pub fn status(&self) -> Status {
        match &self.state.lock().unwrap().session {
            Some(s) => Status {
                connected: true,
                user_name: Some(s.user_name.clone()),
                user_id: Some(s.user_id.clone()),
                base: Some(s.base.clone()),
            },
            None => Status {
                connected: false,
                user_name: None,
                user_id: None,
                base: None,
            },
        }
    }

    /// A call before sign-in: the identity, no token.
    fn anonymous(&self, req: reqwest::RequestBuilder, device_id: &str) -> reqwest::RequestBuilder {
        req.header(reqwest::header::AUTHORIZATION, self.header(device_id, None))
            .header(reqwest::header::ACCEPT, JSON)
    }

    /// Ask the address whether it is an AIOStreams with its Jellyfin side on.
    async fn probe(&self, base: &str, device_id: &str) -> Result<(), String> {
        let res = self
            .anonymous(
                self.http.get(format!("{base}/System/Info/Public")),
                device_id,
            )
            .send()
            .await
            .map_err(describe)?;
        let status = res.status().as_u16();
        let body = res.text().await.map_err(describe)?;
        if status == 404 {
            return Err(UNSUPPORTED.into());
        }
        if status != 200 {
            return Err(format!("HTTP {status}"));
        }
        let info: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
        if info["aiostreams"].is_object() {
            Ok(())
        } else {
            Err(UNSUPPORTED.into())
        }
    }

    /// Start signing in: check the address, ask for a code, and keep its
    /// secret here. The page gets the code and where to approve it.
    pub async fn start(&self, manifest_url: &str) -> Result<Started, String> {
        let d = derive(manifest_url)?;
        let device_id = random_hex(16)?;
        self.probe(&d.base, &device_id).await?;
        let res = self
            .anonymous(
                self.http.post(format!("{}/QuickConnect/Initiate", d.base)),
                &device_id,
            )
            .send()
            .await
            .map_err(describe)?;
        let status = res.status().as_u16();
        let body = res.text().await.map_err(describe)?;
        if status == 429 {
            return Err("AIOStreams is limiting sign-ins, try again in a minute".into());
        }
        if status != 200 {
            return Err(format!("HTTP {status}"));
        }
        let init: Initiated = serde_json::from_str(&body).map_err(|_| BAD_ANSWER.to_string())?;
        if init.code.is_empty() || init.secret.is_empty() {
            return Err(BAD_ANSWER.into());
        }
        let mut st = self.state.lock().unwrap();
        st.epoch += 1;
        st.attempt = Some(Attempt {
            base: d.base,
            secret: init.secret,
            device_id,
        });
        Ok(Started {
            code: init.code,
            expires_in: QUICK_CONNECT_TTL,
            configure_url: d.configure_url,
        })
    }

    /// One poll, as often as the page likes. A network failure is an `Err`
    /// and leaves the sign-in as it was; every `Poll` but `Pending` ends it.
    pub async fn poll(&self) -> Result<Poll, String> {
        let _one = self.polling.lock().await;
        let (epoch, a) = {
            let st = self.state.lock().unwrap();
            match &st.attempt {
                Some(a) => (st.epoch, a.clone()),
                // Nothing under way. A poll that queued behind the one that
                // finished it hears how it ended.
                None => {
                    return Ok(if st.session.is_some() {
                        Poll::Approved
                    } else {
                        Poll::Error
                    })
                }
            }
        };
        let res = self
            .anonymous(
                self.http
                    .get(format!("{}/QuickConnect/Connect", a.base))
                    .query(&[("secret", a.secret.as_str())]),
                &a.device_id,
            )
            .send()
            .await
            .map_err(describe)?;
        let status = res.status().as_u16();
        let body = res.text().await.map_err(describe)?;
        match status {
            200 => {}
            // AIOStreams has forgotten this secret: it ran out.
            404 => return Ok(self.end(epoch, Poll::Expired)),
            429 => return Ok(Poll::Pending),
            s => return Err(format!("HTTP {s}")),
        }
        let connected: Connected =
            serde_json::from_str(&body).map_err(|_| BAD_ANSWER.to_string())?;
        if !connected.authenticated {
            return Ok(Poll::Pending);
        }
        // Disconnected or started again while that was on the wire: leave
        // the secret unspent.
        if self.state.lock().unwrap().epoch != epoch {
            return Ok(Poll::Error);
        }
        let res = self
            .anonymous(
                self.http
                    .post(format!("{}/Users/AuthenticateWithQuickConnect", a.base))
                    .header(reqwest::header::CONTENT_TYPE, JSON)
                    .body(serde_json::json!({ "Secret": a.secret }).to_string()),
                &a.device_id,
            )
            .send()
            .await
            .map_err(describe)?;
        let status = res.status().as_u16();
        let body = res.text().await.map_err(describe)?;
        match status {
            200 => {}
            // The login limiter answered before the secret was touched.
            429 => return Ok(Poll::Pending),
            s => {
                eprintln!("[aiojf] the sign-in was refused: HTTP {s}");
                return Ok(self.end(epoch, Poll::Error));
            }
        }
        let Ok(auth) = serde_json::from_str::<Authenticated>(&body) else {
            eprintln!("[aiojf] the sign-in answer made no sense");
            return Ok(self.end(epoch, Poll::Error));
        };
        if auth.access_token.is_empty() {
            return Ok(self.end(epoch, Poll::Error));
        }
        Ok(self.keep(
            epoch,
            Session {
                base: a.base,
                token: auth.access_token,
                user_id: auth.user.id,
                user_name: auth.user.name,
                server_id: auth.server_id,
                device_id: a.device_id,
            },
        ))
    }

    /// Close the sign-in with `outcome`, if it is still the one under way.
    fn end(&self, epoch: u64, outcome: Poll) -> Poll {
        let mut st = self.state.lock().unwrap();
        if st.epoch == epoch {
            st.attempt = None;
        }
        outcome
    }

    /// Hold the session and write it to the vault, unless the sign-in was
    /// ended meanwhile (a disconnect, or another start). Under the state lock,
    /// so a disconnect is either before (and this keeps nothing) or after
    /// (and clears it). A session that cannot be written is not kept: it
    /// would be gone at the next launch with nothing said.
    fn keep(&self, epoch: u64, session: Session) -> Poll {
        let mut st = self.state.lock().unwrap();
        if st.epoch != epoch {
            return Poll::Error;
        }
        st.attempt = None;
        match self.vault.save(&session) {
            Ok(()) => {
                st.session = Some(session);
                Poll::Approved
            }
            Err(e) => {
                eprintln!("[aiojf] could not save the session: {e}");
                Poll::Error
            }
        }
    }

    /// A call to AIOStreams' Jellyfin API by path (`/UserItems/Resume`), with
    /// the session's token added here. `query` is the query string, so that
    /// what `guard` reads is what goes out. `body` is sent as JSON, and a
    /// `null` is no body. The answer comes back as data, a 4xx included, but
    /// a 401 also ends the session.
    pub async fn request(
        &self,
        method: &str,
        path: &str,
        query: Option<HashMap<String, String>>,
        body: Option<serde_json::Value>,
    ) -> Result<Reply, String> {
        let method = method.to_ascii_uppercase();
        let verb = match method.as_str() {
            "GET" => reqwest::Method::GET,
            "POST" => reqwest::Method::POST,
            "DELETE" => reqwest::Method::DELETE,
            _ => return Err("refused: only GET, POST and DELETE".into()),
        };
        let query = query.unwrap_or_default();
        guard(&method, path, &query)?;
        let body = body.filter(|b| !b.is_null()).map(|b| b.to_string());
        let session = self
            .state
            .lock()
            .unwrap()
            .session
            .clone()
            .ok_or_else(|| "not signed in to AIOStreams".to_string())?;
        let (mut reply, wait) = self
            .send(&session, &verb, path, &query, body.as_deref())
            .await?;
        // Rate limited: wait out what AIOStreams asks, once.
        if reply.status == 429 {
            if let Some(secs) = wait.filter(|s| *s <= MAX_RETRY_WAIT) {
                tokio::time::sleep(Duration::from_secs(secs)).await;
                reply = self
                    .send(&session, &verb, path, &query, body.as_deref())
                    .await?
                    .0;
            }
        }
        if reply.status == 401 {
            self.drop_session(&session.token);
        }
        Ok(reply)
    }

    async fn send(
        &self,
        s: &Session,
        method: &reqwest::Method,
        path: &str,
        query: &HashMap<String, String>,
        body: Option<&str>,
    ) -> Result<(Reply, Option<u64>), String> {
        let mut req = self
            .http
            .request(method.clone(), format!("{}{}", s.base, path))
            .header(
                reqwest::header::AUTHORIZATION,
                self.header(&s.device_id, Some(&s.token)),
            )
            .header(reqwest::header::ACCEPT, JSON);
        if !query.is_empty() {
            req = req.query(query);
        }
        if let Some(b) = body {
            req = req
                .header(reqwest::header::CONTENT_TYPE, JSON)
                .body(b.to_string());
        }
        let res = req.send().await.map_err(describe)?;
        let status = res.status().as_u16();
        let wait = retry_after(&res);
        let body = res.text().await.map_err(describe)?;
        Ok((Reply { status, body }, wait))
    }

    /// AIOStreams refused `used`: the password or PIN changed, or the user
    /// went. Sign out here, unless a newer session has taken its place.
    fn drop_session(&self, used: &str) {
        let mut st = self.state.lock().unwrap();
        if st.session.as_ref().is_some_and(|s| s.token == used) {
            st.session = None;
            self.vault.clear();
        }
    }

    /// Sign out: forget the session here whatever AIOStreams says, and tell
    /// it, best effort.
    pub async fn disconnect(&self) {
        let session = {
            let mut st = self.state.lock().unwrap();
            st.epoch += 1;
            st.attempt = None;
            st.session.take()
        };
        self.vault.clear();
        if let Some(s) = session {
            let _ = self
                .http
                .post(format!("{}/Sessions/Logout", s.base))
                .header(
                    reqwest::header::AUTHORIZATION,
                    self.header(&s.device_id, Some(&s.token)),
                )
                .timeout(LOGOUT_WAIT)
                .send()
                .await;
        }
    }
}

/// The session in Windows Credential Manager, as one generic credential
/// holding the JSON above (credman.rs). Per user, on this machine only.
#[cfg(windows)]
pub struct WindowsVault {
    pub target: String,
}

#[cfg(windows)]
impl Vault for WindowsVault {
    fn load(&self) -> Option<Session> {
        serde_json::from_slice(&crate::credman::read(&self.target)?).ok()
    }

    fn save(&self, s: &Session) -> Result<(), String> {
        crate::credman::write(&self.target, &encode(s)?)
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
    use std::time::Instant;

    /// No tokio `macros` feature in the app's tree: a runtime by hand, as
    /// trakt.rs's tests do.
    fn run<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(f)
    }

    /// What the fake's `/System/Info/Public` says.
    #[derive(Default)]
    enum Probe {
        /// An AIOStreams.
        #[default]
        Aio,
        /// A real Jellyfin: 200, no `aiostreams` object.
        Jellyfin,
        /// Something else on a 200.
        Html,
        /// This status, with an empty JSON body.
        Status(u16),
    }

    /// Holds a request until the test lets it go: no permits to start with.
    struct Gate(tokio::sync::Semaphore);
    impl Default for Gate {
        fn default() -> Self {
            Gate(tokio::sync::Semaphore::new(0))
        }
    }
    impl std::ops::Deref for Gate {
        type Target = tokio::sync::Semaphore;
        fn deref(&self) -> &Self::Target {
            &self.0
        }
    }

    /// One request the fake was sent.
    #[derive(Clone, Debug)]
    struct Seen {
        method: String,
        /// Path and query, as sent.
        uri: String,
        auth: Option<String>,
        body: String,
    }

    /// A fake AIOStreams Jellyfin side: the probe, Quick Connect, Logout, and
    /// a few API routes, recording what it was asked. The one token it
    /// accepts is TOKEN1.
    #[derive(Default)]
    struct Fake {
        probe: Probe,
        /// Connect answers `Authenticated: false` this many times first.
        pending_for: usize,
        /// Connect answers this instead of 200, when set (404: expired).
        connect_status: Option<u16>,
        /// The authenticate trade answers this instead of 200, when set.
        auth_status: Option<u16>,
        /// A request to this path waits for a permit from `gate` first.
        hold: Option<&'static str>,
        gate: Gate,
        connects: AtomicUsize,
        auths: AtomicUsize,
        /// `/limited` answers 429 this many times, then 200.
        limit_for: AtomicUsize,
        /// The `Retry-After` of those 429s, when set.
        retry_after: Option<&'static str>,
        seen: Mutex<Vec<Seen>>,
    }

    impl Fake {
        fn seen(&self) -> Vec<Seen> {
            self.seen.lock().unwrap().clone()
        }
        fn hits(&self, needle: &str) -> usize {
            self.seen()
                .iter()
                .filter(|s| s.uri.contains(needle))
                .count()
        }
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

    fn empty(status: u16) -> Response<Full<Bytes>> {
        Response::builder()
            .status(status)
            .body(Full::new(Bytes::new()))
            .unwrap()
    }

    async fn route(fake: &Fake, req: Request<hyper::body::Incoming>) -> Response<Full<Bytes>> {
        let method = req.method().to_string();
        let uri = req
            .uri()
            .path_and_query()
            .map(|p| p.as_str().to_string())
            .unwrap_or_default();
        let path = req.uri().path().to_string();
        let auth = req
            .headers()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let body = String::from_utf8(req.into_body().collect().await.unwrap().to_bytes().to_vec())
            .unwrap();
        fake.seen.lock().unwrap().push(Seen {
            method: method.clone(),
            uri: uri.clone(),
            auth: auth.clone(),
            body,
        });
        let Some(p) = path.strip_prefix("/jellyfin") else {
            return json(
                404,
                serde_json::json!({ "Message": "Jellyfin API is disabled" }),
            );
        };
        if fake.hold == Some(p) {
            fake.gate.acquire().await.unwrap().forget();
        }
        match (method.as_str(), p) {
            ("GET", "/System/Info/Public") => match fake.probe {
                Probe::Aio => json(
                    200,
                    serde_json::json!({
                        "ServerName": "AIOStreams", "ProductName": "Jellyfin Server",
                        "aiostreams": { "features": { "configSignIn": 1 } },
                    }),
                ),
                Probe::Jellyfin => {
                    json(200, serde_json::json!({ "ProductName": "Jellyfin Server" }))
                }
                Probe::Html => Response::builder()
                    .status(200)
                    .header("content-type", "text/html")
                    .body(Full::new(Bytes::from("<!doctype html>")))
                    .unwrap(),
                Probe::Status(s) => json(s, serde_json::Value::Null),
            },
            ("POST", "/QuickConnect/Initiate") => json(
                200,
                serde_json::json!({
                    "Authenticated": false, "Secret": "SECRET-abc_123", "Code": "123456",
                }),
            ),
            ("GET", "/QuickConnect/Connect") => {
                let n = fake.connects.fetch_add(1, Ordering::SeqCst);
                if let Some(s) = fake.connect_status {
                    return json(s, serde_json::json!({ "Message": "Unknown secret" }));
                }
                json(
                    200,
                    serde_json::json!({
                        "Authenticated": n >= fake.pending_for, "Secret": "SECRET-abc_123",
                        "Code": "123456",
                    }),
                )
            }
            ("POST", "/Users/AuthenticateWithQuickConnect") => {
                fake.auths.fetch_add(1, Ordering::SeqCst);
                if let Some(s) = fake.auth_status {
                    return json(s, serde_json::json!({ "Message": "no" }));
                }
                json(
                    200,
                    serde_json::json!({
                        "User": { "Id": "UID", "Name": "Adam" },
                        "AccessToken": "TOKEN1", "ServerId": "SRV",
                    }),
                )
            }
            ("POST", "/Sessions/Logout") => empty(204),
            _ => {
                if !auth.as_deref().unwrap_or("").contains("Token=\"TOKEN1\"") {
                    return json(401, serde_json::json!({ "Message": "Unauthorized" }));
                }
                match p {
                    "/dead" => json(401, serde_json::json!({ "Message": "Invalid credentials" })),
                    "/limited" => {
                        let left = fake.limit_for.load(Ordering::SeqCst);
                        if left > 0 {
                            fake.limit_for.store(left - 1, Ordering::SeqCst);
                            let mut r = Response::builder().status(429);
                            if let Some(s) = fake.retry_after {
                                r = r.header("retry-after", s);
                            }
                            return r.body(Full::new(Bytes::from("{}"))).unwrap();
                        }
                        json(200, serde_json::json!({ "ok": true }))
                    }
                    _ => json(200, serde_json::json!({ "ok": true })),
                }
            }
        }
    }

    fn cfg() -> Config {
        Config {
            app_version: "9.9.9".into(),
            device_name: "TEST-PC".into(),
        }
    }

    fn manifest(base: &str) -> String {
        format!("{base}/stremio/UUID/ENCPW/manifest.json")
    }

    /// A vault the test can look into after the client has taken it.
    #[derive(Default, Clone)]
    struct Shared(Arc<MemoryVault>);
    impl Vault for Shared {
        fn load(&self) -> Option<Session> {
            self.0.load()
        }
        fn save(&self, s: &Session) -> Result<(), String> {
            self.0.save(s)
        }
        fn clear(&self) {
            self.0.clear()
        }
    }

    fn client(vault: &Shared) -> Arc<Aiojf> {
        Aiojf::new(cfg(), reqwest::Client::new(), Box::new(vault.clone()))
    }

    /// Signed in the real way, through the fake.
    async fn signed_in(fake: &Arc<Fake>) -> (Arc<Aiojf>, Shared, String) {
        let base = serve(fake.clone()).await;
        let vault = Shared::default();
        let a = client(&vault);
        a.start(&manifest(&base)).await.unwrap();
        while a.poll().await.unwrap() == Poll::Pending {}
        assert!(a.status().connected);
        (a, vault, base)
    }

    fn q(pairs: &[(&str, &str)]) -> Option<HashMap<String, String>> {
        Some(
            pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        )
    }

    #[test]
    fn the_sign_in_waits_then_keeps_the_session() {
        run(async {
            let fake = Arc::new(Fake {
                pending_for: 2,
                ..Default::default()
            });
            let base = serve(fake.clone()).await;
            let vault = Shared::default();
            let a = client(&vault);
            assert_eq!(
                a.status(),
                Status {
                    connected: false,
                    user_name: None,
                    user_id: None,
                    base: None
                }
            );
            let started = a.start(&manifest(&base)).await.unwrap();
            assert_eq!(
                started,
                Started {
                    code: "123456".into(),
                    expires_in: 600,
                    configure_url: format!("{base}/stremio/UUID/ENCPW/configure"),
                }
            );
            assert_eq!(a.poll().await.unwrap(), Poll::Pending);
            assert_eq!(a.poll().await.unwrap(), Poll::Pending);
            // Nothing is kept, and nothing was traded, until it is approved.
            assert!(vault.load().is_none());
            assert_eq!(fake.hits("AuthenticateWithQuickConnect"), 0);
            assert_eq!(a.poll().await.unwrap(), Poll::Approved);

            // The blob after approval: everything the later calls need, once.
            let kept = vault.load().expect("the session was written");
            assert_eq!(kept.base, format!("{base}/jellyfin"));
            assert_eq!(kept.token, "TOKEN1");
            assert_eq!(kept.user_id, "UID");
            assert_eq!(kept.user_name, "Adam");
            assert_eq!(kept.server_id, "SRV");
            assert_eq!(kept.device_id.len(), 32);
            assert!(kept.device_id.bytes().all(|b| b.is_ascii_hexdigit()));
            assert_eq!(
                a.status(),
                Status {
                    connected: true,
                    user_name: Some("Adam".into()),
                    user_id: Some("UID".into()),
                    base: Some(format!("{base}/jellyfin")),
                }
            );

            // The probe, the code, three looks and the trade, in that order,
            // all on the one DeviceId and none with a token before the trade.
            let seen = fake.seen();
            let order: Vec<String> = seen
                .iter()
                .map(|s| format!("{} {}", s.method, s.uri))
                .collect();
            let connect = "GET /jellyfin/QuickConnect/Connect?secret=SECRET-abc_123";
            assert_eq!(
                order,
                vec![
                    "GET /jellyfin/System/Info/Public",
                    "POST /jellyfin/QuickConnect/Initiate",
                    connect,
                    connect,
                    connect,
                    "POST /jellyfin/Users/AuthenticateWithQuickConnect",
                ]
            );
            let want = format!(
                "MediaBrowser Client=\"BlammyTV\", Device=\"TEST-PC\", DeviceId=\"{}\", Version=\"9.9.9\"",
                kept.device_id
            );
            for s in &seen {
                assert_eq!(s.auth.as_deref(), Some(want.as_str()), "{}", s.uri);
            }
            assert_eq!(seen[5].body, r#"{"Secret":"SECRET-abc_123"}"#);
            // The code is spent: another poll is not a sign-in.
            assert_eq!(a.poll().await.unwrap(), Poll::Approved);
            assert_eq!(fake.hits("AuthenticateWithQuickConnect"), 1);
        })
    }

    #[test]
    fn an_address_that_is_not_aiostreams_with_its_jellyfin_side_is_named_so() {
        run(async {
            for (name, probe) in [
                ("a 404, the Jellyfin side off", Probe::Status(404)),
                ("a real Jellyfin", Probe::Jellyfin),
                ("a web page", Probe::Html),
            ] {
                let fake = Arc::new(Fake {
                    probe,
                    ..Default::default()
                });
                let base = serve(fake.clone()).await;
                let a = client(&Shared::default());
                let e = a.start(&manifest(&base)).await.unwrap_err();
                assert_eq!(e, UNSUPPORTED, "{name}");
                // The page tells this one by its start.
                assert!(e.starts_with("unsupported: "), "{name}");
                // It stopped at the probe: no code was asked for.
                assert_eq!(fake.hits("Initiate"), 0, "{name}");
                assert_eq!(a.poll().await.unwrap(), Poll::Error, "{name}");
            }
            // Trouble in front of it (a WAF's 403, a 500) is not "too old".
            for code in [403, 500] {
                let fake = Arc::new(Fake {
                    probe: Probe::Status(code),
                    ..Default::default()
                });
                let base = serve(fake.clone()).await;
                let e = client(&Shared::default())
                    .start(&manifest(&base))
                    .await
                    .unwrap_err();
                assert_eq!(e, format!("HTTP {code}"));
                assert!(!e.starts_with("unsupported:"));
            }
            // Nor is an address that is not a manifest, or one that is down.
            let a = client(&Shared::default());
            for bad in [
                "https://h.example/nope",
                "http://127.0.0.1:9/stremio/U/P/manifest.json",
            ] {
                let e = a.start(bad).await.unwrap_err();
                assert!(!e.starts_with("unsupported:"), "{bad}: {e}");
            }
        })
    }

    #[test]
    fn an_expired_code_says_so_and_stops() {
        run(async {
            let fake = Arc::new(Fake {
                connect_status: Some(404),
                ..Default::default()
            });
            let base = serve(fake.clone()).await;
            let vault = Shared::default();
            let a = client(&vault);
            a.start(&manifest(&base)).await.unwrap();
            assert_eq!(a.poll().await.unwrap(), Poll::Expired);
            // Over: another poll has nothing to ask about.
            assert_eq!(a.poll().await.unwrap(), Poll::Error);
            assert_eq!(fake.hits("/QuickConnect/Connect?"), 1);
            assert!(!a.status().connected);
            assert!(vault.load().is_none());
        })
    }

    #[test]
    fn a_refused_trade_is_an_error_and_keeps_nothing() {
        run(async {
            for code in [401, 500] {
                let fake = Arc::new(Fake {
                    auth_status: Some(code),
                    ..Default::default()
                });
                let base = serve(fake.clone()).await;
                let vault = Shared::default();
                let a = client(&vault);
                a.start(&manifest(&base)).await.unwrap();
                assert_eq!(a.poll().await.unwrap(), Poll::Error, "{code}");
                assert_eq!(a.poll().await.unwrap(), Poll::Error, "{code}");
                assert_eq!(fake.hits("AuthenticateWithQuickConnect"), 1, "{code}");
                assert!(!a.status().connected, "{code}");
                assert!(vault.load().is_none(), "{code}");
            }
        })
    }

    #[test]
    fn a_rate_limited_trade_waits_and_goes_on() {
        run(async {
            let fake = Arc::new(Fake {
                auth_status: Some(429),
                ..Default::default()
            });
            let base = serve(fake.clone()).await;
            let a = client(&Shared::default());
            a.start(&manifest(&base)).await.unwrap();
            assert_eq!(a.poll().await.unwrap(), Poll::Pending);
            assert_eq!(a.poll().await.unwrap(), Poll::Pending);
            assert!(!a.status().connected);
        })
    }

    /// A vault whose writes fail.
    struct FailingVault;
    impl Vault for FailingVault {
        fn load(&self) -> Option<Session> {
            None
        }
        fn save(&self, _: &Session) -> Result<(), String> {
            Err("CredWriteW failed".into())
        }
        fn clear(&self) {}
    }

    #[test]
    fn a_session_that_cannot_be_written_is_not_called_signed_in() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let a = Aiojf::new(cfg(), reqwest::Client::new(), Box::new(FailingVault));
            a.start(&manifest(&base)).await.unwrap();
            assert_eq!(a.poll().await.unwrap(), Poll::Error);
            assert!(!a.status().connected);
        })
    }

    #[test]
    fn a_signed_in_call_carries_the_token_and_the_same_device_id() {
        run(async {
            let fake = Arc::new(Fake::default());
            let (a, vault, _) = signed_in(&fake).await;
            let device = vault.load().unwrap().device_id;
            let r = a
                .request(
                    "GET",
                    "/Items/a1110100000001b239ffffffff000000",
                    q(&[("Fields", "ProviderIds")]),
                    None,
                )
                .await
                .unwrap();
            assert_eq!(r.status, 200);
            assert_eq!(r.body, r#"{"ok":true}"#);
            let r = a
                .request(
                    "post",
                    "/Sessions/Playing",
                    None,
                    Some(serde_json::json!({ "ItemId": "x", "PositionTicks": 0 })),
                )
                .await
                .unwrap();
            assert_eq!(r.status, 200);

            let seen = fake.seen();
            let (get, post) = (&seen[seen.len() - 2], &seen[seen.len() - 1]);
            let want = format!(
                "MediaBrowser Client=\"BlammyTV\", Device=\"TEST-PC\", DeviceId=\"{device}\", Version=\"9.9.9\", Token=\"TOKEN1\""
            );
            assert_eq!(get.auth.as_deref(), Some(want.as_str()));
            assert_eq!(post.auth.as_deref(), Some(want.as_str()));
            assert_eq!(
                get.uri,
                "/jellyfin/Items/a1110100000001b239ffffffff000000?Fields=ProviderIds"
            );
            assert_eq!(
                (post.method.as_str(), post.uri.as_str()),
                ("POST", "/jellyfin/Sessions/Playing")
            );
            assert_eq!(post.body, r#"{"ItemId":"x","PositionTicks":0}"#);
            // And the sign-in's own calls used that DeviceId too.
            let sign_in_device = format!("DeviceId=\"{device}\"");
            assert!(seen
                .iter()
                .all(|s| s.auth.as_deref().unwrap().contains(&sign_in_device)));
        })
    }

    #[test]
    fn a_call_with_no_session_goes_nowhere() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let a = client(&Shared::default());
            let _ = base;
            let e = a
                .request("GET", "/UserItems/Resume", None, None)
                .await
                .unwrap_err();
            // Not a guard refusal: the page reads this one as "disconnected".
            assert!(!e.starts_with("refused:"), "{e}");
            assert!(fake.seen().is_empty());
        })
    }

    #[test]
    fn a_401_signs_out_and_clears_the_vault() {
        run(async {
            let fake = Arc::new(Fake::default());
            let (a, vault, _) = signed_in(&fake).await;
            let r = a.request("GET", "/dead", None, None).await.unwrap();
            // The answer still comes back as data.
            assert_eq!(r.status, 401);
            assert!(!a.status().connected);
            assert!(vault.load().is_none());
            // Signed out: nothing more is sent.
            let before = fake.seen().len();
            assert!(a
                .request("GET", "/UserItems/Resume", None, None)
                .await
                .is_err());
            assert_eq!(fake.seen().len(), before);
        })
    }

    #[test]
    fn a_401_for_an_old_token_leaves_the_new_session_alone() {
        run(async {
            let fake = Arc::new(Fake::default());
            let (a, vault, _) = signed_in(&fake).await;
            // A request in flight under an earlier sign-in got its 401 after
            // the user signed in again.
            a.drop_session("OLD-TOKEN");
            assert!(a.status().connected);
            assert!(vault.load().is_some());
            a.drop_session("TOKEN1");
            assert!(!a.status().connected);
            assert!(vault.load().is_none());
        })
    }

    #[test]
    fn a_429_is_waited_out_once() {
        run(async {
            // One 429 with a Retry-After: wait it, retry, get the answer.
            let fake = Arc::new(Fake {
                retry_after: Some("1"),
                ..Default::default()
            });
            fake.limit_for.store(1, Ordering::SeqCst);
            let (a, _, _) = signed_in(&fake).await;
            let t0 = Instant::now();
            let r = a.request("GET", "/limited", None, None).await.unwrap();
            assert_eq!(r.status, 200);
            assert!(
                t0.elapsed() >= Duration::from_millis(950),
                "{:?}",
                t0.elapsed()
            );
            assert_eq!(fake.hits("/limited"), 2);

            // Always limited: one retry and no more, and the 429 goes back.
            fake.limit_for.store(99, Ordering::SeqCst);
            let r = a.request("GET", "/limited", None, None).await.unwrap();
            assert_eq!(r.status, 429);
            assert_eq!(fake.hits("/limited"), 4);
            assert!(a.status().connected);
        })
    }

    #[test]
    fn a_429_with_nothing_to_wait_for_is_not_retried() {
        run(async {
            // No Retry-After.
            let fake = Arc::new(Fake::default());
            fake.limit_for.store(99, Ordering::SeqCst);
            let (a, _, _) = signed_in(&fake).await;
            let r = a.request("GET", "/limited", None, None).await.unwrap();
            assert_eq!(r.status, 429);
            assert_eq!(fake.hits("/limited"), 1);

            // A Retry-After past what is worth waiting for.
            let fake = Arc::new(Fake {
                retry_after: Some("3600"),
                ..Default::default()
            });
            fake.limit_for.store(99, Ordering::SeqCst);
            let (a, _, _) = signed_in(&fake).await;
            let t0 = Instant::now();
            let r = a.request("GET", "/limited", None, None).await.unwrap();
            assert_eq!(r.status, 429);
            assert_eq!(fake.hits("/limited"), 1);
            assert!(t0.elapsed() < Duration::from_secs(5));
        })
    }

    #[test]
    fn disconnect_logs_out_and_forgets() {
        run(async {
            let fake = Arc::new(Fake::default());
            let (a, vault, _) = signed_in(&fake).await;
            let device = vault.load().unwrap().device_id;
            a.disconnect().await;
            assert!(!a.status().connected);
            assert!(vault.load().is_none());
            let last = fake.seen().pop().unwrap();
            assert_eq!(
                (last.method.as_str(), last.uri.as_str()),
                ("POST", "/jellyfin/Sessions/Logout")
            );
            // It said who was leaving: the token and the device.
            let auth = last.auth.unwrap();
            assert!(auth.contains("Token=\"TOKEN1\"") && auth.contains(&device));
            // Signed out, a call is not sent.
            assert!(a
                .request("GET", "/UserItems/Resume", None, None)
                .await
                .is_err());
        })
    }

    #[test]
    fn disconnect_forgets_even_when_aiostreams_is_gone() {
        run(async {
            let vault = Shared::default();
            vault
                .save(&Session {
                    base: "http://127.0.0.1:9/jellyfin".into(),
                    token: "TOKEN1".into(),
                    user_id: "UID".into(),
                    user_name: "Adam".into(),
                    server_id: "SRV".into(),
                    device_id: "d".repeat(32),
                })
                .unwrap();
            let a = client(&vault);
            assert!(a.status().connected);
            a.disconnect().await;
            assert!(!a.status().connected);
            assert!(vault.load().is_none());
        })
    }

    #[test]
    fn a_disconnect_while_a_poll_looks_leaves_the_secret_unspent() {
        run(async {
            let fake = Arc::new(Fake {
                hold: Some("/QuickConnect/Connect"),
                ..Default::default()
            });
            let base = serve(fake.clone()).await;
            let vault = Shared::default();
            let a = client(&vault);
            a.start(&manifest(&base)).await.unwrap();
            let poll = tokio::spawn({
                let a = a.clone();
                async move { a.poll().await }
            });
            while fake.hits("/QuickConnect/Connect?") == 0 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            a.disconnect().await;
            fake.gate.add_permits(1);
            assert_eq!(poll.await.unwrap().unwrap(), Poll::Error);
            assert_eq!(fake.hits("AuthenticateWithQuickConnect"), 0);
            assert!(!a.status().connected);
            assert!(vault.load().is_none());
        })
    }

    #[test]
    fn a_disconnect_while_the_trade_is_on_the_wire_keeps_nothing() {
        run(async {
            let fake = Arc::new(Fake {
                hold: Some("/Users/AuthenticateWithQuickConnect"),
                ..Default::default()
            });
            let base = serve(fake.clone()).await;
            let vault = Shared::default();
            let a = client(&vault);
            a.start(&manifest(&base)).await.unwrap();
            let poll = tokio::spawn({
                let a = a.clone();
                async move { a.poll().await }
            });
            while fake.hits("AuthenticateWithQuickConnect") == 0 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            a.disconnect().await;
            fake.gate.add_permits(1);
            assert_eq!(poll.await.unwrap().unwrap(), Poll::Error);
            assert!(!a.status().connected);
            assert!(vault.load().is_none());
        })
    }

    #[test]
    fn starting_again_replaces_the_code() {
        run(async {
            let fake = Arc::new(Fake {
                pending_for: 99,
                ..Default::default()
            });
            let base = serve(fake.clone()).await;
            let a = client(&Shared::default());
            a.start(&manifest(&base)).await.unwrap();
            let first = a.state.lock().unwrap().attempt.clone().unwrap();
            a.start(&manifest(&base)).await.unwrap();
            let second = a.state.lock().unwrap().attempt.clone().unwrap();
            // Each sign-in has its own DeviceId.
            assert_ne!(first.device_id, second.device_id);
            assert_eq!(a.poll().await.unwrap(), Poll::Pending);
        })
    }

    /// A call the guard must refuse: method, path, query.
    type Case = (
        &'static str,
        String,
        Option<Vec<(&'static str, &'static str)>>,
    );

    /// Every one of these must be refused before anything is sent.
    #[test]
    fn the_traps_are_refused_and_nothing_is_sent() {
        run(async {
            let fake = Arc::new(Fake::default());
            let (a, _, _) = signed_in(&fake).await;
            let sent = fake.seen().len();
            let id = "a1110100000001b239ffffffff000000";
            let cases: Vec<Case> = vec![
                // A single item with no Fields, however it is spelled.
                ("GET", format!("/Items/{id}"), None),
                ("GET", format!("/items/{id}"), None),
                ("GET", format!("/ITEMS/{id}/"), None),
                ("GET", format!("/Users/UID/Items/{id}"), None),
                ("GET", format!("/emby/Items/{id}"), None),
                ("GET", format!("/MediaBrowser/Users/UID/Items/{id}"), None),
                ("GET", format!("/Items/{id}"), Some(vec![("Fields", "")])),
                (
                    "GET",
                    format!("/Items/{id}"),
                    Some(vec![("Fields", " , |")]),
                ),
                ("GET", format!("/Items/{id}"), Some(vec![("Other", "x")])),
                // Fields naming MediaSources, anywhere, any case, any list.
                (
                    "GET",
                    format!("/Items/{id}"),
                    Some(vec![("Fields", "MediaSources")]),
                ),
                (
                    "GET",
                    format!("/Items/{id}"),
                    Some(vec![("fields", "mediasources")]),
                ),
                (
                    "GET",
                    format!("/Items/{id}"),
                    Some(vec![("Fields", "ProviderIds,MediaSources")]),
                ),
                (
                    "GET",
                    format!("/Items/{id}"),
                    Some(vec![("FIELDS", "ProviderIds|MEDIASOURCES")]),
                ),
                (
                    "GET",
                    "/Items".into(),
                    Some(vec![("Ids", id), ("Fields", "MediaSources")]),
                ),
                (
                    "GET",
                    "/UserItems/Resume".into(),
                    Some(vec![("Fields", "MediaSources")]),
                ),
                // Paths that resolve or stream.
                ("POST", format!("/Items/{id}/PlaybackInfo"), None),
                (
                    "GET",
                    format!("/items/{id}/playbackinfo"),
                    Some(vec![("Fields", "x")]),
                ),
                ("GET", format!("/Items/{id}/MediaSources"), None),
                ("GET", format!("/Videos/{id}/stream"), None),
                ("GET", format!("/videos/{id}/main.m3u8"), None),
                ("GET", format!("/Audio/{id}/universal"), None),
                ("GET", format!("/Items/{id}/Download"), None),
                ("GET", format!("/Items/{id}/File"), None),
                (
                    "POST",
                    format!("/Items/{id}/PlaybackInfo"),
                    Some(vec![("x", "y")]),
                ),
                ("DELETE", format!("/Videos/{id}/x"), None),
                // Not a path relative to the base.
                ("GET", format!("Items/{id}"), Some(vec![("Fields", "x")])),
                ("GET", "".into(), None),
                ("GET", "https://evil.example/x".into(), None),
                ("GET", "//evil.example/x".into(), None),
                ("GET", "/a//b".into(), None),
                ("GET", "/a/../b".into(), None),
                ("GET", "/a/./..".into(), None),
                ("GET", "/a\\b".into(), None),
                ("GET", "/a?Fields=x".into(), None),
                ("GET", "/a#b".into(), None),
                ("GET", "/a%2e%2e/b".into(), None),
                ("GET", "/%49tems/x".into(), None),
                ("GET", "/a b".into(), None),
                ("GET", "/a\nb".into(), None),
                ("GET", "/caf\u{e9}".into(), None),
                // Methods this does not make.
                ("PUT", "/UserItems/Resume".into(), None),
                ("HEAD", "/UserItems/Resume".into(), None),
                ("CONNECT", "/UserItems/Resume".into(), None),
            ];
            for (method, path, query) in &cases {
                let query = query.as_ref().map(|p| q(p).unwrap());
                let r = a.request(method, path, query.clone(), None).await;
                let e = r.expect_err(&format!("sent {method} {path:?} {query:?}"));
                assert!(e.starts_with("refused:"), "{method} {path:?}: {e}");
            }
            assert_eq!(fake.seen().len(), sent, "something reached AIOStreams");
            // A refusal is a plain error: still signed in.
            assert!(a.status().connected);
        })
    }

    /// The other half: refusing everything would pass the test above.
    #[test]
    fn what_the_app_needs_is_not_refused() {
        let ok = |m: &str, p: &str, query: &[(&str, &str)]| {
            let query = q(query).unwrap();
            assert_eq!(guard(m, p, &query), Ok(()), "{m} {p} {query:?}");
        };
        let id = "a1110100000001b239ffffffff000000";
        ok("GET", &format!("/Items/{id}"), &[("Fields", "ProviderIds")]);
        ok(
            "GET",
            &format!("/Users/UID/Items/{id}"),
            &[("Fields", "ProviderIds,Overview")],
        );
        ok(
            "GET",
            "/Items",
            &[("Recursive", "true"), ("IsPlayed", "true")],
        );
        ok("GET", "/Items", &[("Ids", id)]);
        ok("GET", "/Items", &[("Ids", id), ("Fields", "ProviderIds")]);
        ok("GET", "/UserItems/Resume", &[]);
        ok("GET", "/Users/UID/Items/Resume", &[]);
        ok("GET", "/Shows/NextUp", &[("Limit", "20")]);
        ok("GET", "/Shows/Upcoming", &[]);
        ok("GET", "/Items/Latest", &[]);
        ok("GET", "/Items/Filters", &[]);
        ok("GET", &format!("/MediaSegments/{id}"), &[]);
        ok("GET", &format!("/Items/{id}/Ancestors"), &[]);
        ok("POST", "/Sessions/Playing", &[]);
        ok("POST", "/Sessions/Playing/Progress", &[]);
        ok("POST", "/Sessions/Playing/Stopped", &[]);
        ok("POST", &format!("/UserPlayedItems/{id}"), &[]);
        ok("DELETE", &format!("/UserPlayedItems/{id}"), &[]);
        // A POST to an item is not the GET that resolves streams.
        ok("POST", &format!("/Items/{id}"), &[]);
    }

    #[test]
    fn the_header_escapes_what_would_break_it() {
        let a = Aiojf::new(
            Config {
                app_version: "1.2.3".into(),
                device_name: "My \"PC\", 100%+\u{e9}\r\nX: y".into(),
            },
            reqwest::Client::new(),
            Box::new(MemoryVault::default()),
        );
        let h = a.header("abc", Some("tok-en_1"));
        assert_eq!(
            h,
            "MediaBrowser Client=\"BlammyTV\", Device=\"My %22PC%22%2C 100%25%2B%C3%A9%0D%0AX%3A y\", \
             DeviceId=\"abc\", Version=\"1.2.3\", Token=\"tok-en_1\""
        );
        // Four quoted values and a token: ten quotes, none from the name.
        assert_eq!(h.matches('"').count(), 10);
        assert!(reqwest::header::HeaderValue::from_str(&h).is_ok());
        // A token with anything odd in it cannot slip out of its quotes.
        assert!(a
            .header("d", Some("a\"b,c"))
            .ends_with("Token=\"a%22b%2Cc\""));
        // No name is "Windows", and no token is no Token.
        let b = Aiojf::new(
            Config {
                app_version: "1".into(),
                device_name: "  ".into(),
            },
            reqwest::Client::new(),
            Box::new(MemoryVault::default()),
        );
        let h = b.header("d", None);
        assert!(h.contains("Device=\"Windows\"") && !h.contains("Token"));
    }

    #[test]
    fn the_base_and_the_configure_page_come_from_the_manifest_url() {
        let d = |u: &str| derive(u).unwrap();
        assert_eq!(
            d("https://aio.example.com/stremio/UUID/PW/manifest.json"),
            Derived {
                base: "https://aio.example.com/jellyfin".into(),
                configure_url: "https://aio.example.com/stremio/UUID/PW/configure".into(),
            }
        );
        // A port, http, a prefix behind a proxy.
        assert_eq!(
            d("http://192.168.1.5:3000/stremio/U/P/manifest.json"),
            Derived {
                base: "http://192.168.1.5:3000/jellyfin".into(),
                configure_url: "http://192.168.1.5:3000/stremio/U/P/configure".into(),
            }
        );
        assert_eq!(
            d("https://h.example/aio/stremio/U/P/manifest.json").base,
            "https://h.example/aio/jellyfin"
        );
        // The last /stremio/ is the one.
        assert_eq!(
            d("https://h.example/stremio/stremio/U/P/manifest.json").base,
            "https://h.example/stremio/jellyfin"
        );
        // A variant or alias after the password is still before manifest.json.
        assert_eq!(
            d("https://h.example/stremio/U/P/v/two/manifest.json").base,
            "https://h.example/jellyfin"
        );
        // The query rides along to the configure page; a fragment does not.
        assert_eq!(
            d("https://h.example/stremio/U/P/manifest.json?x=1#top").configure_url,
            "https://h.example/stremio/U/P/configure?x=1"
        );
        for bad in [
            "",
            "not a url",
            "ftp://h.example/stremio/U/P/manifest.json",
            "file:///stremio/U/P/manifest.json",
            "javascript:alert(1)",
            " https://h.example/stremio/U/P/manifest.json",
            // Not a configured manifest.
            "https://h.example/stremio/manifest.json",
            "https://h.example/manifest.json",
            "https://h.example/stremio/U/P/",
            "https://h.example/stremio/U/P/manifest.jsonx",
            "https://h.example/u/P/manifest.json",
            // A login in the address.
            "https://user:pass@h.example/stremio/U/P/manifest.json",
            "https://user@h.example/stremio/U/P/manifest.json",
        ] {
            let e = derive(bad).unwrap_err();
            assert!(!e.contains("pass") || e.contains("password"), "{e}");
            assert!(derive(bad).is_err(), "took {bad:?}");
        }
    }

    #[test]
    fn what_goes_back_to_the_page_never_holds_the_token_or_the_secret() {
        run(async {
            // Two ways for a host to be unreachable: nothing listening, and
            // a listener that hangs up. reqwest words the second with the
            // URL in it, which for a poll is the secret.
            let hangs_up = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = hangs_up.local_addr().unwrap().port();
            tokio::spawn(async move {
                loop {
                    let _ = hangs_up.accept().await;
                }
            });
            for host in ["127.0.0.1:9".to_string(), format!("127.0.0.1:{port}")] {
                let clean = |e: &str, what: &str| {
                    assert!(
                        !e.contains("THE-SECRET-VALUE")
                            && !e.contains("THE-TOKEN-VALUE")
                            && !e.contains("127.0.0.1")
                            && !e.contains("jellyfin"),
                        "{host} {what}: {e}"
                    );
                };

                // A poll: the query is the secret.
                let vault = Shared::default();
                let a = client(&vault);
                a.state.lock().unwrap().attempt = Some(Attempt {
                    base: format!("http://{host}/jellyfin"),
                    secret: "THE-SECRET-VALUE".into(),
                    device_id: "d".repeat(32),
                });
                clean(&a.poll().await.unwrap_err(), "poll");

                // A call with the token.
                vault
                    .save(&Session {
                        base: format!("http://{host}/jellyfin"),
                        token: "THE-TOKEN-VALUE".into(),
                        user_id: "UID".into(),
                        user_name: "Adam".into(),
                        server_id: "SRV".into(),
                        device_id: "d".repeat(32),
                    })
                    .unwrap();
                let b = client(&vault);
                let e = b
                    .request("GET", "/UserItems/Resume", None, None)
                    .await
                    .unwrap_err();
                clean(&e, "request");
                // Start, whose address is the user's manifest URL.
                let e = b
                    .start(&format!("http://{host}/stremio/U/P/manifest.json"))
                    .await
                    .unwrap_err();
                clean(&e, "start");
                assert!(!e.contains("stremio"), "{host} start: {e}");

                // The status and a stray {:?} hold no token either.
                let s = serde_json::to_string(&b.status()).unwrap();
                assert!(!s.contains("THE-TOKEN-VALUE"), "{s}");
                let shown = format!("{:?}", vault.load().unwrap());
                assert!(!shown.contains("THE-TOKEN-VALUE"), "{shown}");
            }
        })
    }

    #[test]
    fn the_page_gets_camel_case_and_only_what_it_needs() {
        let on = Status {
            connected: true,
            user_name: Some("Adam".into()),
            user_id: Some("UID".into()),
            base: Some("https://h.example/jellyfin".into()),
        };
        assert_eq!(
            serde_json::to_string(&on).unwrap(),
            r#"{"connected":true,"userName":"Adam","userId":"UID","base":"https://h.example/jellyfin"}"#
        );
        let off = Status {
            connected: false,
            user_name: None,
            user_id: None,
            base: None,
        };
        assert_eq!(
            serde_json::to_string(&off).unwrap(),
            r#"{"connected":false}"#
        );
        let started = Started {
            code: "123456".into(),
            expires_in: 600,
            configure_url: "https://h.example/stremio/U/P/configure".into(),
        };
        assert_eq!(
            serde_json::to_string(&started).unwrap(),
            r#"{"code":"123456","expiresIn":600,"configureUrl":"https://h.example/stremio/U/P/configure"}"#
        );
        for (p, word) in [
            (Poll::Approved, "approved"),
            (Poll::Pending, "pending"),
            (Poll::Expired, "expired"),
            (Poll::Error, "error"),
        ] {
            assert_eq!(serde_json::to_string(&p).unwrap(), format!("\"{word}\""));
        }
        let reply = Reply {
            status: 204,
            body: String::new(),
        };
        assert_eq!(
            serde_json::to_string(&reply).unwrap(),
            r#"{"status":204,"body":""}"#
        );
    }

    #[test]
    fn the_session_fits_in_credential_manager() {
        let s = |token: usize| Session {
            base: format!("https://{}.example.com/prefix/jellyfin", "h".repeat(60)),
            token: "t".repeat(token),
            user_id: "f".repeat(32),
            user_name: "n".repeat(60),
            server_id: "s".repeat(32),
            device_id: "d".repeat(32),
        };
        // AIOStreams' tokens run to a few hundred characters.
        assert!(encode(&s(1500)).unwrap().len() < BLOB_MAX);
        // A blob past the limit says so, rather than failing inside Windows.
        assert!(encode(&s(3000)).is_err());
        // And what is written reads back.
        let one = s(500);
        let back: Session = serde_json::from_slice(&encode(&one).unwrap()).unwrap();
        assert_eq!(back, one);
    }

    #[cfg(windows)]
    #[test]
    fn the_windows_vault_keeps_and_forgets_a_session() {
        let v = WindowsVault {
            target: format!("BlammyTV/aiostreams-test-{}", std::process::id()),
        };
        v.clear();
        assert_eq!(v.load(), None);
        let s = Session {
            base: "https://h.example/jellyfin".into(),
            token: "t".repeat(600),
            user_id: "u".into(),
            user_name: "Adam".into(),
            server_id: "s".into(),
            device_id: "d".repeat(32),
        };
        v.save(&s).unwrap();
        assert_eq!(v.load(), Some(s));
        v.clear();
        assert_eq!(v.load(), None);
    }
}

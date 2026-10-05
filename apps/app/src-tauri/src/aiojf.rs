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
//!   (server/src/app.ts:243-246), so the base is the address's origin and
//!   prefix, with `/jellyfin` after it. The address is a manifest URL, a
//!   configure URL, anything with `/stremio/` in it, one ending `/jellyfin`,
//!   or the bare host (plan 024). `derive` says how each is read. The token
//!   names the configuration, so no uuid goes in the path.
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
//!   asks by path, and `guard` is an allow list: it sends the calls the app
//!   makes and refuses every other path, so a route AIOStreams adds later, or
//!   one that does more than it looks (`POST /AIOStreams/Token` mints a token
//!   that never expires, `POST /QuickConnect/Authorize` approves another
//!   device's code), is refused until it is added here.
//! - THE TOKEN IN A REPLY: a detail read is answered with full `MediaSources`
//!   when AIOStreams holds a fresh search for the title (items.ts:838-869),
//!   and each external subtitle's `DeliveryUrl` carries `ApiKey=<the request's
//!   own token>` (media.ts `buildMediaStreams`). So every reply body that
//!   leaves `call` has the token taken out, as it is and as
//!   `encodeURIComponent` writes it (`scrub`).
//! - Calls are rate limited by kind and answer 429 (routes/jellyfin/index.ts).
//! - THE STREAM SEARCH, ON PURPOSE (plan 024): `POST /Items/{id}/PlaybackInfo`
//!   is the one call that runs it, and `sources` is the one way to make it.
//!   The body says how old a kept list may be: `Fresh` takes one up to the
//!   reuse window (180 s), `Refresh` searches again
//!   (routes/jellyfin/playback.ts `listingOptions`). The search waits on the
//!   addons up to MAX_TIMEOUT (50 s by default), so it has its own timeout.
//!   The answer holds each source's subtitle `DeliveryUrl` with `ApiKey=<the
//!   token>` in it (core/src/jellyfin/media.ts `buildMediaStreams`), so what
//!   goes back to the page is a whitelist of fields, never the answer.

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
/// here, the page decides what a 404 means for what it asked. The session's
/// token is taken out of the body (`scrub`).
#[derive(Serialize, Debug)]
pub struct Reply {
    pub status: u16,
    pub body: String,
}

/// What a stream search found, trimmed to the fields the page reads: AIOStreams'
/// own answer carries the token, and this does not. `sources` hold their keys
/// as AIOStreams spells them (`Id`, `Path`, `aiostreams`), so the page reads
/// them as it reads any Jellyfin item. A 4xx is data here too: `status` says
/// it, with no sources, and `errorCode` is the answer's own `ErrorCode`
/// (`NoCompatibleStream`, `NotAllowed`) when it gave one.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sources {
    pub status: u16,
    pub sources: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
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
/// How long a stream search is waited for. AIOStreams gives its addons up to
/// 50 s (MAX_TIMEOUT, core/src/config/schema/user-limits.ts), which is more
/// than the 30 s the shared client allows a call.
const SOURCES_WAIT: Duration = Duration::from_secs(60);
/// The keys a source keeps on its way to the page. `MediaStreams` is not here:
/// its subtitle `DeliveryUrl`s hold the token. The `aiostreams` object is
/// kept whole, and none of its fields is the token (core/src/jellyfin/media.ts
/// `extensionFor`: the formatter's text, the addon, the service, the file).
const SOURCE_KEEPS: [&str; 9] = [
    "Id",
    "Path",
    "Name",
    "Type",
    "Size",
    "Container",
    "RunTimeTicks",
    "IsInfiniteStream",
    "aiostreams",
];

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
    /// How long `sources` waits. A field only so a test can shorten it.
    sources_wait: Duration,
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

/// What an address tells: the Jellyfin base and the configure page.
#[derive(Debug, PartialEq)]
struct Derived {
    base: String,
    configure_url: String,
}

/// `address` with a scheme: a bare `host[:port][/prefix]` gets `https://`.
/// A colon belongs to a scheme unless a port follows it, so `localhost:3000`
/// is a host, while `ftp://h` and `javascript:x` are left as they are for
/// the http check to refuse.
fn with_scheme(address: &str) -> String {
    let head = address.find(['/', '?', '#']).unwrap_or(address.len());
    let has_scheme = !address.starts_with('[')
        && address[..head].find(':').is_some_and(|i| {
            let after = &address[i + 1..head];
            after.is_empty() || !after.bytes().all(|b| b.is_ascii_digit())
        });
    if has_scheme {
        address.to_string()
    } else {
        format!("https://{address}")
    }
}

/// Where an AIOStreams is and where its sign-in is approved, from an address
/// the user typed or pasted (plan 024). Trimmed, and any of:
/// - a manifest URL, `https://host[/prefix]/stremio/<uuid>/<password>/manifest.json`;
/// - a configure URL, `.../stremio/<uuid>/<password>/configure` or
///   `.../stremio/configure`;
/// - anything with `/stremio/` in its path: the address is what is before the
///   last one, so a prefix that holds the word is safe;
/// - one ending `/jellyfin`, or `/jellyfin/...`: what is before the last one;
/// - the bare `https://host[/prefix]`, closing slash or not.
///
/// The base is `{origin}{prefix}/jellyfin`. The configure page is the
/// address's own `.../stremio/<uuid>/<password>/configure` when the address
/// carries that uuid and password (a manifest URL's, as it always was, query
/// and all), and else `{origin}{prefix}/stremio/configure`, the plain mount's
/// own answer. A fragment is always dropped, and a query never reaches the
/// base. With no scheme, https is assumed; any scheme but http and https is
/// refused, as everything handed to mpv is (mpvurl.rs). A user name in the
/// address is refused: the Authorization header is the token's, and
/// AIOStreams' own login is not something this holds.
fn derive(address: &str) -> Result<Derived, String> {
    let bad = || "not an AIOStreams address".to_string();
    let address = with_scheme(address.trim());
    crate::mpvurl::http_only(&address).map_err(|_| bad())?;
    let url = reqwest::Url::parse(&address).map_err(|_| bad())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("the AIOStreams address cannot carry a user name or password".into());
    }
    let origin = url.origin().ascii_serialization();
    // A closing slash, so `/stremio` and `/stremio/` read alike. Markers are
    // found in lower case (the server's routes are not case sensitive), and
    // cut from the path as written.
    let mut path = url.path().to_string();
    if !path.ends_with('/') {
        path.push('/');
    }
    let lower = path.to_ascii_lowercase();
    let (prefix, configure_url) = if let Some(at) = lower.rfind("/stremio/") {
        let prefix = &path[..at];
        let segs: Vec<&str> = path[at + "/stremio/".len()..]
            .split('/')
            .filter(|s| !s.is_empty())
            .collect();
        // A manifest or a configure page ends the config's own path; with
        // neither, the config is its first two segments.
        let ends = segs.last().is_some_and(|s| {
            s.eq_ignore_ascii_case("manifest.json") || s.eq_ignore_ascii_case("configure")
        });
        let named = if ends {
            &segs[..segs.len() - 1]
        } else {
            &segs[..segs.len().min(2)]
        };
        let configure = if named.len() >= 2 {
            let query = url
                .query()
                .filter(|q| !q.is_empty())
                .map(|q| format!("?{q}"))
                .unwrap_or_default();
            format!(
                "{origin}{prefix}/stremio/{}/configure{query}",
                named.join("/")
            )
        } else {
            format!("{origin}{prefix}/stremio/configure")
        };
        (prefix, configure)
    } else {
        let prefix = match lower.rfind("/jellyfin/") {
            Some(at) => &path[..at],
            None => path.trim_end_matches('/'),
        };
        (prefix, format!("{origin}{prefix}/stremio/configure"))
    };
    Ok(Derived {
        base: format!("{origin}{prefix}/jellyfin"),
        configure_url,
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

/// An item id as AIOStreams gives them out: 16 bytes as 32 lower case hex
/// (core/src/jellyfin/ids.ts), and nothing before or after.
fn is_item_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Whether the app makes this call: the method and the path both. `path` is
/// plain (`plain_path`), and a segment is matched exactly: a different case, a
/// trailing slash, a prefix (`/emby`, `/u/<alias>`, `/<uuid>/<password>`) or a
/// longer path is not on the list. `{id}` is `is_item_id`.
///
/// A "Load versions" marker id is 32 lower case hex too, and `GET
/// /Items/<marker>` with `Fields` makes AIOStreams search (items.ts:905-911).
/// Nothing here can tell a marker from an item.
fn on_the_list(method: &str, path: &str) -> bool {
    let segs: Vec<&str> = path.strip_prefix('/').unwrap_or("").split('/').collect();
    match (method, segs.as_slice()) {
        (
            "GET",
            ["UserViews"]
            | ["Genres"]
            | ["Items"]
            | ["UserItems", "Resume"]
            | ["Shows", "NextUp"]
            | ["Shows", "Upcoming"],
        )
        | (
            "POST",
            ["Sessions", "Playing"]
            | ["Sessions", "Playing", "Progress"]
            | ["Sessions", "Playing", "Stopped"],
        ) => true,
        ("GET", ["Items", id] | ["MediaSegments", id] | ["Shows", id, "Episodes"])
        | ("POST", ["UserPlayedItems", id] | ["UserItems", id, "UserData"]) => is_item_id(id),
        _ => false,
    }
}

/// A `Fields` entry the server reads as the name it looks like: a letter, then
/// letters and digits.
fn is_field_name(f: &str) -> bool {
    let mut b = f.bytes();
    b.next().is_some_and(|c| c.is_ascii_alphabetic()) && b.all(|c| c.is_ascii_alphanumeric())
}

/// What `Fields` asks for, as AIOStreams reads it: any key case, repeated,
/// split on commas and bars (context.ts qlist). It then trims each entry with
/// JS `trim()`, which strips more than ASCII whitespace (U+FEFF, U+00A0, the
/// vertical tab...), so an entry that Rust's ASCII trim leaves non-empty can be
/// empty there: a `Fields` that looks set here and is unset to the server.
/// Every entry is therefore trimmed of ASCII whitespace only, and then must be
/// a plain field name (`is_field_name`) or the whole request is refused. An
/// empty entry is none, and an empty `Fields` is no `Fields`.
fn fields_of(query: &HashMap<String, String>) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for (_, v) in query
        .iter()
        .filter(|(k, _)| k.eq_ignore_ascii_case("fields"))
    {
        for part in v.split([',', '|']) {
            let f = part.trim_matches(|c: char| c.is_ascii_whitespace());
            if f.is_empty() {
                continue;
            }
            if !is_field_name(f) {
                return Err("refused: Fields holds an entry that is not a plain field name".into());
            }
            out.push(f.to_ascii_lowercase());
        }
    }
    Ok(out)
}

/// Ok when the app makes this call and it cannot make AIOStreams search for
/// streams. `method` is upper case. Refuses, with nothing sent:
/// - a path that is not plain (`plain_path`);
/// - any method and path `on_the_list` does not name;
/// - a `Fields` with an entry that is not a plain field name (`fields_of`);
/// - `Fields` naming MediaSources, on any path;
/// - `GET /Items/<id>` with no `Fields`, which AIOStreams answers by
///   resolving streams.
fn guard(method: &str, path: &str, query: &HashMap<String, String>) -> Result<(), String> {
    plain_path(path)?;
    let refused = |why: &str| Err(format!("refused: {why}"));
    if !on_the_list(method, path) {
        return refused("not a call this app makes");
    }
    let fields = fields_of(query)?;
    if fields.iter().any(|f| f.contains("mediasources")) {
        return refused("Fields names MediaSources, which makes AIOStreams search for streams");
    }
    // The list has one GET under `/Items/`, and it is a single item.
    if method == "GET" && path.starts_with("/Items/") && fields.is_empty() {
        return refused("a single item needs Fields, or AIOStreams searches for streams");
    }
    Ok(())
}

/// `encodeURIComponent`: the letters, digits and `-_.!~*'()` as they are, every
/// other byte of the UTF-8 as `%` and two upper case hex digits. How AIOStreams
/// writes a token into a URL (media.ts `buildMediaStreams`).
fn uri_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// `body` with the token taken out, as it is and as `uri_component` writes it,
/// each replaced by nothing. Until neither is left: taking one out can join
/// what was either side of it into another. A body without the token comes back
/// as it was.
fn scrub(mut body: String, token: &str) -> String {
    if token.is_empty() {
        return body;
    }
    let forms = [token.to_string(), uri_component(token)];
    while let Some(form) = forms.iter().find(|f| body.contains(f.as_str())) {
        body = body.replace(form.as_str(), "");
    }
    body
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

/// A PlaybackInfo answer, cut down to `SOURCE_KEEPS` per source and its
/// `ErrorCode`. What is not listed is dropped, so a field AIOStreams adds
/// later is not carried either. A 2xx that is not a JSON object is an error;
/// any other status is data, with no sources.
fn trim_sources(reply: Reply) -> Result<Sources, String> {
    let status = reply.status;
    let answer = match serde_json::from_str::<serde_json::Value>(&reply.body) {
        Ok(serde_json::Value::Object(o)) => o,
        _ if !(200..300).contains(&status) => {
            return Ok(Sources {
                status,
                sources: Vec::new(),
                error_code: None,
            })
        }
        _ => return Err(BAD_ANSWER.into()),
    };
    let sources = answer
        .get("MediaSources")
        .and_then(|m| m.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|s| s.as_object())
                .map(|s| {
                    let kept = SOURCE_KEEPS
                        .iter()
                        .filter_map(|k| s.get(*k).map(|v| (k.to_string(), v.clone())))
                        .collect();
                    serde_json::Value::Object(kept)
                })
                .collect()
        })
        .unwrap_or_default();
    let error_code = answer
        .get("ErrorCode")
        .and_then(|c| c.as_str())
        .map(str::to_string);
    Ok(Sources {
        status,
        sources,
        error_code,
    })
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
            sources_wait: SOURCES_WAIT,
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
    /// secret here. The page gets the code and where to approve it. The
    /// address is any `derive` reads: a manifest URL, a configure page, or
    /// just the instance's own.
    pub async fn start(&self, address: &str) -> Result<Started, String> {
        let d = derive(address)?;
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
    /// `null` is no body. Only the calls `guard` lists are made, and any other
    /// is refused with nothing sent. The answer comes back as data, a 4xx
    /// included, with the token taken out of it, but a 401 also ends the
    /// session. Never the stream search: that is `sources`, by name.
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
            _ => return Err("refused: only GET and POST".into()),
        };
        let query = query.unwrap_or_default();
        guard(&method, path, &query)?;
        let body = body.filter(|b| !b.is_null()).map(|b| b.to_string());
        self.call(&verb, path, &query, body.as_deref(), None).await
    }

    /// The stream search for one title (`/Items/{id}/PlaybackInfo`), the call
    /// `request` never makes, and the answer cut down to the sources' own
    /// fields (`trim_sources`). `refresh` searches the addons again, else a
    /// list from the last 3 minutes is taken as it is. `item_id` is 32 lower
    /// case hex, as every id AIOStreams gives out is, and anything else is
    /// refused before a request. A 429 is waited out once and a 401 signs out,
    /// as for `request`; the wait on the search is longer.
    pub async fn sources(&self, item_id: &str, refresh: bool) -> Result<Sources, String> {
        if !is_item_id(item_id) {
            return Err("refused: not an AIOStreams item id".into());
        }
        let body = if refresh {
            serde_json::json!({ "Refresh": true })
        } else {
            serde_json::json!({ "Fresh": true })
        };
        let reply = self
            .call(
                &reqwest::Method::POST,
                &format!("/Items/{item_id}/PlaybackInfo"),
                &HashMap::new(),
                Some(&body.to_string()),
                Some(self.sources_wait),
            )
            .await?;
        trim_sources(reply)
    }

    /// One call with the session's token, past the guard: a 429 waited out
    /// once, a 401 ending the session. `wait` is how long to hold the line,
    /// where the shared client's own limit is not enough. Every reply leaves
    /// here with the token taken out of its body (`scrub`), so no caller, and
    /// no route added later, can hand it back.
    async fn call(
        &self,
        verb: &reqwest::Method,
        path: &str,
        query: &HashMap<String, String>,
        body: Option<&str>,
        wait: Option<Duration>,
    ) -> Result<Reply, String> {
        let session = self
            .state
            .lock()
            .unwrap()
            .session
            .clone()
            .ok_or_else(|| "not signed in to AIOStreams".to_string())?;
        let (mut reply, retry) = self.send(&session, verb, path, query, body, wait).await?;
        // Rate limited: wait out what AIOStreams asks, once.
        if reply.status == 429 {
            if let Some(secs) = retry.filter(|s| *s <= MAX_RETRY_WAIT) {
                tokio::time::sleep(Duration::from_secs(secs)).await;
                reply = self.send(&session, verb, path, query, body, wait).await?.0;
            }
        }
        if reply.status == 401 {
            self.drop_session(&session.token);
        }
        reply.body = scrub(std::mem::take(&mut reply.body), &session.token);
        Ok(reply)
    }

    async fn send(
        &self,
        s: &Session,
        method: &reqwest::Method,
        path: &str,
        query: &HashMap<String, String>,
        body: Option<&str>,
        wait: Option<Duration>,
    ) -> Result<(Reply, Option<u64>), String> {
        let mut req = self
            .http
            .request(method.clone(), format!("{}{}", s.base, path))
            .header(
                reqwest::header::AUTHORIZATION,
                self.header(&s.device_id, Some(&s.token)),
            )
            .header(reqwest::header::ACCEPT, JSON);
        if let Some(w) = wait {
            req = req.timeout(w);
        }
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
    /// a few API routes (PlaybackInfo among them), recording what it was
    /// asked. The one token it accepts is TOKEN1, or `token` when that is set.
    #[derive(Default)]
    struct Fake {
        /// The token the trade hands out and the calls must carry, when not
        /// TOKEN1.
        token: Option<&'static str>,
        /// What `GET /Items/<id>` answers, when set: a raw body, as sent.
        item_body: Option<String>,
        /// `DEAD` answers 401, as for a token AIOStreams no longer knows.
        dead: bool,
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
        /// `LIMITED` and PlaybackInfo answer 429 this many times, then 200.
        limit_for: AtomicUsize,
        /// The `Retry-After` of those 429s, when set.
        retry_after: Option<&'static str>,
        /// What PlaybackInfo answers, when set: `playback()` otherwise.
        playback: Option<serde_json::Value>,
        /// The status it answers with, when set (200 otherwise).
        playback_status: Option<u16>,
        /// A raw body for PlaybackInfo, when set: for the answers that are
        /// not JSON.
        playback_raw: Option<&'static str>,
        /// A request to a path ending so is answered after this long.
        delay: Option<(&'static str, Duration)>,
        seen: Mutex<Vec<Seen>>,
    }

    impl Fake {
        fn token(&self) -> &'static str {
            self.token.unwrap_or("TOKEN1")
        }
        fn seen(&self) -> Vec<Seen> {
            self.seen.lock().unwrap().clone()
        }
        fn hits(&self, needle: &str) -> usize {
            self.seen()
                .iter()
                .filter(|s| s.uri.contains(needle))
                .count()
        }
        /// A 429, while `limit_for` lasts.
        fn limited(&self) -> Option<Response<Full<Bytes>>> {
            let left = self.limit_for.load(Ordering::SeqCst);
            if left == 0 {
                return None;
            }
            self.limit_for.store(left - 1, Ordering::SeqCst);
            let mut r = Response::builder().status(429);
            if let Some(s) = self.retry_after {
                r = r.header("retry-after", s);
            }
            Some(r.body(Full::new(Bytes::from("{}"))).unwrap())
        }
    }

    /// The item the sources tests ask about.
    const ITEM: &str = "a1110100000001b239ffffffff000000";

    /// Calls the app makes that the fake answers in its own way when a test
    /// asks it to (`dead`, `limit_for`, `delay`): a 401, a 429 then a 200, a
    /// slow one. They are real routes because `request` sends no other,
    /// whatever a test would like to name.
    const DEAD: &str = "/Genres";
    const LIMITED: &str = "/UserViews";
    const SLOW: &str = "/Shows/Upcoming";

    /// A PlaybackInfo answer as AIOStreams gives it: whole sources, with the
    /// streams and the subtitle URLs that carry the token, and fields this
    /// app never reads.
    fn playback() -> serde_json::Value {
        serde_json::json!({
            "MediaSources": [
                {
                    "Protocol": "Http", "Id": ITEM, "Path": "https://cdn.example/a/1.mkv",
                    "Type": "Default", "Container": "mkv", "Size": 8123456789u64,
                    "Name": "4K HDR\nRD cached", "IsRemote": true, "ETag": "m1",
                    "RunTimeTicks": 72000000000u64, "IsInfiniteStream": false,
                    "Bitrate": 9000000, "SupportsDirectPlay": true,
                    "MediaAttachments": [], "Formats": [], "RequiredHttpHeaders": {},
                    "MediaStreams": [
                        { "Type": "Video", "Index": 0, "Codec": "hevc" },
                        {
                            "Type": "Subtitle", "Index": 2, "IsExternal": true,
                            "DeliveryUrl": "/Videos/x/m1/Subtitles/2/0/Stream.srt?ApiKey=TOKEN1&PlaySessionId=PS1",
                            "Path": "/Videos/x/m1/Subtitles/2/0/Stream.srt",
                        },
                    ],
                    "aiostreams": {
                        "name": "4K HDR", "description": "RD cached", "addon": "Torrentio",
                        "service": "realdebrid", "cached": true, "resolution": "2160p",
                        "size": 8123456789u64, "filename": "Movie.2160p.mkv",
                        "bingeGroup": "torrentio|2160p", "visualTags": ["HDR10"],
                        "type": "debrid", "id": "m1",
                    },
                },
                {
                    "Protocol": "Http", "Id": "m2", "Path": "https://cdn.example/b/2.mp4",
                    "Type": "Default", "Container": "mp4", "Name": "1080p\nTorBox",
                    "IsRemote": true, "IsInfiniteStream": false,
                    "MediaStreams": [{
                        "Type": "Subtitle", "Index": 1, "IsExternal": true,
                        "DeliveryUrl": "/Videos/x/m2/Subtitles/1/0/Stream.vtt?ApiKey=TOKEN1",
                    }],
                    "aiostreams": {
                        "name": "1080p", "description": "TorBox", "addon": "Comet",
                        "service": "torbox", "cached": false, "visualTags": [],
                        "type": "debrid", "id": "m2",
                    },
                },
            ],
            "PlaySessionId": "PS1",
        })
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
        if let Some((end, wait)) = fake.delay {
            if p.ends_with(end) {
                tokio::time::sleep(wait).await;
            }
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
                        "AccessToken": fake.token(), "ServerId": "SRV",
                    }),
                )
            }
            ("POST", "/Sessions/Logout") => empty(204),
            _ => {
                let want = format!("Token=\"{}\"", esc(fake.token()));
                if !auth.as_deref().unwrap_or("").contains(&want) {
                    return json(401, serde_json::json!({ "Message": "Unauthorized" }));
                }
                match p {
                    DEAD if fake.dead => {
                        json(401, serde_json::json!({ "Message": "Invalid credentials" }))
                    }
                    LIMITED => fake
                        .limited()
                        .unwrap_or_else(|| json(200, serde_json::json!({ "ok": true }))),
                    p if method == "GET"
                        && p.starts_with("/Items/")
                        && fake.item_body.is_some() =>
                    {
                        Response::builder()
                            .status(200)
                            .header("content-type", "application/json")
                            .body(Full::new(Bytes::from(fake.item_body.clone().unwrap())))
                            .unwrap()
                    }
                    p if method == "POST"
                        && p.starts_with("/Items/")
                        && p.ends_with("/PlaybackInfo") =>
                    {
                        if let Some(r) = fake.limited() {
                            return r;
                        }
                        let status = fake.playback_status.unwrap_or(200);
                        if let Some(raw) = fake.playback_raw {
                            return Response::builder()
                                .status(status)
                                .body(Full::new(Bytes::from(raw)))
                                .unwrap();
                        }
                        json(status, fake.playback.clone().unwrap_or_else(playback))
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
        signed_in_with(fake, reqwest::Client::new()).await
    }

    /// The same, on a client of the test's own.
    async fn signed_in_with(
        fake: &Arc<Fake>,
        http: reqwest::Client,
    ) -> (Arc<Aiojf>, Shared, String) {
        let base = serve(fake.clone()).await;
        let vault = Shared::default();
        let a = Aiojf::new(cfg(), http, Box::new(vault.clone()));
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
            let fake = Arc::new(Fake {
                dead: true,
                ..Default::default()
            });
            let (a, vault, _) = signed_in(&fake).await;
            let r = a.request("GET", DEAD, None, None).await.unwrap();
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
            let r = a.request("GET", LIMITED, None, None).await.unwrap();
            assert_eq!(r.status, 200);
            assert!(
                t0.elapsed() >= Duration::from_millis(950),
                "{:?}",
                t0.elapsed()
            );
            assert_eq!(fake.hits(LIMITED), 2);

            // Always limited: one retry and no more, and the 429 goes back.
            fake.limit_for.store(99, Ordering::SeqCst);
            let r = a.request("GET", LIMITED, None, None).await.unwrap();
            assert_eq!(r.status, 429);
            assert_eq!(fake.hits(LIMITED), 4);
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
            let r = a.request("GET", LIMITED, None, None).await.unwrap();
            assert_eq!(r.status, 429);
            assert_eq!(fake.hits(LIMITED), 1);

            // A Retry-After past what is worth waiting for.
            let fake = Arc::new(Fake {
                retry_after: Some("3600"),
                ..Default::default()
            });
            fake.limit_for.store(99, Ordering::SeqCst);
            let (a, _, _) = signed_in(&fake).await;
            let t0 = Instant::now();
            let r = a.request("GET", LIMITED, None, None).await.unwrap();
            assert_eq!(r.status, 429);
            assert_eq!(fake.hits(LIMITED), 1);
            assert!(t0.elapsed() < Duration::from_secs(5));
        })
    }

    #[test]
    fn a_search_asks_for_a_fresh_list_or_a_new_one_by_name() {
        run(async {
            let fake = Arc::new(Fake::default());
            let (a, vault, _) = signed_in(&fake).await;
            let device = vault.load().unwrap().device_id;
            a.sources(ITEM, false).await.unwrap();
            a.sources(ITEM, true).await.unwrap();
            let seen = fake.seen();
            let (fresh, again) = (&seen[seen.len() - 2], &seen[seen.len() - 1]);
            let want = format!(
                "MediaBrowser Client=\"BlammyTV\", Device=\"TEST-PC\", DeviceId=\"{device}\", Version=\"9.9.9\", Token=\"TOKEN1\""
            );
            for s in [fresh, again] {
                assert_eq!(s.method, "POST");
                assert_eq!(s.uri, format!("/jellyfin/Items/{ITEM}/PlaybackInfo"));
                // The signed-in header, as every call, and no query.
                assert_eq!(s.auth.as_deref(), Some(want.as_str()));
            }
            assert_eq!(fresh.body, r#"{"Fresh":true}"#);
            assert_eq!(again.body, r#"{"Refresh":true}"#);
        })
    }

    #[test]
    fn the_generic_call_still_refuses_the_search_beside_it() {
        run(async {
            let fake = Arc::new(Fake::default());
            let (a, _, _) = signed_in(&fake).await;
            a.sources(ITEM, false).await.unwrap();
            assert_eq!(fake.hits("PlaybackInfo"), 1);
            let path = format!("/Items/{ITEM}/PlaybackInfo");
            for (method, body) in [
                ("POST", Some(serde_json::json!({ "Fresh": true }))),
                ("POST", Some(serde_json::json!({ "Refresh": true }))),
                ("POST", None),
                ("GET", None),
            ] {
                let e = a.request(method, &path, None, body).await.unwrap_err();
                assert!(e.starts_with("refused:"), "{method}: {e}");
            }
            // Only the named call reached AIOStreams.
            assert_eq!(fake.hits("PlaybackInfo"), 1);
        })
    }

    #[test]
    fn a_search_comes_back_with_only_the_sources_own_fields() {
        run(async {
            // The fake's answer does carry what must not get out, or the
            // checks below would pass on an answer that never had it.
            let whole = playback().to_string();
            for leak in [
                "TOKEN1",
                "ApiKey",
                "MediaStreams",
                "DeliveryUrl",
                "MediaAttachments",
                "PlaySessionId",
                "Bitrate",
                "ETag",
            ] {
                assert!(whole.contains(leak), "the fixture lost {leak}");
            }
            let fake = Arc::new(Fake::default());
            let (a, _, _) = signed_in(&fake).await;
            let r = a.sources(ITEM, false).await.unwrap();
            let made = playback()["MediaSources"].clone();
            assert_eq!(
                serde_json::to_value(&r).unwrap(),
                serde_json::json!({
                    "status": 200,
                    "sources": [
                        {
                            "Id": ITEM,
                            "Path": "https://cdn.example/a/1.mkv",
                            "Name": "4K HDR\nRD cached",
                            "Type": "Default",
                            "Size": 8123456789u64,
                            "Container": "mkv",
                            "RunTimeTicks": 72000000000u64,
                            "IsInfiniteStream": false,
                            // As it came, every field of it.
                            "aiostreams": made[0]["aiostreams"].clone(),
                        },
                        {
                            "Id": "m2",
                            "Path": "https://cdn.example/b/2.mp4",
                            "Name": "1080p\nTorBox",
                            "Type": "Default",
                            "Container": "mp4",
                            "IsInfiniteStream": false,
                            "aiostreams": made[1]["aiostreams"].clone(),
                        },
                    ],
                })
            );
            assert_eq!(r.sources[0]["aiostreams"]["visualTags"][0], "HDR10");
            // And nowhere in what is handed over, whatever it is called.
            let out = serde_json::to_string(&r).unwrap();
            for gone in [
                "TOKEN1",
                "ApiKey",
                "MediaStreams",
                "DeliveryUrl",
                "MediaAttachments",
                "PlaySessionId",
                "PS1",
                "Bitrate",
                "ETag",
                "SupportsDirectPlay",
                "Subtitles",
                "errorCode",
            ] {
                assert!(!out.contains(gone), "{gone} got out: {out}");
            }
            // The play URL did: it is what the page is asking for.
            assert!(out.contains("https://cdn.example/a/1.mkv"));
        })
    }

    #[test]
    fn a_search_that_found_nothing_is_data_and_one_that_made_no_sense_is_an_error() {
        run(async {
            let placeholder = serde_json::json!({
                "Id": ITEM, "Path": "https://aio.example/static/none.mp4",
                "Type": "Placeholder", "Name": "No streams found", "Container": "mp4",
                "IsInfiniteStream": false, "ETag": ITEM,
                "MediaStreams": [{ "Type": "Video", "Index": 0 }],
            });
            // (status, body, what the page is told)
            let cases: Vec<(u16, serde_json::Value, Sources)> = vec![
                (
                    404,
                    serde_json::json!({
                        "MediaSources": [], "PlaySessionId": "", "ErrorCode": "NotAllowed",
                    }),
                    Sources {
                        status: 404,
                        sources: vec![],
                        error_code: Some("NotAllowed".into()),
                    },
                ),
                // The placeholder is the page's to tell from a stream: it is
                // kept, `Type` and all, down to its own fields.
                (
                    200,
                    serde_json::json!({
                        "MediaSources": [placeholder], "PlaySessionId": "PS1",
                        "ErrorCode": "NoCompatibleStream",
                    }),
                    Sources {
                        status: 200,
                        sources: vec![serde_json::json!({
                            "Id": ITEM, "Path": "https://aio.example/static/none.mp4",
                            "Type": "Placeholder", "Name": "No streams found",
                            "Container": "mp4", "IsInfiniteStream": false,
                        })],
                        error_code: Some("NoCompatibleStream".into()),
                    },
                ),
                // An object with nothing usable in it, and what is not one.
                (
                    200,
                    serde_json::json!({ "MediaSources": "nope", "ErrorCode": 7 }),
                    Sources {
                        status: 200,
                        sources: vec![],
                        error_code: None,
                    },
                ),
                (
                    200,
                    serde_json::json!({ "MediaSources": [null, 5, "x", { "Id": "m1" }] }),
                    Sources {
                        status: 200,
                        sources: vec![serde_json::json!({ "Id": "m1" })],
                        error_code: None,
                    },
                ),
                (
                    500,
                    serde_json::json!({ "Message": "oops" }),
                    Sources {
                        status: 500,
                        sources: vec![],
                        error_code: None,
                    },
                ),
            ];
            for (status, body, want) in cases {
                let fake = Arc::new(Fake {
                    playback_status: Some(status),
                    playback: Some(body.clone()),
                    ..Default::default()
                });
                let (a, _, _) = signed_in(&fake).await;
                assert_eq!(a.sources(ITEM, false).await.unwrap(), want, "{body}");
                assert!(a.status().connected);
            }

            // Not JSON at all: a page from something in front of it. A 2xx
            // of that is no answer; any other status is the status.
            for (status, raw, ok) in [
                (200, "<!doctype html>", false),
                (200, "[]", false),
                (200, "", false),
                (500, "<html>oops</html>", true),
                (502, "", true),
            ] {
                let fake = Arc::new(Fake {
                    playback_status: Some(status),
                    playback_raw: Some(raw),
                    ..Default::default()
                });
                let (a, _, _) = signed_in(&fake).await;
                let r = a.sources(ITEM, false).await;
                if ok {
                    assert_eq!(
                        r,
                        Ok(Sources {
                            status,
                            sources: vec![],
                            error_code: None
                        }),
                        "{status} {raw}"
                    );
                } else {
                    assert_eq!(r, Err(BAD_ANSWER.to_string()), "{status} {raw}");
                }
            }
        })
    }

    #[test]
    fn an_id_that_is_not_32_lower_case_hex_makes_no_request() {
        run(async {
            let fake = Arc::new(Fake::default());
            let (a, _, _) = signed_in(&fake).await;
            let sent = fake.seen().len();
            let bad: Vec<String> = vec![
                String::new(),
                "abc".into(),
                ITEM[..31].into(),
                format!("{ITEM}0"),
                ITEM.to_uppercase(),
                // A uuid with its dashes, which AIOStreams would take.
                "a1110100-0000-01b2-39ff-ffffffff0000".into(),
                format!("{}g", &ITEM[..31]),
                format!("{} ", &ITEM[..31]),
                format!("{}\n", &ITEM[..31]),
                format!("{}/", &ITEM[..31]),
                format!("../{}", &ITEM[..29]),
                format!("{}?x=1", &ITEM[..26]),
                format!("{}%2f", &ITEM[..29]),
                // 32 bytes, 16 characters.
                "\u{e9}".repeat(16),
                format!("{}\u{e9}", &ITEM[..30]),
            ];
            for id in &bad {
                for refresh in [false, true] {
                    let e = a.sources(id, refresh).await.unwrap_err();
                    assert!(e.starts_with("refused:"), "{id:?}: {e}");
                }
            }
            assert_eq!(fake.seen().len(), sent, "something reached AIOStreams");
            assert!(a.status().connected);

            // Signed out, a good id goes nowhere either, and it is not a
            // refusal: the page reads this one as "disconnected".
            let fake = Arc::new(Fake::default());
            let _ = serve(fake.clone()).await;
            let e = client(&Shared::default())
                .sources(ITEM, false)
                .await
                .unwrap_err();
            assert!(!e.starts_with("refused:"), "{e}");
            assert!(fake.seen().is_empty());
        })
    }

    #[test]
    fn a_search_401_signs_out_and_clears_the_vault() {
        run(async {
            let fake = Arc::new(Fake {
                playback_status: Some(401),
                playback: Some(serde_json::json!({ "Message": "Invalid credentials" })),
                ..Default::default()
            });
            let (a, vault, _) = signed_in(&fake).await;
            let r = a.sources(ITEM, false).await.unwrap();
            // The answer still comes back as data.
            assert_eq!(
                r,
                Sources {
                    status: 401,
                    sources: vec![],
                    error_code: None
                }
            );
            assert!(!a.status().connected);
            assert!(vault.load().is_none());
            // Signed out: nothing more is sent.
            let before = fake.seen().len();
            assert!(a.sources(ITEM, false).await.is_err());
            assert_eq!(fake.seen().len(), before);
        })
    }

    #[test]
    fn a_search_429_is_waited_out_once() {
        run(async {
            // One 429 with a Retry-After: wait it, ask again, get the sources.
            let fake = Arc::new(Fake {
                retry_after: Some("1"),
                ..Default::default()
            });
            fake.limit_for.store(1, Ordering::SeqCst);
            let (a, _, _) = signed_in(&fake).await;
            let t0 = Instant::now();
            let r = a.sources(ITEM, true).await.unwrap();
            assert_eq!(r.status, 200);
            assert_eq!(r.sources.len(), 2);
            assert!(
                t0.elapsed() >= Duration::from_millis(950),
                "{:?}",
                t0.elapsed()
            );
            assert_eq!(fake.hits("PlaybackInfo"), 2);
            // The second ask is the first one again.
            let seen = fake.seen();
            let (first, second) = (&seen[seen.len() - 2], &seen[seen.len() - 1]);
            assert_eq!(first.body, r#"{"Refresh":true}"#);
            assert_eq!(second.body, first.body);
            assert_eq!(second.uri, first.uri);

            // Always limited: one more ask and no more, and the 429 goes back.
            fake.limit_for.store(99, Ordering::SeqCst);
            let r = a.sources(ITEM, false).await.unwrap();
            assert_eq!(
                r,
                Sources {
                    status: 429,
                    sources: vec![],
                    error_code: None
                }
            );
            assert_eq!(fake.hits("PlaybackInfo"), 4);
            assert!(a.status().connected);
        })
    }

    #[test]
    fn a_search_429_with_nothing_to_wait_for_is_not_asked_again() {
        run(async {
            // No Retry-After.
            let fake = Arc::new(Fake::default());
            fake.limit_for.store(99, Ordering::SeqCst);
            let (a, _, _) = signed_in(&fake).await;
            assert_eq!(a.sources(ITEM, false).await.unwrap().status, 429);
            assert_eq!(fake.hits("PlaybackInfo"), 1);

            // A Retry-After past what is worth waiting for.
            let fake = Arc::new(Fake {
                retry_after: Some("3600"),
                ..Default::default()
            });
            fake.limit_for.store(99, Ordering::SeqCst);
            let (a, _, _) = signed_in(&fake).await;
            let t0 = Instant::now();
            assert_eq!(a.sources(ITEM, false).await.unwrap().status, 429);
            assert_eq!(fake.hits("PlaybackInfo"), 1);
            assert!(t0.elapsed() < Duration::from_secs(5));
        })
    }

    #[test]
    fn a_search_waits_longer_than_the_shared_client_does() {
        run(async {
            assert_eq!(SOURCES_WAIT, Duration::from_secs(60));
            // A client that gives a call 300 ms, as the app's gives it 30 s.
            let short = || {
                reqwest::Client::builder()
                    .timeout(Duration::from_millis(300))
                    .build()
                    .unwrap()
            };
            // The control: that limit is live, and cuts a plain call short.
            let slow = Arc::new(Fake {
                delay: Some((SLOW, Duration::from_millis(900))),
                ..Default::default()
            });
            let (a, _, _) = signed_in_with(&slow, short()).await;
            assert_eq!(
                a.request("GET", SLOW, None, None).await.unwrap_err(),
                "timed out"
            );
            // The same wait on a search is let be.
            let search = Arc::new(Fake {
                delay: Some(("/PlaybackInfo", Duration::from_millis(900))),
                ..Default::default()
            });
            let (a, _, _) = signed_in_with(&search, short()).await;
            let r = a.sources(ITEM, false).await.unwrap();
            assert_eq!((r.status, r.sources.len()), (200, 2));
        })
    }

    #[test]
    fn a_search_that_never_answers_gives_up_and_stays_signed_in() {
        run(async {
            let fake = Arc::new(Fake {
                delay: Some(("/PlaybackInfo", Duration::from_secs(30))),
                ..Default::default()
            });
            let (mut a, vault, base) = signed_in(&fake).await;
            Arc::get_mut(&mut a).unwrap().sources_wait = Duration::from_millis(400);
            let t0 = Instant::now();
            let e = a.sources(ITEM, false).await.unwrap_err();
            assert_eq!(e, "timed out");
            assert!(t0.elapsed() < Duration::from_secs(5), "{:?}", t0.elapsed());
            assert!(!e.contains(&base) && !e.contains(ITEM) && !e.contains("TOKEN1"));
            // A slow search is not a sign-out.
            assert!(a.status().connected);
            assert!(vault.load().is_some());
        })
    }

    #[test]
    fn a_failed_search_names_neither_the_token_nor_the_address() {
        run(async {
            // Nothing listening, and a listener that hangs up (reqwest words
            // that one with the URL in it).
            let hangs_up = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = hangs_up.local_addr().unwrap().port();
            tokio::spawn(async move {
                loop {
                    let _ = hangs_up.accept().await;
                }
            });
            for host in ["127.0.0.1:9".to_string(), format!("127.0.0.1:{port}")] {
                let vault = Shared::default();
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
                let a = client(&vault);
                let e = a.sources(ITEM, false).await.unwrap_err();
                assert!(
                    !e.contains("THE-TOKEN-VALUE")
                        && !e.contains("127.0.0.1")
                        && !e.contains("jellyfin")
                        && !e.contains(ITEM),
                    "{host}: {e}"
                );
                assert!(a.status().connected, "{host}");
            }
        })
    }

    #[test]
    fn the_sources_go_to_the_page_in_camel_case() {
        let none = Sources {
            status: 404,
            sources: vec![],
            error_code: None,
        };
        assert_eq!(
            serde_json::to_string(&none).unwrap(),
            r#"{"status":404,"sources":[]}"#
        );
        let some = Sources {
            status: 200,
            sources: vec![serde_json::json!({ "Id": "x" })],
            error_code: Some("NoCompatibleStream".into()),
        };
        assert_eq!(
            serde_json::to_string(&some).unwrap(),
            r#"{"status":200,"sources":[{"Id":"x"}],"errorCode":"NoCompatibleStream"}"#
        );
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
            &format!("/Items/{id}"),
            &[("Fields", "Overview,Genres,People,Path,ProviderIds")],
        );
        ok(
            "GET",
            "/Items",
            &[("Recursive", "true"), ("IsPlayed", "true")],
        );
        ok("GET", "/Items", &[("Ids", id)]);
        ok("GET", "/Items", &[("Ids", id), ("Fields", "ProviderIds")]);
        ok("GET", "/UserViews", &[]);
        ok("GET", "/Genres", &[("ParentId", id)]);
        ok("GET", "/UserItems/Resume", &[]);
        ok("GET", "/Shows/NextUp", &[("Limit", "20")]);
        ok("GET", "/Shows/Upcoming", &[]);
        ok(
            "GET",
            &format!("/Shows/{id}/Episodes"),
            &[("Limit", "500"), ("StartIndex", "0")],
        );
        ok("GET", &format!("/MediaSegments/{id}"), &[]);
        ok("POST", "/Sessions/Playing", &[]);
        ok("POST", "/Sessions/Playing/Progress", &[]);
        ok("POST", "/Sessions/Playing/Stopped", &[]);
        ok("POST", &format!("/UserPlayedItems/{id}"), &[]);
        ok("POST", &format!("/UserItems/{id}/UserData"), &[]);
    }

    /// One request for each call the app makes, and each one reaches AIOStreams
    /// as asked: the other half of the refusals below.
    #[test]
    fn every_call_the_app_makes_goes_through() {
        run(async {
            let fake = Arc::new(Fake::default());
            let (a, _, _) = signed_in(&fake).await;
            let body = Some(serde_json::json!({ "ItemId": ITEM, "PositionTicks": 10 }));
            type Made = (
                &'static str,
                String,
                Vec<(&'static str, &'static str)>,
                Option<serde_json::Value>,
            );
            let calls: Vec<Made> = vec![
                ("GET", "/UserViews".into(), vec![], None),
                ("GET", "/Genres".into(), vec![("ParentId", ITEM)], None),
                ("GET", "/Items".into(), vec![("ParentId", ITEM)], None),
                (
                    "GET",
                    format!("/Items/{ITEM}"),
                    vec![("Fields", "Overview,Genres,People,Path,ProviderIds")],
                    None,
                ),
                (
                    "GET",
                    format!("/Shows/{ITEM}/Episodes"),
                    vec![("Limit", "500")],
                    None,
                ),
                ("GET", "/Shows/NextUp".into(), vec![("Limit", "20")], None),
                ("GET", "/Shows/Upcoming".into(), vec![("Limit", "20")], None),
                (
                    "GET",
                    "/UserItems/Resume".into(),
                    vec![("Limit", "20")],
                    None,
                ),
                ("GET", format!("/MediaSegments/{ITEM}"), vec![], None),
                ("POST", "/Sessions/Playing".into(), vec![], body.clone()),
                (
                    "POST",
                    "/Sessions/Playing/Progress".into(),
                    vec![],
                    body.clone(),
                ),
                (
                    "POST",
                    "/Sessions/Playing/Stopped".into(),
                    vec![],
                    body.clone(),
                ),
                ("POST", format!("/UserPlayedItems/{ITEM}"), vec![], None),
                (
                    "POST",
                    format!("/UserItems/{ITEM}/UserData"),
                    vec![],
                    Some(serde_json::json!({ "PlaybackPositionTicks": 0 })),
                ),
            ];
            for (method, path, query, body) in &calls {
                let before = fake.seen().len();
                let r = a
                    .request(method, path, q(query), body.clone())
                    .await
                    .unwrap_or_else(|e| panic!("{method} {path} was refused: {e}"));
                assert_eq!(r.status, 200, "{method} {path}");
                let seen = fake.seen();
                assert_eq!(seen.len(), before + 1, "{method} {path}");
                let got = &seen[before];
                assert_eq!(got.method, *method, "{path}");
                let sent = format!("/jellyfin{path}");
                assert!(
                    got.uri == sent || got.uri.starts_with(&format!("{sent}?")),
                    "{path}: {}",
                    got.uri
                );
            }
        })
    }

    /// What the block list let through and the allow list does not: another
    /// route behind the same auth, another mount, another method, an id that
    /// is not exactly 32 lower case hex. Not one reaches AIOStreams.
    #[test]
    fn what_the_old_guard_let_through_is_refused_and_nothing_is_sent() {
        run(async {
            let fake = Arc::new(Fake::default());
            let (a, _, _) = signed_in(&fake).await;
            let sent = fake.seen().len();
            let id = ITEM;
            let uuid = "0a1b2c3d-4e5f-6789-abcd-ef0123456789";
            let fields = || Some(vec![("Fields", "ProviderIds")]);
            let mut cases: Vec<Case> = vec![
                // A token that never expires for the caller, and a code for
                // another device approved.
                ("POST", "/AIOStreams/Token".into(), None),
                ("POST", "/QuickConnect/Authorize".into(), None),
                (
                    "POST",
                    "/QuickConnect/Authorize".into(),
                    Some(vec![("code", "123456")]),
                ),
                ("POST", "/Sessions/Logout".into(), None),
                ("GET", "/System/Info".into(), None),
                // AIOStreams' other mounts, whatever Fields says.
                ("GET", format!("/{uuid}/x/Items/{id}"), None),
                ("GET", format!("/{uuid}/x/Items/{id}"), fields()),
                ("GET", format!("/u/alias/Items/{id}"), None),
                ("GET", format!("/u/alias/Items/{id}"), fields()),
                ("GET", format!("/Users/UID/Items/{id}"), fields()),
                ("GET", "/Users/UID/Items/Resume".into(), None),
                (
                    "GET",
                    format!("/emby/Items/{id}"),
                    Some(vec![("Fields", "x")]),
                ),
                ("GET", "/mediabrowser/UserItems/Resume".into(), None),
                // Reserved words under /Items, and what hangs off an item.
                ("GET", "/Items/Latest".into(), None),
                ("GET", "/Items/Filters".into(), None),
                ("GET", "/Items/Resume".into(), fields()),
                ("GET", format!("/Items/{id}/Ancestors"), None),
                ("GET", format!("/Items/{id}/Similar"), None),
                // The right path under the wrong method, and the methods the
                // list has no call for.
                ("POST", format!("/Items/{id}"), None),
                ("POST", format!("/Items/{id}"), fields()),
                ("POST", "/UserViews".into(), None),
                ("POST", "/Items".into(), None),
                ("POST", "/UserItems/Resume".into(), None),
                ("GET", "/Sessions/Playing".into(), None),
                ("GET", "/Sessions/Playing/Progress".into(), None),
                ("GET", format!("/UserPlayedItems/{id}"), None),
                ("GET", format!("/UserItems/{id}/UserData"), None),
                ("POST", format!("/MediaSegments/{id}"), None),
                ("DELETE", format!("/UserPlayedItems/{id}"), None),
                ("DELETE", "/Sessions/Playing".into(), None),
                ("DELETE", format!("/Items/{id}"), fields()),
                ("PUT", format!("/UserItems/{id}/UserData"), None),
                // A path with more or less than the list's own, and a case the
                // list does not spell.
                ("GET", "/UserViews/".into(), None),
                ("GET", "/Items/".into(), fields()),
                ("GET", "/UserItems/Resume/x".into(), None),
                ("GET", "/Shows/NextUp/x".into(), None),
                ("GET", format!("/Shows/{id}/Episodes/x"), None),
                ("GET", format!("/Shows/{id}"), None),
                ("POST", "/Sessions/Playing/Progress/x".into(), None),
                ("POST", "/Sessions".into(), None),
                ("GET", "/userviews".into(), None),
                ("GET", "/USERVIEWS".into(), None),
                ("GET", "/items".into(), None),
                ("GET", "/Shows/nextup".into(), None),
                ("POST", "/Sessions/playing".into(), None),
                ("POST", "/Sessions/Playing/progress".into(), None),
            ];
            // An id that is not exactly 32 lower case hex, on every route
            // that takes one.
            let upper = id.to_uppercase();
            let dashed = "a1110100-0000-01b2-39ff-ffffffff0000".to_string();
            let bad: Vec<String> = vec![
                // 33 characters, and 31.
                format!("{id}0"),
                id[..31].to_string(),
                upper.clone(),
                format!("A{}", &id[1..]),
                dashed.clone(),
                format!("{}g", &id[..31]),
                format!("{id}.json"),
                "UID".into(),
                "latest".into(),
                // 32 bytes, 16 characters.
                "\u{e9}".repeat(16),
            ];
            for x in &bad {
                cases.push(("GET", format!("/Items/{x}"), fields()));
                cases.push(("GET", format!("/MediaSegments/{x}"), None));
                cases.push(("GET", format!("/Shows/{x}/Episodes"), None));
                cases.push(("POST", format!("/UserPlayedItems/{x}"), None));
                cases.push(("POST", format!("/UserItems/{x}/UserData"), None));
            }
            for (method, path, query) in &cases {
                let query = query.as_ref().map(|p| q(p).unwrap());
                let r = a.request(method, path, query.clone(), None).await;
                let e = r.expect_err(&format!("sent {method} {path:?} {query:?}"));
                assert!(e.starts_with("refused:"), "{method} {path:?}: {e}");
            }
            assert_eq!(fake.seen().len(), sent, "something reached AIOStreams");
            // A refusal is a plain error: still signed in, and a call on the
            // list is still sent.
            assert!(a.status().connected);
            assert!(a
                .request("POST", &format!("/UserPlayedItems/{id}"), None, None)
                .await
                .is_ok());
            assert_eq!(fake.seen().len(), sent + 1);
        })
    }

    /// A `Fields` that holds anything but plain field names is refused, on any
    /// route: AIOStreams trims with JS `trim()`, which strips U+FEFF and more
    /// than Rust's ASCII trim does, so such an entry can be empty there.
    #[test]
    fn a_fields_that_is_not_plain_names_is_refused_and_nothing_is_sent() {
        run(async {
            let fake = Arc::new(Fake::default());
            let (a, _, _) = signed_in(&fake).await;
            let sent = fake.seen().len();
            let odd = [
                // Only a byte order mark: no Fields to the server, one here.
                "\u{feff}",
                " \u{feff} ",
                "\u{feff},\u{feff}",
                "\u{feff}|\u{feff}",
                "ProviderIds,\u{feff}",
                "\u{feff}|ProviderIds",
                "\u{feff}ProviderIds",
                "ProviderIds\u{feff}",
                // The rest of what JS strips and Rust's ASCII trim does not.
                "\u{a0}",
                "\u{2028}",
                "\u{3000}",
                "\u{0b}",
                "ProviderIds,\u{0b}",
                // Not zero-width or white, and still not a name.
                "\u{200b}",
                "Pro\u{e9}ids",
                "Provider-Ids",
                "Provider Ids",
                "Provider\tIds",
                "1ProviderIds",
                "_ProviderIds",
                "ProviderIds;",
                "Provider\0Ids",
                "ProviderIds,%",
                "../x",
            ];
            let id = ITEM;
            for f in odd {
                for key in ["Fields", "fields", "FIELDS"] {
                    // The single item, where an unset Fields starts a search.
                    let r = a
                        .request("GET", &format!("/Items/{id}"), q(&[(key, f)]), None)
                        .await;
                    let e = r.expect_err(&format!("sent {key}={f:?} on an item"));
                    assert!(e.starts_with("refused:"), "{key}={f:?}: {e}");
                    // And a route that never needed Fields: no entry is let by.
                    let r = a
                        .request("GET", "/UserItems/Resume", q(&[(key, f)]), None)
                        .await;
                    let e = r.expect_err(&format!("sent {key}={f:?} on Resume"));
                    assert!(e.starts_with("refused:"), "{key}={f:?}: {e}");
                }
            }
            // Every key that reads as Fields is read, not just one.
            let r = a
                .request(
                    "GET",
                    &format!("/Items/{id}"),
                    q(&[("Fields", "ProviderIds"), ("fields", "\u{feff}")]),
                    None,
                )
                .await;
            assert!(r.unwrap_err().starts_with("refused:"));
            assert_eq!(fake.seen().len(), sent, "something reached AIOStreams");

            // Plain names are still let by, with ASCII whitespace round them,
            // and an empty Fields is no Fields.
            let ok =
                |query: &[(&str, &str)]| guard("GET", &format!("/Items/{id}"), &q(query).unwrap());
            for f in [
                "ProviderIds",
                " ProviderIds , Overview\t",
                "ProviderIds|Overview",
                "Overview,,Genres,",
                "a",
                "\r\nPath\r\n",
            ] {
                assert_eq!(ok(&[("Fields", f)]), Ok(()), "{f:?}");
            }
            for f in ["", " ", " , |", ",", "|"] {
                assert!(ok(&[("Fields", f)]).is_err(), "{f:?} is no Fields");
                // On a route that needs none, it is just no Fields.
                assert_eq!(
                    guard("GET", "/UserItems/Resume", &q(&[("Fields", f)]).unwrap()),
                    Ok(()),
                    "{f:?}"
                );
            }
        })
    }

    /// The token, in the two forms AIOStreams writes it, and what both do
    /// to a body.
    const TOKEN: &str = "a+b/c=d:e~f";
    const TOKEN_ENCODED: &str = "a%2Bb%2Fc%3Dd%3Ae~f";

    #[test]
    fn a_token_is_written_as_encode_uri_component_writes_it() {
        // Each pair as node's encodeURIComponent gives it.
        for (raw, enc) in [
            ("abcXYZ019-_.!~*'()", "abcXYZ019-_.!~*'()"),
            ("a b", "a%20b"),
            ("+/=:@&?#%", "%2B%2F%3D%3A%40%26%3F%23%25"),
            ("\u{e9}", "%C3%A9"),
            ("\u{1F600}", "%F0%9F%98%80"),
            (",;$", "%2C%3B%24"),
            ("\"<>[]{}|\\^`", "%22%3C%3E%5B%5D%7B%7D%7C%5C%5E%60"),
            (TOKEN, TOKEN_ENCODED),
            ("", ""),
        ] {
            assert_eq!(uri_component(raw), enc, "{raw:?}");
        }
    }

    #[test]
    fn scrub_takes_out_the_token_in_both_forms_and_changes_nothing_else() {
        let go = |body: &str, token: &str| scrub(body.to_string(), token);
        // Both forms, once each and more than once, and in a longer text.
        assert_eq!(go(&format!("x{TOKEN}y"), TOKEN), "xy");
        assert_eq!(go(&format!("x{TOKEN_ENCODED}y"), TOKEN), "xy");
        assert_eq!(
            go(
                &format!("?ApiKey={TOKEN_ENCODED}&b={TOKEN}&c={TOKEN_ENCODED}{TOKEN}"),
                TOKEN
            ),
            "?ApiKey=&b=&c="
        );
        // Taking one out joins its neighbours: that is a token too.
        assert_eq!(go("aabb", "ab"), "");
        assert_eq!(go(&format!("a+{TOKEN}b/c=d:e~f"), TOKEN), "");
        // A body without it is the same bytes, whatever is in it.
        for body in [
            "",
            "{}",
            "{ \"Name\": \"caf\u{e9}\",\n \"x\" : [1, 2] }\n",
            "a+b/c=d:e",
            "a%2Bb%2Fc%3Dd%3Ae",
            "A+B/C=D:E~F",
        ] {
            assert_eq!(go(body, TOKEN), body);
        }
        // No token to look for is no change, not a body cut to pieces.
        assert_eq!(go("some body", ""), "some body");
    }

    #[test]
    fn the_token_is_taken_out_of_every_answer_in_both_forms() {
        run(async {
            // A detail read, as AIOStreams answers one it holds a fresh search
            // for: whole MediaSources, and an external subtitle whose
            // DeliveryUrl carries `ApiKey=<the request's own token>`.
            let detail = |key: &str, echo: &str| {
                serde_json::json!({
                    "Id": ITEM, "Type": "Movie", "Name": "A film",
                    "MediaSources": [{
                        "Id": "m1", "Path": "https://cdn.example/a/1.mkv",
                        "MediaStreams": [{
                            "Type": "Subtitle", "Index": 2, "IsExternal": true,
                            "DeliveryUrl": format!(
                                "/Videos/x/m1/Subtitles/2/0/Stream.srt?ApiKey={key}&PlaySessionId=PS1"
                            ),
                            "Path": "/Videos/x/m1/Subtitles/2/0/Stream.srt",
                        }],
                    }],
                    "Echo": format!("the token was {echo} here"),
                })
                .to_string()
            };
            let whole = detail(TOKEN_ENCODED, TOKEN);
            // The fixture does carry both, or the checks below would pass on
            // an answer that never had them.
            assert!(whole.contains(TOKEN) && whole.contains(TOKEN_ENCODED));
            let fake = Arc::new(Fake {
                token: Some(TOKEN),
                item_body: Some(whole),
                ..Default::default()
            });
            let (a, vault, _) = signed_in(&fake).await;
            assert_eq!(vault.load().unwrap().token, TOKEN);
            let r = a
                .request(
                    "GET",
                    &format!("/Items/{ITEM}"),
                    q(&[("Fields", "ProviderIds")]),
                    None,
                )
                .await
                .unwrap();
            assert_eq!(r.status, 200);
            assert!(!r.body.contains(TOKEN), "{}", r.body);
            assert!(!r.body.contains(TOKEN_ENCODED), "{}", r.body);
            assert!(!r.body.contains("ApiKey=a"), "{}", r.body);
            // Everything else is as it was.
            assert_eq!(r.body, detail("", ""));
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&r.body).unwrap()["MediaSources"][0]
                    ["Path"],
                "https://cdn.example/a/1.mkv"
            );

            // The same on a token that needs no encoding.
            let fake = Arc::new(Fake {
                item_body: Some(detail("TOKEN1", "TOKEN1")),
                ..Default::default()
            });
            let (a, _, _) = signed_in(&fake).await;
            let r = a
                .request(
                    "GET",
                    &format!("/Items/{ITEM}"),
                    q(&[("Fields", "ProviderIds")]),
                    None,
                )
                .await
                .unwrap();
            assert!(!r.body.contains("TOKEN1"), "{}", r.body);
            assert_eq!(r.body, detail("", ""));

            // A body without the token comes back byte for byte.
            for body in [
                "{ \"Id\": \"x\",\n \"Name\" : \"caf\u{e9} a+b/c=d:e\" }\n",
                "{}",
                "",
                "not json at all, with TOKEN2 in it",
            ] {
                let fake = Arc::new(Fake {
                    item_body: Some(body.to_string()),
                    ..Default::default()
                });
                let (a, _, _) = signed_in(&fake).await;
                let r = a
                    .request(
                        "GET",
                        &format!("/Items/{ITEM}"),
                        q(&[("Fields", "ProviderIds")]),
                        None,
                    )
                    .await
                    .unwrap();
                assert_eq!(r.body, body);
            }
        })
    }

    #[test]
    fn a_search_answer_has_the_token_taken_out_too() {
        run(async {
            // The fields a source keeps are the sources' own, and none is the
            // token. If AIOStreams ever put it in one, it still does not get
            // out: the scrub is in the one place both calls go through.
            let mut answer = playback();
            answer["MediaSources"][0]["Path"] = serde_json::json!(format!(
                "https://cdn.example/a/1.mkv?ApiKey={TOKEN_ENCODED}"
            ));
            answer["MediaSources"][0]["aiostreams"]["filename"] =
                serde_json::json!(format!("{TOKEN}.mkv"));
            let whole = answer.to_string();
            assert!(whole.contains(TOKEN) && whole.contains(TOKEN_ENCODED));
            let fake = Arc::new(Fake {
                token: Some(TOKEN),
                playback: Some(answer),
                ..Default::default()
            });
            let (a, _, _) = signed_in(&fake).await;
            let r = a.sources(ITEM, false).await.unwrap();
            let out = serde_json::to_string(&r).unwrap();
            assert!(
                !out.contains(TOKEN) && !out.contains(TOKEN_ENCODED),
                "{out}"
            );
            assert_eq!(r.sources[0]["Path"], "https://cdn.example/a/1.mkv?ApiKey=");
            assert_eq!(r.sources[0]["aiostreams"]["filename"], ".mkv");
        })
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
        // Plan 024 widened what is read: a leading space, a manifest with no
        // uuid, a path that is none of the forms are addresses now, and
        // `every_form_of_address_reads_the_same_way` has them.
        for bad in [
            "",
            "not a url",
            "ftp://h.example/stremio/U/P/manifest.json",
            "file:///stremio/U/P/manifest.json",
            "javascript:alert(1)",
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
    fn every_form_of_address_reads_the_same_way() {
        // (address, the Jellyfin base, the configure page)
        let cases: &[(&str, &str, &str)] = &[
            // A manifest URL, as it was.
            (
                "https://aio.example.com/stremio/U/P/manifest.json",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/U/P/configure",
            ),
            (
                "https://aio.example.com/aio/stremio/U/P/manifest.json",
                "https://aio.example.com/aio/jellyfin",
                "https://aio.example.com/aio/stremio/U/P/configure",
            ),
            (
                "http://192.168.1.5:3000/stremio/U/P/manifest.json",
                "http://192.168.1.5:3000/jellyfin",
                "http://192.168.1.5:3000/stremio/U/P/configure",
            ),
            // A variant or an alias after the password keeps its own page.
            (
                "https://aio.example.com/stremio/U/P/v/two/manifest.json",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/U/P/v/two/configure",
            ),
            (
                "https://aio.example.com/stremio/u/alice/manifest.json",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/u/alice/configure",
            ),
            // A configure URL, with the uuid and password or without.
            (
                "https://aio.example.com/stremio/U/P/configure",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/U/P/configure",
            ),
            (
                "https://aio.example.com/aio/stremio/U/P/configure",
                "https://aio.example.com/aio/jellyfin",
                "https://aio.example.com/aio/stremio/U/P/configure",
            ),
            (
                "https://aio.example.com/stremio/configure",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/configure",
            ),
            (
                "https://aio.example.com/aio/stremio/configure/",
                "https://aio.example.com/aio/jellyfin",
                "https://aio.example.com/aio/stremio/configure",
            ),
            // Anything with /stremio/ in it. The uuid and password, when
            // they are there, give the configure page.
            (
                "https://aio.example.com/stremio/U/P/",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/U/P/configure",
            ),
            (
                "https://aio.example.com/stremio/U/P",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/U/P/configure",
            ),
            (
                "https://aio.example.com/stremio/U/P/stream/movie/tt0111161.json",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/U/P/configure",
            ),
            // The unconfigured manifest, and the mount alone, name no config.
            (
                "https://aio.example.com/stremio/manifest.json",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/configure",
            ),
            (
                "https://aio.example.com/stremio/U/manifest.json",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/configure",
            ),
            (
                "https://aio.example.com/stremio/",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/configure",
            ),
            (
                "https://aio.example.com/aio/stremio",
                "https://aio.example.com/aio/jellyfin",
                "https://aio.example.com/aio/stremio/configure",
            ),
            // The last /stremio/ is the one.
            (
                "https://aio.example.com/stremio/stremio/U/P/manifest.json",
                "https://aio.example.com/stremio/jellyfin",
                "https://aio.example.com/stremio/stremio/U/P/configure",
            ),
            (
                "https://aio.example.com/stremio/x/stremio/configure",
                "https://aio.example.com/stremio/x/jellyfin",
                "https://aio.example.com/stremio/x/stremio/configure",
            ),
            // The routes are not case sensitive, so the marker is not.
            (
                "https://aio.example.com/Stremio/U/P/Manifest.json",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/U/P/configure",
            ),
            // One ending /jellyfin, or going on from it.
            (
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/configure",
            ),
            (
                "https://aio.example.com/jellyfin/",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/configure",
            ),
            (
                "https://aio.example.com/jellyfin/System/Info/Public",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/configure",
            ),
            (
                "https://aio.example.com/jellyfin/u/alice",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/configure",
            ),
            (
                "https://aio.example.com/aio/jellyfin",
                "https://aio.example.com/aio/jellyfin",
                "https://aio.example.com/aio/stremio/configure",
            ),
            (
                "https://aio.example.com/Jellyfin",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/configure",
            ),
            // The last one, so a prefix that holds the word is safe.
            (
                "https://aio.example.com/jellyfin/jellyfin",
                "https://aio.example.com/jellyfin/jellyfin",
                "https://aio.example.com/jellyfin/stremio/configure",
            ),
            // The bare address, closing slash or not.
            (
                "https://aio.example.com",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/configure",
            ),
            (
                "https://aio.example.com/",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/configure",
            ),
            (
                "https://aio.example.com/aio",
                "https://aio.example.com/aio/jellyfin",
                "https://aio.example.com/aio/stremio/configure",
            ),
            (
                "https://aio.example.com/aio/",
                "https://aio.example.com/aio/jellyfin",
                "https://aio.example.com/aio/stremio/configure",
            ),
            (
                "http://192.168.1.5:3000",
                "http://192.168.1.5:3000/jellyfin",
                "http://192.168.1.5:3000/stremio/configure",
            ),
            (
                "https://aio.example.com/my%20aio",
                "https://aio.example.com/my%20aio/jellyfin",
                "https://aio.example.com/my%20aio/stremio/configure",
            ),
            (
                "HTTPS://AIO.Example.com:443/aio",
                "https://aio.example.com/aio/jellyfin",
                "https://aio.example.com/aio/stremio/configure",
            ),
            // No scheme: https.
            (
                "aio.example.com",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/configure",
            ),
            (
                "aio.example.com/",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/configure",
            ),
            (
                "aio.example.com/aio",
                "https://aio.example.com/aio/jellyfin",
                "https://aio.example.com/aio/stremio/configure",
            ),
            (
                "aio.example.com:8443/aio",
                "https://aio.example.com:8443/aio/jellyfin",
                "https://aio.example.com:8443/aio/stremio/configure",
            ),
            (
                "localhost:3000",
                "https://localhost:3000/jellyfin",
                "https://localhost:3000/stremio/configure",
            ),
            (
                "192.168.1.5:3000/stremio/U/P/manifest.json",
                "https://192.168.1.5:3000/jellyfin",
                "https://192.168.1.5:3000/stremio/U/P/configure",
            ),
            (
                "aio.example.com/stremio/configure",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/configure",
            ),
            (
                "aio.example.com/jellyfin",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/configure",
            ),
            (
                "[::1]:3000",
                "https://[::1]:3000/jellyfin",
                "https://[::1]:3000/stremio/configure",
            ),
            // Whitespace around it is not part of it.
            (
                "  https://aio.example.com/aio/  ",
                "https://aio.example.com/aio/jellyfin",
                "https://aio.example.com/aio/stremio/configure",
            ),
            (
                "\t aio.example.com\r\n",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/configure",
            ),
            (
                " https://aio.example.com/stremio/U/P/manifest.json",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/U/P/configure",
            ),
            // A query and a fragment never reach the base, nor a configure
            // page that is not the address's own.
            (
                "https://aio.example.com/aio?token=1#top",
                "https://aio.example.com/aio/jellyfin",
                "https://aio.example.com/aio/stremio/configure",
            ),
            (
                "https://aio.example.com/aio/jellyfin?x=1",
                "https://aio.example.com/aio/jellyfin",
                "https://aio.example.com/aio/stremio/configure",
            ),
            (
                "https://aio.example.com/stremio/configure?x=1#y",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/configure",
            ),
            (
                "aio.example.com?x=1",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/configure",
            ),
            // A manifest URL's own configure page keeps its query, as it did.
            (
                "https://aio.example.com/stremio/U/P/manifest.json?x=1#top",
                "https://aio.example.com/jellyfin",
                "https://aio.example.com/stremio/U/P/configure?x=1",
            ),
        ];
        for (address, base, configure_url) in cases {
            assert_eq!(
                derive(address),
                Ok(Derived {
                    base: base.to_string(),
                    configure_url: configure_url.to_string(),
                }),
                "{address:?}"
            );
        }
    }

    #[test]
    fn an_address_that_is_not_plain_http_is_refused_without_a_word_of_it() {
        for bad in [
            "",
            "   ",
            "not a url",
            "https://",
            "http://",
            "://aio.example.com",
            "https://aio .example.com",
            "aio.example.com:99999",
            // Any scheme but http and https.
            "ftp://aio.example.com",
            "ws://aio.example.com/stremio/U/P/manifest.json",
            "file:///stremio/U/P/manifest.json",
            "file:/etc/passwd",
            "javascript:alert(1)",
            "data:text/html,x",
            "mailto:a@b.example",
            // A scheme that is not written as one: mpv's check, the same.
            "HTTPS:aio.example.com",
            // A login in the address, with or without the scheme.
            "https://user:pass@aio.example.com",
            "https://user@aio.example.com/stremio/U/P/manifest.json",
            "user:pass@aio.example.com",
            "user@aio.example.com",
        ] {
            let e = derive(bad).expect_err(&format!("took {bad:?}"));
            // The address can be a password (a manifest URL is), so no refusal
            // quotes any of it.
            assert!(!e.contains("example"), "{bad:?}: {e}");
            assert!(
                !e.contains("pass") || e.contains("password"),
                "{bad:?}: {e}"
            );
        }
    }

    #[test]
    fn signing_in_from_an_address_asks_the_jellyfin_mount_and_nothing_else() {
        run(async {
            // Each way of naming one instance, and where it is approved.
            let forms: [(&str, &str); 6] = [
                ("", "/stremio/configure"),
                ("/", "/stremio/configure"),
                ("/jellyfin", "/stremio/configure"),
                ("/stremio/configure", "/stremio/configure"),
                ("/stremio/U/P/configure", "/stremio/U/P/configure"),
                // Spaces round it, and a query on the manifest.
                (
                    "/stremio/U/P/manifest.json?x=1#f ",
                    "/stremio/U/P/configure?x=1",
                ),
            ];
            for (tail, configure) in forms {
                let fake = Arc::new(Fake::default());
                let base = serve(fake.clone()).await;
                let vault = Shared::default();
                let a = client(&vault);
                let started = a.start(&format!("  {base}{tail}")).await.unwrap();
                assert_eq!(
                    started.configure_url,
                    format!("{base}{configure}"),
                    "{tail}"
                );
                assert_eq!(started.code, "123456", "{tail}");
                let order: Vec<String> = fake
                    .seen()
                    .iter()
                    .map(|s| format!("{} {}", s.method, s.uri))
                    .collect();
                assert_eq!(
                    order,
                    vec![
                        "GET /jellyfin/System/Info/Public",
                        "POST /jellyfin/QuickConnect/Initiate"
                    ],
                    "{tail}"
                );
                // And it finishes as it always did, on that base.
                while a.poll().await.unwrap() == Poll::Pending {}
                assert_eq!(
                    vault.load().unwrap().base,
                    format!("{base}/jellyfin"),
                    "{tail}"
                );
            }
        })
    }

    #[test]
    fn a_refused_address_sends_nothing() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let a = client(&Shared::default());
            let port = base.rsplit(':').next().unwrap();
            for bad in [
                format!("ftp://127.0.0.1:{port}/stremio/U/P/manifest.json"),
                format!("http://user:pass@127.0.0.1:{port}"),
                "file:///etc/passwd".to_string(),
                String::new(),
            ] {
                let e = a.start(&bad).await.unwrap_err();
                assert!(!e.starts_with("unsupported:"), "{bad}: {e}");
            }
            assert!(fake.seen().is_empty());
            assert_eq!(a.poll().await.unwrap(), Poll::Error);
        })
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

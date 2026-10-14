//! Jellyfin, your own server (plan 027): sign-in by password or Quick
//! Connect, the session in the OS vault, and every call made from here, so
//! the token never reaches the page or localStorage, as Trakt's and MAL's
//! (trakt.rs, mal.rs) and AIOStreams' (aiojf.rs) never do.
//!
//! Beside aiojf.rs, not generalised from it (decision D4): AIOStreams'
//! guard and trap rules are security work tested line by line, and a real
//! Jellyfin needs a different allow list. Where a helper is the same it is
//! copied, with the reason it still applies.
//!
//! No Tauri in this file: lib.rs wraps it in commands, and the host crate
//! (scripts/mvproxy-host) includes it as it is and runs its tests against a
//! fake Jellyfin on Linux, where the app crate itself will not build.
//!
//! What a real server answered (Jellyfin 12.2.0, Adam's, 2026-10-14, by
//! scripts/jf-probe.mjs; plans/027-api-facts.md has the numbers), and this
//! follows:
//! - The token is read only from `Authorization: MediaBrowser ...,
//!   Token="..."` (or `?ApiKey=`). `X-Emby-Token`, `X-MediaBrowser-Token`,
//!   `?api_key=` and a legacy `X-Emby-Authorization` all answered 401.
//! - `/System/Info/Public` needs no sign-in. A server that is really an
//!   AIOStreams carries an `aiostreams` object there and is refused: it has
//!   its own client (aiojf.rs) and the trap rules that go with it.
//! - Password sign-in is `POST /Users/AuthenticateByName` with `{Username,
//!   Pw}`; a wrong one is 401. Quick Connect is `GET /QuickConnect/Enabled`,
//!   `POST /QuickConnect/Initiate`, `GET /QuickConnect/Connect?secret=`,
//!   then `POST /Users/AuthenticateWithQuickConnect` with `{Secret}` (400
//!   until approved); both end in `{User, SessionInfo, AccessToken,
//!   ServerId}`. Both were run live (round 2).
//! - `POST /Sessions/Logout` is 204 and revokes: the token is 401 after.
//! - The signed-in admin's token can do far more than the app asks (`DELETE
//!   /Items/{id}` deletes media), so `guard` is an allow list, and a
//!   `userId` in a query must be the session's own.
//! - A sign-in is checked by one `GET /UserViews`: the routes this app
//!   uses are the new ones (the old `/Users/{id}/...` forms are gone from
//!   the 12.2 spec), so a server without them is refused as too old rather
//!   than by a version number nobody here has checked.
//! - Item ids are 32 lower case hex.

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
    /// `http(s)://host[:port][/prefix]`, never a path past that.
    pub base: String,
    pub token: String,
    pub user_id: String,
    pub user_name: String,
    pub server_id: String,
    #[serde(default)]
    pub server_name: String,
    #[serde(default)]
    pub version: String,
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
    /// The 6 digits to approve, in Jellyfin's own web UI (user menu, Quick
    /// Connect) or any signed-in client.
    pub code: String,
    /// The server's name, so the page can say where.
    pub server_name: String,
}

/// One poll of the sign-in.
#[derive(Serialize, Debug, PartialEq, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum Poll {
    /// Signed in, and the session is kept.
    Approved,
    /// Not approved yet.
    Pending,
    /// The code ran out (the server no longer knows its secret).
    Expired,
    /// The sign-in cannot finish: nothing was started, the server refused
    /// the trade, its answer made no sense, it is too old, or the session
    /// could not be saved. Start again.
    Error,
}

/// Who is signed in, for the Settings row. No token.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub connected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_name: Option<String>,
    /// Jellyfin's id for the user: calls that take a `userId` take this one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

/// A Jellyfin answer, handed to the page as data: a 4xx is not an error
/// here, the page decides what a 404 means for what it asked. The session's
/// token is taken out of the body (`scrub`).
#[derive(Serialize, Debug)]
pub struct Reply {
    pub status: u16,
    pub body: String,
}

/// What a PlaybackInfo call found, trimmed to the fields the page reads
/// (`SOURCE_KEEPS`, `STREAM_KEEPS`): the server's own answer carries file
/// paths and may carry the token in a subtitle's `DeliveryUrl`. A 4xx is
/// data here too: `status` says it, with no sources, and `errorCode` is the
/// answer's own `ErrorCode` when it gave one.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sources {
    pub status: u16,
    pub sources: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub play_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

/// The check before a stream plays (`prepare_stream`).
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    /// The server will serve the stream to mpv, with the header if `needs_auth`.
    pub ok: bool,
    /// The stream is refused without the token and served with it, so mpv is
    /// given the token in a header for this file (`auth_header_for`).
    pub needs_auth: bool,
    /// What the last request answered.
    pub status: u16,
    /// The stream is only reached through a redirect to another server. mpv
    /// would send a header it is given to that server too (measured: mpv
    /// 0.37 carries `http-header-fields` across a redirect), so none is given
    /// and the stream is not played.
    pub off_origin: bool,
}

/// What `sign_in` and `quick_connect` fail with when the address is not a
/// Jellyfin this app can use. The page tells these apart by the prefix.
pub const NOT_JELLYFIN: &str = "unsupported: That address is not a Jellyfin server";
pub const IS_AIOSTREAMS: &str =
    "unsupported: That is an AIOStreams server, sign in to it under AIOStreams";
/// The start of the error for an address that sends you to another server
/// (the page matches the `redirected:` prefix and shows the rest as it is).
pub const REDIRECTED: &str = "redirected: That address sends you to";
pub const TOO_OLD: &str = "unsupported: This Jellyfin server is too old for BlammyTV";
pub const QUICK_CONNECT_OFF: &str = "unsupported: Quick Connect is turned off on this server";
pub const WRONG_LOGIN: &str = "denied: Wrong user name or password";

/// A credential blob holds at most this many bytes (credman.rs).
#[cfg(any(windows, test))]
const BLOB_MAX: usize = 2560;
/// The longest `Retry-After` a 429 is waited out for. Past it the 429 goes
/// back to the page, which can choose to try later.
const MAX_RETRY_WAIT: u64 = 15;
/// How long sign-out waits on the server. It is best effort.
const LOGOUT_WAIT: Duration = Duration::from_secs(5);
/// How long the check before a play waits on the server, for each of its two
/// requests.
const STREAM_WAIT: Duration = Duration::from_secs(8);

/// The keys a media source keeps on its way to the page. `Path` is not here
/// (a path on the server's disk, which nothing here can open), nor
/// `MediaStreams` as the server writes it (`trim_streams`).
const SOURCE_KEEPS: [&str; 14] = [
    "Id",
    "Name",
    "Container",
    "Size",
    "RunTimeTicks",
    "Bitrate",
    "ETag",
    "Protocol",
    "IsRemote",
    "VideoType",
    "SupportsDirectPlay",
    "SupportsDirectStream",
    "DefaultAudioStreamIndex",
    "DefaultSubtitleStreamIndex",
];
/// The keys a stream keeps. `DeliveryUrl` and `Path` are not here: a
/// subtitle's `DeliveryUrl` can carry the token.
const STREAM_KEEPS: [&str; 20] = [
    "Index",
    "Type",
    "Codec",
    "Language",
    "DisplayTitle",
    "Title",
    "IsDefault",
    "IsForced",
    "IsHearingImpaired",
    "IsExternal",
    "IsTextSubtitleStream",
    "SupportsExternalStream",
    "Channels",
    "ChannelLayout",
    "Width",
    "Height",
    "BitRate",
    "VideoRange",
    "BitDepth",
    "AverageFrameRate",
];

const JSON: &str = "application/json";
const BAD_ANSWER: &str = "The server sent an answer this app does not understand";
const NOT_A_PATH: &str = "refused: not a plain path";

/// Where the sign-in and the session are, behind one lock that is never held
/// across a request.
#[derive(Default)]
struct State {
    session: Option<Session>,
    attempt: Option<Attempt>,
    /// Bumped by every start, sign-in and disconnect, so a poll that was on
    /// the wire when one happened keeps nothing.
    epoch: u64,
    /// The token and server origin a stream was found to need the token for
    /// (`prepare_stream`). The header for mpv is made only while this is
    /// still the session's token, so a sign-out or another sign-in ends it
    /// without anything to clear.
    stream_auth: Option<(String, String)>,
}

/// A Quick Connect sign-in under way. The secret and the base stay here,
/// never returned.
#[derive(Clone)]
struct Attempt {
    base: String,
    secret: String,
    device_id: String,
    server: Server,
}

pub struct Jf {
    cfg: Config,
    http: reqwest::Client,
    vault: Box<dyn Vault>,
    state: Mutex<State>,
    /// One poll at a time, so two cannot both trade the one-use secret.
    polling: AsyncMutex<()>,
}

/// What `/System/Info/Public` says about the server.
#[derive(Clone, Debug, Default, PartialEq)]
struct Server {
    id: String,
    name: String,
    version: String,
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

/// A header value as it goes out. The server may read these percent-decoded
/// (aiojf.rs' AIOStreams does), and nothing here has checked a real
/// Jellyfin's rule, so no value holds a quote, a comma, a percent sign or
/// anything past ASCII graphic: the others become `_`. A computer's name is
/// the only free text.
fn plain_value(v: &str) -> String {
    v.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ' | '(' | ')') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// A token as Jellyfin gives them out, and as `header` can write it without
/// escaping: letters, digits and `-_.`, a sane length.
fn is_token(t: &str) -> bool {
    (8..=256).contains(&t.len())
        && t.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

/// `address` with a scheme. A bare host gets `http://` when it names a port,
/// is `localhost` or is an IP address (a server on the home network, which
/// rarely has a certificate), and `https://` otherwise (a name on the
/// internet, which should). Anything with a scheme is left for the http check
/// to accept or refuse.
fn with_scheme(address: &str) -> String {
    let head = address.find(['/', '?', '#']).unwrap_or(address.len());
    let host_port = &address[..head];
    let has_scheme = !host_port.starts_with('[')
        && host_port.find(':').is_some_and(|i| {
            let after = &host_port[i + 1..];
            after.is_empty() || !after.bytes().all(|b| b.is_ascii_digit())
        });
    if has_scheme {
        return address.to_string();
    }
    let (host, has_port) = match host_port.rsplit_once(':') {
        Some((h, p)) if !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()) => (h, true),
        _ => (host_port, false),
    };
    let bare = host.trim_matches(['[', ']']);
    let local = has_port
        || bare.eq_ignore_ascii_case("localhost")
        || bare.parse::<std::net::IpAddr>().is_ok();
    format!("{}://{address}", if local { "http" } else { "https" })
}

/// The server's address, from what the user typed or pasted: trimmed, any
/// scheme but http and https refused (as everything handed to mpv is,
/// mpvurl.rs), no user name or password in it, a query and a fragment
/// dropped, and a web client's own path (`/web/index.html`) cut off, so
/// pasting the address bar works. What is left is `origin` plus an optional
/// base path (Jellyfin can be served under one), with no closing slash.
fn derive(address: &str) -> Result<String, String> {
    let bad = || "That is not a server address".to_string();
    let address = with_scheme(address.trim());
    crate::mpvurl::http_only(&address).map_err(|_| bad())?;
    let url = reqwest::Url::parse(&address).map_err(|_| bad())?;
    if !url.host_str().is_some_and(|h| !h.is_empty()) {
        return Err(bad());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("The server address cannot carry a user name or password".into());
    }
    let mut path = url.path().to_string();
    if !path.ends_with('/') {
        path.push('/');
    }
    let lower = path.to_ascii_lowercase();
    let prefix = match lower.rfind("/web/") {
        Some(at) => &path[..at],
        None => path.trim_end_matches('/'),
    };
    Ok(format!("{}{prefix}", url.origin().ascii_serialization()))
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

/// An item id as Jellyfin gives them out: 32 lower case hex, and nothing
/// before or after.
fn is_item_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// The direct stream of an item on this server and nothing else: `base`'s
/// origin, no login in the address, `/Videos/{id}/stream`, and no credential
/// in the query. What `prepare_stream` will make a request for and
/// `auth_header_for` will give a header for, so neither can be pointed at
/// another host or another route with the token.
fn stream_target(base: &str, url: &str) -> Result<reqwest::Url, String> {
    let refused = |why: &str| Err(format!("refused: {why}"));
    let (Ok(base), Ok(u)) = (reqwest::Url::parse(base), reqwest::Url::parse(url)) else {
        return refused("not a stream of this server");
    };
    if u.origin() != base.origin() || !u.username().is_empty() || u.password().is_some() {
        return refused("not a stream of this server");
    }
    let Some(segs) = u.path_segments().map(|s| s.collect::<Vec<_>>()) else {
        return refused("not a stream of this server");
    };
    // A server under a path (`https://host/jellyfin`) keeps it in front.
    let prefix: Vec<&str> = base.path().trim_matches('/').split('/').filter(|p| !p.is_empty()).collect();
    let rest = segs.strip_prefix(prefix.as_slice()).unwrap_or(&[]);
    match rest {
        ["Videos", id, "stream"] if is_item_id(id) => {}
        _ => return refused("not a stream of this server"),
    }
    for (k, _) in u.query_pairs() {
        let key = k.to_ascii_lowercase().replace(['_', '-'], "");
        if matches!(key.as_str(), "apikey" | "token" | "accesstoken") {
            return refused("a credential in the address");
        }
    }
    Ok(u)
}

/// The header mpv is given for a file that needs the token: the one form the
/// server was seen to take (`Authorization: MediaBrowser Token="..."`, 200
/// with the same bytes as any other), with no commas in it, because mpv reads
/// `http-header-fields` as a list split at commas. `None` for a token that
/// is not the shape Jellyfin gives out.
fn stream_header(token: &str) -> Option<String> {
    is_token(token).then(|| format!("Authorization: MediaBrowser Token=\"{token}\""))
}

/// Whether the app makes this call: the method and the path both. `path` is
/// plain (`plain_path`), and a segment is matched exactly: a different case,
/// a trailing slash, a prefix or a longer path is not on the list. `{id}` is
/// `is_item_id`. What is NOT here, on purpose: everything under `/Users`,
/// `/System`, `/Sessions` but the three play reports, `/Auth`, `/Library`,
/// `/Items/{id}` with any verb but GET (DELETE removes the media),
/// `/Sessions/Logout` (that is `disconnect`'s) and `/Items/{id}/PlaybackInfo`
/// (that is `sources`'s).
fn on_the_list(method: &str, path: &str) -> bool {
    let segs: Vec<&str> = path.strip_prefix('/').unwrap_or("").split('/').collect();
    match (method, segs.as_slice()) {
        (
            "GET",
            ["UserViews"]
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
        (
            "GET",
            ["Items", id]
            | ["MediaSegments", id]
            | ["Shows", id, "Seasons"]
            | ["Shows", id, "Episodes"]
            | ["UserItems", id, "UserData"],
        )
        | (
            "POST",
            ["UserPlayedItems", id] | ["UserItems", id, "UserData"],
        )
        | ("DELETE", ["UserPlayedItems", id]) => is_item_id(id),
        _ => false,
    }
}

/// Ok when the app makes this call and its query holds nothing that changes
/// whose data it is or how it is signed. `method` is upper case. Refuses,
/// with nothing sent:
/// - a path that is not plain (`plain_path`);
/// - any method and path `on_the_list` does not name;
/// - a query key that carries a credential (`ApiKey`, `api_key`, `token`),
///   in any case: the token goes in the header, here, and nowhere else;
/// - a `userId` that is not the session's own: the signed-in user may be an
///   administrator, and another user's watch state is not the page's to read.
fn guard(
    method: &str,
    path: &str,
    query: &HashMap<String, String>,
    user_id: &str,
) -> Result<(), String> {
    plain_path(path)?;
    let refused = |why: &str| Err(format!("refused: {why}"));
    if !on_the_list(method, path) {
        return refused("not a call this app makes");
    }
    for (k, v) in query {
        let key = k.to_ascii_lowercase().replace(['_', '-'], "");
        if matches!(key.as_str(), "apikey" | "token" | "accesstoken") {
            return refused("a credential in the query");
        }
        if key == "userid" && !same_id(v, user_id) {
            return refused("not the signed-in user");
        }
    }
    Ok(())
}

/// Two Jellyfin ids as the same one, with or without dashes, in any case.
fn same_id(a: &str, b: &str) -> bool {
    let n = |s: &str| s.replace('-', "").to_ascii_lowercase();
    !a.is_empty() && n(a) == n(b)
}

/// `encodeURIComponent`: the letters, digits and `-_.!~*'()` as they are,
/// every other byte of the UTF-8 as `%` and two upper case hex digits.
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

/// `body` with the token taken out, as it is and as `uri_component` writes
/// it, each replaced by nothing. Until neither is left: taking one out can
/// join what was either side of it into another. A body without the token
/// comes back as it was.
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

fn keep_keys(
    from: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> serde_json::Map<String, serde_json::Value> {
    keys.iter()
        .filter_map(|k| from.get(*k).map(|v| (k.to_string(), v.clone())))
        .collect()
}

/// A PlaybackInfo answer, cut down to `SOURCE_KEEPS` per source, `STREAM_KEEPS`
/// per stream, the `PlaySessionId` and the `ErrorCode`. What is not listed is
/// dropped, so a field the server adds later is not carried either. A 2xx
/// that is not a JSON object is an error; any other status is data, with no
/// sources.
fn trim_sources(reply: Reply) -> Result<Sources, String> {
    let status = reply.status;
    let answer = match serde_json::from_str::<serde_json::Value>(&reply.body) {
        Ok(serde_json::Value::Object(o)) => o,
        _ if !(200..300).contains(&status) => {
            return Ok(Sources {
                status,
                sources: Vec::new(),
                play_session_id: None,
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
                    let mut kept = keep_keys(s, &SOURCE_KEEPS);
                    let streams = s
                        .get("MediaStreams")
                        .and_then(|m| m.as_array())
                        .map(|l| {
                            l.iter()
                                .filter_map(|x| x.as_object())
                                .map(|x| serde_json::Value::Object(keep_keys(x, &STREAM_KEEPS)))
                                .collect()
                        })
                        .unwrap_or_default();
                    kept.insert("MediaStreams".into(), serde_json::Value::Array(streams));
                    serde_json::Value::Object(kept)
                })
                .collect()
        })
        .unwrap_or_default();
    let text = |k: &str| {
        answer
            .get(k)
            .and_then(|c| c.as_str())
            .map(str::to_string)
    };
    Ok(Sources {
        status,
        sources,
        play_session_id: text("PlaySessionId"),
        error_code: text("ErrorCode"),
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

impl Jf {
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
            plain_value(device),
            plain_value(device_id),
            plain_value(&self.cfg.app_version)
        );
        if let Some(t) = token {
            h.push_str(&format!(", Token=\"{t}\""));
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
                server_name: Some(s.server_name.clone()),
                version: Some(s.version.clone()),
            },
            None => Status {
                connected: false,
                user_name: None,
                user_id: None,
                base: None,
                server_name: None,
                version: None,
            },
        }
    }

    /// A call before sign-in: the identity, no token.
    fn anonymous(&self, req: reqwest::RequestBuilder, device_id: &str) -> reqwest::RequestBuilder {
        req.header(reqwest::header::AUTHORIZATION, self.header(device_id, None))
            .header(reqwest::header::ACCEPT, JSON)
    }

    /// Ask the address what it is: a Jellyfin server this app can use.
    async fn probe(&self, base: &str, device_id: &str) -> Result<Server, String> {
        let res = self
            .anonymous(
                self.http.get(format!("{base}/System/Info/Public")),
                device_id,
            )
            .send()
            .await
            .map_err(describe)?;
        // The client follows a redirect, which is right for a read and wrong
        // for what comes next: a sign-in POST sent to the address typed would be
        // turned into a GET by the same redirect (a proxy that sends http to
        // https), and the user would get a failure with no reason. Say where it
        // went instead. The origin only: a path can carry a login.
        let landed = res.url().origin().ascii_serialization();
        if let Ok(typed) = reqwest::Url::parse(base) {
            if landed != typed.origin().ascii_serialization() {
                return Err(format!("{REDIRECTED} {landed}. Use that address instead."));
            }
        }
        let status = res.status().as_u16();
        let body = res.text().await.map_err(describe)?;
        if status == 404 {
            return Err(NOT_JELLYFIN.into());
        }
        if status != 200 {
            return Err(format!("HTTP {status}"));
        }
        let info: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
        if info["aiostreams"].is_object() {
            return Err(IS_AIOSTREAMS.into());
        }
        let text = |k: &str| info[k].as_str().unwrap_or_default().to_string();
        let server = Server {
            id: text("Id"),
            name: text("ServerName"),
            version: text("Version"),
        };
        if server.id.is_empty() || server.version.is_empty() {
            return Err(NOT_JELLYFIN.into());
        }
        Ok(server)
    }

    /// Sign in with a user name and password. The password goes to the
    /// server and nowhere else: it is not kept, logged or returned.
    pub async fn sign_in(
        &self,
        address: &str,
        user: &str,
        password: &str,
    ) -> Result<Status, String> {
        let base = derive(address)?;
        let device_id = random_hex(16)?;
        let epoch = {
            let mut st = self.state.lock().unwrap();
            st.epoch += 1;
            st.attempt = None;
            st.epoch
        };
        let server = self.probe(&base, &device_id).await?;
        let res = self
            .anonymous(
                self.http
                    .post(format!("{base}/Users/AuthenticateByName"))
                    .header(reqwest::header::CONTENT_TYPE, JSON)
                    .body(serde_json::json!({ "Username": user, "Pw": password }).to_string()),
                &device_id,
            )
            .send()
            .await
            .map_err(describe)?;
        let status = res.status().as_u16();
        let body = res.text().await.map_err(describe)?;
        match status {
            200 => {}
            401 => return Err(WRONG_LOGIN.into()),
            429 => return Err("The server is limiting sign-ins, try again in a minute".into()),
            s => return Err(format!("HTTP {s}")),
        }
        let auth: Authenticated =
            serde_json::from_str(&body).map_err(|_| BAD_ANSWER.to_string())?;
        let session = self.complete(&base, &device_id, &server, auth).await?;
        self.keep(epoch, session)
            .map_err(|_| "The sign-in could not be finished".to_string())?;
        Ok(self.status())
    }

    /// Start signing in with Quick Connect: check the address, ask for a code,
    /// and keep its secret here. The page gets the code to show.
    pub async fn quick_connect(&self, address: &str) -> Result<Started, String> {
        let base = derive(address)?;
        let device_id = random_hex(16)?;
        let server = self.probe(&base, &device_id).await?;
        let res = self
            .anonymous(
                self.http.get(format!("{base}/QuickConnect/Enabled")),
                &device_id,
            )
            .send()
            .await
            .map_err(describe)?;
        let status = res.status().as_u16();
        let body = res.text().await.map_err(describe)?;
        if status != 200 {
            return Err(format!("HTTP {status}"));
        }
        if !matches!(serde_json::from_str::<bool>(body.trim()), Ok(true)) {
            return Err(QUICK_CONNECT_OFF.into());
        }
        let res = self
            .anonymous(
                self.http.post(format!("{base}/QuickConnect/Initiate")),
                &device_id,
            )
            .send()
            .await
            .map_err(describe)?;
        let status = res.status().as_u16();
        let body = res.text().await.map_err(describe)?;
        match status {
            200 => {}
            // The route answers 401 when Quick Connect is off.
            401 => return Err(QUICK_CONNECT_OFF.into()),
            429 => return Err("The server is limiting sign-ins, try again in a minute".into()),
            s => return Err(format!("HTTP {s}")),
        }
        let init: Initiated = serde_json::from_str(&body).map_err(|_| BAD_ANSWER.to_string())?;
        if init.code.is_empty() || init.secret.is_empty() {
            return Err(BAD_ANSWER.into());
        }
        let started = Started {
            code: init.code,
            server_name: server.name.clone(),
        };
        let mut st = self.state.lock().unwrap();
        st.epoch += 1;
        st.attempt = Some(Attempt {
            base,
            secret: init.secret,
            device_id,
            server,
        });
        Ok(started)
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
            // The server has forgotten this secret: it ran out.
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
            429 => return Ok(Poll::Pending),
            s => {
                log::warn!("[jf] the sign-in was refused: HTTP {s}");
                return Ok(self.end(epoch, Poll::Error));
            }
        }
        let Ok(auth) = serde_json::from_str::<Authenticated>(&body) else {
            log::warn!("[jf] the sign-in answer made no sense");
            return Ok(self.end(epoch, Poll::Error));
        };
        let session = match self
            .complete(&a.base, &a.device_id, &a.server, auth)
            .await
        {
            Ok(s) => s,
            Err(e) => {
                log::warn!("[jf] the sign-in could not be completed: {e}");
                return Ok(self.end(epoch, Poll::Error));
            }
        };
        Ok(match self.keep(epoch, session) {
            Ok(()) => Poll::Approved,
            Err(_) => Poll::Error,
        })
    }

    /// A sign-in's last check, shared by both ways in: the token is one this
    /// app can write into a header, and the server answers `/UserViews`, the
    /// route everything after relies on. A server that does not is too old,
    /// and the token it just made is revoked rather than left behind.
    async fn complete(
        &self,
        base: &str,
        device_id: &str,
        server: &Server,
        auth: Authenticated,
    ) -> Result<Session, String> {
        if !is_token(&auth.access_token) || auth.user.id.is_empty() {
            return Err(BAD_ANSWER.into());
        }
        let session = Session {
            base: base.to_string(),
            token: auth.access_token,
            user_id: auth.user.id,
            user_name: auth.user.name,
            server_id: if auth.server_id.is_empty() {
                server.id.clone()
            } else {
                auth.server_id
            },
            server_name: server.name.clone(),
            version: server.version.clone(),
            device_id: device_id.to_string(),
        };
        let (reply, _) = self
            .send(
                &session,
                &reqwest::Method::GET,
                "/UserViews",
                &HashMap::new(),
                None,
                None,
            )
            .await?;
        if !(200..300).contains(&reply.status) {
            self.revoke(&session).await;
            return Err(TOO_OLD.into());
        }
        Ok(session)
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
    /// ended meanwhile (a disconnect, or another start). Under the state
    /// lock, so a disconnect is either before (and this keeps nothing) or
    /// after (and clears it). A session that cannot be written is not kept:
    /// it would be gone at the next launch with nothing said.
    fn keep(&self, epoch: u64, session: Session) -> Result<(), String> {
        let mut st = self.state.lock().unwrap();
        if st.epoch != epoch {
            return Err("cancelled".into());
        }
        st.attempt = None;
        match self.vault.save(&session) {
            Ok(()) => {
                st.session = Some(session);
                Ok(())
            }
            Err(e) => {
                log::error!("[jf] could not save the session: {e}");
                Err(e)
            }
        }
    }

    /// A call to the server's API by path (`/UserItems/Resume`), with the
    /// session's token added here. `query` is the query string, so that what
    /// `guard` reads is what goes out. `body` is sent as JSON, and a `null`
    /// is no body. Only the calls `guard` lists are made, and any other is
    /// refused with nothing sent. The answer comes back as data, a 4xx
    /// included, with the token taken out of it, but a 401 also ends the
    /// session.
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
        let user_id = self.session()?.user_id;
        guard(&method, path, &query, &user_id)?;
        let body = body.filter(|b| !b.is_null()).map(|b| b.to_string());
        self.call(&verb, path, &query, body.as_deref()).await
    }

    /// The media sources of one item (`/Items/{id}/PlaybackInfo`), the call
    /// `request` never makes, with the answer cut down to what the page
    /// reads (`trim_sources`). `item_id` is 32 lower case hex, and anything
    /// else is refused before a request. The body is the direct-play profile
    /// the probe sent (plans/027-api-facts.md).
    pub async fn sources(&self, item_id: &str) -> Result<Sources, String> {
        if !is_item_id(item_id) {
            return Err("refused: not an item id".into());
        }
        let user_id = self.session()?.user_id;
        let body = serde_json::json!({
            "UserId": user_id,
            "DeviceProfile": {
                "Name": "BlammyTV",
                "MaxStreamingBitrate": 120_000_000,
                "DirectPlayProfiles": [{ "Type": "Video" }, { "Type": "Audio" }],
                "TranscodingProfiles": [],
                "SubtitleProfiles": [
                    { "Format": "srt", "Method": "External" },
                    { "Format": "ass", "Method": "External" },
                ],
            },
        });
        let reply = self
            .call(
                &reqwest::Method::POST,
                &format!("/Items/{item_id}/PlaybackInfo"),
                &HashMap::new(),
                Some(&body.to_string()),
            )
            .await?;
        trim_sources(reply)
    }

    /// One request for the first byte of a stream, with the header mpv would
    /// send or none. Redirects are followed, as mpv follows them: the answer
    /// says where it ended. A client drops `Authorization` when a redirect
    /// leaves the host, so this never hands the token to another server.
    async fn probe_stream(
        &self,
        url: &reqwest::Url,
        token: Option<&str>,
    ) -> Result<(u16, bool), String> {
        let mut req = self
            .http
            .get(url.clone())
            .header(reqwest::header::RANGE, "bytes=0-0")
            .timeout(STREAM_WAIT);
        if let Some(t) = token {
            req = req.header(reqwest::header::AUTHORIZATION, format!("MediaBrowser Token=\"{t}\""));
        }
        let res = req.send().await.map_err(describe)?;
        let stayed = res.url().origin() == url.origin();
        Ok((res.status().as_u16(), stayed))
    }

    /// The check before a Jellyfin stream is handed to mpv: does the server
    /// serve it as it is, or only with the token? Jellyfin 12.2 serves a
    /// direct stream to anyone (plans/027-api-facts.md #2), so the first
    /// request carries no token and, when it answers, the token never leaves
    /// this file. A server that refuses it (401, 403) is asked again with the
    /// token, as mpv will ask; when that works the token is marked for this
    /// stream's server (`auth_header_for`) and `needs_auth` says so. When it
    /// works only through a redirect to another host the header would follow
    /// mpv there, so `off_origin` is set and nothing is marked.
    ///
    /// Rejects with `refused: ...` for anything but a direct stream of the
    /// signed-in server (`stream_target`), and when not signed in.
    pub async fn prepare_stream(&self, url: &str) -> Result<Prepared, String> {
        let s = self.session()?;
        let target = stream_target(&s.base, url)?;
        let no = |status: u16, off_origin: bool| Prepared {
            ok: false,
            needs_auth: false,
            status,
            off_origin,
        };
        let (first, _) = self.probe_stream(&target, None).await?;
        if (200..300).contains(&first) {
            self.stream_auth(&s.token, None);
            return Ok(Prepared {
                ok: true,
                needs_auth: false,
                status: first,
                off_origin: false,
            });
        }
        if first != 401 && first != 403 {
            self.stream_auth(&s.token, None);
            return Ok(no(first, false));
        }
        let (second, stayed) = self.probe_stream(&target, Some(&s.token)).await?;
        if !(200..300).contains(&second) {
            self.stream_auth(&s.token, None);
            return Ok(no(second, false));
        }
        if !stayed {
            self.stream_auth(&s.token, None);
            return Ok(no(second, true));
        }
        self.stream_auth(&s.token, Some(target.origin().ascii_serialization()));
        Ok(Prepared {
            ok: true,
            needs_auth: true,
            status: second,
            off_origin: false,
        })
    }

    /// Mark (or clear) the origin the stream check found to need the token.
    /// Only if `token` is still the session's.
    fn stream_auth(&self, token: &str, origin: Option<String>) {
        let mut st = self.state.lock().unwrap();
        if st.session.as_ref().is_some_and(|s| s.token == token) {
            st.stream_auth = origin.map(|o| (o, token.to_string()));
        }
    }

    /// The header line mpv is given for `url`, or None. Some only when the
    /// stream check found this server to need it, for a direct stream of the
    /// signed-in server, with the session's own token, and the page has no
    /// say in it. Not async: it is read as a file is loaded.
    pub fn auth_header_for(&self, url: &str) -> Option<String> {
        let st = self.state.lock().unwrap();
        let session = st.session.as_ref()?;
        let (origin, token) = st.stream_auth.as_ref()?;
        if token != &session.token {
            return None;
        }
        let target = stream_target(&session.base, url).ok()?;
        if &target.origin().ascii_serialization() != origin {
            return None;
        }
        stream_header(token)
    }

    fn session(&self) -> Result<Session, String> {
        self.state
            .lock()
            .unwrap()
            .session
            .clone()
            .ok_or_else(|| "not signed in to Jellyfin".to_string())
    }

    /// One call with the session's token, past the guard: a 429 waited out
    /// once, a 401 ending the session. Every reply leaves here with the
    /// token taken out of its body (`scrub`), so no caller, and no route
    /// added later, can hand it back.
    async fn call(
        &self,
        verb: &reqwest::Method,
        path: &str,
        query: &HashMap<String, String>,
        body: Option<&str>,
    ) -> Result<Reply, String> {
        let session = self.session()?;
        let (mut reply, retry) = self.send(&session, verb, path, query, body, None).await?;
        // Rate limited: wait out what the server asks, once.
        if reply.status == 429 {
            if let Some(secs) = retry.filter(|s| *s <= MAX_RETRY_WAIT) {
                tokio::time::sleep(Duration::from_secs(secs)).await;
                reply = self.send(&session, verb, path, query, body, None).await?.0;
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

    /// The server refused `used`: it was revoked, the password changed, or
    /// the user went. Sign out here, unless a newer session has taken its
    /// place.
    fn drop_session(&self, used: &str) {
        let mut st = self.state.lock().unwrap();
        if st.session.as_ref().is_some_and(|s| s.token == used) {
            st.session = None;
            self.vault.clear();
        }
    }

    /// Ask the server to end `s`'s token. True when it said it did.
    async fn revoke(&self, s: &Session) -> bool {
        let sent = self
            .http
            .post(format!("{}/Sessions/Logout", s.base))
            .header(
                reqwest::header::AUTHORIZATION,
                self.header(&s.device_id, Some(&s.token)),
            )
            .timeout(LOGOUT_WAIT)
            .send()
            .await;
        match sent {
            Ok(r) => r.status().is_success(),
            Err(e) => {
                log::warn!(
                    "[jf] could not revoke the token on {}: {}",
                    crate::mvproxy::origin_of(&s.base),
                    describe(e)
                );
                false
            }
        }
    }

    /// Sign out: forget the session here whatever the server says, and
    /// revoke the token there (`POST /Sessions/Logout`, which on a real
    /// server ends it). Returns whether the server confirmed, so the page
    /// can say when it could not be reached and the token still stands.
    pub async fn disconnect(&self) -> bool {
        let session = {
            let mut st = self.state.lock().unwrap();
            st.epoch += 1;
            st.attempt = None;
            st.session.take()
        };
        self.vault.clear();
        match session {
            Some(s) => self.revoke(&s).await,
            None => true,
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
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    /// No tokio `macros` feature in the app's tree: a runtime by hand, as
    /// trakt.rs's and aiojf.rs's tests do.
    fn run<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(f)
    }

    /// What the fake's `/System/Info/Public` says.
    #[derive(Default)]
    enum Info {
        /// A Jellyfin 12.2, as Adam's answered.
        #[default]
        Jellyfin,
        /// An AIOStreams: the same, plus an `aiostreams` object.
        Aio,
        /// Something else on a 200.
        Html,
        /// A 200 JSON object with no `Version`.
        NoVersion,
        /// This status, with an empty JSON body.
        Status(u16),
        /// A redirect to this address.
        Redirect(String),
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
        /// Path and query, as sent, with the fake's own prefix still on.
        uri: String,
        auth: Option<String>,
        body: String,
    }

    /// The token the fake hands out (32 hex, as Jellyfin's are) and the user.
    const TOKEN1: &str = "7f3a9c01d2e44b6f8a15c0e9b2d34a67";
    const USER: &str = "d41f6b82a3c94e57b0e8c9a7f2d63b15";
    const PASSWORD: &str = "hunter2-correct";
    /// An item, and another.
    const ITEM: &str = "7acf01459a4fb0ba75583ff9c88ca080";
    const ITEM2: &str = "af5d938797ad50779e33385b7e567a0c";

    /// A fake Jellyfin 12.2: the public info, both sign-ins, Logout (which
    /// revokes), `/UserViews` and a few API routes (PlaybackInfo among
    /// them), recording what it was asked. Shapes are the real server's
    /// (plans/027-api-facts.md); the Quick Connect bodies are the spec's.
    #[derive(Default)]
    struct Fake {
        /// The token the sign-ins hand out, when not TOKEN1.
        token: Option<&'static str>,
        /// A path prefix the server is served under.
        prefix: &'static str,
        /// What `GET /Items/<id>` answers, when set: a raw body, as sent.
        item_body: Option<String>,
        /// `/Items` answers 401, as for a token the server no longer knows.
        dead: bool,
        info: Info,
        /// What Enabled answers (true when unset).
        qc_enabled: Option<bool>,
        /// Initiate answers this instead of 200, when set.
        initiate_status: Option<u16>,
        /// Connect answers `Authenticated: false` this many times first.
        pending_for: usize,
        /// Connect answers this instead of 200, when set (404: expired).
        connect_status: Option<u16>,
        /// The Quick Connect trade answers this instead of 200, when set.
        auth_status: Option<u16>,
        /// `/UserViews` answers this instead of 200, when set (404: too old).
        views_status: Option<u16>,
        /// Logout answers this instead of 204, when set.
        logout_status: Option<u16>,
        /// A request to this path waits for a permit from `gate` first.
        hold: Option<&'static str>,
        gate: Gate,
        connects: AtomicUsize,
        auths: AtomicUsize,
        logouts: AtomicUsize,
        /// Logout revokes: the token is 401 after it.
        revoked: AtomicBool,
        /// `/Items` answers 429 this many times, then 200.
        limit_for: AtomicUsize,
        /// The `Retry-After` of those 429s, when set.
        retry_after: Option<&'static str>,
        /// What PlaybackInfo answers, when set: `playback()` otherwise.
        playback: Option<serde_json::Value>,
        /// The status it answers with, when set (200 otherwise).
        playback_status: Option<u16>,
        /// A raw body for PlaybackInfo, when set.
        playback_raw: Option<&'static str>,
        /// How `/Videos/{id}/stream` answers.
        stream: Stream,
        seen: Mutex<Vec<Seen>>,
    }

    /// How the fake serves a direct stream.
    #[derive(Default, Clone)]
    enum Stream {
        /// To anyone, as 12.2 does (plans/027-api-facts.md #2).
        #[default]
        Open,
        /// Only to a request with the token, 401 otherwise.
        NeedsToken,
        /// 403 to a request with no token, 401 to a wrong one.
        Forbidden,
        /// A redirect to this address, whoever asks.
        Redirect(String),
        /// 401 without the token, a redirect to this address with it.
        RedirectWithToken(String),
        /// This status, whoever asks.
        Status(u16),
    }

    impl Fake {
        fn token(&self) -> &'static str {
            self.token.unwrap_or(TOKEN1)
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
        fn last(&self, needle: &str) -> Seen {
            self.seen()
                .into_iter()
                .rev()
                .find(|s| s.uri.contains(needle))
                .unwrap_or_else(|| panic!("no request to {needle}"))
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

    /// The answer Jellyfin 12.2.0 gave for `/System/Info/Public`.
    fn public_info() -> serde_json::Value {
        serde_json::json!({
            "LocalAddress": "http://127.0.0.1:8096", "ServerName": "TESTSRV",
            "Version": "12.2.0", "ProductName": "Jellyfin Server", "OperatingSystem": "",
            "Id": "5e7a1c0f9b3d4a68b2c4d6e8f0a1b3c5", "StartupWizardCompleted": true,
        })
    }

    /// The shape of the answer to both sign-ins (user trimmed to what is read).
    fn auth_result(token: &str) -> serde_json::Value {
        serde_json::json!({
            "User": {
                "Name": "testuser", "ServerId": "5e7a1c0f9b3d4a68b2c4d6e8f0a1b3c5", "Id": USER,
                "HasPassword": true, "Policy": { "IsAdministrator": true },
            },
            "SessionInfo": { "Id": "65da22305da20a9052fd528744ee445c", "UserId": USER },
            "AccessToken": token,
            "ServerId": "5e7a1c0f9b3d4a68b2c4d6e8f0a1b3c5",
        })
    }

    /// A PlaybackInfo answer as Jellyfin 12.2 gave it (the Severance clip),
    /// plus what a real library can carry that the test clips did not: the
    /// file's path, an external subtitle whose `DeliveryUrl` holds the token,
    /// and fields this app never reads.
    fn playback() -> serde_json::Value {
        serde_json::json!({
            "MediaSources": [{
                "Protocol": "File", "Id": ITEM,
                "Path": "C:\\jf-test\\shows\\Severance (2022)\\Season 01\\Severance S01E01.mkv",
                "Type": "Default", "Container": "mkv", "Size": 558231, "Name": "Severance S01E01",
                "IsRemote": false, "ETag": "ef3dd306a6c798e2a3d7ec119830eeb4",
                "RunTimeTicks": 300230000u64, "SupportsTranscoding": false,
                "SupportsDirectStream": true, "SupportsDirectPlay": true, "VideoType": "VideoFile",
                "MediaStreams": [
                    {
                        "Codec": "h264", "TimeBase": "1/1000", "VideoRange": "SDR",
                        "DisplayTitle": "720p H264 SDR", "BitDepth": 8, "Height": 720,
                        "Width": 1280, "AverageFrameRate": 24, "Profile": "High 4:4:4 Predictive",
                        "Type": "Video", "Index": 0, "IsExternal": false,
                        "IsTextSubtitleStream": false, "SupportsExternalStream": false,
                    },
                    {
                        "Codec": "aac", "DisplayTitle": "AAC - Mono", "ChannelLayout": "mono",
                        "BitRate": 192000, "Channels": 1, "SampleRate": 44100, "Language": "eng",
                        "IsDefault": true, "Type": "Audio", "Index": 1, "IsExternal": false,
                    },
                    {
                        "Codec": "subrip", "Language": "eng", "Type": "Subtitle", "Index": 2,
                        "IsExternal": true, "IsTextSubtitleStream": true,
                        "SupportsExternalStream": true,
                        "Path": "C:\\jf-test\\shows\\Severance S01E01.en.srt",
                        "DeliveryUrl": format!(
                            "/Videos/{ITEM}/{ITEM}/Subtitles/2/0/Stream.srt?ApiKey={TOKEN1}"
                        ),
                    },
                ],
                "MediaAttachments": [], "Formats": [], "Bitrate": 148747,
                "RequiredHttpHeaders": {}, "DefaultAudioStreamIndex": 1,
            }],
            "PlaySessionId": "55f9c72ae099462ba18881830ddb8b0e",
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
            .header("content-type", "application/json; charset=utf-8")
            .body(Full::new(Bytes::from(body.to_string())))
            .unwrap()
    }

    /// A 401 as Jellyfin 12.2 answers a refused token: empty.
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
            body: body.clone(),
        });
        let Some(p) = path.strip_prefix(fake.prefix) else {
            return empty(404);
        };
        if fake.hold == Some(p) {
            fake.gate.acquire().await.unwrap().forget();
        }
        match (method.as_str(), p) {
            ("GET", "/System/Info/Public") => match &fake.info {
                Info::Jellyfin => json(200, public_info()),
                Info::Aio => {
                    let mut i = public_info();
                    i["aiostreams"] = serde_json::json!({ "features": { "configSignIn": 1 } });
                    json(200, i)
                }
                Info::NoVersion => json(200, serde_json::json!({ "ProductName": "Jellyfin Server" })),
                Info::Html => Response::builder()
                    .status(200)
                    .header("content-type", "text/html")
                    .body(Full::new(Bytes::from("<!doctype html>")))
                    .unwrap(),
                Info::Status(s) => json(*s, serde_json::Value::Null),
                Info::Redirect(to) => Response::builder()
                    .status(301)
                    .header("location", to.as_str())
                    .body(Full::new(Bytes::new()))
                    .unwrap(),
            },
            ("POST", "/Users/AuthenticateByName") => {
                let b: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
                if b["Username"] == "testuser" && b["Pw"] == PASSWORD {
                    json(200, auth_result(fake.token()))
                } else {
                    Response::builder()
                        .status(401)
                        .header("content-type", "text/plain")
                        .body(Full::new(Bytes::from("Error processing request.")))
                        .unwrap()
                }
            }
            ("GET", "/QuickConnect/Enabled") => {
                json(200, serde_json::json!(fake.qc_enabled.unwrap_or(true)))
            }
            ("POST", "/QuickConnect/Initiate") => {
                if let Some(s) = fake.initiate_status {
                    return empty(s);
                }
                json(
                    200,
                    serde_json::json!({
                        "Authenticated": false, "Secret": "SECRET-abc_123", "Code": "123456",
                        "DeviceId": "x", "DeviceName": "PC", "AppName": "BlammyTV",
                        "AppVersion": "9.9.9", "DateAdded": "2026-10-14T17:00:00Z",
                    }),
                )
            }
            ("GET", "/QuickConnect/Connect") => {
                let n = fake.connects.fetch_add(1, Ordering::SeqCst);
                if let Some(s) = fake.connect_status {
                    return empty(s);
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
                    return empty(s);
                }
                json(200, auth_result(fake.token()))
            }
            ("POST", "/Sessions/Logout") => {
                fake.logouts.fetch_add(1, Ordering::SeqCst);
                if let Some(s) = fake.logout_status {
                    return empty(s);
                }
                // Revokes, as 12.2's did: the same token is 401 after.
                if auth
                    .as_deref()
                    .unwrap_or("")
                    .contains(&format!("Token=\"{}\"", fake.token()))
                {
                    fake.revoked.store(true, Ordering::SeqCst);
                }
                empty(204)
            }
            ("GET", p) if p.starts_with("/Videos/") && p.ends_with("/stream") => {
                let has = auth
                    .as_deref()
                    .unwrap_or("")
                    .contains(&format!("Token=\"{}\"", fake.token()));
                let ok = Response::builder()
                    .status(206)
                    .header("content-type", "video/x-matroska")
                    .header("content-range", "bytes 0-0/558231")
                    .body(Full::new(Bytes::from_static(&[0x1a])))
                    .unwrap();
                match &fake.stream {
                    Stream::Open => ok,
                    Stream::NeedsToken if has => ok,
                    Stream::NeedsToken => empty(401),
                    Stream::Forbidden if has => ok,
                    Stream::Forbidden if auth.is_none() => empty(403),
                    Stream::Forbidden => empty(401),
                    Stream::Redirect(to) => Response::builder()
                        .status(302)
                        .header("location", to.as_str())
                        .body(Full::new(Bytes::new()))
                        .unwrap(),
                    Stream::RedirectWithToken(_) if !has => empty(401),
                    Stream::RedirectWithToken(to) => Response::builder()
                        .status(302)
                        .header("location", to.as_str())
                        .body(Full::new(Bytes::new()))
                        .unwrap(),
                    Stream::Status(s) => empty(*s),
                }
            }
            _ => {
                let want = format!("Token=\"{}\"", fake.token());
                if fake.revoked.load(Ordering::SeqCst)
                    || !auth.as_deref().unwrap_or("").contains(&want)
                {
                    return empty(401);
                }
                match p {
                    "/UserViews" => match fake.views_status {
                        Some(s) => empty(s),
                        None => json(200, serde_json::json!({ "Items": [], "TotalRecordCount": 0 })),
                    },
                    "/Items" if fake.dead => empty(401),
                    "/Items" => fake
                        .limited()
                        .unwrap_or_else(|| json(200, serde_json::json!({ "Items": [] }))),
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
                        let status = fake.playback_status.unwrap_or(200);
                        if let Some(raw) = fake.playback_raw {
                            return Response::builder()
                                .status(status)
                                .body(Full::new(Bytes::from(raw)))
                                .unwrap();
                        }
                        json(status, fake.playback.clone().unwrap_or_else(playback))
                    }
                    "/Sessions/Playing" | "/Sessions/Playing/Progress" | "/Sessions/Playing/Stopped" => {
                        empty(204)
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

    /// A vault that cannot be written, as a full Credential Manager is.
    struct Failing;
    impl Vault for Failing {
        fn load(&self) -> Option<Session> {
            None
        }
        fn save(&self, _: &Session) -> Result<(), String> {
            Err("no room".into())
        }
        fn clear(&self) {}
    }

    fn client(vault: &Shared) -> Arc<Jf> {
        Jf::new(cfg(), reqwest::Client::new(), Box::new(vault.clone()))
    }

    /// Signed in the real way, by password, through the fake.
    async fn signed_in(fake: &Arc<Fake>) -> (Arc<Jf>, Shared, String) {
        let base = serve(fake.clone()).await;
        let vault = Shared::default();
        let j = client(&vault);
        j.sign_in(&format!("{base}{}", fake.prefix), "testuser", PASSWORD)
            .await
            .unwrap();
        assert!(j.status().connected);
        (j, vault, base)
    }

    fn q(pairs: &[(&str, &str)]) -> Option<HashMap<String, String>> {
        Some(
            pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        )
    }

    // ---- the address ----

    #[test]
    fn an_address_is_read_the_way_people_paste_it() {
        for (typed, base) in [
            ("192.168.1.5:8096", "http://192.168.1.5:8096"),
            ("10.0.0.2", "http://10.0.0.2"),
            ("localhost:8096/", "http://localhost:8096"),
            ("localhost", "http://localhost"),
            ("[::1]:8096", "http://[::1]:8096"),
            ("jellyfin.example.com", "https://jellyfin.example.com"),
            ("media.example.com:8920", "http://media.example.com:8920"),
            ("https://host:8920", "https://host:8920"),
            (
                "http://192.168.1.5:8096/web/index.html#!/home.html",
                "http://192.168.1.5:8096",
            ),
            (
                "https://media.example.com/jellyfin/web/index.html",
                "https://media.example.com/jellyfin",
            ),
            ("https://media.example.com/jellyfin/", "https://media.example.com/jellyfin"),
            ("  http://HOST:8096/?x=1#y  ", "http://host:8096"),
            ("http://host:8096/Web/", "http://host:8096"),
        ] {
            assert_eq!(derive(typed).as_deref(), Ok(base), "{typed}");
        }
    }

    #[test]
    fn an_address_that_is_not_a_server_is_refused() {
        for bad in [
            "",
            "   ",
            "ftp://host",
            "file:///C:/x",
            "javascript:alert(1)",
            "http://",
            "http://user:pass@host:8096",
            "http://user@host",
            "not a url at all",
        ] {
            assert!(derive(bad).is_err(), "{bad:?} was read as a server");
        }
    }

    // ---- the header ----

    #[test]
    fn a_header_value_never_holds_a_quote_a_comma_or_a_percent() {
        assert_eq!(plain_value("Adam's PC, 2%"), "Adam_s PC_ 2_");
        assert_eq!(plain_value("DESKTOP-ABC (2)"), "DESKTOP-ABC (2)");
        assert_eq!(plain_value("PC\u{e9}\"x\"\r\n"), "PC__x___");
        let j = Jf::new(
            Config {
                app_version: "0.12.0".into(),
                device_name: "Adam's \"PC\", 100%".into(),
            },
            reqwest::Client::new(),
            Box::new(Shared::default()),
        );
        let h = j.header("devid", Some(TOKEN1));
        assert_eq!(
            h,
            format!(
                "MediaBrowser Client=\"BlammyTV\", Device=\"Adam_s _PC__ 100_\", \
                 DeviceId=\"devid\", Version=\"0.12.0\", Token=\"{TOKEN1}\""
            )
        );
        assert!(!j.header("devid", None).contains("Token"));
        let blank = Jf::new(
            Config {
                app_version: "1".into(),
                device_name: "  ".into(),
            },
            reqwest::Client::new(),
            Box::new(Shared::default()),
        );
        assert!(blank.header("d", None).contains("Device=\"Windows\""));
    }

    #[test]
    fn only_a_token_that_can_be_written_as_it_is_is_taken() {
        assert!(is_token(TOKEN1));
        assert!(is_token("abc.DEF-123_xyz"));
        for bad in ["", "short", "a\"b0123456789", "with space 123456", "pct%20encoded1", "uni\u{e9}code0123"] {
            assert!(!is_token(bad), "{bad:?}");
        }
        assert!(!is_token(&"a".repeat(257)));
    }

    // ---- the guard ----

    fn guarded(method: &str, path: &str, query: &[(&str, &str)]) -> Result<(), String> {
        guard(
            method,
            path,
            &query
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            USER,
        )
    }

    #[test]
    fn the_calls_the_app_makes_pass() {
        for (m, p) in [
            ("GET", "/UserViews".to_string()),
            ("GET", "/Items".to_string()),
            ("GET", format!("/Items/{ITEM}")),
            ("GET", "/UserItems/Resume".to_string()),
            ("GET", "/Shows/NextUp".to_string()),
            ("GET", "/Shows/Upcoming".to_string()),
            ("GET", format!("/Shows/{ITEM}/Seasons")),
            ("GET", format!("/Shows/{ITEM}/Episodes")),
            ("GET", format!("/MediaSegments/{ITEM}")),
            ("GET", format!("/UserItems/{ITEM}/UserData")),
            ("POST", format!("/UserItems/{ITEM}/UserData")),
            ("POST", format!("/UserPlayedItems/{ITEM}")),
            ("DELETE", format!("/UserPlayedItems/{ITEM}")),
            ("POST", "/Sessions/Playing".to_string()),
            ("POST", "/Sessions/Playing/Progress".to_string()),
            ("POST", "/Sessions/Playing/Stopped".to_string()),
        ] {
            assert_eq!(guarded(m, &p, &[]), Ok(()), "{m} {p}");
        }
    }

    #[test]
    fn nothing_else_is_sent_whatever_the_token_could_do() {
        for (m, p) in [
            // an administrator's token can do these; the app asks for none
            ("DELETE", format!("/Items/{ITEM}")),
            ("DELETE", "/Items".to_string()),
            ("POST", format!("/Items/{ITEM}")),
            ("POST", "/Users/New".to_string()),
            ("GET", "/Users".to_string()),
            ("GET", "/Users/Me".to_string()),
            ("POST", "/Library/Refresh".to_string()),
            ("POST", "/System/Restart".to_string()),
            ("GET", "/System/Info".to_string()),
            ("GET", "/System/Configuration".to_string()),
            ("GET", "/Auth/Keys".to_string()),
            ("POST", "/Auth/Keys".to_string()),
            ("POST", "/Sessions/Logout".to_string()),
            ("GET", "/Sessions".to_string()),
            ("POST", "/QuickConnect/Authorize".to_string()),
            ("POST", "/Users/AuthenticateByName".to_string()),
            // owned by `sources`
            ("POST", format!("/Items/{ITEM}/PlaybackInfo")),
            ("GET", format!("/Items/{ITEM}/PlaybackInfo")),
            // the wrong verb on a listed path
            ("POST", "/UserViews".to_string()),
            ("GET", format!("/UserPlayedItems/{ITEM}")),
            ("DELETE", format!("/UserItems/{ITEM}/UserData")),
            ("PUT", format!("/UserPlayedItems/{ITEM}")),
            // not exact
            ("GET", "/userviews".to_string()),
            ("GET", "/UserViews/".to_string()),
            ("GET", "/Items/abc".to_string()),
            ("GET", format!("/Items/{}", ITEM.to_uppercase())),
            ("GET", format!("/Items/{ITEM}/Images/Primary")),
            ("GET", format!("/emby/Items/{ITEM}")),
            ("GET", format!("/Shows/{ITEM}/Episodes/extra")),
        ] {
            assert!(guarded(m, &p, &[]).is_err(), "{m} {p} was allowed");
        }
    }

    #[test]
    fn a_path_that_is_not_plain_is_refused() {
        for p in [
            "UserViews",
            "//UserViews",
            "/UserViews?x=1",
            "/UserViews#x",
            "/Items/../Users",
            "/%55serViews",
            "/User Views",
            "/User\\Views",
            "/UserViews\n",
            "/Us\u{e9}rViews",
        ] {
            assert_eq!(guarded("GET", p, &[]), Err(NOT_A_PATH.to_string()), "{p:?}");
        }
    }

    #[test]
    fn a_query_cannot_carry_a_credential_or_name_another_user() {
        for k in ["ApiKey", "api_key", "apikey", "API-KEY", "token", "Token", "AccessToken"] {
            assert!(guarded("GET", "/Items", &[(k, "x")]).is_err(), "{k}");
        }
        assert!(guarded("GET", "/Items", &[("userId", USER)]).is_ok());
        assert!(guarded("GET", "/Items", &[("UserId", &USER.to_uppercase())]).is_ok());
        // the same id written with dashes is still this user; a different one is not
        assert!(guarded(
            "GET",
            "/Items",
            &[("userId", "d41f6b82-a3c9-4e57-b0e8-c9a7f2d63b15")]
        )
        .is_ok());
        assert!(guarded(
            "GET",
            "/Items",
            &[("userId", "00000000-66ed-4c5f-9d5e-d26a313553bb")]
        )
        .is_err());
        assert!(guarded("GET", "/Items", &[("userId", "someoneelse")]).is_err());
        assert!(guarded("GET", "/Items", &[("userid", "")]).is_err());
        assert!(guarded("GET", "/Items", &[("Fields", "ProviderIds"), ("ParentId", ITEM)]).is_ok());
    }

    // ---- sign-in by password ----

    #[test]
    fn a_password_sign_in_keeps_the_session_and_shows_who() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let vault = Shared::default();
            let j = client(&vault);
            assert!(!j.status().connected);
            let st = j.sign_in(&base, "testuser", PASSWORD).await.unwrap();
            assert_eq!(
                st,
                Status {
                    connected: true,
                    user_name: Some("testuser".into()),
                    user_id: Some(USER.into()),
                    base: Some(base.clone()),
                    server_name: Some("TESTSRV".into()),
                    version: Some("12.2.0".into()),
                }
            );
            let kept = vault.load().unwrap();
            assert_eq!(kept.token, TOKEN1);
            assert_eq!(kept.server_id, "5e7a1c0f9b3d4a68b2c4d6e8f0a1b3c5");
            assert_eq!(kept.device_id.len(), 32);
            // the password reached the server and is nowhere else
            assert!(fake.last("AuthenticateByName").body.contains(PASSWORD));
            assert!(!serde_json::to_string(&kept).unwrap().contains(PASSWORD));
            assert!(!format!("{kept:?}").contains(PASSWORD));
            assert!(!serde_json::to_string(&j.status()).unwrap().contains(PASSWORD));
            // the identity went out before sign-in, without a token
            let a = fake.last("AuthenticateByName").auth.unwrap();
            assert!(a.starts_with("MediaBrowser Client=\"BlammyTV\", Device=\"TEST-PC\""));
            assert!(a.contains(&format!("DeviceId=\"{}\"", kept.device_id)));
            assert!(!a.contains("Token"));
            // the sign-in's own check used the new token
            assert!(fake.last("/UserViews").auth.unwrap().contains(&format!("Token=\"{TOKEN1}\"")));
        })
    }

    #[test]
    fn a_wrong_password_is_denied_and_keeps_nothing() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let vault = Shared::default();
            let j = client(&vault);
            let e = j.sign_in(&base, "testuser", "nope").await.unwrap_err();
            assert_eq!(e, WRONG_LOGIN);
            assert!(e.starts_with("denied:"));
            let e = j.sign_in(&base, "nobody", PASSWORD).await.unwrap_err();
            assert_eq!(e, WRONG_LOGIN);
            assert!(!j.status().connected);
            assert!(vault.load().is_none());
            assert_eq!(fake.hits("/UserViews"), 0);
        })
    }

    #[test]
    fn an_address_that_is_not_jellyfin_is_told_so_before_a_password_is_sent() {
        run(async {
            for info in [Info::Html, Info::NoVersion, Info::Status(404)] {
                let fake = Arc::new(Fake {
                    info,
                    ..Default::default()
                });
                let base = serve(fake.clone()).await;
                let j = client(&Shared::default());
                let e = j.sign_in(&base, "testuser", PASSWORD).await.unwrap_err();
                assert_eq!(e, NOT_JELLYFIN);
                assert!(e.starts_with("unsupported:"));
                assert_eq!(fake.hits("Authenticate"), 0, "a password went to a non-server");
            }
            let fake = Arc::new(Fake {
                info: Info::Status(503),
                ..Default::default()
            });
            let base = serve(fake.clone()).await;
            let e = client(&Shared::default())
                .sign_in(&base, "testuser", PASSWORD)
                .await
                .unwrap_err();
            assert_eq!(e, "HTTP 503");
        })
    }

    #[test]
    fn an_aiostreams_is_sent_to_aiostreams_own_sign_in() {
        run(async {
            let fake = Arc::new(Fake {
                info: Info::Aio,
                ..Default::default()
            });
            let base = serve(fake.clone()).await;
            let j = client(&Shared::default());
            assert_eq!(j.sign_in(&base, "testuser", PASSWORD).await.unwrap_err(), IS_AIOSTREAMS);
            assert_eq!(j.quick_connect(&base).await.unwrap_err(), IS_AIOSTREAMS);
            assert_eq!(fake.hits("Authenticate"), 0);
            assert_eq!(fake.hits("QuickConnect"), 0);
        })
    }

    #[test]
    fn a_server_without_the_routes_is_too_old_and_its_token_is_revoked() {
        run(async {
            let fake = Arc::new(Fake {
                views_status: Some(404),
                ..Default::default()
            });
            let base = serve(fake.clone()).await;
            let vault = Shared::default();
            let j = client(&vault);
            let e = j.sign_in(&base, "testuser", PASSWORD).await.unwrap_err();
            assert_eq!(e, TOO_OLD);
            assert!(!j.status().connected);
            assert!(vault.load().is_none());
            assert_eq!(fake.logouts.load(Ordering::SeqCst), 1, "the new token was left alive");
            assert!(fake.last("/Sessions/Logout").auth.unwrap().contains(TOKEN1));
        })
    }

    #[test]
    fn a_token_that_cannot_be_written_into_a_header_is_refused() {
        run(async {
            let fake = Arc::new(Fake {
                token: Some("bad\"token, Token=\"x"),
                ..Default::default()
            });
            let base = serve(fake.clone()).await;
            let vault = Shared::default();
            let j = client(&vault);
            assert_eq!(j.sign_in(&base, "testuser", PASSWORD).await.unwrap_err(), BAD_ANSWER);
            assert!(!j.status().connected);
            assert!(vault.load().is_none());
            assert_eq!(fake.hits("/UserViews"), 0);
        })
    }

    #[test]
    fn a_sign_in_that_cannot_be_saved_is_not_kept() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let j = Jf::new(cfg(), reqwest::Client::new(), Box::new(Failing));
            assert!(j.sign_in(&base, "testuser", PASSWORD).await.is_err());
            assert!(!j.status().connected);
        })
    }

    #[test]
    fn a_server_under_a_path_is_called_under_it() {
        run(async {
            let fake = Arc::new(Fake {
                prefix: "/jf",
                ..Default::default()
            });
            let base = serve(fake.clone()).await;
            let vault = Shared::default();
            let j = client(&vault);
            j.sign_in(&format!("{base}/jf/web/index.html"), "testuser", PASSWORD)
                .await
                .unwrap();
            assert_eq!(j.status().base, Some(format!("{base}/jf")));
            j.request("GET", "/UserViews", None, None).await.unwrap();
            assert_eq!(fake.last("/UserViews").uri, "/jf/UserViews");
        })
    }

    // ---- sign-in by Quick Connect ----

    #[test]
    fn quick_connect_waits_then_keeps_the_session() {
        run(async {
            let fake = Arc::new(Fake {
                pending_for: 2,
                ..Default::default()
            });
            let base = serve(fake.clone()).await;
            let vault = Shared::default();
            let j = client(&vault);
            let s = j.quick_connect(&base).await.unwrap();
            assert_eq!(
                s,
                Started {
                    code: "123456".into(),
                    server_name: "TESTSRV".into(),
                }
            );
            assert_eq!(j.poll().await.unwrap(), Poll::Pending);
            assert_eq!(j.poll().await.unwrap(), Poll::Pending);
            assert!(!j.status().connected);
            assert_eq!(j.poll().await.unwrap(), Poll::Approved);
            assert_eq!(fake.auths.load(Ordering::SeqCst), 1);
            assert_eq!(j.status().user_name.as_deref(), Some("testuser"));
            assert_eq!(vault.load().unwrap().token, TOKEN1);
            // the secret is in the trade's body and the poll's query, never a header
            assert!(fake.last("AuthenticateWithQuickConnect").body.contains("SECRET-abc_123"));
            assert!(fake.seen().iter().all(|s| !s.auth.clone().unwrap_or_default().contains("SECRET")));
            // a poll after the end hears how it ended and does not trade again
            assert_eq!(j.poll().await.unwrap(), Poll::Approved);
            assert_eq!(fake.auths.load(Ordering::SeqCst), 1);
        })
    }

    #[test]
    fn quick_connect_that_is_off_says_so() {
        run(async {
            for fake in [
                Fake {
                    qc_enabled: Some(false),
                    ..Default::default()
                },
                Fake {
                    initiate_status: Some(401),
                    ..Default::default()
                },
            ] {
                let fake = Arc::new(fake);
                let base = serve(fake.clone()).await;
                let j = client(&Shared::default());
                let e = j.quick_connect(&base).await.unwrap_err();
                assert_eq!(e, QUICK_CONNECT_OFF);
                assert_eq!(j.poll().await.unwrap(), Poll::Error);
            }
        })
    }

    #[test]
    fn a_code_that_ran_out_ends_the_sign_in() {
        run(async {
            let fake = Arc::new(Fake {
                connect_status: Some(404),
                ..Default::default()
            });
            let base = serve(fake.clone()).await;
            let j = client(&Shared::default());
            j.quick_connect(&base).await.unwrap();
            assert_eq!(j.poll().await.unwrap(), Poll::Expired);
            // and it is over: the next poll does not ask again
            assert_eq!(j.poll().await.unwrap(), Poll::Error);
            assert_eq!(fake.connects.load(Ordering::SeqCst), 1);
        })
    }

    #[test]
    fn a_refused_trade_ends_the_sign_in_with_nothing_kept() {
        run(async {
            let fake = Arc::new(Fake {
                auth_status: Some(400),
                ..Default::default()
            });
            let base = serve(fake.clone()).await;
            let vault = Shared::default();
            let j = client(&vault);
            j.quick_connect(&base).await.unwrap();
            assert_eq!(j.poll().await.unwrap(), Poll::Error);
            assert!(!j.status().connected);
            assert!(vault.load().is_none());
            assert_eq!(j.poll().await.unwrap(), Poll::Error);
        })
    }

    #[test]
    fn a_quick_connect_on_a_server_too_old_is_an_error_and_revoked() {
        run(async {
            let fake = Arc::new(Fake {
                views_status: Some(404),
                ..Default::default()
            });
            let base = serve(fake.clone()).await;
            let vault = Shared::default();
            let j = client(&vault);
            j.quick_connect(&base).await.unwrap();
            assert_eq!(j.poll().await.unwrap(), Poll::Error);
            assert!(vault.load().is_none());
            assert_eq!(fake.logouts.load(Ordering::SeqCst), 1);
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
            let j = client(&vault);
            j.quick_connect(&base).await.unwrap();
            let poll = tokio::spawn({
                let j = j.clone();
                async move { j.poll().await }
            });
            while fake.hits("/QuickConnect/Connect?") == 0 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            j.disconnect().await;
            fake.gate.add_permits(1);
            assert_eq!(poll.await.unwrap().unwrap(), Poll::Error);
            assert_eq!(fake.auths.load(Ordering::SeqCst), 0);
            assert!(!j.status().connected);
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
            let j = client(&vault);
            j.quick_connect(&base).await.unwrap();
            let poll = tokio::spawn({
                let j = j.clone();
                async move { j.poll().await }
            });
            while fake.hits("AuthenticateWithQuickConnect") == 0 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            j.disconnect().await;
            fake.gate.add_permits(1);
            assert_eq!(poll.await.unwrap().unwrap(), Poll::Error);
            assert!(!j.status().connected);
            assert!(vault.load().is_none());
        })
    }

    #[test]
    fn a_password_sign_in_cancels_a_quick_connect_under_way() {
        run(async {
            let fake = Arc::new(Fake {
                pending_for: 99,
                ..Default::default()
            });
            let base = serve(fake.clone()).await;
            let j = client(&Shared::default());
            j.quick_connect(&base).await.unwrap();
            j.sign_in(&base, "testuser", PASSWORD).await.unwrap();
            // the old code's attempt is gone: a poll hears the session
            assert_eq!(j.poll().await.unwrap(), Poll::Approved);
            assert_eq!(fake.connects.load(Ordering::SeqCst), 0);
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
            let j = client(&Shared::default());
            j.quick_connect(&base).await.unwrap();
            j.quick_connect(&base).await.unwrap();
            assert_eq!(fake.hits("/QuickConnect/Initiate"), 2);
            assert_eq!(j.poll().await.unwrap(), Poll::Pending);
        })
    }

    // ---- calls ----

    #[test]
    fn a_call_carries_the_token_in_the_header_and_never_in_the_url() {
        run(async {
            let fake = Arc::new(Fake::default());
            let (j, _, _) = signed_in(&fake).await;
            let r = j
                .request(
                    "get",
                    "/Items",
                    q(&[("userId", USER), ("Recursive", "true"), ("IncludeItemTypes", "Series,Movie")]),
                    None,
                )
                .await
                .unwrap();
            assert_eq!(r.status, 200);
            let s = fake.last("/Items?");
            assert_eq!(s.method, "GET");
            assert!(s.auth.unwrap().contains(&format!("Token=\"{TOKEN1}\"")));
            assert!(s.uri.contains("Recursive=true"));
            assert!(s.uri.contains("IncludeItemTypes=Series%2CMovie") || s.uri.contains("IncludeItemTypes=Series,Movie"));
            assert!(fake.seen().iter().all(|s| !s.uri.contains(TOKEN1)));
        })
    }

    #[test]
    fn posts_and_deletes_go_out_with_their_verb_and_body() {
        run(async {
            let fake = Arc::new(Fake::default());
            let (j, _, _) = signed_in(&fake).await;
            let report = serde_json::json!({ "ItemId": ITEM, "PositionTicks": 150115000u64 });
            assert_eq!(
                j.request("POST", "/Sessions/Playing/Stopped", None, Some(report.clone()))
                    .await
                    .unwrap()
                    .status,
                204
            );
            let s = fake.last("/Sessions/Playing/Stopped");
            assert_eq!(s.method, "POST");
            assert_eq!(serde_json::from_str::<serde_json::Value>(&s.body).unwrap(), report);
            // a null body is no body
            j.request("POST", &format!("/UserPlayedItems/{ITEM}"), q(&[("userId", USER)]), Some(serde_json::Value::Null))
                .await
                .unwrap();
            assert_eq!(fake.last("/UserPlayedItems/").body, "");
            j.request("DELETE", &format!("/UserPlayedItems/{ITEM}"), q(&[("userId", USER)]), None)
                .await
                .unwrap();
            assert_eq!(fake.last("/UserPlayedItems/").method, "DELETE");
        })
    }

    #[test]
    fn a_call_that_is_not_on_the_list_sends_nothing() {
        run(async {
            let fake = Arc::new(Fake::default());
            let (j, _, _) = signed_in(&fake).await;
            let before = fake.seen().len();
            for (m, p) in [
                ("DELETE", format!("/Items/{ITEM}")),
                ("POST", "/Users/New".to_string()),
                ("POST", "/Sessions/Logout".to_string()),
                ("POST", format!("/Items/{ITEM}/PlaybackInfo")),
                ("GET", "/System/Configuration".to_string()),
                ("PATCH", "/UserViews".to_string()),
            ] {
                let e = j.request(m, &p, None, None).await.unwrap_err();
                assert!(e.starts_with("refused:"), "{m} {p}: {e}");
            }
            assert!(j.request("GET", "/Items", q(&[("ApiKey", "x")]), None).await.is_err());
            assert!(j.request("GET", "/Items", q(&[("userId", "someoneelse")]), None).await.is_err());
            assert_eq!(fake.seen().len(), before, "a refused call reached the server");
            assert!(j.status().connected);
        })
    }

    #[test]
    fn a_call_signed_out_says_so_and_sends_nothing() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let j = client(&Shared::default());
            let e = j.request("GET", "/UserViews", None, None).await.unwrap_err();
            assert_eq!(e, "not signed in to Jellyfin");
            assert_eq!(j.sources(ITEM).await.unwrap_err(), "not signed in to Jellyfin");
            assert!(fake.seen().is_empty());
            let _ = base;
        })
    }

    #[test]
    fn a_401_signs_out_here() {
        run(async {
            let fake = Arc::new(Fake {
                dead: true,
                ..Default::default()
            });
            let (j, vault, _) = signed_in(&fake).await;
            let r = j.request("GET", "/Items", None, None).await.unwrap();
            assert_eq!(r.status, 401);
            assert!(!j.status().connected);
            assert!(vault.load().is_none());
        })
    }

    #[test]
    fn a_4xx_comes_back_as_data() {
        run(async {
            let fake = Arc::new(Fake::default());
            let (j, _, _) = signed_in(&fake).await;
            // the fake answers 404 for a path it was not given a prefix for
            let ok = j.request("GET", "/UserViews", None, None).await.unwrap();
            assert_eq!(ok.status, 200);
            assert!(j.status().connected);
        })
    }

    #[test]
    fn a_429_is_waited_out_once() {
        run(async {
            let fake = Arc::new(Fake {
                limit_for: AtomicUsize::new(1),
                retry_after: Some("0"),
                ..Default::default()
            });
            let (j, _, _) = signed_in(&fake).await;
            let r = j.request("GET", "/Items", None, None).await.unwrap();
            assert_eq!(r.status, 200);
            assert_eq!(fake.hits("/Items"), 2);

            // twice in a row is the page's to hear
            let fake = Arc::new(Fake {
                limit_for: AtomicUsize::new(5),
                retry_after: Some("0"),
                ..Default::default()
            });
            let (j2, _, _) = signed_in(&fake).await;
            assert_eq!(j2.request("GET", "/Items", None, None).await.unwrap().status, 429);
            assert_eq!(fake.hits("/Items"), 2);
            let _ = j;
        })
    }

    #[test]
    fn a_429_asking_for_a_long_wait_goes_back_at_once() {
        run(async {
            let fake = Arc::new(Fake {
                limit_for: AtomicUsize::new(5),
                retry_after: Some("3600"),
                ..Default::default()
            });
            let (j, _, _) = signed_in(&fake).await;
            let t = std::time::Instant::now();
            assert_eq!(j.request("GET", "/Items", None, None).await.unwrap().status, 429);
            assert!(t.elapsed() < Duration::from_secs(5));
            assert_eq!(fake.hits("/Items"), 1);
        })
    }

    #[test]
    fn the_token_is_taken_out_of_every_answer() {
        run(async {
            let leaky = format!(
                "{{\"Path\":\"/Videos/x/stream?ApiKey={TOKEN1}\",\"b\":\"{}\",\"c\":\"{}\"}}",
                uri_component(TOKEN1),
                "a".repeat(3)
            );
            let fake = Arc::new(Fake {
                item_body: Some(leaky),
                ..Default::default()
            });
            let (j, _, _) = signed_in(&fake).await;
            let r = j.request("GET", &format!("/Items/{ITEM}"), None, None).await.unwrap();
            assert!(!r.body.contains(TOKEN1));
            assert!(r.body.contains("ApiKey="));
            assert_eq!(scrub("clean".into(), TOKEN1), "clean");
            // taking one out can join what was either side into another
            let joined = format!("{}{}{}", &TOKEN1[..16], TOKEN1, &TOKEN1[16..]);
            assert!(!scrub(joined, TOKEN1).contains(TOKEN1));
            assert_eq!(scrub("x".into(), ""), "x");
        })
    }

    // ---- sources ----

    #[test]
    fn sources_come_back_cut_down_to_what_the_page_reads() {
        run(async {
            let fake = Arc::new(Fake::default());
            let (j, _, _) = signed_in(&fake).await;
            let s = j.sources(ITEM).await.unwrap();
            assert_eq!(s.status, 200);
            assert_eq!(s.play_session_id.as_deref(), Some("55f9c72ae099462ba18881830ddb8b0e"));
            assert_eq!(s.sources.len(), 1);
            let src = &s.sources[0];
            assert_eq!(src["Id"], ITEM);
            assert_eq!(src["Container"], "mkv");
            assert_eq!(src["Size"], 558231);
            assert_eq!(src["ETag"], "ef3dd306a6c798e2a3d7ec119830eeb4");
            assert_eq!(src["SupportsDirectPlay"], true);
            assert_eq!(src["DefaultAudioStreamIndex"], 1);
            assert_eq!(src["MediaStreams"].as_array().unwrap().len(), 3);
            assert_eq!(src["MediaStreams"][1]["Language"], "eng");
            assert_eq!(src["MediaStreams"][2]["IsExternal"], true);
            let text = serde_json::to_string(&s).unwrap();
            for gone in ["Path", "jf-test", "DeliveryUrl", "ApiKey", TOKEN1, "RequiredHttpHeaders", "SampleRate", "TimeBase", "Profile"] {
                assert!(!text.contains(gone), "{gone} reached the page: {text}");
            }
            // what was sent: the user's own id, and a direct-play profile
            let sent = fake.last("/PlaybackInfo");
            assert_eq!(sent.method, "POST");
            assert!(sent.uri.ends_with(&format!("/Items/{ITEM}/PlaybackInfo")));
            let b: serde_json::Value = serde_json::from_str(&sent.body).unwrap();
            assert_eq!(b["UserId"], USER);
            assert_eq!(b["DeviceProfile"]["TranscodingProfiles"], serde_json::json!([]));
            assert!(sent.auth.unwrap().contains(&format!("Token=\"{TOKEN1}\"")));
        })
    }

    #[test]
    fn sources_refuses_what_is_not_an_item_id_before_a_request() {
        run(async {
            let fake = Arc::new(Fake::default());
            let (j, _, _) = signed_in(&fake).await;
            let before = fake.seen().len();
            for bad in ["", "abc", &ITEM.to_uppercase(), &format!("{ITEM}/../x"), &format!("{ITEM}0"), "../Users"] {
                assert!(j.sources(bad).await.unwrap_err().starts_with("refused:"), "{bad:?}");
            }
            assert_eq!(fake.seen().len(), before);
        })
    }

    #[test]
    fn a_failed_source_lookup_is_data_and_a_garbled_one_is_an_error() {
        run(async {
            let fake = Arc::new(Fake {
                playback_status: Some(404),
                playback: Some(serde_json::json!({ "ErrorCode": "NotAllowed" })),
                ..Default::default()
            });
            let (j, _, _) = signed_in(&fake).await;
            assert_eq!(
                j.sources(ITEM2).await.unwrap(),
                Sources {
                    status: 404,
                    sources: vec![],
                    play_session_id: None,
                    error_code: Some("NotAllowed".into()),
                }
            );
            let fake = Arc::new(Fake {
                playback_raw: Some("<html>nope</html>"),
                ..Default::default()
            });
            let (j, _, _) = signed_in(&fake).await;
            assert_eq!(j.sources(ITEM).await.unwrap_err(), BAD_ANSWER);
            let fake = Arc::new(Fake {
                playback_status: Some(500),
                playback_raw: Some("oops"),
                ..Default::default()
            });
            let (j, _, _) = signed_in(&fake).await;
            let s = j.sources(ITEM).await.unwrap();
            assert_eq!((s.status, s.sources.len()), (500, 0));
        })
    }

    // ---- the session, between runs ----

    #[test]
    fn a_session_survives_a_restart_and_hides_its_token_when_printed() {
        run(async {
            let fake = Arc::new(Fake::default());
            let (j, vault, _) = signed_in(&fake).await;
            drop(j);
            let again = client(&vault);
            assert!(again.status().connected);
            assert_eq!(again.status().user_name.as_deref(), Some("testuser"));
            assert_eq!(
                again.request("GET", "/UserViews", None, None).await.unwrap().status,
                200
            );
            let kept = vault.load().unwrap();
            let shown = format!("{kept:?}");
            assert!(!shown.contains(TOKEN1));
            assert!(shown.contains("(hidden)"));
            assert!(encode(&kept).unwrap().len() < BLOB_MAX);
            let huge = Session {
                server_name: "x".repeat(BLOB_MAX),
                ..kept
            };
            assert!(encode(&huge).is_err());
        })
    }

    #[test]
    fn an_old_blob_without_the_newer_fields_still_loads() {
        let old = serde_json::json!({
            "base": "http://h:8096", "token": TOKEN1, "user_id": USER,
            "user_name": "testuser", "server_id": "s", "device_id": "d",
        });
        let s: Session = serde_json::from_value(old).unwrap();
        assert_eq!((s.server_name.as_str(), s.version.as_str()), ("", ""));
    }

    // ---- sign-out ----

    #[test]
    fn disconnect_revokes_the_token_and_forgets_it() {
        run(async {
            let fake = Arc::new(Fake::default());
            let (j, vault, _) = signed_in(&fake).await;
            assert!(j.disconnect().await);
            assert_eq!(fake.logouts.load(Ordering::SeqCst), 1);
            assert!(fake.last("/Sessions/Logout").auth.unwrap().contains(&format!("Token=\"{TOKEN1}\"")));
            assert!(!j.status().connected);
            assert!(vault.load().is_none());
            // revoked there: the same token is refused now
            let r = j
                .request("GET", "/UserViews", None, None)
                .await
                .unwrap_err();
            assert_eq!(r, "not signed in to Jellyfin");
            assert!(fake.revoked.load(Ordering::SeqCst));
        })
    }

    #[test]
    fn disconnect_forgets_here_even_when_the_server_cannot_be_reached() {
        run(async {
            let fake = Arc::new(Fake::default());
            let (j, vault, _) = signed_in(&fake).await;
            // a client whose server is gone: point a copy of the session at a closed port
            let mut s = vault.load().unwrap();
            s.base = "http://127.0.0.1:9".into();
            let dead = Shared::default();
            dead.save(&s).unwrap();
            let j2 = client(&dead);
            assert!(!j2.disconnect().await, "an unreachable server was reported as confirmed");
            assert!(!j2.status().connected);
            assert!(dead.load().is_none());
            let _ = j;
        })
    }

    #[test]
    fn disconnect_reports_a_server_that_would_not_revoke() {
        run(async {
            let fake = Arc::new(Fake {
                logout_status: Some(500),
                ..Default::default()
            });
            let (j, vault, _) = signed_in(&fake).await;
            assert!(!j.disconnect().await);
            assert!(!j.status().connected);
            assert!(vault.load().is_none());
        })
    }

    #[test]
    fn disconnect_when_signed_out_asks_nobody() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let j = client(&Shared::default());
            assert!(j.disconnect().await);
            assert!(fake.seen().is_empty());
            let _ = base;
        })
    }

    // ---- the check before a stream plays, and the header mpv is given ----

    fn stream_of(base: &str) -> String {
        format!("{base}/Videos/{ITEM}/stream?static=true&mediaSourceId={ITEM}&tag=ef3dd306a6c798e2")
    }

    #[test]
    fn a_stream_the_server_serves_to_anyone_is_played_with_no_token_at_all() {
        run(async {
            let fake = Arc::new(Fake::default());
            let (j, _, base) = signed_in(&fake).await;
            let url = stream_of(&base);
            let r = j.prepare_stream(&url).await.unwrap();
            assert_eq!(
                r,
                Prepared { ok: true, needs_auth: false, status: 206, off_origin: false }
            );
            // One request, and it carried no credential: the token stayed here.
            let stream: Vec<_> = fake.seen().into_iter().filter(|s| s.uri.contains("/stream")).collect();
            assert_eq!(stream.len(), 1);
            assert_eq!(stream[0].auth, None);
            assert_eq!(j.auth_header_for(&url), None);
        });
    }

    #[test]
    fn a_stream_that_wants_the_token_is_asked_again_with_it_and_marked() {
        run(async {
            for mode in [Stream::NeedsToken, Stream::Forbidden] {
                let fake = Arc::new(Fake { stream: mode, ..Default::default() });
                let (j, _, base) = signed_in(&fake).await;
                let url = stream_of(&base);
                assert_eq!(j.auth_header_for(&url), None, "before the check");
                let r = j.prepare_stream(&url).await.unwrap();
                assert_eq!(
                    r,
                    Prepared { ok: true, needs_auth: true, status: 206, off_origin: false }
                );
                let stream: Vec<_> = fake.seen().into_iter().filter(|s| s.uri.contains("/stream")).collect();
                assert_eq!(stream.len(), 2);
                assert_eq!(stream[0].auth, None);
                assert_eq!(
                    stream[1].auth.as_deref(),
                    Some(format!("MediaBrowser Token=\"{TOKEN1}\"").as_str())
                );
                let line = j.auth_header_for(&url).unwrap();
                assert_eq!(line, format!("Authorization: MediaBrowser Token=\"{TOKEN1}\""));
                assert!(crate::mpvheader::clean(&line));
            }
        });
    }

    #[test]
    fn the_header_is_only_for_a_stream_of_the_signed_in_server() {
        run(async {
            let fake = Arc::new(Fake { stream: Stream::NeedsToken, ..Default::default() });
            let (j, _, base) = signed_in(&fake).await;
            j.prepare_stream(&stream_of(&base)).await.unwrap();
            assert!(j.auth_header_for(&stream_of(&base)).is_some());
            // The same server, another item: still its stream.
            assert!(j.auth_header_for(&format!("{base}/Videos/{ITEM2}/stream?static=true")).is_some());
            for url in [
                // another host, another port, another scheme
                "http://evil.example/Videos/7acf01459a4fb0ba75583ff9c88ca080/stream",
                &format!("{}/Videos/{ITEM}/stream", base.replace("127.0.0.1", "localhost")),
                &format!("{}/Videos/{ITEM}/stream", base.replace("http://", "https://")),
                // a login in the address
                &format!("{}/Videos/{ITEM}/stream", base.replace("http://", "http://u:p@")),
                // not a stream: other routes of the same server
                &format!("{base}/Items/{ITEM}"),
                &format!("{base}/Videos/{ITEM}/{ITEM}/Subtitles/0/Stream.srt"),
                &format!("{base}/Videos/{ITEM}/stream/x"),
                &format!("{base}/Videos/not-an-id/stream"),
                // a credential in the address
                &format!("{base}/Videos/{ITEM}/stream?ApiKey=x"),
                &format!("{base}/Videos/{ITEM}/stream?api_key=x"),
                "not a url",
                "",
            ] {
                assert_eq!(j.auth_header_for(url), None, "{url}");
            }
        });
    }

    #[test]
    fn the_check_refuses_what_is_not_a_stream_of_the_server_and_sends_nothing() {
        run(async {
            let fake = Arc::new(Fake::default());
            let (j, _, base) = signed_in(&fake).await;
            let before = fake.seen().len();
            for url in [
                "http://evil.example/Videos/7acf01459a4fb0ba75583ff9c88ca080/stream".to_string(),
                format!("{base}/Items"),
                format!("{base}/Videos/{ITEM}/stream?token=x"),
                format!("{}/Videos/{ITEM}/stream", base.replace("http://", "http://u:p@")),
            ] {
                let e = j.prepare_stream(&url).await.unwrap_err();
                assert!(e.starts_with("refused:"), "{e}");
                assert!(!e.contains(TOKEN1) && !e.contains("evil"), "{e}");
            }
            assert_eq!(fake.seen().len(), before, "a refused check sends nothing");
        });
    }

    #[test]
    fn a_check_when_not_signed_in_is_an_error_and_sends_nothing() {
        run(async {
            let fake = Arc::new(Fake::default());
            let base = serve(fake.clone()).await;
            let j = client(&Shared::default());
            assert!(j.prepare_stream(&stream_of(&base)).await.is_err());
            assert!(fake.seen().is_empty());
            assert_eq!(j.auth_header_for(&stream_of(&base)), None);
        });
    }

    #[test]
    fn a_stream_that_fails_either_way_is_not_ok_and_marks_nothing() {
        run(async {
            for (mode, want) in [(Stream::Status(404), 404), (Stream::Status(500), 500)] {
                let fake = Arc::new(Fake { stream: mode, ..Default::default() });
                let (j, _, base) = signed_in(&fake).await;
                let r = j.prepare_stream(&stream_of(&base)).await.unwrap();
                assert_eq!(r, Prepared { ok: false, needs_auth: false, status: want, off_origin: false });
                assert_eq!(j.auth_header_for(&stream_of(&base)), None);
            }
            // 401 with the token too: the token is no good here.
            let fake = Arc::new(Fake { stream: Stream::Status(401), ..Default::default() });
            let (j, _, base) = signed_in(&fake).await;
            let r = j.prepare_stream(&stream_of(&base)).await.unwrap();
            assert_eq!(r, Prepared { ok: false, needs_auth: false, status: 401, off_origin: false });
            assert_eq!(j.auth_header_for(&stream_of(&base)), None);
        });
    }

    #[test]
    fn a_stream_only_reached_through_a_redirect_off_the_server_gets_no_token() {
        run(async {
            // The other server, which counts what it is sent.
            let other = Arc::new(Fake::default());
            let other_base = serve(other.clone()).await;
            // This one refuses without the token and, with it, redirects away.
            let fake = Arc::new(Fake {
                stream: Stream::Redirect(format!("{other_base}/Videos/{ITEM}/stream")),
                ..Default::default()
            });
            let (j, _, base) = signed_in(&fake).await;
            // Anonymous, the redirect is followed and served: nothing to mark.
            let r = j.prepare_stream(&stream_of(&base)).await.unwrap();
            assert_eq!(r, Prepared { ok: true, needs_auth: false, status: 206, off_origin: false });
            assert_eq!(j.auth_header_for(&stream_of(&base)), None);
            // The server wants the token first and then redirects away: the
            // header would follow mpv there, so none is given and the
            // stream is not played. The token did not go either.
            let fake2 = Arc::new(Fake {
                stream: Stream::RedirectWithToken(format!("{other_base}/Videos/{ITEM}/stream")),
                ..Default::default()
            });
            let (j2, _, base2) = signed_in(&fake2).await;
            let r2 = j2.prepare_stream(&stream_of(&base2)).await.unwrap();
            assert_eq!(r2, Prepared { ok: false, needs_auth: false, status: 206, off_origin: true });
            assert_eq!(j2.auth_header_for(&stream_of(&base2)), None);
            // Nothing the other server saw carried a credential.
            assert!(other.seen().iter().all(|s| s.auth.is_none()), "{:?}", other.seen());
            assert!(!other.seen().is_empty());
        });
    }

    #[test]
    fn the_mark_ends_with_the_session() {
        run(async {
            let fake = Arc::new(Fake { stream: Stream::NeedsToken, ..Default::default() });
            let (j, _, base) = signed_in(&fake).await;
            let url = stream_of(&base);
            j.prepare_stream(&url).await.unwrap();
            assert!(j.auth_header_for(&url).is_some());
            assert!(j.disconnect().await);
            assert_eq!(j.auth_header_for(&url), None);
        });
    }

    #[test]
    fn a_server_under_a_path_is_still_its_own() {
        run(async {
            let fake = Arc::new(Fake {
                prefix: "/jellyfin",
                stream: Stream::NeedsToken,
                ..Default::default()
            });
            let (j, _, base) = signed_in(&fake).await;
            let url = format!("{base}/jellyfin/Videos/{ITEM}/stream?static=true");
            let r = j.prepare_stream(&url).await.unwrap();
            assert!(r.ok && r.needs_auth, "{r:?}");
            assert!(j.auth_header_for(&url).is_some());
            // The same host with the path left off is not this server's stream.
            assert_eq!(j.auth_header_for(&format!("{base}/Videos/{ITEM}/stream")), None);
        });
    }

    #[test]
    fn an_address_that_redirects_to_another_server_says_where_and_sends_no_password() {
        run(async {
            // The server the address sends you to, which counts what it is sent.
            let other = Arc::new(Fake::default());
            let other_base = serve(other.clone()).await;
            let fake = Arc::new(Fake {
                info: Info::Redirect(format!("{other_base}/System/Info/Public")),
                ..Default::default()
            });
            let base = serve(fake.clone()).await;
            let j = client(&Shared::default());
            let e = j.sign_in(&base, "testuser", PASSWORD).await.unwrap_err();
            assert!(e.starts_with("redirected:"), "{e}");
            assert!(e.contains(&other_base), "{e}");
            assert!(!j.status().connected);
            // Only the read was followed; nothing carrying the password went anywhere.
            assert_eq!(fake.hits("/Users/AuthenticateByName"), 0);
            assert_eq!(other.hits("/Users/AuthenticateByName"), 0);
            // Same server, another path: not a redirect off it.
            let same = Arc::new(Fake::default());
            let (j2, _, _) = signed_in(&same).await;
            assert!(j2.status().connected);
        });
    }

    #[test]
    fn a_mark_made_under_another_token_gives_no_header() {
        run(async {
            let fake = Arc::new(Fake { stream: Stream::NeedsToken, ..Default::default() });
            let (j, _, base) = signed_in(&fake).await;
            let url = stream_of(&base);
            j.prepare_stream(&url).await.unwrap();
            assert!(j.auth_header_for(&url).is_some());
            // The session now holds another token (a re-sign-in on the same
            // server), and the mark was made for the old one: the old token
            // must not be handed out, and the new one was never checked.
            j.state.lock().unwrap().session.as_mut().unwrap().token =
                "9f8e7d6c5b4a39281706f5e4d3c2b1a0".to_string();
            assert_eq!(j.auth_header_for(&url), None);
        });
    }
}

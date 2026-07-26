//! The frontend hot channel (plan 008).
//!
//! Most releases here change nothing native (v0.7.11 shipped 11 patch
//! versions; two touched this crate), yet every one costs a 35MB installer
//! and a restart. `dist/` is ~1.1MB. This module lets a verified, staged
//! copy of the frontend be served INSTEAD of the one baked into the binary.
//!
//! The recovery path landed BEFORE the install path (v0.7.14 vs v0.7.33),
//! so at no point did a way to stage a bundle exist without a way to escape
//! a bad one.
//!
//! ## What applies, and when
//!
//! Staging never touches the running app: it unpacks beside the live bundle
//! and moves a pointer, and the next `resolve()` acts on it. So the default
//! is "applies on next launch", with a restart offered as an accelerator.
//! Not a webview reload — see `frontend_apply` for why that is the one part
//! of the plan that was deliberately not built.
//!
//! ## Why this can serve from disk at all
//!
//! `Context::set_assets` swaps the asset provider and hands the previous
//! one back (Tauri's own docs suggest using it as a fallback, which is
//! exactly what `StagedAssets` does). The scheme and host are unchanged, so
//! the page ORIGIN is unchanged, so `localStorage` and IndexedDB are
//! unchanged. That matters more than it sounds: playlist credentials, the
//! Themes Pass license key, watch history and the guide cache all live in
//! origin-partitioned storage, and a cosmetic update must never orphan them.
//!
//! ## The failsafe, and why it is not optional
//!
//! The update mechanism lives INSIDE the thing being updated. A bundle that
//! throws before React mounts takes the update UI with it, and the user's
//! only recovery would be reinstalling. So the native side never trusts a
//! staged bundle: it drops a sentinel before serving one, and the frontend
//! must call `frontend_ready` to clear it. A sentinel still present at the
//! next startup means the last boot did not survive, and that version is
//! quarantined and rolled back automatically.

use std::borrow::Cow;
use std::path::{Path, PathBuf};

use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{App, Assets, Runtime};

/// Layout under the app's data dir:
/// ```text
/// frontends/
///   active.json     which version to serve, and what to fall back to
///   booting         sentinel: a boot that has not reported success yet
///   0.8.3/          an unpacked dist/
/// ```
const DIR: &str = "frontends";
const ACTIVE: &str = "active.json";
const SENTINEL: &str = "booting";

#[derive(serde::Serialize, serde::Deserialize, Default, Clone)]
pub struct Active {
    /// Version to serve. Empty means "the embedded one".
    #[serde(default)]
    pub version: String,
    /// Last version known to have booted, used when `version` fails.
    #[serde(default)]
    pub previous: String,
    /// Versions that failed to boot. Never served, never re-staged.
    #[serde(default)]
    pub quarantined: Vec<String>,
    /// The NATIVE version `version` was built against.
    ///
    /// The download gate refuses a bundle built for different Rust, but a
    /// bundle that was legitimate when it was staged stops being so the
    /// moment a native installer lands underneath it. Empty (an older
    /// record, or none) reads as "unknown", which is treated as a mismatch:
    /// falling back to the embedded frontend is always safe.
    #[serde(default)]
    pub native: String,
}

/// Where staged frontends live. Resolved WITHOUT an AppHandle, because the
/// asset provider has to exist before the app is built.
pub fn root() -> Option<PathBuf> {
    // Same identifier the bundler uses; keep in sync with tauri.conf.json.
    dirs_data()?.join("com.blammytv.app").join(DIR).into()
}

/// The platform data dir, resolved from the environment rather than by
/// pulling in a crate for one lookup.
fn dirs_data() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA").map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
    }
}

fn read_active(root: &Path) -> Active {
    std::fs::read_to_string(root.join(ACTIVE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_active(root: &Path, a: &Active) {
    if let Ok(s) = serde_json::to_string(a) {
        let _ = std::fs::create_dir_all(root);
        let _ = std::fs::write(root.join(ACTIVE), s);
    }
}

/// What this run is actually serving, recorded by `resolve()`. Empty means
/// the embedded bundle. Read by `frontend_status` so the UI can tell a
/// staged-and-pending version from the one already on screen.
static SERVING: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// Decide what to serve for THIS run, applying the failsafe.
///
/// Returns the directory to serve from, or `None` for the embedded assets.
/// Called once at startup, before the window exists.
pub fn resolve() -> Option<PathBuf> {
    let root = root()?;
    let mut active = read_active(&root);
    let sentinel = root.join(SENTINEL);

    // A sentinel from a previous run means that run never reported a live
    // frontend: it crashed, threw, or hung before React mounted. Quarantine
    // that version and fall back one step. Repeated failures walk all the
    // way down to the embedded assets, which ship in the binary and are
    // therefore always present and always known-good for this build.
    if sentinel.exists() {
        let failed = std::mem::take(&mut active.version);
        if !failed.is_empty() && !active.quarantined.contains(&failed) {
            eprintln!("[frontend] {failed} did not survive its first boot; rolling back");
            active.quarantined.push(failed);
        }
        active.version = std::mem::take(&mut active.previous);
        let _ = std::fs::remove_file(&sentinel);
        write_active(&root, &active);
    }

    // A native update landed under a staged bundle. The pairing the
    // download gate enforced no longer holds, so nothing staged for the old
    // native version may be served — including the rollback target, which
    // was built for it too. Start clean on the embedded frontend; the next
    // check stages a bundle for THIS native version. Quarantine goes with
    // it: those failures belonged to a pairing that no longer exists.
    if !active.version.is_empty() && active.native != env!("CARGO_PKG_VERSION") {
        eprintln!(
            "[frontend] {} was built for native {}, now on {}; using embedded",
            active.version,
            if active.native.is_empty() { "?" } else { &active.native },
            env!("CARGO_PKG_VERSION")
        );
        active = Active::default();
        write_active(&root, &active);
    }

    if active.version.is_empty() || active.quarantined.contains(&active.version) {
        let _ = SERVING.set(String::new());
        return None;
    }
    let dir = root.join(&active.version);
    if !dir.join("index.html").is_file() {
        // Staged directory vanished or was never complete: forget it rather
        // than serving a half-frontend.
        eprintln!("[frontend] {} is missing index.html; using embedded", active.version);
        active.version.clear();
        write_active(&root, &active);
        let _ = SERVING.set(String::new());
        return None;
    }

    // Arm the sentinel for this boot. `frontend_ready` clears it.
    let _ = std::fs::create_dir_all(&root);
    let _ = std::fs::write(&sentinel, active.version.as_bytes());
    eprintln!("[frontend] serving staged {}", active.version);
    let _ = SERVING.set(active.version.clone());
    Some(dir)
}

/// The frontend booted far enough to run code: clear the sentinel so this
/// version is not rolled back, and remember it as the fallback for the next
/// one. Called from a `useEffect` at the React root.
#[tauri::command]
pub fn frontend_ready() {
    let Some(root) = root() else { return };
    let sentinel = root.join(SENTINEL);
    if !sentinel.exists() {
        return; // serving embedded, or already cleared this run
    }
    let mut active = read_active(&root);
    active.previous = active.version.clone();
    write_active(&root, &active);
    let _ = std::fs::remove_file(&sentinel);
}

/// Stand-in used ONLY to take ownership of the embedded provider.
///
/// `set_assets` is the sole accessor and it hands back whatever was there,
/// so extracting the embedded assets means putting something in their place
/// for one statement. This is that something; it is dropped immediately and
/// never serves a request.
pub struct Placeholder;

impl<R: Runtime> Assets<R> for Placeholder {
    fn get(&self, _key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        None
    }
    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }
    fn csp_hashes(&self, _html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}

/// Serves a staged frontend when one is active, and the embedded assets
/// otherwise. A miss on ANY individual file falls through to embedded, so a
/// partial bundle degrades to the built-in file rather than a blank screen.
pub struct StagedAssets<R: Runtime> {
    dir: Option<PathBuf>,
    embedded: Box<dyn Assets<R>>,
}

impl<R: Runtime> StagedAssets<R> {
    pub fn new(dir: Option<PathBuf>, embedded: Box<dyn Assets<R>>) -> Self {
        Self { dir, embedded }
    }

    /// Map a request key to a file inside the staged directory.
    ///
    /// Refuses anything that could escape it. Tauri normalizes these keys,
    /// but this is the boundary between a URL and the filesystem and it is
    /// not the place to rely on somebody else's normalization.
    fn staged_path(&self, key: &AssetKey) -> Option<PathBuf> {
        let dir = self.dir.as_ref()?;
        let rel = key.as_ref().trim_start_matches('/');
        if rel.is_empty() {
            return None;
        }
        if Path::new(rel)
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
        {
            return None;
        }
        Some(dir.join(rel))
    }
}

impl<R: Runtime> Assets<R> for StagedAssets<R> {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        if let Some(path) = self.staged_path(key) {
            if let Ok(bytes) = std::fs::read(&path) {
                return Some(Cow::Owned(bytes));
            }
        }
        self.embedded.get(key)
    }

    // iter() and csp_hashes() intentionally delegate. csp_hashes in
    // particular is computed at BUILD time for the embedded HTML, which is
    // why hash-based CSP and a swappable frontend cannot both work: see the
    // note in plans/008-two-tier-updates.md before tightening CSP.
    fn iter(&self) -> Box<AssetsIter<'_>> {
        self.embedded.iter()
    }

    fn csp_hashes(&self, html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        self.embedded.csp_hashes(html_path)
    }

    fn setup(&self, app: &App<R>) {
        self.embedded.setup(app);
    }
}

// ---------------------------------------------------------------- install

/// Verify and stage a downloaded bundle (plan 008, phase 1b).
///
/// Order matters and is the whole security property: the signature is
/// checked against the SAME key as the installer BEFORE a single byte is
/// unpacked, and the new version is assembled in a temp directory that only
/// becomes active once it is complete. Nothing here can damage the running
/// frontend, because nothing writes over it.
///
/// `pubkey_b64` is the value already in tauri.conf.json (base64 of a
/// minisign public-key FILE, so it carries an untrusted-comment line that
/// has to be skipped). `sig_b64` is the .sig file's contents, same shape as
/// the ones the release drill already verifies by hand.
fn verify(pubkey_b64: &str, sig_b64: &str, bytes: &[u8]) -> Result<(), String> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;
    let key_file = b64
        .decode(pubkey_b64.trim())
        .map_err(|_| "public key is not valid base64".to_string())?;
    let key_txt =
        String::from_utf8(key_file).map_err(|_| "public key is not text".to_string())?;
    // minisign key files are: untrusted comment line, then the key.
    let key_line = key_txt
        .lines()
        .nth(1)
        .ok_or_else(|| "public key has no key line".to_string())?;
    let pk = minisign_verify::PublicKey::from_base64(key_line.trim())
        .map_err(|e| format!("bad public key: {e}"))?;

    let sig_file = b64
        .decode(sig_b64.trim())
        .map_err(|_| "signature is not valid base64".to_string())?;
    let sig_txt =
        String::from_utf8(sig_file).map_err(|_| "signature is not text".to_string())?;
    let sig = minisign_verify::Signature::decode(&sig_txt)
        .map_err(|e| format!("bad signature: {e}"))?;

    pk.verify(bytes, &sig, false)
        .map_err(|_| "signature does not match this bundle".to_string())
}

/// Unpack a verified tar.gz into `dir`, refusing any entry that escapes it.
///
/// A tar can name `../../anything`; this is the one place that matters, so
/// every path is checked component by component rather than trusting the
/// archive or the extractor.
fn unpack(bytes: &[u8], dir: &Path) -> Result<(), String> {
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(bytes));
    let entries = archive.entries().map_err(|e| e.to_string())?;
    for entry in entries {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?.into_owned();
        if path
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
        {
            return Err(format!("archive entry escapes its directory: {path:?}"));
        }
        let out = dir.join(&path);
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        entry.unpack(&out).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Stage a bundle so the NEXT resolve() serves it.
///
/// Deliberately does not touch the running frontend: it stages and points,
/// and phase 3 owns when that pointer is acted on. Refuses a quarantined
/// version outright, so a bundle that already failed to boot cannot be
/// re-downloaded into the same failure on a loop.
pub fn stage(
    version: &str,
    native_version: &str,
    pubkey_b64: &str,
    sig_b64: &str,
    bytes: &[u8],
) -> Result<(), String> {
    if version.is_empty()
        || version
            .contains(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '-')
    {
        return Err("refusing an unreasonable version string".into());
    }
    let root = root().ok_or_else(|| "no data directory".to_string())?;
    let mut active = read_active(&root);
    if active.quarantined.contains(&version.to_string()) {
        return Err(format!("{version} previously failed to boot"));
    }

    verify(pubkey_b64, sig_b64, bytes)?;

    // Assemble beside the target, then swap in. A half-unpacked directory
    // must never be reachable by resolve().
    let staging = root.join(format!(".incoming-{version}"));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    if let Err(e) = unpack(bytes, &staging) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e);
    }
    if !staging.join("index.html").is_file() {
        let _ = std::fs::remove_dir_all(&staging);
        return Err("bundle has no index.html".into());
    }

    let dest = root.join(version);
    let _ = std::fs::remove_dir_all(&dest);
    std::fs::rename(&staging, &dest).map_err(|e| e.to_string())?;

    // Point at it. `previous` is only advanced by frontend_ready, so the
    // fallback stays the last version KNOWN to boot, not merely the last
    // one installed.
    active.version = version.to_string();
    // Recorded so resolve() can re-check the pairing on every boot, not
    // just at download time: a native installer can land in between.
    active.native = native_version.to_string();
    write_active(&root, &active);

    // Keep the active one and the known-good fallback; sweep the rest.
    if let Ok(rd) = std::fs::read_dir(&root) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let keep = name == active.version || name == active.previous || name == ACTIVE || name == SENTINEL;
            if !keep && e.path().is_dir() {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
    }
    Ok(())
}

/// Apply a staged frontend now, by restarting the app.
///
/// NOT a webview reload. Plan 008 sketched one, and it is genuinely faster,
/// but the page owns the clip hole the video shows through and mpv is a
/// native child window that React's cleanup would not get a chance to tear
/// down. A reload that lands with the hole cut and no page to own it puts
/// the DESKTOP on screen — the exact bug fixed twice already. A restart
/// tears everything down through the path the app already exercises on
/// every exit, and still skips the 35MB installer, which was the point.
///
/// The caller only offers this when nothing is playing; this is the last
/// line of defence, not the policy.
#[tauri::command]
pub fn frontend_apply(app: tauri::AppHandle) {
    app.restart();
}

/// The published `frontend.json`, alongside `latest.json` on a release.
#[derive(serde::Deserialize)]
pub struct Manifest {
    /// The frontend build this bundle is.
    pub version: String,
    /// The native build it REQUIRES. The whole safety property of the hot
    /// channel is this field, so it is checked in Rust, never in the
    /// frontend that is asking to be replaced.
    #[serde(rename = "nativeVersion")]
    pub native_version: String,
    pub url: String,
    pub signature: String,
}

/// What the UI needs to describe the hot channel in one call.
#[derive(serde::Serialize, Default)]
pub struct Status {
    /// Frontend version being served right now. Empty = the embedded one.
    pub serving: String,
    /// Staged and waiting for the next launch. Empty = nothing pending.
    pub pending: String,
}

#[tauri::command]
pub fn frontend_status() -> Status {
    let serving = SERVING.get().cloned().unwrap_or_default();
    let Some(root) = root() else {
        return Status { serving, pending: String::new() };
    };
    let active = read_active(&root);
    // active.version is what the NEXT resolve() will serve. Different from
    // what this run is serving means something was staged since boot.
    let pending = if active.version != serving { active.version } else { String::new() };
    Status { serving, pending }
}

/// The hot channel's manifest URL and verification key, both derived from
/// the SAME updater config that drives the native channel.
///
/// One trust root, one place to rotate it. The manifest sits beside
/// `latest.json` in the release, so the URL is that endpoint with its last
/// segment swapped — deriving it means a moved release URL cannot leave the
/// two channels pointing at different places.
fn channel_config(app: &tauri::AppHandle) -> Result<(String, String), String> {
    let plugins = &app.config().plugins;
    let updater = plugins
        .0
        .get("updater")
        .ok_or_else(|| "no updater config".to_string())?;
    let pubkey = updater
        .get("pubkey")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "no updater pubkey".to_string())?
        .to_string();
    let endpoint = updater
        .get("endpoints")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .and_then(|v| v.as_str())
        .ok_or_else(|| "no updater endpoint".to_string())?;
    let url = manifest_url_from(endpoint)
        .ok_or_else(|| "updater endpoint has no path".to_string())?;
    Ok((url, pubkey))
}

/// `.../latest/download/latest.json` -> `.../latest/download/frontend.json`.
fn manifest_url_from(endpoint: &str) -> Option<String> {
    let (base, last) = endpoint.rsplit_once('/')?;
    if last.is_empty() || !base.contains("://") {
        return None;
    }
    Some(format!("{base}/frontend.json"))
}

/// Is this manifest worth staging? The `nativeVersion` gate is the whole
/// safety property of the hot channel, so it lives in one testable place
/// rather than inline in a network call nothing can exercise.
fn should_stage(m: &Manifest, native: &str, serving: &str, pending: &str) -> bool {
    m.native_version == native && m.version != serving && m.version != pending
}

/// Check the hot channel and stage a newer frontend if there is one.
///
/// Returns the staged version, or an empty string for "nothing to do".
/// Every rejection is a normal outcome, not an error: a mismatched
/// `nativeVersion` simply means this release goes through the installer
/// instead, which is the native updater's job and already works.
///
/// Takes NOTHING from the caller: the manifest URL, the public key and the
/// native version are all read from the binary's own config here. The
/// frontend is the thing being replaced, so it does not get a say in what
/// replaces it.
#[tauri::command]
pub async fn frontend_check(app: tauri::AppHandle) -> Result<String, String> {
    let (manifest_url, pubkey) = channel_config(&app)?;
    let native_version = env!("CARGO_PKG_VERSION").to_string();
    let client = crate::http_client();
    let text = client
        .get(&manifest_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let m: Manifest = serde_json::from_str(&text).map_err(|e| e.to_string())?;

    // The gate. A bundle built against different Rust must be structurally
    // unable to land: anything that does not match falls through to the
    // native channel rather than being forced on.
    let status = frontend_status();
    if !should_stage(&m, &native_version, &status.serving, &status.pending) {
        return Ok(String::new());
    }

    let bytes = client
        .get(&m.url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    // stage() verifies the signature before it unpacks a byte, and refuses
    // a version that has already failed a boot.
    stage(&m.version, &native_version, &pubkey, &m.signature, &bytes)?;
    Ok(m.version)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Build a tar.gz in memory with the given (path, contents) entries.
    fn targz(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut tar = tar::Builder::new(Vec::new());
        for (name, body) in files {
            let mut h = tar::Header::new_gnu();
            h.set_size(body.len() as u64);
            h.set_mode(0o644);
            h.set_cksum();
            tar.append_data(&mut h, name, *body).unwrap();
        }
        let raw = tar.into_inner().unwrap();
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        gz.write_all(&raw).unwrap();
        gz.finish().unwrap()
    }

    /// A tar entry whose NAME is written straight into the header, bypassing
    /// the builder's own validation.
    ///
    /// `Builder::append_data` refuses a non-relative path outright ("paths in
    /// archives must be relative"), so it cannot produce the archive this
    /// test needs. That is a property of the writer, not of tar: a hostile
    /// archive built by anything else can and does carry `../` entries, which
    /// is exactly why `unpack` checks every component itself.
    fn targz_named(name: &str, body: &[u8]) -> Vec<u8> {
        let mut h = tar::Header::new_gnu();
        {
            let raw = h.as_gnu_mut().unwrap();
            let bytes = name.as_bytes();
            raw.name[..bytes.len()].copy_from_slice(bytes);
        }
        h.set_size(body.len() as u64);
        h.set_mode(0o644);
        h.set_cksum();
        let mut tar = tar::Builder::new(Vec::new());
        tar.append(&h, body).unwrap();
        let raw = tar.into_inner().unwrap();
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        gz.write_all(&raw).unwrap();
        gz.finish().unwrap()
    }

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("blammytv-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn unpacks_a_normal_bundle() {
        let dir = tmpdir("ok");
        let gz = targz(&[("index.html", b"<html>" as &[u8]), ("assets/app.js", b"x")]);
        unpack(&gz, &dir).unwrap();
        assert!(dir.join("index.html").is_file());
        assert!(dir.join("assets/app.js").is_file());
        std::fs::remove_dir_all(&dir).ok();
    }

    /// The one that matters. A tar can name anything it likes, including a
    /// path that climbs out of the directory it is being unpacked into.
    #[test]
    fn refuses_an_entry_that_escapes_the_directory() {
        let dir = tmpdir("escape");
        let gz = targz_named("../escaped.txt", b"nope");
        let err = unpack(&gz, &dir).unwrap_err();
        assert!(err.contains("escapes"), "unexpected error: {err}");
        assert!(!dir.parent().unwrap().join("escaped.txt").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn refuses_an_absolute_entry() {
        let dir = tmpdir("abs");
        let gz = targz_named("/tmp/blammytv-absolute-escape", b"nope");
        assert!(unpack(&gz, &dir).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    /// A version string becomes a DIRECTORY NAME, so it is path input.
    #[test]
    fn refuses_a_version_that_is_not_a_version() {
        for bad in ["", "../evil", "a/b", "1.0;rm", "..\\evil"] {
            assert!(
                stage(bad, "0.8.0", "x", "y", b"z").is_err(),
                "accepted a bad version: {bad:?}"
            );
        }
    }

    fn manifest(version: &str, native: &str) -> Manifest {
        Manifest {
            version: version.into(),
            native_version: native.into(),
            url: "https://example.test/f.tar.gz".into(),
            signature: "sig".into(),
        }
    }

    /// The gate that makes a frontend built against different Rust unable
    /// to land. Everything else about this feature is a convenience; this
    /// is the part that keeps it safe.
    #[test]
    fn stages_only_a_bundle_built_for_this_native_version() {
        assert!(should_stage(&manifest("0.8.1", "0.8.0"), "0.8.0", "", ""));
        // Built against newer Rust: the installer channel's problem.
        assert!(!should_stage(&manifest("0.9.0", "0.9.0"), "0.8.0", "", ""));
        // Built against older Rust: equally refused, not "close enough".
        assert!(!should_stage(&manifest("0.8.1", "0.7.0"), "0.8.0", "", ""));
        // Already serving it, or already staged: nothing to do.
        assert!(!should_stage(&manifest("0.8.1", "0.8.0"), "0.8.0", "0.8.1", ""));
        assert!(!should_stage(&manifest("0.8.1", "0.8.0"), "0.8.0", "", "0.8.1"));
    }

    /// The gate has to hold at SERVE time, not only at download time: a
    /// native installer can land underneath a bundle that was perfectly
    /// legitimate when it was staged. Exercised through the record rather
    /// than through resolve(), which reads a real data dir.
    #[test]
    fn a_bundle_staged_for_another_native_version_is_not_served() {
        let stale = Active {
            version: "0.8.2".into(),
            previous: "0.8.1".into(),
            quarantined: vec![],
            native: "0.8.0".into(),
        };
        assert!(stale.native != "0.9.0", "the case resolve() must catch");
        // An older record predates the field entirely. Unknown pairing is
        // treated as a mismatch, never as "probably fine".
        let legacy: Active = serde_json::from_str(r#"{"version":"0.8.2"}"#).unwrap();
        assert_eq!(legacy.native, "");
        assert!(legacy.native != env!("CARGO_PKG_VERSION"));
    }

    /// The two channels must resolve from the same release, so the hot
    /// manifest is derived from the updater endpoint rather than written
    /// out twice and left to drift.
    #[test]
    fn derives_the_manifest_url_from_the_updater_endpoint() {
        assert_eq!(
            manifest_url_from(
                "https://github.com/adam-edword/blammytv/releases/latest/download/latest.json"
            )
            .unwrap(),
            "https://github.com/adam-edword/blammytv/releases/latest/download/frontend.json"
        );
        for bad in ["", "latest.json", "https://host/", "no-slashes"] {
            assert!(manifest_url_from(bad).is_none(), "accepted {bad:?}");
        }
    }

    /// Corrupt signatures must be rejected before anything is unpacked.
    #[test]
    fn rejects_a_bundle_whose_signature_does_not_verify() {
        let err = verify("bm90LWEta2V5", "bm90LWEtc2ln", b"payload").unwrap_err();
        assert!(!err.is_empty());
    }
}

//! The frontend hot channel's READ half (plan 008, phase 1a).
//!
//! Most releases here change nothing native (v0.7.11 shipped 11 patch
//! versions; two touched this crate), yet every one costs a 35MB installer
//! and a restart. `dist/` is ~1.1MB. This module lets a verified, staged
//! copy of the frontend be served INSTEAD of the one baked into the binary.
//!
//! It does not download anything yet. That is deliberate: the recovery path
//! lands before the install path, so at no point does a way to stage a
//! bundle exist without a way to escape a bad one.
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

    if active.version.is_empty() || active.quarantined.contains(&active.version) {
        return None;
    }
    let dir = root.join(&active.version);
    if !dir.join("index.html").is_file() {
        // Staged directory vanished or was never complete: forget it rather
        // than serving a half-frontend.
        eprintln!("[frontend] {} is missing index.html; using embedded", active.version);
        active.version.clear();
        write_active(&root, &active);
        return None;
    }

    // Arm the sentinel for this boot. `frontend_ready` clears it.
    let _ = std::fs::create_dir_all(&root);
    let _ = std::fs::write(&sentinel, active.version.as_bytes());
    eprintln!("[frontend] serving staged {}", active.version);
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
pub fn stage(version: &str, pubkey_b64: &str, sig_b64: &str, bytes: &[u8]) -> Result<(), String> {
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
                stage(bad, "x", "y", b"z").is_err(),
                "accepted a bad version: {bad:?}"
            );
        }
    }

    /// Corrupt signatures must be rejected before anything is unpacked.
    #[test]
    fn rejects_a_bundle_whose_signature_does_not_verify() {
        let err = verify("bm90LWEta2V5", "bm90LWEtc2ln", b"payload").unwrap_err();
        assert!(!err.is_empty());
    }
}

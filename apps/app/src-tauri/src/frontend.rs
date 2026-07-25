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

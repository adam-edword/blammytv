fn main() {
  // tauri-build embeds icons/icon.ico into the exe but doesn't watch it, so an
  // icon swap alone never re-runs the build script (stale icon in incremental
  // builds). Declare it ourselves.
  println!("cargo:rerun-if-changed=icons/icon.ico");
  trakt_keys();
  tauri_build::build()
}

/// The Trakt app's client id (plan 015, D4 a), compiled into the binary.
/// Trakt no longer issues a secret (trakt.rs). Read from the environment,
/// else from apps/app/.env.local, which is gitignored and holds the TMDB key
/// the same way. NOT prefixed VITE_: Vite only hands `VITE_` variables to
/// the page, and the page makes no Trakt call. A build without it has Trakt
/// switched off ("not configured"), which is every CI build. Nothing here
/// prints a value. MyAnimeList's client id (plan 021) comes the same way.
fn trakt_keys() {
  println!("cargo:rerun-if-changed=../.env.local");
  let file = std::fs::read_to_string("../.env.local").unwrap_or_default();
  let from_file = |key: &str| {
    file.lines().find_map(|line| {
      let (k, v) = line.trim().split_once('=')?;
      (k.trim() == key).then(|| v.trim().trim_matches('"').trim_matches('\'').to_string())
    })
  };
  for (key, out) in [
    ("TRAKT_CLIENT_ID", "BLAMMYTV_TRAKT_ID"),
    ("TRAKT_REDIRECT_URI", "BLAMMYTV_TRAKT_REDIRECT"),
    // MyAnimeList (plan 021): a client id only, no secret for type "other".
    ("MAL_CLIENT_ID", "BLAMMYTV_MAL_ID"),
  ] {
    println!("cargo:rerun-if-env-changed={key}");
    let value = std::env::var(key).ok().filter(|v| !v.is_empty()).or_else(|| from_file(key));
    if let Some(v) = value.filter(|v| !v.is_empty()) {
      println!("cargo:rustc-env={out}={v}");
    }
  }
}

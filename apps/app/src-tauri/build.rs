fn main() {
  // tauri-build embeds icons/icon.ico into the exe but doesn't watch it, so an
  // icon swap alone never re-runs the build script (stale icon in incremental
  // builds). Declare it ourselves.
  println!("cargo:rerun-if-changed=icons/icon.ico");
  tauri_build::build()
}

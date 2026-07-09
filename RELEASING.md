# Releasing BlammyTV

The desktop app self-updates from **GitHub Releases** via `tauri-plugin-updater`.
A release is just: bump the version, build signed, and publish a release with the
installer + a `latest.json` manifest. Existing 0.2.0+ installs then update
themselves on next launch.

## One-time setup (already done)

1. Generate the updater signing keypair:
   ```powershell
   pnpm tauri signer generate -w $HOME\.tauri\blammytv.key
   ```
   This writes `blammytv.key` (private) and `blammytv.key.pub` (public).
2. Put the **public** key in `apps/app/src-tauri/tauri.conf.json` → `plugins.updater.pubkey`.
3. Keep `blammytv.key` and its password **safe and private** — never commit them.
   Lose the private key and existing installs can't accept updates (they'd need a
   fresh manual install with a new key).

## Hard-won rules (2026-07-09, the first rebuild release)

- **Dev bumps touch only the three frontend files** (root+app package.json,
  version.ts). Cargo.toml + tauri.conf.json stay at the LAST RELEASED
  version between releases — touching either makes every `git pull`
  recompile Rust for no reason. They jump straight to the new version in
  the release commit itself.

- **One shell, one build, one upload.** The `TAURI_SIGNING_*` env vars die
  with the PowerShell window; a rebuild without them produces an UNSIGNED
  exe and errors only at the end. Never mix an exe and a `.sig` from
  different builds — every build makes a new pair, and the updater
  rejects a mismatched one (correctly).
- **The 0.2.x tag namespace up to v0.2.4a is BURNED** by the pre-rebuild
  app's releases. Never reuse an existing tag: GitHub attaches your
  release to the old tag/commit, silently refuses same-name asset uploads
  until the old asset is deleted, and the old releases' own latest.json
  manifests make `releases/latest` ambiguous. The rebuild line continues
  from v0.2.5.
- **Always tick "Set as the latest release"** when publishing — it pins
  what `releases/latest/download/latest.json` (the URL every installed
  app polls) resolves to, deterministically.
- Verification is cheap: the sig math can be checked against the uploaded
  exe before shipping the manifest (blake2b-512 of the file, Ed25519
  against tauri.conf's pubkey — the remote session does this on request).

## Per release

**Lazy path:** `.\scripts\release.ps1` does steps 2 of the below in one go —
prompts for the key password (never echoed), builds signed NSIS, wipes the
env vars, and puts the `.sig` on the clipboard. Steps 0 (libmpv refresh),
1 (version bump) and 3+ (publish) still apply.


0. **Refresh the bundled libmpv** (the installer ships
   `apps/app/src-tauri/libmpv-2.dll` via `tauri.windows.conf.json`; the DLL
   is gitignored, so each release machine keeps its own copy current):
   ```powershell
   node scripts/fetch-libmpv.mjs   # needs 7-Zip; prints manual steps if not
   ```
   The app degrades gracefully on older mpv builds (e.g. the settings-glass
   frost needs gpu-next; without it the card goes solid) — but ship current.

1. **Bump the version** in all four spots (they must agree — the updater compares
   against `tauri.conf.json`):
   - `apps/app/src-tauri/tauri.conf.json` → `version`
   - `apps/app/src-tauri/Cargo.toml` → `[package] version`
   - `apps/app/package.json` → `version`
   - `apps/app/src/version.ts` → `APP_VERSION`

2. **Build signed** (from `apps/app`):
   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $HOME\.tauri\blammytv.key -Raw
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password>"
   pnpm tauri build
   ```
   Outputs (under `apps/app/src-tauri/target/release/bundle/`):
   - `nsis/BlammyTV_<version>_x64-setup.exe`
   - `nsis/BlammyTV_<version>_x64-setup.exe.sig`  ← the signature

3. **Write `latest.json`** (the update manifest the app polls). `signature` is the
   entire contents of the `.sig` file; `url` points at the installer asset on the
   release you're about to publish:
   ```json
   {
     "version": "<version>",
     "notes": "What changed in this release.",
     "pub_date": "<ISO 8601, e.g. 2026-06-24T00:00:00Z>",
     "platforms": {
       "windows-x86_64": {
         "signature": "<paste the full contents of the .exe.sig file>",
         "url": "https://github.com/adam-edword/blammytv/releases/download/v<version>/BlammyTV_<version>_x64-setup.exe"
       }
     }
   }
   ```

4. **Publish the GitHub Release** (GitHub → Releases → Draft a new release):
   - Tag: `v<version>` (e.g. `v0.2.0`).
   - Upload `BlammyTV_<version>_x64-setup.exe` as an asset.
   - Upload `latest.json` as an asset.
   - Publish.

   The updater endpoint is
   `https://github.com/adam-edword/blammytv/releases/latest/download/latest.json`,
   so the latest published release's `latest.json` is what every install sees.

## Notes

- The installer is **unsigned for Windows SmartScreen** (separate from updater
  signing) — testers click "More info → Run anyway" on first install.
- A build with `bundle.createUpdaterArtifacts: true` (our config) **fails** unless
  the `TAURI_SIGNING_*` env vars are set — that's intentional.
- Installs older than the first updater-enabled build (0.2.0) can't auto-update;
  hand those testers the new `-setup.exe` once, then they're on the auto track.

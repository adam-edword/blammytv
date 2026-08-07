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
3. Keep `blammytv.key` and its password **safe and private**: never commit them.
   Lose the private key and existing installs can't accept updates (they'd need a
   fresh manual install with a new key).
   **BACK UP the key file AND its password to 2+ durable places (password
   manager + external/cloud).** This is the one irreplaceable artifact: it is
   not in git and lives only at `%USERPROFILE%\.tauri\blammytv.key`.

> **KEY ROTATED 2026-07 (Windows reinstall).** The original updater key
> `5FD3E10724DF10F7` (id `f710df2407e1d35f`) was lost when the build machine
> was wiped without a backup. A new keypair `163EBD51B4EE3232` was minted and
> its public half now lives in tauri.conf.json. **Consequence:** every install
> shipped before **v0.5.4** has the OLD pubkey compiled in and CANNOT
> auto-update to v0.5.4 or later. Those users must **manually reinstall
> v0.5.4's `-setup.exe` once**, after which auto-update resumes on the new key.
> v0.5.4 is the first release signed with the new key.

## Code signing, and the 2026-08-07 "the app uninstalled itself" reports

**Status: CONFIRMED 2026-08-07. Windows Defender, a false positive.**

    Threat blocked                      Severe
    Detected: Trojan:Win32/Bearfoos.A!ml
    Status:   Removed
    file: C:\Users\<user>\AppData\Local\BlammyTV\app.exe

The `!ml` suffix is the tell: a machine-learning heuristic, not a signature
match on known malware. Two things fed it, and both are fixable.

**1. The main binary was named `app.exe`.** `[package] name = "app"` in
Cargo.toml, with no `mainBinaryName` override, produced a generic `app.exe`
sitting in `AppData\Local` — which is precisely where droppers put
generically-named payloads, and a strong ML feature on its own. Fixed in
tauri.conf.json: `"mainBinaryName": "BlammyTV"` ships `BlammyTV.exe`.
Tauri's NSIS template deletes `$OldMainBinaryName` on update, so existing
installs migrate rather than keeping a stray `app.exe`. **This lands on the
next NATIVE release; a frontend-only release cannot carry it.**

**2. The installer is unsigned** (see below). Nothing else moves the needle
as much as a certificate.

**Also do this, it is free and it works:** submit the binary to Microsoft as
a false positive at <https://www.microsoft.com/en-us/wdsi/filesubmission>
(pick "Software developer", "Incorrectly detected"). Turnaround is usually a
few days, and the detection is withdrawn fleet-wide. Re-submit after each
release until the signing cert is in place, because an unsigned binary earns
no reputation carry-over between builds.

**For affected users, right now:** Windows Security → Protection history →
the entry → Actions → **Restore**, then reinstall. Adding an exclusion for
`%LOCALAPPDATA%\BlammyTV` prevents a repeat on that machine.

---

Original investigation, kept because the ruled-out list is the useful part:

Two users reported the app vanishing from their PC mid-use, one right after
pressing SOURCES on a Continue Watching card. What the investigation found:

**Ruled out, with evidence:**

- **The button cannot do it.** `onSources` and `onOpen` on `ContinueCard` are
  the same call, `requestResumeInStream(e)` — it sets a module variable and
  dispatches a `CustomEvent`. Pressing SOURCES does exactly what opening the
  card does, which every user does constantly.
- **Nothing in the app can delete an install.** The frontend reaches the disk
  only through registered Tauri commands. Every destructive op in
  `src-tauri/` writes inside `%APPDATA%\com.blammytv.app` (frontend.rs, the
  hot-update staging) or `%TEMP%` (the snapshot PNG). We spawn no processes:
  `grep Command::new src-tauri/src/` is empty.
- **The updater does not uninstall.** This was the best theory —
  `installMode: "quiet"` maps to NSIS `/S /R`, and an NSIS upgrade normally
  runs the old uninstaller first. It does not here. tauri-bundler's
  `installer.nsi`, in `PageLeaveReinstall`:

      ; In update mode, always proceeds without uninstalling
      ${If} $UpdateMode = 1
        Goto reinst_done

  tauri-plugin-updater always appends `/UPDATE`, so the upgrade path installs
  over the top and never removes anything.

**What was left, and what it turned out to be:** the shipped installer is
**UNSIGNED**.
Verified against the published v0.8.163 binary by reading its PE header —
the Certificate Table data directory is `rva=0 size=0`, i.e. no Authenticode
signature at all. An unsigned, low-reputation NSIS app that loads a DLL at
runtime, streams from arbitrary hosts, and self-updates by downloading and
executing an .exe is squarely in Defender's heuristic territory
(`Wacatac`/`Wacapew`-class detections). A cloud signature landing quarantines
the binary on **every affected machine at once**, which fits "it happened to
someone else just now too" far better than any UI interaction does. To a
user, a quarantined exe plus a dead shortcut reads exactly as "it uninstalled
itself".

**How this was confirmed (Defender's own record, above):**

    Windows Security → Virus & threat protection → Protection history

or, in PowerShell:

    Get-MpThreatDetection | Select-Object -Property ThreatID,InitialDetectionTime,Resources



**The real fix is an Authenticode certificate** (OV is cheap but earns
SmartScreen reputation slowly; EV buys reputation immediately). That is a
purchase decision, not a code change. Until then, expect this to recur, and
expect it to hit users in batches rather than one at a time.

## Hard-won rules (2026-07-09, the first rebuild release)

- **Dev bumps touch only the three frontend files** (root+app package.json,
  version.ts). Cargo.toml + tauri.conf.json stay at the LAST RELEASED
  version between releases: touching either makes every `git pull`
  recompile Rust for no reason. They jump straight to the new version in
  the release commit itself.

- **One shell, one build, one upload.** The `TAURI_SIGNING_*` env vars die
  with the PowerShell window; a rebuild without them produces an UNSIGNED
  exe and errors only at the end. Never mix an exe and a `.sig` from
  different builds: every build makes a new pair, and the updater
  rejects a mismatched one (correctly).
- **The 0.2.x tag namespace up to v0.2.4a is BURNED** by the pre-rebuild
  app's releases. Never reuse an existing tag: GitHub attaches your
  release to the old tag/commit, silently refuses same-name asset uploads
  until the old asset is deleted, and the old releases' own latest.json
  manifests make `releases/latest` ambiguous. The rebuild line continues
  from v0.2.5.
- **Always tick "Set as the latest release"** when publishing: it pins
  what `releases/latest/download/latest.json` (the URL every installed
  app polls) resolves to, deterministically.
- Verification is cheap, and now one command:
  ```powershell
  node scripts\verify-release.mjs `
    apps\app\src-tauri\target\release\bundle\nsis\BlammyTV_<version>_x64-setup.exe `
    apps\app\src-tauri\target\release\bundle\nsis\BlammyTV_<version>_x64-setup.exe.sig
  ```
  Offline, no key needed. It checks four things and names the one that
  fails: the key id against tauri.conf's pubkey (so a signature from the
  ROTATED-OUT key is caught before it ships), minisign's global signature
  so the trusted comment is authentic, that the comment names the file you
  handed it (this is the exe/sig mismatch guarded against above), and
  finally Ed25519 over blake2b-512 of the bytes. Works on the frontend
  tar.gz too.

- **Verify the signature BEFORE writing the manifest, and verify the
  manifest after publishing.** Hand the same script a `latest.json` or a
  `frontend.json` and it checks everything around the signature too:
  ```powershell
  node scripts\verify-release.mjs latest.json            # fetches + verifies the published asset
  node scripts\verify-release.mjs latest.json <exe>      # or verifies a local one, offline
  ```
  It reads the manifest's kind off its shape, then checks that the version
  is declared, that a `frontend.json`'s `nativeVersion` equals
  tauri.conf's (a stale one is silently ignored by the app, not an error),
  that the `signature` field is an actual minisign signature and not a
  placeholder, that it names the asset the `url` points at, that the asset
  filename carries the manifest version, that the url resolves, and that
  the signature covers the bytes actually sitting at that url. Add
  `--offline` to skip the fetch.

  **v0.8.163 shipped both failures this catches**: a `latest.json` whose
  signature still read "PASTE THE FULL CONTENTS OF ..." (the in-app update
  failed for everyone until it was replaced), and a `frontend.json` naming
  a bundle nobody uploaded. Neither is a crypto problem, so verifying the
  `.sig` alone said nothing about either. Run manifest mode on the live
  URL once the release is published — it takes eight seconds.

## Per release

**Lazy path:** `.\scripts\release.ps1` does steps 2 of the below in one go:
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
   frost needs gpu-next; without it the card goes solid), but ship current.

1. **Bump the version** in all four spots (they must agree: the updater compares
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

3. **Verify the `.sig` against the exe, THEN write `latest.json`** (the update
   manifest the app polls). Verifying first is the order that matters: a
   manifest is only as good as the signature pasted into it, and the paste is
   the step that goes wrong. `signature` is the entire contents of the `.sig`
   file; `url` points at the installer asset on the release you're about to
   publish:
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

5. **Verify what you published**, against the live URLs, not your local copies:
   ```powershell
   curl -sL -o latest.live.json https://github.com/adam-edword/blammytv/releases/latest/download/latest.json
   node scripts\verify-release.mjs latest.live.json
   ```
   This downloads the asset the manifest names and checks the signature over
   its bytes, so a green run means an install will accept the update. Do the
   same for `frontend.json` if the release published one. Eight seconds, and
   it is the difference between "I published a release" and "the release
   works".

## Frontend-only release (the hot channel, plan 008)

Most releases change nothing native. Those do not need an installer at all:
the app can fetch a ~1MB signed frontend bundle and serve it on the next
launch. Same signing key, same trust root, separate manifest.

**Use this path only when `apps/app/src-tauri/` is untouched since the last
native release.** If any Rust, mpv, installer or updater config changed, it
is a native release, full stop — the `nativeVersion` gate below will refuse
the bundle anyway, but do not make the app prove it for you.

1. **Bump the three frontend files only** (root + app `package.json`,
   `version.ts`). `tauri.conf.json` and `Cargo.toml` stay where the last
   NATIVE release left them: their version is what the bundle must declare
   as `nativeVersion`, and it is what the native updater compares.

2. **Build and pack** (from `apps/app`):
   ```powershell
   pnpm build
   tar -czf frontend-<version>.tar.gz -C dist .
   ```
   **tar.gz, not zip**, and the archive's paths are relative to `dist/` so
   `index.html` sits at the archive root. The unpacker refuses absolute
   paths and anything containing `..`, so a wrongly-rooted archive fails
   closed rather than scattering files.

3. **Sign it with the same key:**
   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $HOME\.tauri\blammytv.key -Raw
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password>"
   pnpm tauri signer sign frontend-<version>.tar.gz
   ```
   Produces `frontend-<version>.tar.gz.sig`, the same shape as the
   installer's.

4. **Write `frontend.json`:**
   ```json
   {
     "version": "<frontend version>",
     "nativeVersion": "<tauri.conf.json version, unchanged>",
     "url": "https://github.com/adam-edword/blammytv/releases/download/v<version>/frontend-<version>.tar.gz",
     "signature": "<full contents of the .tar.gz.sig file>"
   }
   ```

5. **Publish the release with the bundle, the `.sig` and `frontend.json`.**
   **Do NOT upload a `latest.json`.** That file is the native updater's
   trigger; omitting it is what keeps the installer channel quiet. Still
   tick "Set as the latest release", because the hot channel resolves its
   manifest from `releases/latest/download/` too.

6. **Verify the bundle before step 4, and the manifest after step 5**, exactly
   as for an installer:
   ```powershell
   node scripts\verify-release.mjs frontend-<version>.tar.gz frontend-<version>.tar.gz.sig
   # ...then, once published:
   curl -sL -o frontend.live.json https://github.com/adam-edword/blammytv/releases/latest/download/frontend.json
   node scripts\verify-release.mjs frontend.live.json
   ```
   The app verifies too and refuses to unpack a byte on mismatch, but a bad
   bundle should never reach a user in the first place — and a manifest
   pointing at a missing bundle fails silently, which is worse than loudly.

**Native releases additionally publish a `frontend.json`** whose
`nativeVersion` equals the new native version, so a user who installs it
starts receiving hot updates for that line.

### What the app does with it

- Checks a few seconds after launch, silently. A mismatched `nativeVersion`
  is a no-op, not an error: that release goes through the installer.
- Verified, unpacked beside the live one, then pointed at. The running app
  is never modified.
- Applied on the **next launch**. Settings offers a "Restart now"
  accelerator, disabled while something is playing.
- If a staged bundle fails to boot, the next launch quarantines it and
  falls back — previous bundle first, then the one built into the binary.
  That is why `frontend_ready` is called at the React root with nothing in
  front of it.
- **A native install resets the hot channel.** The bundle a user is running
  was gated against the native version they had; once an installer lands,
  that pairing is gone, so the app goes back to the frontend built into the
  new binary and re-checks from there. So a native release's frontend must
  be complete on its own, which it always is: it is just `dist/`.

## Notes

- The installer is **unsigned for Windows SmartScreen** (separate from updater
  signing): testers click "More info → Run anyway" on first install.
- A build with `bundle.createUpdaterArtifacts: true` (our config) **fails** unless
  the `TAURI_SIGNING_*` env vars are set. That's intentional.
- Installs older than the first updater-enabled build (0.2.0) can't auto-update;
  hand those testers the new `-setup.exe` once, then they're on the auto track.

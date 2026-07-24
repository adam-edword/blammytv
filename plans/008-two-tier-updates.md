# 008: Two-tier updates: a frontend hot channel behind the installer

- **Status**: PLANNED. Not started. **Phase 0 is a decision gate**, see below:
  the whole shape of this depends on one fact about Tauri v2 that must be
  verified before any of it is built.
- **Severity**: MEDIUM (no user-visible bug; compounding leverage)
- **Category**: Release pipeline / updater
- **Estimated scope**: Rust (protocol handler, verify, staging, failsafe) +
  a small frontend surface + release-drill changes. Multi-session.
- **Origin**: Adam, 2026-07-23, from a friend's suggestion about silent
  installs. Quiet native installs shipped in v0.7.2; this is the other half.

## Problem

Every release is a 35MB installer, an app exit, an install, and a relaunch,
**even when nothing native changed**. That is the normal case, not the
exception:

- v0.7.11 shipped 11 patch versions. Exactly two touched `src-tauri`.
- The entire v0.6.x polish train (roughly 25 versions) was frontend-only.
  In this repo that is literally the `git pull` to hot reload line at the
  end of most task reports.

So the common case pays the rare case's cost. A CSS fix costs a user 35MB
and a restart. Meanwhile `dist/` is about 1.1MB after the v0.6.1 debloat,
which is roughly **30x smaller** than the installer that carries it.

The prize is that most future releases stop being an event.

## Target

Two channels, chosen by what actually changed:

| Change touches | Channel | User experience |
| --- | --- | --- |
| `src-tauri` (Rust, mpv, installer, updater) | Native | Today's flow, now silent (v0.7.2 quiet mode) |
| Frontend only | **Hot** | ~1MB download, staged in the background, applied with a webview reload |

`latest.json` keeps its exact current meaning and keeps driving the Tauri
updater. The hot channel gets its **own** manifest asset, because the two
must not be conflated: bumping `latest.json`'s `version` is precisely what
tells the Tauri updater to go fetch an installer.

```jsonc
// frontend.json, published alongside latest.json on a release
{
  "version": "0.8.3",        // the frontend build this bundle is
  "nativeVersion": "0.8.0",  // the native build it REQUIRES
  "url":  "https://github.com/.../releases/download/v0.8.3/frontend-0.8.3.zip",
  "signature": "<minisign, same key as the installer>"
}
```

The client rule is one line: **apply the hot bundle only when
`nativeVersion` equals the running native version.** Anything else falls
through to the native channel. That makes a frontend bundle that assumes a
new Rust command structurally unable to land on an app that lacks it.

## Phase 0: the decision gate (do this FIRST, alone)

**Question: can the app serve its frontend from disk without changing the
page's ORIGIN?**

This is load-bearing and everything downstream branches on it.
`localStorage` and IndexedDB are partitioned by origin, and this app keeps
essentially all of its state there:

- playlists, **including Xtream server/username/password**
- the Themes Pass **license key**
- accent, theme pack, scale, clock, adult filter, skip behavior, overlay
  meta, playback prefs, favorites, recents, watch progress
- the whole `liveCache` IndexedDB store (the 97MB-guide snapshot)

If the origin changes, every one of those is orphaned. Losing a user's
saved credentials and their paid license key to a cosmetic update would be
a catastrophic own-goal, and cross-origin storage is not readable, so there
is no clean migration to write afterwards.

Three candidate answers, in order of preference:

1. **Override the built-in asset resolution, same origin.** Tauri v2 serves
   the embedded `frontendDist` over its own scheme. If a registered
   protocol handler can take over that same scheme/host and decide per
   request whether to return embedded bytes or staged bytes, this is done
   and nothing else in this section matters. VERIFY THIS FIRST: it is
   cheap to test and it collapses the risk to near zero.
2. **Custom scheme from the start, plus a state migration.** Move to
   `app://blammytv/` and serve everything ourselves. Requires migrating
   localStorage and IndexedDB off the old origin, which cannot be done from
   the new origin. Would need a one-shot bridge shipped in a NATIVE release
   first (old origin reads its own storage, hands it to Rust, new origin
   reads it back), i.e. a full release cycle of prep before the feature.
3. **Move persisted state to a Rust-side store first.** Correct long-term
   (it also fixes "settings are invisible to the backend" and would make
   backups possible), but it is its own project and would gate this one
   behind it.

**Do not write any of Phase 1+ until Phase 0 has an answer.** If the answer
is (2) or (3), stop and re-plan: the cost profile changes completely and
this may no longer be the right thing to build next.

## Phase 1: verified staging (Rust)

- Download the zip to a temp path.
- **Verify the minisign signature against the same public key already in
  `tauri.conf.json`** before unpacking a single byte. Reuse the existing
  keypair: Adam already holds the private key and the trust root is already
  established. `minisign-verify` is a small crate; the alternative is
  reaching into `tauri-plugin-updater`'s internals, which is not public API.
- Unpack to `<appdata>/frontends/<version>/`, never over the live one.
- Flip a pointer (a tiny `active.json`) only after the unpack fully
  succeeds. **Atomic swap, not in-place mutation**: a half-written frontend
  is a bricked app.
- Keep exactly the previous version on disk for rollback; prune the rest.

## Phase 2: the failsafe (the part that must not be skipped)

**The update mechanism lives inside the thing being updated.** A frontend
bundle that throws before React mounts takes the update UI with it, and the
user has no way back except reinstalling. So the native side owns recovery
and never trusts the staged bundle:

- Write a boot sentinel before loading a staged frontend; clear it once the
  frontend reports itself alive (one `invoke` from a `useEffect` at the app
  root is enough).
- On startup, if the sentinel from the previous run is still set, **discard
  the staged frontend and fall back**: first to the previous staged version,
  then to the embedded one. The embedded frontend ships in the binary and
  is therefore always present and always known-good for that native build.
- Two consecutive failures should also quarantine that version so it is not
  re-downloaded in a loop.

This is the difference between a nice feature and a support nightmare.

## Phase 3: apply policy (a real UX decision, not an implementation detail)

The naive read of "no restart" is to reload the webview the moment a bundle
lands. That is wrong here. A reload destroys the React tree **while mpv
keeps playing underneath it**, because mpv is a native child window owned by
Rust, not by the page. Recommended policy instead:

- Stage silently, always.
- **If nothing is playing**: the update chip becomes "Reload to update", a
  sub-second operation.
- **If something is playing**: hold it. Apply on next launch, which is
  instant and involves no installer at all.

Default to applying at next launch even if the user never clicks. That
alone removes the 35MB download, the installer, and the relaunch, which is
already the bulk of the win.

## Risks and scars

- **The mpv teardown on reload.** `InvertedPlayer` sets its internal
  `opened` flag synchronously and its cleanup calls `inv_stop`. A hard
  webview reload may not run React cleanup at all, which would leak the
  child HWND (see also `inv.rs`, which already leaks it on a failed
  `play_wid`). **A reload must go through an explicit native teardown
  first**, not rely on component unmount.
- **The clip hole.** The shell paints opaque and cuts a hole for mpv. If a
  reload lands while the hole is cut and the new page has not yet taken
  ownership of it, that is the DESKTOP on screen, which is the exact bug
  class fixed twice already (v0.6.x tune gate, v0.7.9 episode gate). Heal
  the hole natively before reloading.
- **CSP is currently `null`** (`tauri.conf.json`), and tightening it is a
  1.0 gate. Serving from a different source is the moment that decision
  gets harder, so do not let this feature quietly make CSP harder to add.
- **Version display.** `version.ts` is compiled INTO the bundle, so the
  hot channel updates it correctly and for free. But `tauri.conf.json`'s
  version (what the native updater compares) will now legitimately differ
  from what the user sees in the header. Decide what the About/header shows:
  probably `0.8.3 (native 0.8.0)`.
- **Do not ship a hot bundle built against different Rust.** The
  `nativeVersion` gate is the whole safety property. It must be enforced in
  Rust, not just in the frontend that is asking to be replaced.

## Release drill changes

`RELEASING.md` gains a frontend-only path:

1. `pnpm build`, zip `dist/`.
2. Sign the zip with the existing key (same `TAURI_SIGNING_PRIVATE_KEY`).
3. Upload the zip plus `frontend.json`. **Do not touch `latest.json`**, so
   the native updater stays quiet.
4. The session verifies the signature before the manifest is published,
   exactly as it already does for installer `.sig` files.

Native releases keep today's drill and additionally publish a
`frontend.json` whose `nativeVersion` equals the new native version.

## Verification

- A staged bundle with a **corrupt signature** is rejected and never
  unpacked.
- A bundle whose `nativeVersion` does not match is never applied.
- A bundle that throws on boot is discarded on the next launch and the app
  comes back on the embedded frontend.
- Storage survives an update: playlists, license key, and watch progress
  are all intact afterwards. **This is the acceptance test that matters
  most**; test it before anything else is called done.
- mpv is not orphaned by an apply-time reload (no stray child window, no
  second provider connection).

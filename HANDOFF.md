# Handoff — fresh-session bootstrap

Read order: **CLAUDE.md** (how we work — binding) → **ROADMAP.md** (what's
built, in what order, and every scar) → this file (live state, environment
knowledge that isn't in the repo, and the queue). Update this file when the
live state changes materially; it's the first thing the next session reads.

## What this is

BlammyTV: a Tauri v2 (Rust + React/TS) **Windows desktop** app — the one-app
solution for IPTV and Stremio content. An ultra-premium native IPTV
experience (mpv composited into the window) plus an elegant
Stremio/AIOStreams hub. Desktop **Telly** is the live-TV quality bar.
Audience: switchers from other Windows IPTV clients, Stremio users, ideally
both — and explicitly *inviting to newcomers*; first-five-minutes activation
weighs as much as switcher parity. NOT a living-room/TV-remote product.

## Live state (2026-07-08, v0.1.110)

- Branch `claude/blammytv-rebuild-xclzto` — the only branch; never push
  elsewhere. Adam pulls it and runs `pnpm tauri dev` on Windows.
- Just landed: audio/subtitle track menus in TheaterOverlay (v0.1.110-112,
  frontend-only — comp.rs's tracks push/selectAudio/selectSub were already
  complete; verified 12/12 headless with a mocked bridge via
  `scripts/verify-overlay-tracks.mjs`). Buttons always visible, grayed when
  nothing to choose (v0.1.112, Adam's call). Receipt of the comp.rs tracks
  push was confirmed on Adam's Windows machine via a temporary debug chip
  (v0.1.111, removed in v0.1.112): a real channel read `1 audio / 0 subs ·
  eng` — the push pipeline is healthy end-to-end; no Rust change needed. Before that: the gradient-ring brand mark
  (`public/logo.png` + `logo.svg` in the header, full `src-tauri/icons`
  set; `build.rs` watches `icon.ico` so swaps re-embed), the load-time saga
  (11s → ~4s cold → 0.24s hydrated launch) and the tune watchdog — ROADMAP
  has them in full.
- Adam's terminal `[http]`/`[live]` logs are the ground truth for perf and
  networking claims — ask him to paste them. That measure→fix→paste loop
  settled every perf question so far; keep using it.

## THE BIG ONE — layer inversion (see ROADMAP "Layer inversion")

Probed Desktop Telly's window tree on Adam's machine: it's OUR STACK
(wry/WebView2 + native mpv child) with the layers INVERTED — transparent UI
webview above bottom-parked video. **Spike PASSED on Adam's machine (first
build, v0.1.115)** — video through the hole, chrome above video, flip model
clean; glass over video is tint-only (status quo, not a regression). **A0
landed (v0.1.116): the inverted player runs in the real app behind a dev
flag — Ctrl+Shift+U flips old ↔ new and reloads.** A0+A1 verified on
Windows (theater, fullscreen, inline chrome, Settings over live video).
**Modal-over-video treatment settled after four iterations (ROADMAP has
the full A2→A5 arc): the answer is A5 (v0.1.122) LIVE REGION FROST — mpv
GPU-blurs only the rect under the centered settings card (rect baked into
the shader source, no version dependencies), video visibly playing
everywhere, hole scrim 0.25. Adam's constraints that got us here: video
must VISIBLY play behind the panel (killed frozen-frame A4), whole-frame
blur looked wrong (killed A2 frost), render-API/DComp rejected on
presentation-path grounds. Dormant-but-kept: mpv_blur (whole-frame),
mpv_snapshot (thumbnails someday).** mpv.rs has gained exactly TWO
additive fns (set_glsl_shaders, screenshot_to_file) — do-not-touch
exceptions covered by Adam's rip authorization. `[mpv] <version>` prints
to the terminal on inverted open — feeds the pending libmpv-upgrade /
gpu-next decision. **ARCHITECTURE COMMITTED (Adam, 2026-07-09: "100%"): inverted is the
DEFAULT as of v0.1.132.** Ctrl+Shift+U = legacy escape hatch until the
v0.2.0 deletion. Remaining v0.2.0 gates: desk parity pass (popout + HDR
brightness), mid-play death detection (headless, mpv_status), review
fleet, test backfill, then the deletion itself.

**Frost diagnosis CLOSED (v0.1.127-129):** placement was fine all along —
the "unblurred" line was the hole-rim seam where CSS backdrop blur (shell)
meets mpv frost (video); two blur systems, hard clip between them. A
whole-rim --bg feather read as a giant vignette (reverted). Adam accepted
the seam ("live with it"); a future fix must scope to card∩rim only. The
frost debug tint/logging was removed in v0.1.129; `[mpv] frost requested,
vo=` (capability) stays. v0.1.129 also fixed the inline overlay's stale
state across channel switches (playbackKey prop resets paused/live-edge
and re-pushes volume/mute to the fresh mpv instance).

**Welcome/boot animation merged (PR #5 → v0.1.125):** Figma-motion boot
lockup, session-gated, skippable, reduced-motion aware; ?welcome=1
replays. The PR missed version.ts (classic slip) — fixed in the merge. The rip is Adam-
approved; comp.rs/mpv.rs still do-not-touch until the inverted path is
default and the v0.2.0 deletion milestone formally starts. Main window is
now transparent:true (tauri.conf) — if Adam reports flag-OFF visual
regressions (launch flash, window shadow), that change is the suspect.

## Immediate queue (user-approved order)

1. ~~**Track menus**~~ — SHIPPED v0.1.110-112 (see live state above).
2. ~~**Adult-hide by default**~~ — SHIPPED v0.1.113 (ROADMAP slate #6 has
   the full mechanics + verify evidence).
3. Waiting on Adam's Figma: **Ctrl+K search palette** (#1) and **first-run
   onboarding** (#4). He's designing both — don't start them without his
   designs or an explicit go.
4. Batched for a Windows-native pass at Adam's desk (don't attempt
   headless): comp.rs END_FILE/error event (mid-play death detection),
   WM_SETCURSOR handler, DComp corner clip, async-close channel-switch
   tighten. Post-1.0 headliner: recording to disk.

## Environment (remote container)

- **Rust does not build here** — Windows-target app, Linux sandbox lacks
  GTK. Verify Rust/Tauri API claims against crate source (tauri is
  version-LOCKED; check `Cargo.lock` before citing an API). The cargo
  registry is NOT in fresh containers — fetch locked sources with
  `curl -A "blammytv-dev" https://static.crates.io/crates/<name>/<name>-<ver>.crate`
  into the scratchpad and untar (the crates.io API path 403s without a UA).
- **Headless verification**: chromium at `/opt/pw-browsers/chromium`;
  `npm i playwright-core` in the session scratchpad, then
  `chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })`.
  Serve the app with `pnpm build` + `vite preview` (:4173) and seed
  `blammytv.playlists` in localStorage via `addInitScript`.
- **Fake Xtream panels live in `scripts/`** (rescued from a dead container;
  keep them in-repo): `fake-panel.mjs` (:8081, 4 channels, wiring/behavior
  coverage) and `perf-panel.mjs` (:8090, synthesizes 20k streams + ~50MB
  xmltv at real-provider scale; takes a real `get_live_streams` dump path
  to use actual data, `STREAMS=220000` for hardening scale).
- Gates before every push: `pnpm typecheck && pnpm lint && pnpm test`
  (+ `pnpm build` when styles/geometry changed). 69 tests green at handoff.
- The scratchpad is EPHEMERAL — anything worth keeping goes in the repo.
  Two scratchpad-only reports died with an earlier container
  (LIVE_TV_1.0_FEATURES.md, CODE_REVIEW_v0.1.md); their conclusions are
  distilled in ROADMAP's slate section, and the review findings were fixed.
- A website mood-board artifact (Raycast/Apple direction, approved) is
  published on claude.ai — find it via the Artifact tool's list action if
  the landing-page work resumes.

## Landmines (the expensive ones; ROADMAP's "Scars" notes have more)

- **`src-tauri/comp.rs` and `mpv.rs` are do-not-touch** without an explicit
  ask from Adam. `lib.rs#http_get` is fair game (established precedent).
- **native-tls (Schannel) is a TLS-fingerprint fix** — AIOStreams 403'd the
  default stack with identical headers. Never swap reqwest's TLS backend.
  reqwest is `default-features = false`; every listed feature
  (gzip/brotli/deflate) is there on purpose.
- **Never log a full URL** — Xtream credentials live in the query string
  and path. The `[http]` Rust log already strips queries; keep that
  property everywhere, both sides of the bridge.
- **Single-flight in `source.ts`**: the in-flight slot is claimed
  SYNCHRONOUSLY before any await. An `await` between the join-check and
  the claim re-opens the StrictMode double-load race (bit us twice).
- **Version protocol**: every user-visible change bumps THREE files — root
  `package.json`, `apps/app/package.json`, `apps/app/src/lib/version.ts`.
  Missing `version.ts` is the classic slip (header shows a stale version;
  happened at v0.1.108, fixed in v0.1.109).
- Xtream numeric fields arrive as strings (`tv_archive`, `category_id`,
  `tv_archive_duration`…) — coerce defensively.
- In this container's Bash, `pkill` exits 144 and silently aborts `&&`
  chains — run it as its own isolated command.
- End every task the CLAUDE.md way: completion status, commit + push, then
  the one-line restart instruction with the real version number
  (frontend-only → "`git pull` to hot reload"; Rust/icons → "needs
  rebuild").

## Working with Adam

Warm and informal; fast, earned trust. He wants an opinion held and stated
— the no-guessing rule in CLAUDE.md is his, and he means it. He measures on
his own machine and pastes real logs; treat those as the deciding
experiment. He designs in Figma (the palette and onboarding are his) —
build to his designs rather than designing those surfaces out from under
him. Timeshift/catch-up is shelved because his provider advertises but
doesn't serve it — don't resurrect it without a provider that does
(groundwork + resume path documented in ROADMAP and `stream.ts`).

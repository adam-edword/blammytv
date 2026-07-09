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

- Branch `claude/blammytv-rebuild-xclzto-uz75yh` — the working branch;
  never push elsewhere. Adam pulls it and runs `pnpm tauri dev` on Windows.
  NOTE for the next Windows rebuild: cargo will rewrite Cargo.lock (the
  v0.1.135 Cargo.toml trim couldn't be locked here — no Rust toolchain);
  commit that lockfile churn with the rebuild.
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
DEFAULT as of v0.1.132.** ~~Remaining v0.2.0 gates~~ ALL CLOSED 2026-07-09:
desk parity pass ✅ (Adam at-desk: popout + HDR on inverted, "no issues
found"), mid-play death detection ✅ (headless, mpv_status, v0.1.133), and
**THE DELETION ITSELF ✅ (v0.1.135)**: comp.rs (829 lines, the whole
overlay-webview subsystem), spike.rs + SpikeScreen + `?spike=1`, the
Ctrl+Shift+U/Ctrl+Shift+L dev shortcuts, the invertPlayer flag (always
inverted now — main.tsx stamps .invert-player whenever isTauri()), the
comp_* commands and comp-* events, webview2-com + the D3D11/DComp windows
features (Cargo.toml down to Foundation + WindowsAndMessaging). Popout
survives rewired: `popout_open` captures time-pos, inv::close()es (one
provider connection at a time), then mpv::play_popout — TS wrapper
`tauriPopoutOpen`. App.tsx tab switches are INSTANT (v0.1.136): no teardown await —
InvertedPlayer's unmount cleanup heals the clip hole synchronously before
paint (the review fleet confirmed the brief awaited-stop variant was a
real desktop-peek bug). `onPopoutClosed` re-homed to its own effect in
LiveScreen. From fullscreen, `t` returns to THEATER (v0.1.136).
CompositionPlayer.tsx → **InvertedPlayer.tsx** (comp branches + modal
parking stripped; it's the geometry driver: rAF follow + clip hole +
two-phase settle). mpv.rs touched only additively-adjacent: emit_comp →
emit_ui rename at its one call, and #[allow(dead_code)] on seek_abs +
set_speed (kept for the Stream tab's VOD controls). The `?overlay=1`
route + `window.overlayApi` fallback in overlayApi.ts survive as a
DOCUMENTED TEST SEAM for scripts/verify-overlay-tracks.mjs — the shipping
app never loads them. NOT COMPILED HERE (no Rust toolchain): first
`pnpm tauri dev` after pulling may need a trivial fix — paste errors.

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
approved and EXECUTED (v0.1.135) — see Landmines for mpv.rs's standing
rule. Main window is transparent:true (tauri.conf) — if Adam reports flag-OFF visual
regressions (launch flash, window shadow), that change is the suspect.

## Headless sprint (v0.1.133-134 — MERGED into the working branch
## 2026-07-09 after Adam's Windows verify; the sprint branch is disposable)

Fresh 20x-budget autonomous sprint off the working branch. All landed green
(typecheck / lint / 113 tests / build; M3U + adult + tracks browser E2Es):
- **M3U/M3U8 sources** (v0.2.0 scope): `m3u.ts` parser + `buildM3uSource` in
  source.ts (group-title folders, tvg-id/URL-hash ids, header `url-tvg` EPG
  via the XMLTV path, adult + hidden-group drop). Add form already existed.
  NOT done: an M3U folder editor in Settings (still Xtream-only) — channels
  load + adult-filter works, but per-folder hide UI for M3U is a follow-up.
  Fixture `scripts/fake-m3u.mjs`, E2E `scripts/verify-m3u.mjs`.
- **Mid-play death detection** (v0.2.0 gate #2): `mpv_status` reports
  eof/idle; useDirectOverlay re-arms the tune watchdog. RUST CHANGED.
- **Channel number on hero** (triage #4): Xtream `num` → model → hero chip.
- **Favorites hand-ordering**: `reorderFavorite` + Favorites renders in list
  order. Drag-handle UI in the guide DEFERRED (scarred virtualized grid
  needs real-app verification — a desk item).
- **Stats-for-nerds overlay**: `mpv_stats` command + StatsOverlay, `i`
  toggles (theater/fullscreen). RUST CHANGED.
- **docs/stalker-implementation.md**: full Stalker protocol + plan (key
  finding: streams resolve per-play → `stream.ts` needs an async
  `resolveStreamUrl`; `http_get` needs a headers map).
- Extracted `hole.ts` (+ tests) from CompositionPlayer.
A fresh-eyes review workflow ran over the diff (dimension fan-out +
adversarial verify) before this handoff. Four confirmed findings, ALL
FIXED in v0.1.134:
1. (HIGH) M3U channels were unplayable — the parsed URL was discarded and
   playback always built an Xtream URL. Fix: `Channel.url` carries the M3U
   URL verbatim; LiveScreen plays `heroChannel.url ?? channelStreamUrl(id)`.
2. (MED) Colliding tvg-ids (HD/SD variants) produced duplicate channel ids
   → dup React keys, one variant untunable. Fix: `~N` dedup suffix.
3. (MED) Provider error strings could leak credentialed URLs (reqwest
   embeds the full URL; M3U creds ride the query, Xtream creds the path).
   Fix: source.ts `msg()` scrubs any URL down to its origin.
4. (LOW) `tvg-chno=""` coerced to 0 → spurious "#0" chip. Fix: positive-
   integer-only guard in both the M3U and Xtream number paths.
The review also flagged `reorderFavorite` as uncalled — intentional: the
data layer landed ahead of the deferred drag-handle UI (desk item).
v0.1.134 also folds in Adam's asks: hero channel-number chip restyled to
the mock (right of the name, `#137`, dark pill) + a Customize toggle
("Channel Numbers", default on, `channelNumber.ts`), and wheel-to-change-
volume restored on the theater/mini overlays (native non-passive wheel
listener — React root wheel handlers are passive and can't preventDefault).
**TODO for Adam:** replace the landing page's CSS app mock with a real
screenshot of the app (his request). And decide whether to merge this
sprint branch into the working branch after a Windows rebuild.

## RELEASED: v0.2.5 (tag v0.2.5_alpha, 2026-07-09) — the self-update
## pipeline is PROVEN LIVE: chip → verified download → install → relaunch
## worked on both real installs (Adam + Bobby). Release flow hardening in
## RELEASING.md + scripts/release.ps1 (one-shell signed build). The 0.2.x
## tags ≤ 0.2.4a belong to the PRE-REBUILD app — never reuse them; the
## June v0.2.1 release collision cost a whole evening (details in
## RELEASING.md's hard-won rules). Manifests live in releases/<ver>/ and
## are only written AFTER the uploaded exe verifies against the sig
## (blake2b-512 + Ed25519 vs tauri.conf pubkey — the session does this).

## OPEN BUG — friend's install: EPG empty on his Xtream line (2026-07-09)

Bobby's provider: channels + video fine, EVERY channel "No Information";
the same login loads a guide in Desktop Telly; Adam can't repro on his
line and Bobby won't share creds. Suspects, in order: (1) the Rust HTTP
client's 30s timeout starving a big/slow xmltv download (fits the
Telly-works signature — Telly has no cap; fetchXmltv now gets 180s),
(2) streams carrying no epg_channel_id, (3) xmltv.php 404/403 on that
panel. v0.2.1 ships the DIAGNOSTIC: guide failures now land on
LiveGroup.epgError and render under the playlist row in Settings →
Playlists ("Channels OK · guide: <reason>"). Bobby updates via the chip,
opens Settings, reads the line to Adam. Fix follows the data.

## v0.2.0 — PACKAGED-READY (2026-07-09). Update chip shipped; all four
## version spots aligned at 0.2.0 (tauri.conf/Cargo.toml included, the
## milestone exception to the three-file protocol). Release = Adam's desk:
## RELEASING.md verbatim (fetch-libmpv, signed tauri build, latest.json,
## GitHub release). First `pnpm tauri dev`/build also compile-verifies the
## v0.1.137 http_get headers change and rewrites Cargo.lock — commit that.

## Update banner — SHIPPED v0.2.0. UpdateChip.tsx in the header's new
## .header__right group (full-strength, outside the 0.3-opacity icon
## cluster): silent check_update 6s after launch (Tauri only), gradient-
## ring glass pill "vX ready" when one exists, click = install_update →
## auto-relaunch; failure re-arms as "retry". `?update=<ver>` forces the
## chip for styling/screenshots (the test seam the headless shots used).

## Stalker/MAG sources — SHIPPED v0.1.137 (the last v0.2.0 source gate)

Full protocol client per docs/stalker-implementation.md (that doc is the
reference; its "no code written yet" header is now historical). Shape:
`data/stalker.ts` mirrors xtream.ts; sessions are in-memory per playlist
(token + discovered endpoint), auth failures re-handshake once (lazy
refresh — no watchdog heartbeat); create_link runs on EVERY play and on
go-live (stream.ts#resolveStreamUrl is now the async front door: M3U url →
Stalker create_link → Xtream sync). LiveScreen resolves playUrl in an
effect keyed on [playing, heroId] — a background data refresh must NOT
re-resolve (would rebuild the player mid-watch). Rust http_get gained an
optional headers map (verified against locked reqwest source: request
headers override client defaults; never log values — Cookie carries the
MAC). Verified: 8 unit tests (header assembly, path probe, pagination
fallback, prefix strip, token-expiry retry) + verify-stalker.mjs 4/4
against fake-stalker.mjs (LAX=1 relaxes Cookie/UA for browser fetch; the
Bearer flow still enforced). UNPROVEN against a real portal — watch
endpoint probing and get_epg_info's period unit on first live use.

The comp.rs deletion-review fleet (19 agents, adversarial verify) returned
16 confirmed findings on v0.1.135: 1 HIGH (tab-switch desktop peek — was
already killed by v0.1.136's instant tab switch, independently), 2 real
races fixed in v0.1.137 (InvertedPlayer stale-move settle timer re-cutting
the healed hole → `disposed` guard; popout's Rust-side inv::close racing
the unmount heal → LiveScreen heals the hole before invoking popout_open),
1 Cargo.lock note (cargo rewrites it on Adam's next build — commit that
churn), and 12 stale-docs/comments findings — all swept (README
architecture paragraph, this file's queue/landmines, ROADMAP's historical
sections annotated, TheaterOverlay/player.css/tauri.ts/mpv.rs headers).

## Immediate queue (user-approved order)

1. ~~**Track menus**~~ — SHIPPED v0.1.110-112 (see live state above).
2. ~~**Adult-hide by default**~~ — SHIPPED v0.1.113 (ROADMAP slate #6 has
   the full mechanics + verify evidence).
3. Waiting on Adam's Figma: **Ctrl+K search palette** (#1) and **first-run
   onboarding** (#4). He's designing both — don't start them without his
   designs or an explicit go.
4. ~~The batched Windows-native pass~~ RESOLVED: mid-play death detection
   shipped headless via mpv_status (v0.1.133), and the WM_SETCURSOR /
   DComp corner-clip / switch-gap items dissolved with the comp.rs
   deletion (v0.1.135). Post-1.0 headliner: recording to disk.

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

- **`src-tauri/mpv.rs` is do-not-touch** without an explicit ask from Adam
  (comp.rs no longer exists — deleted at the v0.2.0 milestone under Adam's
  rip authorization, which also covered mpv.rs's emit_ui rename + two
  #[allow(dead_code)] annotations). `lib.rs#http_get` is fair game
  (established precedent; it grew an optional headers map for Stalker).
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

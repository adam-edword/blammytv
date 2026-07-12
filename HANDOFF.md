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

## Live state (2026-07-12, dev v0.4.31 — ONBOARDING ERA)

- Dev is **v0.4.31** on `blammytv-0.4.0-push`; natives sit at 0.4.0
  (released). All suites green: units 204/204, onboarding E2E 36/36,
  discover 59/59, credits 6/6, probe 5/5.
- **v0.4.31: ONBOARDING BACKDROP REBUILT GROUND-UP (Adam's call after
  v0.4.30 still misbehaved in-app: start glow double-bright then
  snapping down at 1.6s — a shared entrance keyframe hard-coded
  `to {opacity:1}` over the disc's 0.5 base — plus finale brightness
  jump + whole-frame flashes).** The new engine has ZERO filters on the
  backdrop: the aurora is ONE unfiltered conic disc (oklab sweep +
  radial annulus mask baked into the disc's own rotating layer,
  will-change:transform) over a static viewport-fitted elliptical veil
  (farthest-corner stops: edges dark, corners most color — the old
  blurred-cover look, aspect-correct). Entrance keyframe is FROM-only
  (fills to each layer's own opacity). The finale plays an
  **in-component boot MIMIC** (onb-boot-* keyframes in onboarding.css,
  TWIN COPIES of welcome.css — Adam's call, update both if the boot
  changes; geometry vars shared via lockupVars in welcome.ts) — no
  WelcomeAnimation mount, no double-buffer, no transitionend watchdog,
  plain timers. The mimic is NOT input-skippable (cold-boot skip
  unchanged). Reduced motion: quick fade to app, no mimic. App.tsx lost
  welcomeIntro/90ms-hand-off; WelcomeAnimation lost the intro prop
  (cold boots always fade in). Measured in headless Chromium: idle
  drift = 0 Paint/0 RasterTask over 120 frames (UpdateLayer only);
  entrance + finale luminance curves smooth, no snap/flash frames;
  mimic lockup geometry pixel-exact vs the boot's numbers. AWAITING
  Adam's in-app Windows pass — the machine that overturned every prior
  "fixed" verdict.
- **FIRST-RUN ONBOARDING is built** (v0.4.7→v0.4.30, Adam's mockup: dither
  field + blurred aurora glow + Arc-style choreography). Files:
  `app/Onboarding.tsx`, `app/onboardingGate.ts` (NOT onboarding.ts —
  Windows case-collision with Onboarding.tsx black-screened the app once;
  vite tries .ts before .tsx and Windows matches case-insensitively.
  NEVER create same-dir files differing only in case), `styles/
  onboarding.css`, Replay button in CustomizeTab.
- Onboarding architecture (each piece exists because something broke):
  - **Glow disc** (.onb-glowdisc): 150vmax circle, conic in welcome stops,
    blurred ONCE, rotated by TRANSFORM from the rAF loop (filter runs
    before transform → compositor spins a cached texture, zero repaints).
    Every rotating-from-angle version re-rasterized the mega-blur per
    frame and FLICKERED on real hardware during fast spins. Chromium
    re-rasterizes filtered layers on content change; Firefox/WebRender
    doesn't — test perf verdicts on WebView2, not Firefox. NO
    will-change:filter on big blurs (GPU-composited mega-blur smears —
    Adam key-framed it).
  - **Finale**: content out → gradlayer (the welcome composite at its
    NATIVE 90deg — never rotated, seam correct by construction)
    crossfades in over the disc UNDER full blur (300ms) → delayed
    (450ms) blur/inset transitions sharpen static content onto the boot
    frame → double-buffered hand-off (WelcomeAnimation mounts UNDER the
    opaque overlay, release ~90ms later; backdrop swaps blur(0) for
    filter:none first). Boot animation gets intro={false} there (cold
    boots fade+unblur in via welcome-overlay--intro).
  - **Steps** (0-5): logo (glow solo 1.2s → lockup 1.8s rise → button
    2s) · streams (manifest input + REAL probeAioStreams verify, verdict
    on failure, "Continue anyway" ghost) · Live TV (KIND_TABS rail;
    xtream=authenticate(), m3u=fetch+#EXTM3U check, stalker=
    discoverEndpoint() with endpoint persisted) · accent+clock ·
    startup tab · nav map + Settings nudge. Verification never
    hard-walls; empty = skip; 12s timeouts; successes save + auto-
    advance (750ms dwell).
  - **Hardening**: entrance animations REMOVED after settle (password-
    manager DOM injection replayed filled animations — Adam's PM repro);
    PM_IGNORE attrs on all inputs; app shell inert behind the overlay;
    Enter drives steps (repeat-guarded, INPUT/BUTTON excluded); Back
    bottom-left + Escape; finale watchdog (350ms reduced-motion / 1900ms).
  - **Gate policy (v0.4.25, Adam)**: btv:onboarded flag is the ONLY
    suppressor — every existing user sees the flow ONCE (showcase);
    everything pre-fills, sources only get ADDED. ?onboarding=1 forces.
    Settings → Customize → Replay Onboarding (does NOT clear the flag).
  - **Shared option lists** (Adam's drift concern): STARTUP_TABS
    (startupTab.ts), CLOCK_TABS (clockFormat.ts), KIND_TABS + form model
    (playlists.ts) — Settings and onboarding import the same lists.
- **E2E suites moved INTO scripts/** (they lived in the session
  scratchpad, which dies with the container): verify-onboarding (36,
  FAST=1 runs core walk only), verify-discover (59), verify-credits,
  verify-probe, verify-conns, verify-watchdog, verify-aniskip-chip.
  Run: build+`pnpm preview --port 4173` (from apps/app), fixtures
  fake-aio :8084 / fake-panel :8081 / fake-m3u :8082, then
  `PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-*.mjs`
  (playwright-core resolution, repo convention). App-booting harnesses
  MUST stamp localStorage `btv:onboarded=1` or the showcase intercepts.
- **OPEN at hand-off**: (1) Adam verifying v0.4.30 in-app — if the
  finale STILL flickers, the documented last resort is merging a boot-
  animation mimic into onboarding itself (one component, no swap);
  every cheaper class (repaint storm, GPU blur smear, swap teardown,
  spin re-raster) has been eliminated in turn. (2) No 0.4.x release cut
  yet — testers are on 0.4.0; eyedropper fix + Connection Test +
  onboarding all wait on the next release. (3) The 0.5/0.6 roadmap
  slates proposed to Adam (0.5 = product: Ctrl+K palette + onboarding
  polish + My List multi-lists + aurora sweep; 0.6+ = themes/Stripe,
  signing, Trakt) — not yet blessed into ROADMAP.
- v0.4.4-0.4.6 also shipped: Connection Test forensics (Rust http_probe:
  non-2xx = data, gatekeeper headers + scrubbed body head) + plain-
  language verdicts + auto-run on manifest submit. Bobby's 403 CLOSED
  (Cloudflare challenge on the friend's zone; re-host confirmed).

## Prior state (2026-07-10, v0.3.0 RELEASED)

- **Branch `blammytv-0.4.0-push`** — the working branch since the v0.3.0
  release; never push elsewhere. (History: claude/blammytv-rebuild-… →
  blammytv-0.3.0-push, which carries the v0.3.0 release commit.) Adam
  pulls and runs `pnpm tauri dev` on Windows.
- **v0.3.0 "VOD" SHIPPED 2026-07-10**: tag v0.3.0 (clean namespace, no
  suffix needed — only 0.2.x tags are burned), set-as-latest ✓, sig
  verified from this session against the uploaded exe (sha256 matches
  GitHub's digest), manifest at releases/v0.3.0/latest.json, attached to
  the release. Both installs updated via the chip. Natives sit at 0.3.0
  now; dev bumps are 0.3.x in the three frontend files ONLY.
- ~~OPEN~~ **CLOSED (2026-07-11)**: Bobby's AIOStreams 403 = **Cloudflare
  bot challenge on the blammy.org zone**, proven twice over. (1) His
  `curl -v`: HTTP 403 + `server: cloudflare` + `cf-mitigated: challenge`
  (Ray ID a199ff57884452c0-EWR) — a JS challenge no non-browser client
  can pass; fires on IP-reputation, which is why Adam's machine passed
  with the same URLs and nothing client-side (headers, UA, even the
  real-Chrome webview retry) could ever fix it. (2) The instance was
  re-hosted on a NEW server (zone owner declined to touch his Cloudflare
  settings) and Bobby's same app + config + machine immediately worked.
  His machine was clean the whole time: no proxy (netsh + Settings
  verified), WPAD-off no difference, AV never involved. Lessons kept:
  NO app-side fix exists for `cf-mitigated: challenge` — auto-solving
  is bot-wall evasion, and a solved cookie couldn't ride our fetch
  anyway (ACAO:* forbids credentialed requests). v0.4.4 shipped
  Connection Test FORENSICS so the next one never needs curl: Rust
  http_probe (non-2xx = data; status + server/cf-* headers + 600B body
  head, URL scrubbed both sides) renders "answered HTTP 403 - server:
  cloudflare - cf-mitigated: challenge" under failed rows. (Eyedropper
  freeze FIXED v0.4.1 - WebView2 exposes EyeDropper but open() never
  settles, browser-only now.) Cargo.lock churn from Adam's release
  build still uncommitted on his machine.
- The 0.3.0 cycle's scars worth remembering: PS 5.1 reads BOM-less UTF-8
  as ANSI, so em-dashes in .ps1 strings become closing quotes (release.ps1
  is pure ASCII now); anything drawn over the video MUST portal into
  #inv-chrome (the shell's clip hole eats in-shell content — the invisible
  Up Next card); libmpv forbids terminate_destroy concurrent with
  wait_event (popout teardown is quit→watcher-owned destroy now).
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

## ~~OPEN BUG~~ CLOSED (v0.2.5 confirmed on Bobby's install): the 30s
## HTTP timeout WAS the culprit — his guide populates with the 180s xmltv
## budget. Suspect (1) below confirmed by outcome; the Settings guide-
## status line stays as permanent diagnosability.

## The original report — friend's install: EPG empty on his Xtream line (2026-07-09)

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

## STREAM TAB S1 — LANDED (v0.2.6, branch blammytv-0.3.0-push)

The AIOStreams browse surface is real: data/stremio.ts (protocol client,
colon-preserving encSegment — load-bearing), features/stream/{model,mapper,
source}.ts ported from the old build (rows from browseable catalogs,
hero round-robin + up-front meta enrich, Cinemeta fallback for sparse
metas, magnet filtering, per-catalog isolation, manifest-URL scrubbing in
errors), StreamScreen: hero carousel + poster rows + detail/sources +
series season/episode browser + fullscreen playback through the SHARED
InvertedPlayer/TheaterOverlay (its own #inv-chrome host + api override —
overlay verbs mapped: close/collapse/exitFullscreen all stop back to the
catalog). Verified: 9 unit tests + scripts/verify-stream.mjs 8/8 vs
scripts/fake-aio.mjs (:8084). The whole S2 player block SHIPPED in
0.3.0: scrubber+resume, Up Next autoplay, next-episode button, speed
menu, source panel + failover queue, watched marks, Skip Intro Phase 1
(chapters) with the Hidden/Normal/Combine setting. 0.4.0 QUEUE:
Skip Intro Phase 2 (aniskip for anime — imdb→MAL mapping, see the
2026-07-10 conversation), catalog pagination + search (skip= supported
client-side already), episode search within a series, nav glass
re-enable (base.css comment), Ctrl+K palette + onboarding (await Adam's
Figma).
NOTE: repo branches cleaned 2026-07-09; work continues on
blammytv-0.3.0-push (old branch list is in the session log; android-tv
kept deliberately — 186 unique commits of parked port work).

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
5. **PRE-1.0 GATE: Paid themes** (Adam, 2026-07-11: free app, themes
   behind a paywall). Architecture notes agreed in-session:
   - Mechanism = the Aurora pattern generalized: a theme is a named
     token bundle scoped under a root attribute (data-theme-pack), with
     per-element tweak classes where needed. Cheap to build; the real
     per-theme cost is design QA across light/dark and every surface
     (the Aurora light-theme fleet findings are the cautionary tale).
   - Paywall reality: client-side checks on a local desktop app are
     honor-system. The meaningful gate is DON'T SHIP LOCKED BITS —
     paid theme payloads (token CSS) download from a server only
     against a valid license key. Merchant-of-record licensing
     (LemonSqueezy/Paddle style) for key issue + validation; cache the
     entitlement locally and FAIL OPEN offline — never brick a paid
     theme on a TV app because the internet blipped. Don't escalate
     into DRM: CSS is copyable; price low, make buying nicer than
     pirating.
   - NO ACCOUNTS — Adam's explicit call (2026-07-11): the license key
     IS the credential. No signup/login/password anywhere; the MoR
     checkout email is their receipt flow, not an app account; the
     payload service stays STATELESS (no PII on the box, ever). New
     machine = paste the key again; per-key activation limits handle
     sharing. Trakt/MAL later are the user's own third-party accounts
     via OAuth device-code — we still operate no account system.
   - Hosting shape (updated 2026-07-11 — Adam's call: STRIPE, not a
     merchant-of-record; "the tax is probably negligible" = accepted
     risk at hobby scale, revisit if volume or EU share grows: EU VAT
     technically applies from €0 for digital goods, some US states
     have 200-transaction nexus). Stripe has NO license API, so the
     Oracle box owns keys end-to-end: Stripe Checkout → webhook → box
     generates the key (stored WITHOUT buyer identity — the key list
     stays PII-free; Stripe's dashboard is the purchase↔person record
     for manual lost-key support) → success page shows the key. App
     activation = key → box /validate (activation cap in SQLite) →
     theme payload CSS. SQLite key DB NEEDS A BACKUP STORY — a dead
     disk must not orphan every sold key (nightly dump off-box).
     Never publish a readable key list; validation is key-in,
     yes/no-out. Caddy HTTPS, rate-limited. Fail-open caching
     unchanged: box uptime only gates NEW activations.
   - "Can the backend overwrite/hack the theme?" Provider-controlled
     strings (channel names, EPG, addon metas) never reach HTML/CSS
     sinks (React escaping; zero innerHTML/dangerouslySetInnerHTML in
     app code — fleet-audited 2026-07-11), and theme storage keys are
     only written by Settings code. The gap: tauri.conf.json has
     "csp": null. PRE-1.0 HARDENING: set a strict CSP (script-src
     'self'; img-src needs http:/https:/data: because panel posters
     are arbitrary user-configured hosts, often plain http; connect-src
     likewise broad; style-src needs 'unsafe-inline' unless Vite style
     injection is reworked). Needs on-device verification against
     Adam's real providers before shipping — a too-tight CSP silently
     breaks posters/EPG.
6. **PRE-1.0 GATE: Windows code signing** (agreed 2026-07-11, prompted
   by the Bobby saga — unsigned binaries are second-class to AV
   web-shields, and "Unknown publisher" is a conversion tax once themes
   cost money). Order of attack: check Azure Trusted Signing
   eligibility for individuals (~$10/mo, no hardware token, signtool →
   Tauri signCommand) → else Certum indie/OV (~$70-300/yr, hardware key
   required since 2023, name-in-UAC but SmartScreen reputation still
   accrues per-cert) → EV only if an LLC exists anyway (also relevant
   to the Stripe theme business). SEPARATE from updater minisign — that
   stays. Wire into release.ps1: sign app exe + installer in the same
   one-build flow. Scope check: signing earns LOCAL trust only
   (SmartScreen/AV read the exe); it changes NOTHING about server-side
   bot walls — a signed build sends byte-identical traffic, so a
   Cloudflare challenge fires exactly the same (Adam asked 2026-07-11).
   WATCH-ITEM (not a gate): Web Bot Auth — IETF HTTP Message
   Signatures, Cloudflare-backed — is the emerging "verified client"
   mechanism (Ed25519-signed requests + registered public key, works
   from any IP). Today it's gatekept to cloud AI agents; Verified Bots
   proper needs fixed egress IPs a desktop app can never have. If
   registration opens to desktop clients, BlammyTV is well-positioned
   (Ed25519 infra in-house). Re-evaluate near 1.0.
7. **PRE-1.0 GATE: Trakt / MyAnimeList integrations** (Adam, 2026-07-11:
   "maybe that's a pre 1.0 gate. one of the last things we tackle").
   Scope when it lands: watchlist/custom-list sync (My List's
   snapshot+membership model maps onto Trakt lists), watched-history
   push, MAL for the anime lists. Design decisions until then should not
   preclude it — keep My List entries keyed by imdb id (Trakt speaks
   imdb/tmdb; the aniskip index already maps imdb→MAL).
8. **POST-V1: hero slider click-and-drag** (Adam-approved 2026-07-10).
   Vibe-checked as "somewhat simple": the virtual-index moving-window
   architecture is drag-friendly (drag = live px offset on the card
   positions, commit index ±1 or snap back on release; index−1 already
   renders fine — "never rewinds" is about wrap direction only). The four
   seams: click-vs-drag slop threshold (~6px, suppress card click past
   it), transition OFF during drag (same inline `transition: none` trick
   as the entry-animation gate), auto-advance pause while dragging,
   pointer capture + draggable=false hygiene. Scope call: ONE card per
   gesture (threshold ~15-20% width or a flick) — no multi-card momentum.
   Sized at a solid session, two-thirds of it verifying the
   click/drag/auto-advance interplay doesn't regress.

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

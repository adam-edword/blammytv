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

## Live state (2026-07-14, dev v0.5.4 — THE THEMES ERA)

- **🗝️ KEYBOX ADMIN CLI + unlimited keys (2026-07-14).** `services/keybox/
  scripts/admin.mjs` — `list` (see every key; the DB is otherwise invisible —
  no sqlite3 CLI in the slim image, no Coolify DB viewer), `mint` (a `pass` key
  with a new per-key `unlimited` flag → unlocks all themes on UNLIMITED
  machines, bypassing the 3-cap; comp/admin use), `revoke <key>`. Run it in the
  Coolify container Terminal (`node scripts/admin.mjs …`, DB_PATH=/data/
  keybox.db). Schema gained `unlimited INTEGER DEFAULT 0` (runtime-migrated like
  emailed_at); `/validate` passes Infinity to touchActivation for unlimited
  keys; Dockerfile now COPYs admin.mjs. Tests 34 → 39. **Security:** a minted
  key is a free master-unlock (no Stripe) — keep private, `revoke` if leaked.
  **Deploy step:** redeploy keybox on Coolify, then `node scripts/admin.mjs
  mint` in the container to get the key.
- **🔑 UPDATER SIGNING KEY ROTATED (2026-07-14, Windows reinstall).** The
  original updater key `f710df2407e1d35f` (`5FD3E10724DF10F7`) was LOST when
  Adam's build machine was wiped with no backup. A new keypair
  `163EBD51B4EE3232` was minted (Adam holds the private half at
  `%USERPROFILE%\.tauri\blammytv.key`, now backed up) and its public half is in
  tauri.conf.json as of **v0.5.4**. **Every pre-0.5.4 install cannot
  auto-update across the key change** — those users must manually reinstall
  v0.5.4's `-setup.exe` ONCE, then auto-update resumes. v0.5.4 is the first
  release on the new key and carries the intense-themes work (909e9f6). See
  RELEASING.md's rotation note. (Old `verify-vs-tauri.conf pubkey` checks below
  that cite `f710df2407e1d35f` predate the rotation.)
- **v0.5.3 → shipped as v0.5.4: intense theme packs + live-preview-before-buy
  (909e9f6).** Widened the theme engine past color-only: a pack can now swap
  fonts, paint a dithered/textured background layer (.app-shell::before), and
  restyle per-component hovers. All intense CSS is BUNDLED (not keybox-
  delivered) so any theme previews live/offline with no key; the license now
  gates PERSISTENCE not delivery (license.ts ownsPack). Terminal reference
  theme (VT323 CRT font + phosphor dither + glowing hovers) + Nebula migrated
  to bundled. 240 units, E2E 24/24 + 18/18 + 13/13. One manual Tauri smoke
  left: invert-player video-hole vs the bg layer.

- **🟢 PAID BACKEND LIVE & PROVEN END-TO-END (test mode, 2026-07-12).**
  The keybox runs in production on Coolify at https://themes.eddtv.org
  (container, /data volume, healthcheck via curl, self-healing volume
  perms). A real test-mode purchase completed the WHOLE chain: Stripe
  Checkout → webhook (checkout.session.completed) → key minted (price
  ids in catalog.json matched) → **key delivered BOTH by Resend email
  (verified eddtv.org sender, landed in inbox) AND the /success page**.
  Adam confirmed: "email landed in inbox and success page worked."
  Env live in Coolify: STRIPE_API_KEY, STRIPE_WEBHOOK_SECRET,
  RESEND_API_KEY, EMAIL_FROM (+ optional EMAIL_REPLY_TO). Stripe
  webhook endpoint + Payment Link configured.
  - **STILL TEST MODE** — real revenue needs a live Stripe account
    (Adam: not opening one until the marketing site exists) → swap
    catalog.json price ids to live ids + set live STRIPE_API_KEY/webhook
    secret when that happens. Also confirm the Payment Link's
    after-payment redirect points at
    themes.eddtv.org/success?session_id={CHECKOUT_SESSION_ID}.
  - **NOT YET DONE**: in-app activation test (paste a real key in the
    themes-branch build → Nebula unlocks — needs the dev build or a
    0.5.x release, since released 0.4.43 has no themes UI); the
    marketing/download site (Adam's stated go-live blocker); real theme
    designs to replace the sample packs (void/slate/paper/nebula).
- **v0.5.2c: keybox self-heals /data volume ownership (fixes the first
  real Coolify deploy).** The image built clean on eddtv (better-sqlite3
  glibc prebuild resolved — risk retired) but crash-looped with
  SQLITE_CANTOPEN: the non-root `node` user couldn't write the
  root-owned mounted /data. Fix (standard container pattern, in-process
  so no gosu in the slim image): Dockerfile drops `USER node` so the
  container starts as ROOT; server.js `ensureDataDirAndDropPrivs()`
  mkdir+chown /data to 1000:1000 then setgid/setuid down to node before
  serving. Any Coolify mount type now works with no host chown (README
  updated). VERIFIED for real: this sandbox runs as uid 0, so the boot
  test exercised the actual root→chown→drop→open-db path against a fresh
  nested dir — server dropped to uid 1000, db files created owned 1000,
  /healthz 200. Keybox tests still 27/27. Coolify: no config change,
  just redeploy. (Earlier deploy-config gotchas Adam hit, for the
  record: must target branch blammy-tv-0.6.0-themes-push not main
  — keybox isn't on main; Base Directory = /services/keybox, Dockerfile
  Location = /Dockerfile; healthcheck HTTP port 8390 path /healthz,
  blank response-text.)
- **v0.5.2b: keybox CONTAINERIZED for Coolify (Adam runs Coolify on the
  Oracle VPS; DNS for themes.eddtv.org already set).** Sonnet agent +
  PM review. Dockerfile (node:22-bookworm-slim multi-stage, non-root,
  VOLUME /data, fetch-based HEALTHCHECK), .dockerignore, scripts/
  backup.mjs (better-sqlite3 .backup API — containers have no sqlite3
  CLI), README rewritten Coolify-first (Build Pack Dockerfile, Base
  Dir services/keybox, port 8390, env vars, /data persistent storage
  BOLDED as critical, /healthz health check, daily backup Scheduled
  Task; bare-metal systemd kept in a <details>).
  - **REAL BUG CAUGHT during this pass: the production server had NO
    CORS** — the app's cross-origin WebView fetch would have failed on
    first real deploy (the E2E tested against the CORS-enabled FIXTURE
    — a masked integration gap; lesson: fixtures must not be more
    permissive than production). Fixed: CORS (* origin — no cookies,
    entitlement rides explicit headers) on /validate + /payload only,
    preflights answered 204 before the rate limiter; /webhook and
    /success deliberately bare. Plus GET /healthz and mkdir-on-boot
    for a fresh /data volume. Keybox tests 21 → 27/27.
  - **PM review caught a second real bug in the agent's Dockerfile**:
    chown /data was placed AFTER the VOLUME declaration — Docker
    discards post-VOLUME changes to the path, so a fresh named volume
    would arrive root-owned and the non-root process would crash-loop
    on first boot. Moved above VOLUME; README notes the Directory-
    Mount (bind) variant needs a host-side chown 1000:1000.
  - **UNVERIFIED (sandbox limitation, be honest on first deploy)**:
    the docker build itself — this sandbox's proxy blocks every
    registry blob host (Docker Hub AND the ECR mirror), so the image
    was never built. Everything else verified at process level (27/27
    incl. new CORS/healthz tests, curl transcript, restart-persistence
    sim). THE one first-deploy watch item: better-sqlite3's glibc
    prebuild resolving inside the image (same platform combo resolves
    it in dev; if the build log shows node-gyp/prebuild-install
    failure, the Dockerfile comment says exactly what to add).

## Prior state (2026-07-12, dev v0.5.1 — THE THEMES ERA)

- **v0.5.1: THE PAID PLUMBING (0.5.x step ②)** — Stripe → keybox →
  app unlock, built by 3 Sonnet agents under Fable PM (one agent even
  ran the parallel agent's E2E mid-build and fixed its own UI bug).
  Adam's product calls: BOTH a lifetime Themes Pass AND per-theme
  purchases; activation cap 3 machines.
  - **services/keybox/** (NEW workspace pkg): Express + better-sqlite3
    + stripe. POST /webhook (sig-verified; checkout.session.completed
    → price-id→entitlement via catalog.json → BTV-XXXX key, PII-free,
    replay-safe), GET /success?session_id (shows the key), POST
    /validate {key,machine} → {ok,pass,themes:[metas]} (3-machine cap
    in SQLite), GET /payload/:id (entitlement+activation gated CSS,
    allowlist path handling), hand-rolled per-IP rate limit. 21/21
    node:test + live curl smoke. README = Oracle-box runbook (systemd,
    Caddy, Stripe products/webhook, stripe listen walkthrough, backup
    cron); scripts/backup.sh (the dead-disk requirement). Sample paid
    theme "nebula" (violet-noir) payload in the packs.css contract.
  - **App (license.ts)**: anonymous machineId, key normalize/shape-
    check before network, activate() → validate + fetch payloads →
    injectPackCss + cache; FAIL-OPEN startup applyInstalledPacks()
    re-injects from localStorage with NO network (main.tsx, pre-paint);
    background revalidate never clears state except explicit
    unknown_key. Customize Theme pill: pack row = THEME_PACKS ∪
    installed; "Premium Themes" row (key input + Activate + plain-
    language errors; licensed → "Themes Pass active"/count + Remove
    license which also resets an active premium pack). 16 new units.
  - **DEFAULT_KEYBOX is REAL as of v0.5.2: https://themes.eddtv.org**
    (Adam's domain, subdomain shape his pick). localStorage
    "blammytv.keyboxUrl" (raw, no envelope) stays the dev/test
    override. Remaining deploy blockers: DNS for the subdomain, deploy
    the keybox per its README, real Stripe price ids in catalog.json.
  - Verified end-to-end: scripts/fake-keybox.mjs (:8085) +
    verify-license.mjs 14/14 (activation, pack join, token applies,
    reload persistence, DEAD-SERVER fail-open, all three error copies,
    solo entitlement, full deactivate teardown, malformed-key never
    hits the network via /__count); verify-themes 24/24; onboarding
    47/47; units 229/229; keybox 21/21; tsc/eslint clean.
  - NEXT in 0.5.x: deploy keybox to the Oracle box (README runbook),
    create real Stripe products + paste price ids, pick the domain +
    set DEFAULT_KEYBOX, buy-link UI once purchase links exist, CSP
    hardening, Adam's real theme designs.

## Prior state (2026-07-12, dev v0.5.0 — THE THEMES ERA)

- **Version scheme reset (Adam)**: v0.4.43 "should've been 0.5.0"; the
  tag stays, dev jumps to 0.5.0. 0.5.x = making themes work; 0.6.0 =
  themes release. My List multi-lists → 1.0 gate. Working branch is now
  **blammy-tv-0.6.0-themes-push** (Adam's naming, cut from f02fa9c);
  the claude/onboarding-glow-rebuild-k3vd2u branch mirrors it.
- **v0.5.0: THEME-PACK ENGINE + Customize pill rail (the 0.5.x opener).**
  Built by 3 Sonnet agents under Fable PM (Adam's token-saving model —
  keep it for big pushes; integration review caught one real bug:
  classic was marked dark-only, which would have disabled the Light
  toggle for everyone).
  - A pack = token-override block `:root[data-theme-pack="<id>"]` in
    styles/packs.css (+ `[data-theme="light"]` variant if supportsLight)
    — the Aurora pattern generalized, per pre-1.0 gate #5. THIS FILE'S
    BLOCK SHAPE IS THE PAID-PAYLOAD FORMAT; `injectPackCss(id, css)` in
    themePacks.ts is the seam the future fetch-and-unlock flow calls
    (create-or-replace <style data-pack-css>, unit-tested). Packs
    override ONLY surfaces/borders/glass/text — never --accent (user-
    owned), never shape/spring/type. "classic" = no attribute.
  - Sample packs (placeholders; Adam's Figma redesigns them pre-0.6.0):
    void (OLED crushed surfaces, dark-only), slate (graphite blue-cast,
    dark-only), paper (warm cream light + warm charcoal dark,
    supportsLight). loadThemePack returns unknown ids as-is (forward-
    compat with paid ids); applying one is harmless by construction.
  - Customize restructured (Adam: "like m3u/xtream/stalker"): ChipTabs
    pill rail General | Theme | Display, one section at a time,
    ephemeral state; utilities (Replay/Updates/Reset) persistent below.
    Pack cards = radiogroup, preview swatches from metadata (sanctioned
    raw hex), active = accent ring. Dark-only pack + light theme =
    dead combo: picking one flips dark; the Light toggle wraps in
    .toggle-disable-wrap--off (Toggle has no disabled prop) with a
    "<Pack> is dark-only." note. Reset also resets the pack.
  - Verified: NEW scripts/verify-themes.mjs 24/24 (rail, cards,
    persistence-before-first-paint, dark-only interplay, reset,
    synthetic payload via dataset attr + scoped CSS, no section dupes);
    onboarding 47/47 (boot is pack-invariant — fixed brand artwork);
    units 213/213 (9 new); tsc/eslint clean; visual sweep screenshots
    of all packs across Live + Settings (paper-light flips the whole
    app cream; no raw-hex leaks spotted).
  - NEXT in 0.5.x: ② Stripe Checkout + Oracle-box key service
    (/validate + payload host) + app-side license entry with fail-open
    entitlement cache; ③ CSP hardening + Adam's real theme designs.

## Prior state (2026-07-12, v0.4.43 RELEASED — the onboarding release)

- **Taskbar-icon report DIAGNOSED, no code change (2026-07-12)**: Adam's
  Windows taskbar showed the old logo "since the logo changed". Data:
  the bundled icon set (src-tauri/icons) was regenerated WITH the logo
  at v0.1.107 and pixel-diffs identical to public/logo.png (1.78%
  differing px, mean channel delta 0.7 — resampling noise; both holes
  transparent). The exe resource has been correct in every release
  since. Root cause: Windows icon-cache staleness — the pin cached the
  icon at install time and the exe path never changes across updates;
  a running window grouped onto a pin shows the PIN's cached icon.
  Tester-facing fix, least→most invasive: (1) unpin + re-pin; (2)
  `ie4uinit.exe -show` + restart Explorer; (3) delete
  %LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache*.db with
  Explorer stopped. Fallback only if a full cache rebuild still shows
  the old mark: `pnpm tauri icon` from logo.svg@1024 so the resource
  bytes change, ship next release.
- **v0.4.43 SHIPPED 2026-07-12**: tag v0.4.43 ("v0.4.43 - Onboarding"),
  set-as-latest ✓ (releases/latest/download/latest.json serves the
  0.4.43 manifest — confirmed live). Signature FULLY VERIFIED from this
  session against the published exe (38,910,385 bytes, blake2b-512
  e39df5e9…, Ed25519 valid against tauri.conf's pubkey; trusted-comment
  signature also valid; key id f710df2407e1d35f matches — checked
  pre-publish from the .sig alone, a trick worth repeating: the key-id
  check needs no exe). latest.json was generated this session from
  Adam's uploaded .sig. Natives now sit at 0.4.43. Carries: full
  onboarding + one-piece boot, Connection Test forensics, eyedropper/
  black-screen fixes, settings glass, uiScale exemption. Note: Adam
  said "release 0.4.42" but dev had already moved to 0.4.43 (same
  content + the uiScale exemption) — released as 0.4.43 so the tag
  matches the build.
- **Slate decisions (Adam, 2026-07-12)**: Ctrl+K palette CUT. "Update
  banner UI" and "stream nav glass" were STALE roadmap lines — both
  shipped long ago (UpdateChip v0.2.0; glass live in base.css). 0.5 =
  My List multi-lists + aurora sweep. See ROADMAP "Post-onboarding
  slate".

**Adam signed off the onboarding/boot experience at v0.4.42** ("i think
we can consider onboarding done") after his Windows pass on the full
stack: one-piece boot motion, old released endgame spring, thin border,
splash-sized y-centered lockup, 0.5 idle glow, flash-free opaque cold
boot on true black. Treat the boot/onboarding surface as FROZEN — no
further motion changes without a fresh ask from Adam.
- **v0.4.43: boot/onboarding EXEMPT from UI scale (Adam: "people will
  change the zoom which persists on sessions, so any new boots will
  load with ui scale ≠ 1").** Implemented as counter-zoom: applyUiScale
  publishes `--ui-zoom-inverse` on the root; `.boot-overlay` and `.onb`
  set `zoom: var(--ui-zoom-inverse, 1)` → net zoom 1 inside, so 1
  local px = 1 true px and bootVars' innerWidth math needs NO
  correction. Empirical model (headless, verified before building):
  innerWidth IGNORES root zoom (true device-independent px); a plain
  fixed overlay inside zoom 1.2 lays out at innerWidth/1.2 local px
  (the old distortion); at net zoom 1 a 100px box paints at exactly
  100 visual px. Side effect: the cursor glow's clientX lerp is now
  correct at zoom ≠ 1 too (clientX is true px). E2E §11 guards it
  (47 checks now): at uiScale 1.2 the boot frame fills the true
  viewport, the screen inset is true-px 35·s, the splash mark is 76
  visual px. This closes the uiScale×boot item for good.
- Still queued (unchanged): the committed raster-throttle E2E harness.

- Dev is **v0.4.42**; natives sit at 0.4.0 (released). All suites green:
  units 204/204, onboarding E2E 44/44 (blur-safety frame sampler +
  cold-boot skip/spin guards added), discover 59/59, credits 6/6,
  probe 5/5.
- **v0.4.42: cold boot opaque from frame one + true-black backdrop
  (Adam's report: the stream page flashed before the intro).**
  WelcomeAnimation mounts in the app's FIRST render, but .boot-overlay
  entered via @starting-style opacity 0→1 (400ms) — the shell was
  visible THROUGH it for the first frames. The @starting-style
  entrance on the overlay root is GONE: the overlay is opaque from its
  first frame and the entrance is the scene's own (the sheet's
  existing 0→0.5 fade plays over black). RULE: a full-screen host that
  exists to hide the app must never animate its own opacity IN —
  entrance fades belong to the scene inside it (exit fades are fine).
  Both hosts' backgrounds are now TRUE BLACK #000 (was the mock's
  #0b0b0e; Adam's call) — .boot-overlay AND .onb stay identical so the
  shared scene's surroundings never differ between surfaces. Also
  added pointer-events:none to .boot-overlay.is-leaving (mirrors the
  .onb audit find). Headless proof: first-frame computed opacity "1" +
  rgb(0,0,0) on the natural (unforced) cold-boot path; frame-0
  screenshot fully covered.
- **v0.4.41: thin border + y-centered lockup + the OLD endgame motion
  (Adam's pass on 0.4.40: "feels super good" + three tweaks).**
  - **Border**: screen inset 71.5/72·s → **36.5/35·s** — the old
    released welcome's exact frame thickness ("pretty thicc" fixed).
    The idle glow ring thins with it (blur contract: same geometry
    idle→landing) — Adam's explicit trade. Blur stays 108.4·s: a 64·s
    variant was screenshotted side-by-side and the difference was
    marginal; 108.4 keeps the design's softness and still reads.
    welcome.ts INSET_X/Y 144/143 → 70/73.
  - **Y-center**: the v0.4.40 −51.5·s footprint offset died; the end
    lockup sits dead-center (sizes + x keep the splash match).
  - **Old endgame motion PORTED VERBATIM** from welcome.css@ca5877c
    (Adam: the mock's short ease+slide "not great"): 2000ms track —
    shrink eases in-out to 36.86% (737ms), ~130ms hold, then the
    leftward move 43.42→92.79% (868→1856ms) on the sampled spring
    linear() (~2.8% overshoot, settles back); the wordmark is a PURE
    opacity fade at its final position (58.65→92.5%, no slide).
    BOOT_TIMELINE_MS 2530 → **3200** (830 landing + 2000 track + ~370
    hold). Blur choreography untouched. Headless proof: spring peak
    −219.48px vs theoretical −219.6 (1.028 × −213.59), end −213.59;
    wordmark never carries a translateX; lockup y-center exact.
  - **RULE (headless E2E)**: headless Chromium SUSPENDS the page's
    frame pipeline (rAF + the animation timeline; timers keep running)
    when nothing external touches the page — in-page rAF/interval
    samplers see animations "freeze" mid-flight, and fixed
    waitForTimeout+measure patterns read frozen frames. Poll from the
    CDP side (each evaluate wakes the renderer) — §9's tile assert now
    does; the rAF-driven phase flips (landed/shrink) also run ~400ms
    late under throttle, so never assert boot phases against absolute
    wall-clock times.
- **v0.4.40: quieter idle glow + FULL-CIRCLE LANDING (Adam's tweaks).**
  `.boot-sheet` idle opacity 0.65→0.5 (still rides to 1 during P1 —
  the is-landing/landed/shrink rule was already there). The finale's
  end lockup now lands EXACTLY in the onboarding splash lockup's
  footprint, measured from the rendered splash (not eyeballed): tile
  121→76·s, hole 68.57→43.07·s (same 0.5667 ratio), wordmark
  116.22→84px·s / tracking −1.7·s / line-height 1 (mirrors .onb-word),
  end translate (−302.5, 0)→(−213.59, −51.5)·s, wordmark left
  −214→−157.59·s, slide-in +120.24→+86.9·s. The 51.5·s vertical drift
  rides the SHRINK segment so the slide stays purely horizontal.
  Splash is fixed-px, boot scales with --s ⇒ exact match at s=1,
  "a little bigger" on larger windows — Adam's spec verbatim.
  Headless proof at 1920×1167 (s=1): tile 76.0×76.0 @ (746.4, 532.0)
  vs splash mark (746.4, 532.7); wordmark box 409.2×84.0 with left
  edge and v-center equal to .onb-word within 0.7px. Blur-safety
  choreography untouched (only end-state numbers changed).
- **v0.4.39: ONE SPEC — the one-piece boot motion (Adam's Figma mock,
  "Wireframe - 5" node 272:1000, 2530ms; plan-mode approved).** Adam's
  definitive statement of the desire: "ITS ALL ONE PIECE, NO
  TRANSITIONING INTO A SEPARATE ANIMATION FOR FINALE" + "no gradient
  animation". The steps backdrop IS frame zero of the boot timeline;
  the finale plays it forward on the same nodes. NEW: BootScene.tsx +
  boot.css (one component, one stylesheet, both surfaces — onboarding
  finale AND cold boot; WelcomeAnimation is now a ~80-line host; the
  TWIN-copy problem is deleted, not managed). welcome.css is GONE.
  - **Sheet**: oversized (2438×2207 design ×1.15 rotation safety, new
    design space 1920×1167, bootVars in welcome.ts) STATIC brand conic
    — no hue spin anywhere anymore; rAF drift/bursts as before; steps
    opacity 0.65/scaleY 1.15 per mock; root bg #0b0b0e.
  - **Screen**: ONE solid-black rounded rect = idle darkener AND boot
    screen. Idle softness = STATIC blur(108.4px·s) — LITERAL FILTER,
    readmitted under the war's terms (Adam's explicit call): solid
    color only, static during idle (rasters ONCE — CDP trace: 0
    Paint/RasterTask over 2s drift), animates ONLY while geometry is
    frozen (P1 unblur, 830ms), NO will-change:filter (v0.4.28),
    swapped to filter:none the frame it lands (v0.4.30), one full rAF
    tick before any geometry moves. E2E now samples every finale frame
    and asserts geometry never changed under a live filter.
  - **Timeline** (one clock — BootScene's rAF): P1 0-830ms unwind
    (quintic Hermite from live angle+velocity, ≥1.5 forward turns,
    lands EXACTLY 0 = the static paint's native angle) + brighten +
    unblur; P2 830-1490 shrink to the 121·s tile / 68.57·s hole (plain
    ease-in-out — the sampled-spring linear() is dead); P3 1490-2000
    slide left 302.5·s + wordmark (116.22·s) fades/slides in; P4 hold;
    release fade overlaps the tail. Onboarding finale non-skippable;
    cold boot = 400ms fade-in + 500ms drift + same timeline, skippable
    on any input.
  - Kept: dither + cursor glow (steps garnish, fade at landing, swept
    at 900ms), fitted superellipse/32.5%/27.5% corner profile (the
    mock's nominal radii are wireframe approximations of the logo).
  - RULES now: no gradient/paint animation ever; blur only under the
    frozen-geometry contract above; single dark layer (crossfade
    coverage math is structurally unreachable); one rAF clock owns all
    JS motion; boot.css is the ONLY home for boot-motion styles.
  - Queued: uiScale≠1 bug carries into bootVars unchanged; raster-
    throttle harness still unbuilt (did a manual CDP trace this pass).
  - AWAITING Adam's Windows pass: steps shimmer (static blur must not
    re-filter while the sheet spins), unwind from mid-burst, the
    landing, shrink at 125% DPI/HDR, cold-boot feel + skip.
- **v0.4.38: the emergence is SEQUENCED, not crossfaded (Adam's repro:
  the whole center flashed a muddy aurora wash mid-finale).** The
  crossfade math was knowable and got waved off: two complementary
  opacity fades MULTIPLY — at the midpoint the center's coverage
  (veil×screen stack) dips to ~75%, bleeding the full-brightness aurora
  through the entire center for ~300ms (subtle at 1600×900 headless;
  ugly on a big HDR display). Fix: the screen fades in FIRST (320ms —
  black over the veil's black center = invisible; over the glow band it
  darkens monotonically, pressing the light out into the frame), THEN
  the veil releases the border (380ms, delay 240ms, done by 620ms <
  the 650ms boot flip). Verified with per-region luminance sampling:
  center pinned at 0.0 the whole emergence, band monotone down, border
  monotone up. RULE: complementary fades over a bright layer must be
  SEQUENCED so combined coverage never dips — check the
  1-(1-a)(1-b) arithmetic before shipping any crossfade.
- **v0.4.37: audit fixes (two Sonnet agents reviewed v0.4.36 — one
  adversarial, one against the Emil Kowalski motion standards now in
  .claude/skills):**
  - **Entrance animation/transition collision (real bug, reachable):**
    the aurora/dither entrance was a 1600ms CSS ANIMATION while the
    emergence is a TRANSITION on the same `opacity` — a running
    animation preempts a transition, so Skip inside the first 1.6s
    stalled/desynced the emergence. Entrances are now @starting-style +
    transitions (1600ms base, is-finale overrides to 600ms) — a
    mid-entrance finale RETARGETS smoothly (verified empirically).
    RULE: entrance effects on emergence-managed properties must be
    transitions, never animations.
  - **Reduced motion kept the release fade** (dropped `.onb` from the
    1ms transition-duration list): guidance keeps comprehension-aiding
    opacity fades; the 400ms release fits before the 550ms unmount.
    `.onb-screen` added to the 1ms list (defensive).
  - **`.onb.is-leaving` gets pointer-events: none** — the overlay is
    fully transparent 50ms before onDone unmounts it and must not eat
    clicks meant for the app.
  - **Wordmark now truly persistent** (rendered from first render like
    frame/screen, base opacity 0) — the "nothing ever mounts" claim is
    now literally true; and all stale "mimic"-era comments purged
    across Onboarding.tsx / onboarding.css / App.tsx / welcome.ts
    (the audit's top find: comments contradicting code, this repo's
    twice-burned failure mode).
  - Provenance note: the flip/mount pixel-delta measurements quoted in
    these entries (0.05-0.07%) came from session-local pixelmatch
    harnesses against `pnpm preview`, not from anything committed; a
    committed screenshot-diff + raster-throttle harness stays QUEUED.
  - Motion-review taste items (NOT applied — they alter Adam-approved
    steps feel; his call): stagger 90ms→~65ms (standards say 30-80);
    onb-out's curve reads ease-in-shaped, could be ease-out; onb-btn
    180ms→160ms; hover rules ungated by (hover:hover); swatch :active
    squish; emergence `ease` → the steps' signature cubic-bezier(0.22,
    1, 0.36, 1) for vocabulary cohesion.
- **v0.4.36: PERSISTENT SCENE GRAPH + EMERGENCE — the finale end-state
  (four-agent review; Adam picked "emergence + endgame now" + the
  tightened timeline).** After v0.4.35 the residual artifact on Adam's
  machine was diagnosed by the agents as INHERENT to animated mask
  geometry: (a) the landing parked a by-design 12px fringe + square
  corner slivers OUTSIDE the final edge until a wall-clock fade (worse
  at 125% DPI/HDR; my own CSS comment described a tuck the code never
  did); (b) the per-frame fullscreen mask re-raster can present STALE
  TILES against the seat's current geometry under load — headless
  screenshots synchronize with raster and structurally cannot see this,
  which is why every "fixed" verdict shipped green. Conclusion: the
  un-feather violated the rebuild's own law (nothing repaints per
  frame). v0.4.36 finishes the law:
  - **Persistent scene graph**: .onb-frame (holding the aurora),
    .onb-screen, .onb-wordmark are the BOOT'S OWN ACTORS, in the DOM
    from first render to app reveal. The finale flips two classes
    (is-finale → is-boot); NOTHING ever mounts/remounts — no fresh
    fullscreen layer is born anywhere in the sequence (the old mimic
    mount was the last raster-timing bet).
  - **Emergence**: the veil's mask is STATIC FOREVER (rasterizes once);
    the finale is all opacity on painted-once layers — screen fades up
    AT ITS FINAL GEOMETRY, veil/dither dissolve, aurora brightens
    0.5→1, rAF spring lands rotation on 0 mod 360 (= the boot paint's
    native angle). No moving boundaries: a wrong SHAPE is no longer
    expressible; worst failure = briefly wrong brightness. RULE: never
    reintroduce animated mask geometry or any per-frame-raster
    primitive to the backdrop, bounded or not.
  - **is-boot**: attaches onb-boot-* keyframes (welcome.css twins) to
    the same nodes with a 300ms hold (INTENTIONAL divergence from the
    cold boot's 700ms — this viewer stared at the frame all flow); the
    paint drops to cover scale (invisible, conic scale-invariance) and
    welcome-gradient-spin resumes = exact cold-boot parity. Flip
    measured invisible (0.069% pixel delta, spin drift included).
  - **Timeline tightened** (Adam approved): 650 condense + 300 hold +
    2000 boot + 700 end-hold with the 450ms app-reveal fade overlapping
    its last 200ms ≈ 4.0s finale (was 4.8s+).
  - Emil Kowalski's design-eng skills added to .claude/skills (Adam).
  - QUEUED (SUPERSEDED — see the v0.4.42 sign-off entry: Adam decided
    UI scale should not affect these screens at all; exempt the
    overlays from the root zoom, do NOT zoom-correct the math):
    latent uiScale bug — lockupVars computes from visual
    innerWidth but elements lay out in innerWidth/zoom, z-distorting
    the boot lockup's end scale under UI scale ≠ 1 (geometry-agent
    find; affects the real boot too). Also
    queued: a raster-throttled E2E harness (--slow-down-raster-scale-
    factor) so stale-tile artifact classes become testable headless.
- **v0.4.35: the morph geometry moved to JS (Adam's frame-by-frame after
  v0.4.34: the seat's hard edge STILL poked through the soft band on his
  WebView2, while headless Chromium — computed-value dumps + screenshots
  — provably kept the invariant).** Diagnosis from his frames: both the
  seat and the veil animated smoothly, but on DIFFERENT effective curves
  — his engine's registered-custom-property transitions don't track the
  seat's standard `inset` transition, so the trajectories desynced.
  Fix: the rAF loop now drives ALL morph geometry (veil inset-x/y,
  feather, lift + seat inset) from ONE clock and ONE easing
  (easeInOutCubic over MORPH_MS 550), written as inline styles per
  frame — the containment invariant cannot desync across engines by
  construction. Only the residue fade stays a CSS transition (plain
  opacity, delay 540ms). RULE: never drive the morph with CSS
  transitions on custom properties; typed-property interpolation is
  engine-sensitive on WebView2.
- **v0.4.34: morph fade-timing fix (Adam's frame-grab: a hard inner
  rectangle snapped in before the border solidified).** The veil's
  residue fade started at 420ms — while the .onb-screen seat was still
  traveling — so dropping the veil's opacity exposed the seat's hard
  edge through the still-soft band. The fade now waits for the seat to
  LAND (100ms ease, delay 540ms > the vars' 550ms track, done by 640ms
  < the mimic's 650ms mount): the only thing it ever reveals is the
  final screen edge, and the only thing it dissolves is the 12px fringe
  + corner slivers. Invariant to keep: the veil must stay at opacity 1
  for as long as the seat is moving.
- **v0.4.33: THE FINALE IS A SEAMLESS MORPH (Adam: "there shouldn't
  ever be a transition to the boot animation" — v0.4.32's condense was
  a crossfade with mismatched gradients).** Three constructions make
  the mimic's mount pixel-identical (measured: 0.06% of pixels differ
  across the mount boundary in headless Chromium):
  1. **The aurora's paint IS the boot gradient** — welcome-gradient
     classes verbatim inside the disc, spin frozen at its native 90deg
     (`.onb-aurora .welcome-gradient { animation: none }`), fit scaled
     2.1×cover (a conic depends on angle only → scaling about its
     center changes nothing; 2.1 outreaches the viewport's circumcircle
     at every rotation/aspect). Steps drift = this paint rotated by the
     rAF angle; zero repaints (child is static, wrapper rotates).
  2. **The spin-down LANDS**: a critically-damped spring (ω=12,
     velocity-continuous from drift or mid-burst) takes the disc to the
     NEAREST full turn — rotation 0 = the boot's first-frame gradient
     exactly. Lands < 0.05deg by CONDENSE_MS (650ms).
  3. **The veil un-feathers into the screen**: its mask geometry rides
     four registered @properties (inset-x/y, feather, lift) that
     TRANSITION 550ms — the 260px soft band tightens to a 12px edge
     landing exactly on the screen inset — while the .onb-screen seat
     (boot screen twin, always mounted, parked at inset 300px inside
     the veil's opaque interior) slides out beneath it on the same
     curve (gap = 40px×(1−e), zero only at the end). A late 150ms
     opacity fade (delay 420ms) dissolves the veil's last 12px fringe
     and the square-ish corner slivers the two-ramp intersect can't
     round, leaving the seat's true superellipse corners. Meanwhile the
     aurora BRIGHTENS 0.5→1 (the glow resolves, not fades).
  Mimic mounts at 650ms with NO entrance animation (pixels identical);
  backdrop tears down at 750ms UNDER the opaque mimic (v0.4.29 lesson);
  settle/leave timers shifted by CONDENSE_MS. Reduced motion: media
  block reverts all condense end-states (no mimic mounts — the morph
  would flash the bare gradient center).
- **v0.4.32: THE TWO v0.4.31 SHIP-BREAKERS FIXED (Adam's repro:
  onboarding "just an oval", boot animation broken).**
  1. **Boot animation was killed by a COMMENT.** welcome.css's TWIN
     comment wrote `(--s/--tv-*/--scr-*)` — the star-slash inside
     `--tv-*/` TERMINATED the comment; the tail leaked out as garbage
     CSS and the parser ate the ENTIRE `.welcome-backdrop` rule
     (proven: computed animationName "none", rect 1600×0; the unclipped
     gradient child painted fullscreen while screen/wordmark animated —
     Adam's exact screenshot). Comment reworded; E2E section 9 now
     asserts the backdrop rule APPLIES and the frame really shrinks, so
     a dead rule can never ship green again. Lesson: never write `*/`
     inside a CSS comment; a per-file open/close count catches it
     (`grep -o "/\*" f | wc -l` vs `"\*/"`).
  2. **The "oval": v0.4.31's disc mask was a circle in DISC-space** —
     sampled anisotropically by the viewport (full color at the side
     edges, none at top/bottom) — and its elliptical veil held
     everything dim. Rebuilt to the v0.4.30 look, still zero-filter:
     the disc is UNMASKED (paints the whole viewport, like the old
     blurred disc); the dark center is a fullscreen black veil carved
     by TWO INTERSECTING linear-gradient masks (x-ramp × y-ramp,
     mask-composite: intersect — rectangle-following ~200px feathered
     band, corners most open, no box silhouette, static/painted-once).
     Side-by-side vs a v0.4.30 worktree build: matches.
  Also hardened the finale for Adam's compositor-artifact-prone
  machine: backdrop layers (aurora/veil/dither/cursor glow) UNMOUNT
  650ms into the finale and the rAF loop stops — the mimic plays over
  plain black, no invisible pinned 150vmax layer still receiving
  transform writes; the mimic wrapper's fade-in is opacity-only (the
  v0.4.31 scale settle collapsed its layer 100ms before the children's
  shrink promoted new ones — v0.4.26-29-class promotion churn).
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

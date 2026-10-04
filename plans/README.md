# Plans

Every plan, with where it stands (refreshed 2026-09-28, v0.10.61). The
week of 2026-09-28's log is [week-2026-09-28.md](week-2026-09-28.md).

001 to 007 came out of the `improve-animations` audit at commit `018a8f4` (2026-07-22). The full
verified findings table is in [audit-report.md](audit-report.md), 71 findings that
survived adversarial verification, out of 77 raised. The execution rollout (waves,
feel-gates, risks) is in [OP-PLAN.md](OP-PLAN.md).

Each plan is self-contained: an executor with zero context can run one end-to-end.
Run with `improve-animations execute <plan>` or hand to any agent.

## Plans

| Plan | Title | Severity | Status |
| --- | --- | --- | --- |
| [001](001-press-feedback.md) | Add press feedback to every pressable surface | HIGH | DONE (wave B; feel-gate: EPG tiles re-pressed as brightness dip, not scale, wide shared-edge tiles read as detaching when scaled (Adam)) |
| [002](002-overlay-popover-entrances.md) | Give every overlay, popover, and chip a real entrance | HIGH | DONE (wave B; feel-gate = the @starting-style WebView2 smoke test) |
| [003](003-vod-source-panel-transitions.md) | Make the VOD source panel interruptible, with a real exit | MEDIUM | DONE (wave C) |
| [004](004-motion-tokens.md) | Motion tokens: shared easing curves and duration tiers | HIGH | DONE (wave A) |
| [005](005-thumb-physics.md) | Unify sliding-thumb physics; Toggle off layout properties | HIGH | DONE (wave A; feel-gate: ChipTabs thumb 300→380ms per Adam, spring kept, on watch) |
| [006](006-reduced-motion-pass.md) | Close the reduced-motion gaps | HIGH | DONE (wave C; hover gates written :hover:not(:active), the wave-B press dips out-cascaded naive gates) |
| [007](007-hold-to-clear-progress.md) | Hold-to-clear: show the hold's progress | MEDIUM | DONE (wave C) |
| [008](008-two-tier-updates.md) | Two-tier updates: a frontend hot channel behind the installer | MEDIUM | LIVE: 0.10.3 and 0.10.14 went out on it (2026-09-26). An installed app downloaded 0.10.3; a dev run then quarantined it, fixed in v0.10.19, and v0.10.46 made the channel forward-only |
| [009](009-library-and-lists.md) | Library: multiple lists, and a home for everything you've watched | MEDIUM | COMPLETE (0.8.0 headline feature) |
| [010](010-sports.md) | Sports: a hub for what is on right now | MEDIUM | SHIPPED (0.9.0 headline, released 2026-08-23; matcher refined v0.9.47 and v0.9.75 against a real catalog) |
| [011](011-live-home.md) | Live TV: a home screen instead of ten thousand channels | MEDIUM | DESIGN (3 open questions; one needs a real playlist) |
| [012](012-player-events.md) | Stop polling mpv: observe properties like Stremio does | HIGH | CLOSED (persistent instance shipped + verified v0.8.168-172; event loop CUT at 0.08% of a core; faster clock declined) |
| [013](013-multiview.md) | Multiview: two to four sports at once | MEDIUM | ARCHITECTURE STANDS (web tiles through the native proxy since v0.9.101, verified on Adam's line); UI superseded by 017 |
| [014](014-shadcn-and-glass.md) | shadcn/ui, and a layer of liquid glass | LOW | L0 to L2 DONE (M2, v0.10.29 to v0.10.37; every generated component has a consumer, held by verify-tailwind); the screens took plan 019's look instead of L3; the glass is plan 022 |
| [015](015-trakt.md) | Trakt: sign in, scrobble what you watch, bring in what you watched elsewhere and where you left off, a two-way watchlist | HIGH | BUILT v0.10.27 to v0.10.36 (2026-09-27); waits on Adam's Trakt app keys for its first real run |
| [016](016-audit-work.md) | Working the v0.9.79 audit: release path, what broke, the system, each screen once | HIGH | IN PROGRESS (Tracks 0, 1, 3, 6 and N done; 2 became 017; 4, 5 and 7 open, 4.8 and 4.9 are plan 022) |
| [017](017-multiview-design.md) | Multi-view, designed: an immersive mode, 16:9 tiles with info and controls, a search-first picker | HIGH | COMPLETE (P1 to P6b, v0.9.105 to v0.9.121; shipped in 0.10.0) |
| [018](018-multiview-hardening.md) | Multi-view, hardened: tiles that recover, the line's count, what the tab costs, the keyboard | HIGH | COMPLETE (H1 to H5, v0.9.125 to v0.9.131; shipped in 0.10.0) |
| [019](019-multiview-language.md) | Multi-view's look, on every tab: its controls, tiles, states and picker as the whole app's primitives | MEDIUM | SHIPPED in 0.10.14 (built v0.10.1 to v0.10.11); three items left on purpose, reasons in the plan |
| [020](020-player-language.md) | The player in the redesign's language: its controls in two capsules like the nav, Play the white circle, times as eyebrows, menus on the chip fill | LOW | BUILT v0.10.22 (2026-09-27), option B, with a tooltip on every player button |
| [021](021-mal.md) | MyAnimeList: sign in, your finished anime episodes counted on MAL, your MAL counts ticking episodes here | MEDIUM | BUILT (v0.10.39 to v0.10.44, films included, 2026-09-27); waiting on Adam's MAL app for a real run |
| [022](022-glass-and-light.md) | The glass in two tiers, and light mode back with its control | MEDIUM | CALLS TAKEN 2026-09-29 (glass B, grey page, Appearance control); not built yet |
| [023](023-aiostreams-jellyfin.md) | AIOStreams' Jellyfin side: sync what you watch with AIOStreams' own watch state, skip intros and credits for every film and show, Next Up and Upcoming rows | MEDIUM | BUILT (2026-10-04): v0.11.13, 595c29a1 (native), v0.11.14; not yet run against a real AIOStreams |
| [024](024-aiostreams-sign-in.md) | AIOStreams by sign-in: the instance's address and a code instead of a pasted manifest URL, with Stream's catalogs, details, sources and playback over the Jellyfin side | MEDIUM | CALLS TAKEN (2026-10-04): all four as recommended; B1 and B2 building |

## 001 to 007: execution order & dependencies

1. **004 (tokens) first**: 001, 002, 003, 005 reference `--ease-out` / `--ease-drawer` /
   `--spring` pairings. (Each plan inlines the literal values as a fallback, so any
   order *works*, but tokens-first avoids literal-then-tokenize churn.)
2. **001 (press feedback)** and **002 (entrances)** next, either order, independent files
   mostly, both touch settings.css/themes.css reduced-motion blocks (whichever runs
   second extends the block the first created).
3. **003 (vod panel)** and **005 (thumbs)** any time after 004, independent.
4. **006 (reduced motion) second-to-last**: it sweeps for gaps and coordinates with
   blocks created by 001/002/003; running it last-but-one catches everything.
5. **007 (hold-to-clear)** any time, independent delight item.

## Not planned (deliberately)

- The header Live↔Stream rail glide (`base.css:466-480`), raised three times, twice
  overturned: comments document it as deliberate. The surviving performance point
  (max-width is a layout property) is real but the layout re-centering *is the design*;
  revisit only with a Performance trace showing actual dropped frames.
- The hero carousel's 650ms slide and glow choreography, deliberate cinematic move
  (its reduced-motion gap IS planned, in 006).
- The boot scene, onboarding, and welcome animation, sanctioned delight surfaces.
- Table-only findings (Plan `—` in the report): real but lower leverage: e.g. Discover
  search result-collapse (#2 in the report, needs a state-management decision about
  keeping stale results visible), Settings→Themes hand-off, settings tab-content swap,
  view navigation crossfades, tooltip replay on the folded rail, guide star feedback,
  update-chip custom-property spin (removed in v0.10.61: it animated an
  angle nothing read). Ask for a plan for any of these and it can be
  written from the report row.

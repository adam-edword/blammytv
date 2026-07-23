# Polish audit — 0.7.0 push

*2026-07-22 · branch `blammytv-0.7.0-push` · method: 6 parallel audit dimensions
(dead-code, debloat, css/tokens, react-perf, ux-polish, code-health), every finding
adversarially verified by an independent agent against the code AND the documented
intent in ROADMAP/CLAUDE/HANDOFF (61 agents total). Only findings that survived
verification appear here — 53 of 55. Animations/motion excluded (separate audit).
Full machine-readable findings with complete evidence + verifier notes:
`docs/polish-audit-0.7.0.json` — read an entry's verifier note before executing its
fix; several contain load-bearing line-range corrections.*


## P1 — user-visible, small effort (do first)

### 1. playMeta rebuilt every render feeds useDirectOverlay's [meta] effect — TheaterOverlay re-renders on every LiveScreen/StreamScreen render (worst: per guide hover-preview during playback)

`apps/app/src/features/live/LiveScreen.tsx:418` · react-perf · impact **high** · effort **S**

- **Evidence:** LiveScreen builds playMeta in a render-time IIFE (LiveScreen.tsx:418-431) — new Date(), a .find() over the channel's programmes, and a fresh buildMeta object every render. useDirectOverlay's meta effect is keyed on object identity: `useEffect(() => { metaRef.current = meta; s.metaCbs.forEach(cb => cb(meta)); }, [meta, s])` …
- **Fix:** Memoize playMeta at both call sites: LiveScreen — useMemo keyed on [playUrl, heroChannel, airing-programme identity (e.g. its start time via the existing 30s-tick pattern), favorites.includes(heroChannel.id)]; StreamScreen — useMemo keyed on [playing?.url, playing?.label, playing?.episodeId, aniSkips]. Belt-and-braces: in …

### 2. Ad-hoc danger/success color family in settings.css — two different danger reds, no tokens

`apps/app/src/styles/settings.css:598` · css-tokens · impact **medium** · effort **S**

- **Evidence:** The fixed-red intent is documented (settings.css:583 'The red is fixed (not the accent) so danger reads as danger under any theme') but the values are scattered and inconsistent: `color: #e04b4b` (598, danger title) vs `color: #e25b5b` (990 playlist error, 1167 license error) — two near-identical danger-text reds; `border: 1px solid …
- **Fix:** Add constant (deliberately untheamble) tokens to tokens.css — e.g. --danger: #c22727; --danger-text: #e25b5b; --ok: #2cad57 — keep the documented fixed-red decision, derive the 45% border via color-mix from --danger, and pick one danger-text red.

### 3. Supporter is the only intense pack without a .guide__cell:hover replacement, and the inherited hover is near-invisible on its frosted cells

`apps/app/src/styles/intense-packs.css:208` · css-tokens · impact **medium** · effort **S**

- **Evidence:** Terminal (80), dither (313), kawaii (426) and streamy (477) all override the base cell hover with `filter: none` plus an inset ring, explicitly 'Drop the base brightness filter'. Supporter re-backgrounds every cell to `#00000040 !important` + blur (203-210) but adds no hover rule, so live.css:721's `filter: brightness(1.25)` still …
- **Fix:** Add `:root[data-theme-pack="supporter"] .guide__cell:hover { filter: none; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.35); transition: box-shadow 140ms ease; }` (matching the other packs' pattern).

### 4. Card (Tilt-wrapped) mapped in every big grid without memo; unstable metaFields identity would defeat memo where it matters most

`apps/app/src/features/stream/StreamScreen.tsx:1675` · react-perf · impact **medium** · effort **S**

- **Evidence:** Card (StreamScreen.tsx:1675) is a plain function component wrapping react-parallax-tilt (a stateful pointer-tracking component) and is mapped in three large lists: Stream home rows (StreamScreen.tsx:1265-1282, rowCap default 40 items/row across many rows = 200-400 mounted cards), the Discover infinite-scroll grid …
- **Fix:** Wrap Card in React.memo. In DiscoverScreen, hoist gridMetaFields into useMemo([filter, metaFields]). In MyListScreen, useMemo the entries.map(toItem) array and the gridMetaFields array. Optionally memo ContinueCard too, giving Home stable per-entry callbacks (useCallback keyed maps or pass entry + id-taking handlers) since its …

### 5. Stream Home renders a completely blank page when the catalog loads empty

`apps/app/src/features/stream/StreamScreen.tsx:1242` · ux-polish · impact **medium** · effort **S**

- **Evidence:** Home has branches for unconfigured (line 1213), loading (1224), and error (1228), but the ready path renders `{featured.length > 0 && <Hero…>}` plus `data.rows.map(...)` with no empty branch. buildVod (features/stream/source.ts:161-163) swallows per-catalog failures into `{ cat, items: [] }` and rows with 0 items are skipped …
- **Fix:** In Home, when `load.status === "ready"` and `featured.length === 0 && data.rows.every(r => r.itemIds.length === 0) && activeWatching.length === 0`, render a `.stream__note` in the family voice, e.g. "Nothing came back from your catalogs — check the manifest in Settings → AIOStreams." Optionally have buildVod set `error` when every …

### 6. Continue Watching card: no keyboard path to clear, Space scrolls the page, Sources chip unreachable by keyboard

`apps/app/src/features/stream/StreamScreen.tsx:1786` · ux-polish · impact **medium** · effort **S**

- **Evidence:** The role=button div (1786-1798) only maps Enter/Space to onOpen; onClear is reachable solely via a 1s pointer hold (1771-1779) — keyboard users cannot remove an entry. The Space keydown calls onOpen without preventDefault, so the scroll container also pages down. The "Sources ›" chip is opacity:0 until :hover (stream.css:1101-1104) with …
- **Fix:** e.preventDefault() on Space; add a Delete/Backspace handler (or a focus-revealed ✕ button) calling onClear; add `.continue-card:focus-within .continue-card__sources { opacity: 1; }` mirroring the guide-star rule.

### 7. Header Profile button and Live search button are clickable no-ops with full hover affordances

`apps/app/src/app/AppHeader.tsx:329` · ux-polish · impact **medium** · effort **S**

- **Evidence:** The Profile button (329-331) has aria-label, cursor:pointer and a hover brighten (base.css:509-511) but no onClick — clicking does nothing, with no comment marking it a placeholder (README.md:50 lists Profile as a future cosmetic feature). The Live-side search button (192-204) is documented as deliberately inert ("wire it when TV search …
- **Fix:** Until wired, render both with disabled (or aria-disabled + tabIndex -1), drop the hover brighten/cursor for the disabled state, and optionally a title="Coming soon" — keeping the layout slot intact.

### 8. Deleting a playlist is one-click destructive; the app's own Danger Zone requires arm-then-confirm for the same class of action

`apps/app/src/features/settings/PlaylistsTab.tsx:239` · ux-polish · impact **medium** · effort **S**

- **Evidence:** The ✕ on a playlist row calls `update(removePlaylist(playlists, p.id))` immediately (239-246) — stored credentials (server/username/password or portal/MAC) are gone in one click with no undo, and hiddenCategories curation with them. CustomizeTab's "Clear All Login Info" (152-177) treats exactly this data as needing a two-click …
- **Fix:** Reuse the arm pattern on the row delete: first click arms (button swaps to "Click again to remove", 4s timeout), second click deletes — same mechanics as clearLogins so the behavior language stays consistent.

### 9. Truncated text lacks tooltip recovery inconsistently across sibling surfaces

`apps/app/src/features/stream/StreamScreen.tsx:2055` · ux-polish · impact **medium** · effort **S**

- **Evidence:** Source rows ellipsize their meta lines (`.vod-source__lines span` white-space:nowrap + ellipsis, stream.css:815-819) with no title attribute (StreamScreen.tsx:2055-2059 and panel 959-963) — the release name is exactly what the user picks a source BY. Stream Card titles clamp to 2 lines (stream.css:360-363) with no title attr (1731), …
- **Fix:** Add title attributes: full line text (or the joined lines) on .vod-source, title={item.title} on the Stream Card button, and title={channel.name} on the guide card (cheap; the aria-label already carries it for AT).

## P2 — worth scheduling (medium effort or deeper change)

### 1. Dead ~108-line theme-pack card block in settings.css (.pack-row + entire .pack-card family)

`apps/app/src/styles/settings.css:433` · dead-code · impact **medium** · effort **S**

- **Evidence:** grep -rIn '\.pack-card\|pack-row' across apps/scripts/services (ts/tsx/mjs/html) returns nothing; a class-extraction script over all 13 CSS files vs all TS/TSX+index.html flags pack-row, pack-card, pack-card--active, pack-card__preview, pack-card__surface, pack-card__accent, pack-card__name, pack-card__lock, pack-card__heart as …
- **Fix:** Delete settings.css lines ~431-538: the 'theme packs' section banner, .pack-row, and all .pack-card* rules, stopping before .pack-preview-note at line 540.
- **Verifier correction:** One precision correction to the fix: deletion should stop at line 537, not 538 — lines 538-539 are the doc comment for the live .

### 2. Credential scrubber (scrubbedMessage) and colon-preserving encSegment have no direct unit tests despite being load-bearing

`apps/app/src/lib/errors.ts:8` · code-health · impact **medium** · effort **S**

- **Evidence:** scrubbedMessage is the single chokepoint keeping Xtream/AIOStreams credentials out of on-screen errors and console logs (used by live/source.ts, stream/source.ts, aioProbe.ts, Onboarding.tsx, DiscoverScreen.tsx). It's covered only incidentally (source.vod.test.ts:166 and source.stalker.test.ts:136 assert one scrubbed string each); its …
- **Fix:** Add lib/errors.test.ts (~5 asserts: origin-only output, multi-URL message, invalid-URL fallback, non-Error input, query-credential stripping) and 2-3 asserts for encSegment/addonBase in data/data.test.ts (colon preservation, slash/space escaping, trailing-slash base trim). ~30 lines total in a repo that already runs 243 units — the …

### 3. 528 KB of .woff font fallbacks shipped that WebView2 can never download

`apps/app/src/fonts.ts` · debloat · impact **medium** · effort **M**

- **Evidence:** dist/assets contains 70 font files totaling 996 KB: 35 .woff2 (468 KB) + 35 .woff (528 KB). The built CSS (dist/assets/index-BXJVhaWK.css) has 41 @font-face rules, each `src: url(...woff2) format("woff2"), url(...woff) format("woff")` — the Fontsource default. Chromium/WebView2 (the only target; Linux is just the sandbox) always resolves …
- **Fix:** Stop using Fontsource's prebuilt CSS and declare the @font-face rules by hand in a small fonts.css importing only the woff2 files (e.g. `@fontsource/stack-sans-headline/files/stack-sans-headline-latin-400-normal.woff2`), preserving the exact family names/weights/unicode-ranges the theme packs rely on. Alternatively a ~10-line Vite …
- **Verifier correction:** caveat for the fixer: the 35 files are unicode-range subsets (latin, hebrew, etc.); a hand-written fonts.

### 4. LiveScreen sidebar (groups × folders, splitTitleEmoji per folder) rendered inline — re-renders on every hover-preview and tooltip state change

`apps/app/src/features/live/LiveScreen.tsx:594` · react-perf · impact **medium** · effort **M**

- **Evidence:** The source/folder rail is inline JSX in LiveScreen: ready.groups.map (LiveScreen.tsx:594) with nested g.folders.map (LiveScreen.tsx:643) calling splitTitleEmoji(f.name) per folder per render (LiveScreen.tsx:644). LiveScreen re-renders on every setPreview (each guide-cell mouseenter) and every setTip (folded-rail hover, …
- **Fix:** Extract the <aside> list into a memoized SidebarList component taking (groups, conns, closedGroups, folder, collapsed, and stable callbacks for toggle-group/pick-folder/tip). All of those props already have stable identities across preview/tip changes, so React.memo will skip it entirely during guide hovers. Optionally memoize …

### 5. Error states dead-end on Stream and Discover while Live gets a Try-again button

`apps/app/src/features/discover/DiscoverScreen.tsx:314` · ux-polish · impact **medium** · effort **M**

- **Evidence:** LiveScreen's two error states both render a retry (`live-status__retry` "Try again" → refresh(false), LiveScreen.tsx:736-742 and 754-760). The sibling surfaces have none: Discover's "Couldn't load Discover." (DiscoverScreen.tsx:312-317) offers only the message; Stream Home's "Couldn't load your catalog." (StreamScreen.tsx:1228-1234) …
- **Fix:** Add a retry button to each: Discover re-runs the loadDiscover effect (lift it into a callback like Live's refresh); Stream Home re-calls loadVod(true); the sources rail/panel re-runs resolveVodSources. Reuse the live-status__retry / btn-primary styling so the affordance reads the same across tabs.

### 6. Discover renders fetch failures as authoritative empty results

`apps/app/src/features/discover/DiscoverScreen.tsx:133` · ux-polish · impact **medium** · effort **M**

- **Evidence:** Search: `searchDiscover(...).then(r => setResults(r), () => setResults([]))` (line 133) — a network failure renders "No results for “{q}”." (line 338), a definitive claim the app can't back. Browse grid: every page fetch failure maps to null (line 234), all-null leaves `items` empty with phase "idle", which renders "Nothing here — the …
- **Fix:** Track failure distinctly: search error → a `results: "failed"` state rendering "Search didn't go through — try again." with retry; grid reset where ALL pages returned null → an error note (with retry) instead of the empty-catalog copy.

### 7. Themed :focus-visible ring exists only on Live (and Onboarding); Stream/Discover/My List/header get the browser default

`apps/app/src/styles/live.css:1055` · ux-polish · impact **medium** · effort **M**

- **Evidence:** live.css:1055-1072 declares "One themed ring for every interactive Live control" (mode rail, groups, folders, cards, cells, retry, resize). Grep across styles finds no :focus-visible rule in stream.css, discover.css, ui.css or base.css — stream cards, continue cards, hero carousel, genre cards, ChipTabs, header actions, vod-source rows, …
- **Fix:** Extend the same ring: one grouped rule per sheet (or a shared selector in ui.css) applying `outline: 2px solid var(--accent); outline-offset: 2px` on :focus-visible to .stream-card, .continue-card, .shero__card, .genre-card, .chip-tabs__tab, .header__tab, .header__action, .vod-source, .vod-back, .season-chip, .episode-card, …

### 8. ChipTabs carries no selected-state semantics while Live's equivalent rail is a full WAI-ARIA tablist

`apps/app/src/ui/ChipTabs.tsx:77` · ux-polish · impact **medium** · effort **M**

- **Evidence:** ChipTabs buttons (77-90) expose no aria-selected/aria-pressed/aria-current and no roving tabindex — the active chip differs only by opacity. The same control shape on Live (ModeRail, LiveScreen.tsx:87-103 + 137-186) implements role=tablist/tab, aria-selected, roving tabindex and arrow keys. ChipTabs serves Discover's filter, the header's …
- **Fix:** Give ChipTabs tablist semantics (role=tablist/tab + aria-selected + roving tabindex, reusing ModeRail's onKey logic), or minimally aria-pressed on each chip; add aria-pressed={i === seasonIdx} to season chips.
- **Verifier correction:** Caveat for the fixer: the tablist variant must handle the trailing search chip (a span+input, not a valid tab); the minimal aria-pressed/aria-current fix sidesteps that. Medium impact is right — chips stay Tab/Enter-operable, so it is a state-semantics gap for AT users, not an operability blocker.

### 9. Quick-resume failure is a silent no-op; episodes screen shows "Loading episodes…" forever on meta failure

`apps/app/src/features/stream/StreamScreen.tsx:512` · ux-polish · impact **medium** · effort **M**

- **Evidence:** quickResume: `if (!item) { setResolving(null); return; }` (512-515) — when resolveVodItem fails, a Continue Watching click flashes the resolving screen then lands back on Home with zero feedback (watchNow, by contrast, falls back to the detail page). Related: Episodes renders "Loading episodes…" whenever `item.seasons.length === 0` …
- **Fix:** quickResume: on item-resolve failure show a transient error note (or route to the detail page with the light entry data). Episodes: track whether the full meta resolve settled; render "Couldn't load episodes — try again" (with retry) or "No episodes listed" instead of the loading line once it has.

## P3 — hygiene batch (mechanical; can land as one or two sweep commits)

### 1. Placeholder.tsx is a dead file, and its .placeholder CSS block is dead with it

`apps/app/src/ui/Placeholder.tsx:2` · dead-code · impact **low** · effort **S**

- **Evidence:** grep -rn "Placeholder" --include='*.ts' --include='*.tsx' . (from src, excluding the file itself) returns only an unrelated doc comment in xmltv.ts:87. Cross-repo grep of apps/scripts/services for className "placeholder"/placeholder__ hits only Placeholder.tsx itself. Its comment says 'Empty screen used while a tab's real feature hasn't …
- **Fix:** Delete apps/app/src/ui/Placeholder.tsx and the '.placeholder' section of styles/base.css (lines ~518-545, including the section banner comment).
- **Verifier correction:** Caveats for the fix: the deletion range should stop at base.css:543 (line 544 is the next section's banner for the update chip), and base.

### 2. .toggle-disable-wrap--off is dead — superseded by ThemesModal's .theme-pill__seg--off

`apps/app/src/styles/settings.css:426` · dead-code · impact **low** · effort **S**

- **Evidence:** grep -rn 'toggle-disable-wrap' --include='*.tsx' --include='*.ts' across the repo returns zero hits (only the CSS rule). HANDOFF.md:201 documents it as the old CustomizeTab dark-only-pack mechanism ('the Light toggle wraps in .toggle-disable-wrap--off'); the dark-only case is now handled in ThemesModal.tsx:538 via 'theme-pill__seg--off' …
- **Fix:** Delete the .toggle-disable-wrap--off rule and its comment (settings.css ~lines 421-429).

### 3. .license-control is dead — ThemesModal renders the license form without the wrapper

`apps/app/src/styles/settings.css:1116` · dead-code · impact **low** · effort **S**

- **Evidence:** Class-extraction audit flags license-control as referenced by no TS/TSX/HTML/other-CSS; grep -rIn 'license-control' across apps/scripts/services confirms zero non-CSS hits. ThemesModal.tsx uses license-form (line 711), license-input (713), license-remove (700), license-status (742) — all still styled in the same section — but nothing …
- **Fix:** Delete the .license-control rule and its comment (settings.css ~1112-1121).

### 4. Dead tokens --badge-4k/--badge-fhd/--badge-hd and --accent-dim, plus a stale comment describing the old badge-border scheme

`apps/app/src/styles/tokens.css:47` · dead-code · impact **low** · effort **S**

- **Evidence:** A custom-property audit (regex '--[a-zA-Z0-9-]+:' definitions vs 'var(--...)' / setProperty / getPropertyValue reads across all CSS+TS) shows --badge-4k (tokens.css:48), --badge-fhd (:49), --badge-hd (:50), and --accent-dim (:39) are defined but read nowhere; grep -rn 'badge-4k|badge-fhd|badge-hd|accent-dim' over all css/ts/tsx returns …
- **Fix:** Delete tokens.css lines 39 and 47-50 (the --accent-dim token, the badge tokens, and the stale badge-border comment). Verify no pack CSS overrides them first (already checked: none do).

### 5. Four dead icon components in icons.tsx: InfoIcon, ListIcon, PencilIcon, SquareIcon

`apps/app/src/ui/icons.tsx:176` · dead-code · impact **low** · effort **S**

- **Evidence:** grep -rnw -E 'InfoIcon|ListIcon|PencilIcon|SquareIcon' --include='*.ts' --include='*.tsx' over apps, scripts, and services (excluding icons.tsx) returns zero hits; each symbol occurs exactly once in icons.tsx (its declaration: PencilIcon:176, SquareIcon:222, InfoIcon:426, ListIcon:502). No namespace imports of the module exist (grep …
- **Fix:** Delete the four unused icon components from icons.tsx.

### 6. Stale comment in stream.css describes a deleted ::after glow on .shero__card

`apps/app/src/styles/stream.css:122` · dead-code · impact **low** · effort **S**

- **Evidence:** Comment inside .shero__card reads 'No overflow:hidden here — it would clip the ::after glow.' but grep -n '::after' styles/stream.css shows no shero-related pseudo-element (only episode-card__thumb::after and continue-card__artwrap::after). The glow is now a separate sibling layer — .shero__glowbox/.shero__glowtrack with <img …
- **Fix:** Rewrite the comment to reference the sibling .shero__glowbox layer (or drop the ::after rationale), keeping whatever rationale for no-overflow still holds (rounding lives on art/scrim layers).

### 7. public/logo.png is 722 KB (1143x1143 RGBA) but rendered at 35x28 px — 31% of the entire dist

`apps/app/public/logo.png` · debloat · impact **low** · effort **S**

- **Evidence:** public/logo.png = 721,762 bytes, PNG 1143x1143 8-bit RGBA (verified with file/ls). Its only uses: favicon (`<link rel="icon" href="/logo.png">` in apps/app/index.html:6) and `<img className="header__logo" src="/logo.png">` in apps/app/src/app/AppHeader.tsx:178, styled at `width:35px; height:28px` (apps/app/src/styles/base.css:261-264). …
- **Fix:** Point both the favicon and .header__logo at the existing logo.svg (4.6 KB), or export a small PNG (~70x56 for 2x DPI, a few KB) if raster is preferred for the favicon. Then delete whichever of logo.png/logo.svg is left unreferenced. Saves ~700 KB (~30% of dist).

### 8. latin-ext subsets add ~300 KB across all seven font families — possibly unneeded

`apps/app/src/fonts.ts` · debloat · impact **low** · effort **S**

- **Evidence:** du over dist/assets: latin-ext font files total 300 KB (144 KB woff2 + ~156 KB woff). Fontsource weight CSS (e.g. @fontsource/vt323/400.css) unconditionally includes every subset, so latin + latin-ext ship for all 14 imported family/weight combos. Caveat that keeps this from being a clear cut: IPTV channel names and VOD titles are …
- **Fix:** Decide based on real provider data: if the user's playlists contain latin-ext glyphs, keep the woff2 latin-ext files (144 KB after the .woff cut) and close this. If not, the hand-rolled @font-face approach from the woff finding can import latin-only woff2 files, saving the further 144 KB. Do not cut blindly — missing subsets fall back to …

### 9. @tauri-apps/api is in devDependencies but imported at runtime by app code

`apps/app/package.json` · debloat · impact **low** · effort **S**

- **Evidence:** package.json lists "@tauri-apps/api": "^2.11.0" under devDependencies, yet 5 source modules import it at runtime (2x @tauri-apps/api/window, 2x @tauri-apps/api/core, 1x @tauri-apps/api/event, per import scan). It works today only because Vite bundles it into index-*.js; any future tooling that prunes devDependencies for a production …
- **Fix:** Move @tauri-apps/api from devDependencies to dependencies in apps/app/package.json. Zero size change (already bundled); pure classification fix.

### 10. Theme-pack coverage gap: dither/kawaii (and mildly terminal) keep solid --bg guide occluders over non-flat pack backgrounds — the exact defect streamy documents and fixes

`apps/app/src/styles/intense-packs.css:282` · css-tokens · impact **low** · effort **S**

- **Evidence:** Streamy's block explains at 483-485: 'The board gradient is OPAQUE and diagonal, so the guide's flat --bg occluders would read as dark patches' and frosts .guide__ruler/.guide__corner/.guide__channel (487-492); supporter does the same (195-199). But dither's background is a #000→#1F1F1F diagonal Bayer gradient (307) while …
- **Fix:** Give dither, kawaii (and optionally terminal) the streamy recipe scoped to their pack: translucent tinted occluders + static backdrop-filter blur(10px) (WebView2-safe per the file's own guardrails), tinted to each pack's --bg.

### 11. Supporter's !important cluster contradicts the 'one sanctioned !important' doctrine; streamy proves it unnecessary

`apps/app/src/styles/intense-packs.css:199` · css-tokens · impact **low** · effort **S**

- **Evidence:** tokens.css:93-94 declares the sharp-corner radius zero 'the one sanctioned !important'. Supporter uses six more: `background: transparent !important` (199), `background: #00000040 !important` (208), the --live cell (221), `display: none !important` (229, 236), `padding-right: 0 !important` (246). Streamy overrides the identical occluder …
- **Fix:** Drop the !importants at 199, 208, 229, 236, 246; keep 221 but rewrite its comment to name the real reason (beating ui.css's later-loaded equal-specificity aurora rule), or bump its specificity instead.

### 12. Player glass recipes duplicated: .overlay__btn vs .player__btn--glass, .track-menu vs .stats-overlay

`apps/app/src/styles/player.css:358` · css-tokens · impact **low** · effort **S**

- **Evidence:** .overlay__btn (192-213) and .player__btn--glass (358-370) restate the identical glass set — `background: rgba(0,0,0,0.32)`, `border: 1px solid rgba(255,255,255,0.16)`, `backdrop-filter: blur(14px) saturate(1.2)`, the same two-part box-shadow — and identical hovers (219-222 vs 372-376); the comment at 191 admits 'Same glassy treatment as …
- **Fix:** One shared `.glass-circle` (buttons) and `.glass-panel` (menu/stats) class each carrying the recipe once; variants keep only size/position. Alternatively hoist the values into --player-glass-* custom properties at the top of the file.

### 13. settings.css verbatim duplicates: .source-tools__discard/.source-tools__all and the glass-popover recipe

`apps/app/src/styles/settings.css:714` · css-tokens · impact **low** · effort **S**

- **Evidence:** .source-tools__discard (683-699) and .source-tools__all (714-736) are declaration-for-declaration identical (padding 7px 14px, --radius-chip, --surface-raised, 0.5px --border-raised, Bold 13, brightness(1.3) hover) — only :disabled differs. Separately, .accent-popover (314-328) and .chip-select__menu (838-850) both restate the …
- **Fix:** Merge the two source-tools buttons under one class (`.source-tools__btn`) with a modifier; extract a `.glass-popover` base class for the two popovers (which also matches .settings' card language).

### 14. boot.css header comment states two contradictory P4 timings (3200ms vs 2530ms)

`apps/app/src/styles/boot.css:37` · css-tokens · impact **low** · effort **S**

- **Evidence:** Line 30: 'P4 hold →3200ms, then the host's release fade.' Seven lines later, after the FULL-CIRCLE LANDING paragraph, line 37 repeats: 'P4 hold →2530ms, then the host's release fade.' — a leftover from the pre-v0.4.41 timeline (the header's own total is '3200ms total' at line 3 and line 12). Anyone timing the host release against the …
- **Fix:** Delete the stale 2530ms line (or, if 2530ms was the pre-v0.4.41 truth someone may need, mark it explicitly as superseded).

### 15. stream.css comments contradict the rules below them: '90vh' hero (is 80vh) and '650ms-ish' shadow (is 450ms)

`apps/app/src/styles/stream.css:33` · css-tokens · impact **low** · effort **S**

- **Evidence:** Line 33: 'featured hero (Figma 133-721): 90vh sliding track' but the rule at 45 is `height: calc(80vh * var(--ui-zoom-inverse, 1))` with its own comment 'True 80vh at every UI-scale notch'. Line 327-329: '650ms-ish settle, matched to the Tilt transitionSpeed' directly above `transition: box-shadow 450ms ease;` — either the value or the …
- **Fix:** Update the section header to 80vh; for the tilt shadow, verify the actual Tilt transitionSpeed prop in the component and make comment and value agree (comment-only fix if 450ms is the tuned truth).

### 16. Badge comment says 'Bold 7.2px' but the rule is 8.2px

`apps/app/src/styles/ui.css:150` · css-tokens · impact **low** · effort **S**

- **Evidence:** ui.css:149-150: '23x12 pills: tier gradient at ~30% over black, Bold 7.2px.' The rule at 166 sets `font-size: 8.2px`. Also mildly stale: the file-top chip comment (3-4) still describes 'near-black track; the raised #2a2a2a chip' though both are tokens now (--surface-track/--surface-raised) that every theme pack re-points.
- **Fix:** Correct the size in the comment to 8.2px and reword the chip-rail comment in token terms ('the raised --surface-raised thumb').

### 17. Dead-weight and WRONG-value var() fallbacks scattered through stream.css/settings.css

`apps/app/src/styles/stream.css:995` · css-tokens · impact **low** · effort **S**

- **Evidence:** `var(--accent, #c22727)` appears 8 times (stream.css:439, 915, 969, 1037, 1082, 1216; settings.css:1024, 1082) while dozens of sibling rules use bare `var(--accent)` — the fallback can never fire (tokens.css always defines --accent) and invites inconsistency. Worse, two fallbacks lie about the token: `var(--radius-card, 14px)` …
- **Fix:** Drop all fallbacks on tokens that tokens.css unconditionally defines (mechanical sweep); tokens loaded first in main.tsx guarantees availability.

### 18. live.css housekeeping: stale file header + --header-h fallback disagrees with every other sheet

`apps/app/src/styles/live.css:10` · css-tokens · impact **low** · effort **S**

- **Evidence:** Line 10: `padding-top: var(--header-h, 103px)` while stream.css (11, 643, 665, 752) and discover.css (13) all use `var(--header-h, 76px)` for the same AppHeader-published variable — if the measure ever fails, Live clears 27px more than its siblings for the identical header. Line 1's file header is also stale: 'Rebuilding section by …
- **Fix:** Pick one fallback (the header's real resting height) and use it in all three sheets — or hoist it as a `--header-h-fallback` note in tokens.css; rewrite live.css's line-1 comment to describe the file's actual contents.

### 19. VOD progress tick drives setWatching every 5s (1s while popped) — state churn re-rendering the playback stage while the only consumer (Home) is unmounted

`apps/app/src/features/stream/StreamScreen.tsx:832` · react-perf · impact **low** · effort **S**

- **Evidence:** The 5s progress interval calls setWatching(updateWatchingProgress(...)) (StreamScreen.tsx:832-838); updateWatchingProgress always returns a freshly-mapped array (watching.ts: `loadWatching().map(...)` + save), so every tick is a guaranteed new state identity → full StreamScreen re-render. During playback StreamScreen early-returns the …
- **Fix:** During playback, persist without setState: call updateWatchingProgress for its storage write but drop the setWatching (or add an updateWatchingProgressQuiet). Re-sync state once on stop/onEnded/onPopoutClosed with setWatching(loadWatching()). This removes the periodic re-render entirely; the storage write cadence (which powers resume) is …

### 20. TheaterOverlay runs document.elementFromPoint on every mousemove to feed setMouseIgnore — a documented no-op on the inline (shipping) path

`apps/app/src/features/live/TheaterOverlay.tsx:441` · react-perf · impact **low** · effort **S**

- **Evidence:** The activity tracker's document-level mousemove handler does `document.elementFromPoint(e.clientX, e.clientY)` + `el.closest("[data-interactive]")` on every pointer move while theater/fullscreen chrome is mounted (TheaterOverlay.tsx:439-442), solely to call api()?.setMouseIgnore(ig). On the inline inverted-player path — the only shipping …
- **Fix:** Gate the hit-test on the path that needs it: inline mode is identifiable by the `frame` prop being set (TheaterOverlay.tsx:153 already branches on it). In the mousemove handler, when `frame` is present skip elementFromPoint/closest and only call wake(). The overlay-webview fallback keeps the current behavior.

### 21. window.matchMedia evaluated on every render via useRef initializer argument in Card and the Stream Hero

`apps/app/src/features/stream/StreamScreen.tsx:1702` · react-perf · impact **low** · effort **S**

- **Evidence:** Card does `useRef(window.matchMedia("(prefers-reduced-motion: reduce)").matches).current` (StreamScreen.tsx:1701-1703) and Hero the same (StreamScreen.tsx:1482-1484). useRef's argument is evaluated on every render even though only the first value is kept — so every render of every Card performs a matchMedia call. Today that is hundreds …
- **Fix:** Hoist to a module-level constant (`const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches`) or a tiny shared hook with a lazy useState initializer (`useState(() => ...)`), and reuse it in both components. Matches the existing pattern of module constants like NO_PROGRAMMES.

### 22. Loading states announce nothing outside Live (role=status only on the Live tab)

`apps/app/src/features/stream/StreamScreen.tsx:1224` · ux-polish · impact **low** · effort **S**

- **Evidence:** Live's loading/error blocks carry role="status" aria-live="polite" / role="alert" (LiveScreen.tsx:722-726, 728-731 — part of the landed v0.1.98 pass). Stream Home's "Loading your catalog…" is a bare div (1224-1227); Discover's skeleton grid is aria-hidden with no textual alternative (DiscoverScreen.tsx:400-405), and "Searching…"/"Loading …
- **Fix:** Add role="status" (and aria-live="polite") to Stream's loading note, Discover's Searching/Loading-more notes, and pair the skeleton grid with a visually-hidden status line; add role="alert" to the Stream/Discover error blocks to match Live.

### 23. Same copy string shipped with both curly and straight apostrophes

`apps/app/src/features/stream/StreamScreen.tsx:2038` · ux-polish · impact **low** · effort **S**

- **Evidence:** The identical message appears twice in one file with different typography: "Couldn&rsquo;t load sources." (line 940, in-playback panel) vs "Couldn't load sources." (line 2038, detail rail). Tab-level errors split the same way: Discover "Couldn&rsquo;t load Discover." (DiscoverScreen.tsx:314) vs straight quotes in StreamScreen.tsx:1231, …
- **Fix:** Pick one (the curly &rsquo; matches the &ldquo;/&rdquo; already used in MyListScreen and PlaylistsTab quotes) and normalize every user-facing string; a grep for "'t " in JSX text catches the set.

### 24. Stream Home error path skips the credential scrubber Discover uses for the same failure

`apps/app/src/features/stream/StreamScreen.tsx:220` · ux-polish · impact **low** · effort **S**

- **Evidence:** DiscoverScreen wraps its load rejection in scrubbedMessage with the comment "transport errors echo the FULL manifest URL (the credential) and this string renders on screen" (DiscoverScreen.tsx:147-154). StreamScreen's parallel rejection handler renders `e instanceof Error ? e.message : String(e)` raw (213-221 → shown at 1232). Today …
- **Fix:** Use scrubbedMessage(e) in StreamScreen's loadVod rejection handler, matching Discover.

### 25. Race-sensitive popout + #inv-chrome wiring duplicated (and already diverging) between LiveScreen and StreamScreen

`apps/app/src/features/stream/StreamScreen.tsx:664` · code-health · impact **low** · effort **S**

- **Evidence:** The documented 'heal the shell's clip hole BEFORE Rust tears the video child down' sequence (querySelector('.app-shell') → clipPath='' → tauriPopoutOpen) exists verbatim in two places: LiveScreen.tsx:454-466 and StreamScreen.tsx:664-673 — both carry the same scar comment about losing the race flashing the desktop through the hole. The …
- **Fix:** Extract two small shared pieces in features/live: (1) an openPopout(url) helper that owns the heal-hole-then-popout_open sequence (both onPopout handlers call it, keeping their own state resets); (2) a useInvChromeHost() hook that creates the #inv-chrome div, appends/removes it, and clears the overlay-api override on teardown. One home …

### 26. Shared Card/RowScroller primitives live inside the 2245-line StreamScreen.tsx; two other features import a screen file for them

`apps/app/src/features/stream/StreamScreen.tsx:1675` · code-health · impact **low** · effort **S**

- **Evidence:** Card (StreamScreen.tsx:1675) and RowScroller (StreamScreen.tsx:1292) are the shared card primitives — DiscoverScreen.tsx:8 and MyListScreen.tsx:2 both `import { Card, RowScroller } from '../stream/StreamScreen'`. So the grid features depend on a 2245-line screen module whose other 2000 lines (playback orchestration, popout, Up Next, …
- **Fix:** Step 1 (cheap, clearly right): move Card + RowScroller (and ContinueCard's shared bits) into features/stream/cards.tsx; update the three importers. Step 2 (optional, discuss first per the Confusion Protocol — it touches the playback stage): extract the playing-state cluster into a useVodPlayback hook + VodStage component so the screen …

### 27. Dead exports in data/stalker.ts: fetchShortEpg and resetStalkerSession have zero callers, and resetStalkerSession's comment claims callers that don't exist

`apps/app/src/data/stalker.ts:395` · code-health · impact **low** · effort **S**

- **Evidence:** fetchShortEpg (stalker.ts:395-412, the documented 'lazy fallback when a portal ignores get_epg_info') is referenced nowhere — not in source.ts, not in any test. resetStalkerSession (stalker.ts:59-61) is likewise uncalled, and its doc comment says '(tests, or a Settings credential edit)' — neither exists (grep across src and *.test.ts …
- **Fix:** Decide per function: fetchShortEpg — either promote to ROADMAP (wire it as the EPG fallback when get_epg_info returns empty, plausible since Stalker is 'NOT yet proven against a real portal') or delete it; resetStalkerSession — either call it from the Settings playlist-edit path (a stale session self-heals via withSession's retry today, …

### 28. stalker.ts: fetchShortEpg is dead (unwired EPG fallback) and resetStalkerSession is dead with a stale doc comment claiming tests use it

`apps/app/src/data/stalker.ts:395` · dead-code · impact **low** · effort **M**

- **Evidence:** grep -rl -w for each symbol across all src TS/TSX (including tests) and scripts/services returns only stalker.ts itself; internal occurrence count is 1 each (declaration only; the verify-script hits are Playwright getByPlaceholder, unrelated). fetchShortEpg's comment calls it 'the lazy fallback when a portal ignores get_epg_info', but …
- **Fix:** Either wire them (call resetStalkerSession from the Settings credential-edit path — arguably a real gap since sessions cache ~1h — and fetchShortEpg as the documented EPG fallback) or delete both and their comments. Ask before deleting fetchShortEpg in case it is undocumented groundwork like the stream.ts catch-up code.

### 29. Unnecessary export keywords on ~20 symbols used only inside their own file

`apps/app/src/features/stream/source.ts:145` · dead-code · impact **low** · effort **M**

- **Evidence:** A sweep of every 'export (function|const|type|interface)' declaration vs whole-src usage (grep -rl -w per symbol, excluding the defining file, tests counted separately) found these exported but imported nowhere, not even by tests, while being used internally: stream/source.ts buildVod (:145) and pickEven (:365); stream/mapper.ts …
- **Fix:** Drop the export keyword on the value symbols (buildVod, pickEven, mapStream, windowEnd, programmesFor, LAND_MS, SETTLE_MS, AURORA_HUE, clampRowCap, DEFAULT_KEYBOX, keyboxUrl, genreForCatalog, actionUrl, liveStreamsUrl, xmltvUrl, MOCK_FOLDERS, MOCK_PLAYLIST_NAME) so dead-code tooling and readers see the real module surface. The type …

### 30. z-index ladder exists only in scattered comments, with outliers that break it

`apps/app/src/styles/live.css:906` · css-tokens · impact **low** · effort **M**

- **Evidence:** Values span -2, -1, 0..5, 20 (base.css:126 header), 30 (stream.css:1226 popped stage), 40 (live.css:387 .live-tip), 45 (player.css:248 #inv-chrome, stream.css:1153), 46 (stream.css:1163, player.css:833), 50 (stream.css:931), 60 (settings.css:10), 70 (settings.css:840), 200 (live.css:906 .live--fullscreen .hero__preview), 1000 …
- **Fix:** Add a --z-* scale to tokens.css (e.g. --z-header:20, --z-popped:30, --z-tip:40, --z-player-chrome:45, --z-player-float:46, --z-upnext:50, --z-modal:60, --z-menu:70, --z-boot:1000) and reference it everywhere; either fold the fullscreen 200 into the scale deliberately (documenting why it must beat modals) or lower it to the chrome tier.

### 31. Detail-screen glass-chip recipe duplicated 5x in stream.css with drifting blur radius

`apps/app/src/styles/stream.css:696` · css-tokens · impact **low** · effort **M**

- **Evidence:** The comment at 689 declares 'Same glass language as the pills/chips on these screens: #00000050, blur, and the shared darkening hover', then five blocks restate it: .vod-back (696), .vod-detail__pills button (729), .vod-source (782), .season-chip (837), .episode-card (862) — each with `background: #00000050`, a white hairline border …
- **Fix:** Extract a shared `.glass-chip` class (or a `--glass-fill`/`--glass-border`/`--glass-blur` custom-property trio on these screens) carrying fill, hairline, blur and darken-hover once; per-element rules keep only shape/typography. Unifies the 16 vs 18px blur drift as a side effect.

### 32. Brand gradient stop-lists and the dither dot lattice are hand-copied across 3+ files

`apps/app/src/styles/themes.css:72` · css-tokens · impact **low** · effort **M**

- **Evidence:** The 10-stop brand conic appears verbatim three times with only the `from` angle differing: boot.css:163-177 (.boot-paint), onboarding.css:189-203 (.onb-mark), base.css:581-585 (.update-chip ring, minus one stop-set drift risk already: the chip's list drops the percentage offsets). --rainbow-text is defined twice identically inside …
- **Fix:** Tokenize the stop list as `--brand-conic-stops` (usable via `conic-gradient(from <angle>, var(--brand-conic-stops))`) and `--dither-dots` (+ `--dither-dots-size`) in tokens.css; move --rainbow-text to :root next to its siblings and delete the two local copies.

### 33. onTime pushes every 500ms re-render the entire theater chrome for a clock/scrubber that lives in one corner of it

`apps/app/src/features/live/TheaterOverlay.tsx:193` · react-perf · impact **low** · effort **M**

- **Evidence:** useDirectOverlay's 500ms mpv_status poll pushes a fresh TimeInfo whenever dur > 0 (useDirectOverlay.ts:143-146); TheaterOverlay subscribes with setTime at the top level (TheaterOverlay.tsx:192-195), so during any VOD playback the whole ~450-line theater JSX tree (top buttons, meta block, track menus, controls, skip-chip computation …
- **Fix:** Move the time subscription down: extract the seek row + time labels (and the skip-chip/credits computation, which are the only time consumers) into a small child component that subscribes to onTime itself. The parent chrome then re-renders only on real state changes (pause, volume, menu, tracks). Low urgency — the tree is cheap to diff — …

### 34. Two hand-rolled TTL + single-flight cache implementations (live vs stream source loaders) carry the StrictMode-race guard separately

`apps/app/src/features/live/source.ts:52` · code-health · impact **low** · effort **M**

- **Evidence:** features/live/source.ts:49-196 and features/stream/source.ts:32-129 each implement config-fingerprint key → 30-min memory cache → single-flight inflight record → claim-slot-synchronously discipline. The StrictMode double-load race is a twice-documented scar (ROADMAP v0.1.104/v0.1.106: 'the slot is claimed SYNCHRONOUSLY before the async …
- **Fix:** Smallest safe move: extract a ~20-line singleFlight helper (claim record synchronously, join matching key, clear-if-current in finally) into lib/, used by both loaders; leave TTL policy, stage narration, and disk hydrate in each loader. Alternative if that feels like ceremony: add a cross-referencing comment in stream/source.ts pointing …

## Came back clean / do NOT act

- **Audit baseline: the noise/type/error-swallowing categories came back clean — no action needed** — Verified with real runs, not inspection alone: tsc --noEmit clean; eslint src --max-warnings=0 clean; 243/243 vitest units pass (33 files). Zero console.log/debug anywhere; the 8 console.info sites are [live] timings …
- **Refuted: @fontsource/unbounded is a dependency with zero imports (documented as intentional)** — The facts are accurate (dependency at apps/app/package.json:20, zero imports, no dist/bundle cost), but the situation is explicitly documented as intentional at apps/app/src/fonts.ts:31-32: "Unbounded stays in …
- **Refuted: My List grid has no heading while every sibling grid titles itself** — The raw facts check out (populated My List at /home/user/blammytv/apps/app/src/features/stream/MyListScreen.tsx:64-79 renders the gridwrap with no media-row__title; Discover's gridwrap at DiscoverScreen.tsx:396-399 …

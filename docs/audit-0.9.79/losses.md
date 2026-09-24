**Audit of losses since v0.9.0: 34 findings, one high.** Every file:line below is at HEAD (v0.9.79, c9196ba8) unless it says 0.9.0. I made no repo writes, started no servers and ran no harnesses. The v0.9.0 worktree is removed. My scratch tools and the compiled CSS are in `/tmp/audit-losses/`.

**How I found them:** I parsed every stylesheet with postcss at both versions and diffed them rule by rule (243 rules removed, 162 changed). I cross-checked every `<Button>` call site (117 of them) against the app-layer rules that target it. I compiled HEAD's CSS with `@tailwindcss/node` to confirm what utilities actually emit. I excluded anything already decided: the palette, radii, Geist, uppercase removal, button paint, the nav capsule, the themes/Aurora removal, and the known items.

**The pattern behind most of these:** v0.9.56's prune (1cfcec91) deleted hover-reveal and state rules along with the button paint. `opacity`, `:hover` reveals and `.is-on`/`--armed` rules are not Button-owned properties, so nobody intended those to go.

## Most severe first

1. **HIGH. Live guide: the favourite star is invisible for good, and its hit area is still live.** CONFIRMED.
   - **Cause:** 1cfcec91 deleted the reveal rule but kept `opacity: 0`.
   - **Where:** `live.css:566-575`, `Guide.tsx:549-571`. At 0.9.0 the reveal was `live.css:692`: `.guide__channel:hover .guide__fav, .guide__channel:focus-within .guide__fav, .guide__fav:focus-visible, .guide__fav--on { opacity: 1 }`.
   - **Evidence:** in the compiled CSS, nothing sets opacity on `.guide__fav` except the `opacity: 0`.
   - **What the user sees:** starred channels show no star. A 32×32 invisible button (it was 24×24) sits at `right: 18px` on every channel card, so clicking near a card's right edge toggles favourite instead of tuning. Keyboard focus lands on an invisible control.
   - **Coverage:** no harness touches `guide__fav`.
   - **Fix:** restore the 0.9.0 reveal rule and add a verify check.

2. **MED-HIGH. Settings: the light/dark toggle has no UI, but the stored theme is still applied at boot.** CONFIRMED.
   - **Cause:** 8ce5e53c. The Theme Style pill lived in ThemesModal (0.9.0 `ThemesModal.tsx:521-560`). v0.9.58's commit lists what left with the modal (accent picker, Aurora, onboarding accent) and does not list this.
   - **Where:** `main.tsx:42` still runs `applyTheme(loadTheme())`. The only writer is Reset (`CustomizeTab.tsx:115-120`), whose comment still says "the user control (the Theme Style pill) lives in the Themes panel now".
   - **Who is affected:** 0.9.0 users on Classic or Paper with light on boot into light and can only get out through Reset Appearance, which also wipes accent, scale and clock. Dark users can't reach light at all.
   - **Fix:** a Light/Dark ChipTabs row in Customize → Interface.

3. **MED. Every icon inside a `<Button>` renders at 16px, whatever its `size` prop says.** CONFIRMED.
   - **Cause:** the rule `[&_svg:not([class*='size-'])]:size-4` at `button.tsx:7` beats the SVG `width`/`height` attributes. 1cfcec91 / 2b9753b0 also deleted the app's `svg` sizing rules.
   - **Scope:** 44 icons.
     - Player: play/pause 26→16 (`TheaterOverlay.tsx:1745`), ±10s 24→16 (`:1726`, `:1754`), next 22, stats/lang/CC/volume 20, top cluster 20.
     - Header gear: 25 at 0.9.0, 22 per its prop, now 16 (`AppHeader.tsx:754`).
     - Settings close 24→16.
     - Mode-rail icons 20→16 (0.9.0 `live.css:152`).
     - Row arrows 18→16. Folder eye 15→16. League star 19→16.
   - **Fix:** put `size-*` classes on the icons, or drop the `size` props that no longer do anything.

4. **MED. Settings → Customize → Accent: the Custom popover picks up the old picker's positioning rule.** SUSPECTED visual; the mechanism is confirmed.
   - **Cause:** c9196ba8. `AccentPicker.tsx:186` gives `PopoverContent` the class `accent-popover`, and `settings.css:430-455` still has the legacy rule for it: `position: absolute; top: calc(100% + 10px); right: 0; display: flex; flex-direction: column; gap: 10px; transition…`.
   - **What likely happens:** Radix measures its wrapper, which is now 0×0 because the content is out of flow. The panel would open with its right edge at the Custom chip's left edge, 14px low, with no collision flip. The gap-10 plus `mt-3` doubles the spacing.
   - **Coverage:** verify-accent only hit-tests the centre of the popover, so it passes either way.
   - **Fix:** delete the position/top/right/display/gap/transition declarations, or rename the class. Keep the vendor.css hook.

5. **MED. Stored accents that 0.9.0 wrote without a click are brought back.** CONFIRMED.
   - **Cause:** c9196ba8. The `main.tsx:34-41` comment says "0.9.0 only ever stored an accent on a real swatch click". That's false.
   - **Evidence:**
     - 0.9.0's Reset saved `#c22727` (0.9.0 `CustomizeTab.tsx:211`).
     - Picking Streamy or Kawaii saved their paired accent (`#7b5bf5` / `#f2a0c2`), and leaving a paired pack saved `#c22727` (0.9.0 `ThemesModal.tsx:200-224`).
     - `loadAccentPairedBy` (`accent.ts:174`) has zero callers, so boot can't tell a pack's colour from a real pick.
   - **Fix:** at boot, skip the stored accent when `accent-paired-by` isn't empty.

## Live screen

6. **MED. The folder "hide" eye shows on every folder row, all the time.** CONFIRMED.
   - **Cause:** 1cfcec91 deleted `opacity: 0` and the reveal (0.9.0 `live.css:1109-1127`).
   - **Where:** `live.css:965-972`, `LiveScreen.tsx:233-240`.
   - **Effect:** it permanently covers the right 40px of each name. Same bug in the Sports league picker star, which borrows the class (`LeaguePicker.tsx:244-246`): all 151 league rows show a star.
   - **Fix:** restore `.live-folder-row:hover/:focus-within .live-folder__hide { opacity: 1 }` with base `opacity: 0`.

7. **MED. Mode rail (Live and Sports sidebars): the track is invisible in dark.** CONFIRMED.
   - **Cause:** 67229a84 plus f2462abb.
   - **Evidence:** `.mode-rail { background: var(--surface-puck) }` (`live.css:88`) = oklch(0.205), sitting on `.live-sidebar { background: var(--sidebar) }` (`live.css:34`) = oklch(0.205). At 0.9.0 (slate) it was #26262e on #1e1e25. The `tokens.css:24-27` comment says "a track is DARKER than the panel", but the values are equal.
   - **Fix:** point `--surface-puck` at a value that differs from `--sidebar`.

8. **LOW-MED. Mode rail chips: inactive chips no longer dim, and hovering one paints a second pill.** SUSPECTED visual.
   - **Cause:** 1cfcec91.
   - **Evidence:** 0.9.0 had opacity 0.5 / 0.85 / 1 (`live.css:124-148`). Now it's a ghost Button (`ModeRail.tsx:146`). The hover fill `bg-accent` is `--surface-raised`, the indicator's own colour (50% of it in dark, identical in light). That's the "lie" the `CustomizeTab.tsx:358-364` comment warns about.
   - **Fix:** `hover:bg-transparent` plus an opacity treatment.

9. **LOW. The folded sidebar rail lost its quiet 0.45 icons and hover cue.** CONFIRMED.
   - **Cause:** 1cfcec91.
   - **Evidence:** a husk is left at `live.css:289-291`: `.live-sidebar--collapsed .live-folder:hover { /* opacity is the hover cue when folded */; }`. At 0.9.0 it was `live.css:368-385`.

10. **LOW. The connections pill lost its warning colour when full.** CONFIRMED.
    - **Cause:** 67229a84.
    - **Evidence:** `.live-conns--full` (`live.css:197-200`) uses `--accent`, which was red and is now near-white. verify-conns only checks the class, not the colour.

11. **LOW. LIVE indicators went grey while the Sports pip stayed red.** SUSPECTED unintended.
    - **Cause:** 67229a84.
    - **Where:** `.hero__live` and its dot (`live.css:812-831`), `.theater-seek__live` (`player.css:543`), `.theater-live__dot` (`player.css:565-580`; its comment still says "glows red"). v0.9.60 kept `.gamepip` on `--danger` (`sports.css:155`) on purpose ("a grey live dot would say nothing").

12. **LOW. Live hero mini-preview: Play/Pause and Stop are always visible.** CONFIRMED.
    - **Cause:** 1cfcec91.
    - **Evidence:** 0.9.0 revealed them on hover (`player.css:195-212`). Now `player.css:177-180`, `TheaterOverlay.tsx:1403-1417`. They also lost their fixed `#fff` colour, so in light mode they are dark ink over video.

## Player (theater)

13. **LOW-MED. Menu triggers no longer show an open state.** CONFIRMED.
    - **Cause:** 1cfcec91 deleted `.player__btn.is-open` (0.9.0 `player.css:718-721`).
    - **Where:** Speed, Stats, Audio and CC (`TheaterOverlay.tsx:1814`, `1855`, `1871`, `1904`).
    - **Fix:** choose the variant from the state, as meta-pick does.

14. **LOW-MED. Unseekable VOD shows ±10s at full strength.** CONFIRMED.
    - **Cause:** 1cfcec91 deleted `.player__btn[data-inert] { opacity: .3; cursor: not-allowed }` (0.9.0 `player.css:1051`).
    - **Where:** `data-inert` is still set at `TheaterOverlay.tsx:1740` and `:1768`, and nothing reads it.

15. **LOW. Audio, subtitle and speed menu rows are centred.** CONFIRMED.
    - **Cause:** 1cfcec91. At 0.9.0 the label sat left and the tick right (`space-between`, 0.9.0 `player.css:785-800`). Button's `justify-center` wins now.
    - **Also dead:** `font: 500 13px/1.2` on `.track-menu__item` (`player.css:643-646`) loses to `text-sm`/`font-medium`.

16. **LOW. Play/pause lost its size hierarchy.** CONFIRMED.
    - **Cause:** 1cfcec91 deleted `.player__btn--play { 48px }`. Every transport button is 36px now, and with finding 3 every glyph is 16px.

17. **LOW. The skip chip lost its entrance fade.** CONFIRMED.
    - **Cause:** 1cfcec91 removed `opacity: 0` from its `@starting-style` (`player.css:747-751`; 0.9.0 `:928`). Under reduced motion there is no fade either.

18. **LOW. The player chrome follows the app theme.** SUSPECTED.
    - **Cause:** 1cfcec91.
    - **Evidence:** ghost hover is `bg-accent`/`text-accent-foreground`, and the LIVE pill is `secondary`. In light mode, hovered buttons become white squares with dark icons over video. At 0.9.0 the chrome used fixed rgba white.

## Stream and Library

19. **MED. Library: "Remove" is always on over every poster, as bare text overflowing a 32px box.** CONFIRMED.
    - **Cause:** 1cfcec91.
    - **Evidence:** 0.9.0 had a hover-revealed 11px glass pill (0.9.0 `stream.css:1684-1705`). Now `size="icon-sm"` holds a text label (`LibraryScreen.tsx:342-353`, `stream.css:1450-1456`). The comment still says "revealed on card hover".

20. **MED. Library: "Delete" list and "Clear history" have no danger colour and no armed state.** CONFIRMED.
    - **Cause:** 1cfcec91.
    - **Evidence:** the class is applied (`LibraryScreen.tsx:273-283`, `303-311`) but has no CSS. 0.9.0 `stream.css:1624-1627` and `1748-1751` coloured it. General's Clear uses `destructive` plus a ring, so the two screens now disagree.

21. **LOW. Row arrows are always visible whenever a row can scroll.** CONFIRMED.
    - **Cause:** 1cfcec91.
    - **Evidence:** they're transparent ghosts over art (`StreamScreen.tsx:2086-2104`). `top: calc(50% - 46px)` still assumes the old 46px size, so they sit about 5px off (`stream.css:260-265`; 0.9.0 `:266-289`).

22. **LOW. Continue Watching: the "Sources ›" chip is always on.** CONFIRMED.
    - **Cause:** 1cfcec91.
    - **Evidence:** 0.9.0 revealed it on hover or focus-within (`stream.css:1323-1342`). Now `stream.css:1106-1111`, `StreamScreen.tsx:2564`.

23. **LOW. The Continue Watching title hover went flat.** CONFIRMED.
    - **Cause:** 67229a84. `stream.css:405` changes colour from `--text` (0.985) to `--accent` (0.922) on hover, which is not visible.

## Sports

24. **MED. League picker: the armed "Remove from Favorites" state is broken.** CONFIRMED.
    - **Cause:** 1cfcec91.
    - **Evidence:** it lost `width/height: auto`, padding, `white-space: normal`, the danger colour and border (0.9.0 `sports.css:2444-2465`). Button `icon-sm` pins it to 32×32 at the top-left, since `inset: 0` plus a fixed width ignores `right`. The sentence overflows on one line in plain text. The ✕ is also always visible now (0.9.0 `:2409-2428`, reveal at `:2425`).
    - **Where:** `sports.css:2471-2497`, `LeaguePicker.tsx:318-329`.
    - **Fix:** a sized, variant-by-state Button.

25. **MED. Tournament draw: the selected filter chip looks the same as the rest.** CONFIRMED.
    - **Cause:** 1cfcec91 deleted `.tourndraw__chip.is-on` (0.9.0 `sports.css:3363-3367`). The variant is always `outline` (`TournamentDraw.tsx:265-275`).

## Settings

26. **LOW-MED. Playlists: the armed "Sure?" lost its danger colour and overflows its 32px box.** CONFIRMED.
    - **Cause:** 1cfcec91.
    - **Where:** `PlaylistsTab.tsx:247-281`, `settings.css:803-805` (0.9.0 `:1024-1030`).

27. **LOW. The manifest field's copy/clear puck no longer matches the field.** SUSPECTED.
    - **Cause:** 8a1e8ca6. The puck keeps `border-radius: 0 24px 24px 0` (`settings.css:339`) while the input went to 8px. Its `--surface` fill is also darker than the input's new tinted fill.

28. **LOW. Header Settings button: the capsule-glass chip was reduced to a plain 36px ghost.** CONFIRMED.
    - **Cause:** 1cfcec91. This was Adam's v0.9.27 design (fdfc796a): 44px round, capsule glass, 20px glyph. It may count as covered by "kill all custom button CSS", but it broke the pairing with the capsule, which kept its glass. The `base.css:410-424` comment still describes the 44/20 chip, and the `::after` rim is a husk.

29. **LOW. Header update chip.** CONFIRMED.
    - **Cause:** 1cfcec91.
    - **Evidence:**
      - The entrance fade is gone (`base.css:484-487`).
      - While installing, it drops to 50% with `pointer-events: none`, so the "installing" tooltip and progress cursor are unreachable (0.9.0 `base.css:645`).
      - `animation: update-ring-turn 9s infinite` still animates a variable nothing paints (`base.css:474`).

## Onboarding

30. **LOW. The copy is out of date.** CONFIRMED.
    - **Cause:** 8ce5e53c.
    - **Evidence:** `Onboarding.tsx:810-811` still says "sources, themes, playback, and a few surprises", but themes and Aurora are gone. `:746` says "A couple of preferences" on a step that has one. The accent step was cut because no picker existed; the picker is back in v0.9.79 and the step isn't.

31. **LOW. The onboarding CTAs follow the app theme.** SUSPECTED.
    - **Cause:** 1cfcec91.
    - **Evidence:** on the always-black `.onb`, a light-mode user who replays onboarding gets a near-black `bg-primary` CTA on #000. The ghost links lost their 0.5 alpha and shout at full white.

## Multi-view (shared code)

32. **LOW. The Sports board now polls `player_api` every 60s for every enabled Xtream playlist.** CONFIRMED.
    - **Cause:** 0b0f88e1. `useConnections(null)` at `SportsScreen.tsx:216` runs even for users who never open multi-view, and keeps running during single-game playback in the theater. Nothing polled from Sports at 0.9.0.
    - **Nothing found:** multi-view's CSS is all scoped `mv*` and did not reach single-view code. `MultiviewScreen` has no `useMouseNav`, so mouse Back does nothing there (the theater and draw both have it).

## Tests

33. **MED. verify-tailwind's "no app rule fights Button" check misses rules.** CONFIRMED.
    - **Cause:** any declaration with a comment in front of it is skipped (`verify-tailwind.mjs:593`, `m[2].split(";")` without stripping comments).
    - **Evidence:** I replicated the check offline. It PASSes as-is. With comments stripped it FAILs with 4 dead rules: `.update-chip transition`, `.live-collapse border-radius`, `.live-folder flex-shrink`, `.leaguepick__x--armed border-radius`.
    - **Also missing:** its OWNED list has no `width`, `line-height` or `font` shorthand, so `.track-menu__item`'s `font` shorthand isn't caught.

34. **LOW-MED. Light mode and the themes machinery have no coverage.**
    - verify-themes (18 checks, including the sun toggle and light) was parked. The comment at `verify-tailwind.mjs:156-161` still hands light-mode testing to it.
    - `license.test.ts`, `themePacks.test.ts` and `verify-license.mjs` sit in `old/` and never run, though ROADMAP decision 1 says "keep the machinery".

## Dead CSS (no user impact)

- Accent picker leftovers: `accent-row`, `accent-swatch*`, `accent-custom`, `accent-popover__*` (`settings.css:371-520`) and `accent-swatch--aurora` (`ui.css:376`).
- `license-*` (`settings.css:910-948`) and `pack-preview-note*` (`settings.css:519-545`).
- `onb-swatch(es)` (`onboarding.css:387-470`), `disc-search*` (`discover.css:26-60`), `header__searchchip` (`ui.css:426`).
- Empty `@media` at `base.css:371` and an empty `.navcap…{}` at `base.css:577-582`.

## Wins (don't undo)

- **729c17ba (v0.9.53):** a global `:focus-visible` ring by construction, replacing a 41-selector registry that kept going stale. It's fainter than 0.9.0's (3px of `--ring` at 50%, about 1.9:1 on `--bg`), worth a contrast pass.
- **Player playback fixes:** 4c262b29 (Play now stops the old episode), 7230a0c2 (remembered languages survive the episode roll), 0bce5e62 (track preference retried until mpv confirms), cc63c8ca (cancelling resolve actually cancels).
- **d7159e7b (v0.9.8):** chrome gets its box during VOD load, not after (`placeChrome`).
- **72234e0b (v0.9.24):** mouse Back works over Settings and exits the sports theater.
- **3d534a35 plus 67639688:** `pnpm verify` board, and verify-discover running again (it found a real bug).

**DONE:** every CONFIRMED item was traced through source and compiled CSS. The SUSPECTED visuals (4, 8, 11, 18, 27, 31) and anything light-mode need someone to open the running app. I didn't do that, because the rules ruled out starting servers.

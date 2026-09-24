Audit done. I drove every listed screen in light and dark at 1400x900, with spot checks at 1280x720 and 1920x1080, and the accent set to yellow (#ffd500, dark theme) and blue (#3730ff, light theme). Values come from getComputedStyle and getBoundingClientRect at deviceScaleFactor 2. All screenshots are in `/tmp/audit-polish/`. CSS paths are under `apps/app/src/styles/` and TSX paths under `apps/app/src/`.

Four things you'd see as broken, not just unpolished:
1. **Multi-view screen:** collapses to a 540px strip under the header.
2. **Light theme, three controls with invisible text:** the Undo toast message, "Add to Library" and the genre pills on the title page.
3. **Settings sheet:** overlaps the bottom 4px of the nav capsule, with no scrim behind it.
4. **Sports board:** 111px of dead space at the top, caused by the stylesheet cascade.

## App-wide (every screen)

- **HIGH. Ghost/outline hover is invisible in light theme, and so is the pressed chip.** CONFIRMED.
  - Measured: the hover fill is `oklch(1 0 0)` on a white Settings card, and on the 0.985 sidebar (Close, sidebar collapse, folder rows, folder-menu item).
  - Shots: `fm-hover-light.png`, `g-folder-hover-light.png`.
  - Source: `theme.css:156-158` maps `--color-accent` and `--color-secondary` to `--surface-raised`, which `tokens.css:294` sets to pure white in light.
  - Fix: map light `--color-accent` and `--color-secondary` to shadcn's `muted` (oklch 0.97), not `--surface-raised`.
- **HIGH. Dimmed setting descriptions fail contrast.** CONFIRMED.
  - Measured: `.settings__section-note--dim` is `opacity .4` on text-muted, which composites to **2.16:1 in dark and 1.69:1 in light**.
  - Shots: `se-customize-a-0-dark.png`, `se-general-live-0-light.png`.
  - Source: `settings.css:226-228`.
  - Fix: delete the opacity and use `text-muted-foreground`.
- **MED. The focus ring is too faint.** CONFIRMED.
  - Measured: ring/50 (0.556 at 50%) on the 0.145 page gives 1.87:1, under the 3:1 wanted for non-text.
  - Offsets differ: 3px on nav items, 0 everywhere else.
  - Shots: `focus-*.png`.
  - Source: `tokens.css:158`, `base.css:884`.
  - Fix: `ring-ring` at full strength, one offset everywhere.
- **MED. Casing is mixed across the app.** CONFIRMED.
  - Title Case: "Watch Now", "More Info", "Add Playlist", "Run Connection Test", "Get Started", "Startup Tab", "Clear All Login Info", "More Like This", "By Genre".
  - Sentence case: "Show earlier days", "Hide finished", "Compact results", "Show adult content", "Your lists", "New list".
  - Fix: sentence case everywhere, which matches the house voice.
- **MED. Text greys are built from alphas instead of tokens.** CONFIRMED.
  - Measured: `#f2f2f4` at .85/.8/.75/.65/.6/.55, white at .5/.55/.65/.75/.8, `rgb(12,14,20)` (blue-tinted) at .07 to .8, plus opacity .3/.35/.4/.5/.75/.85 applied to already-muted tokens.
  - Source: `stream.css:171-203,789-790`, `sports.css:400-446`, `base.css:355-401`.
  - Fix: `text-foreground`, `text-muted-foreground` and `text-dim` only. A raw colour only for a scrim over imagery.

## Header and nav capsule

- **HIGH. Settings is a bare 16px glyph.** CONFIRMED.
  - Measured: the button is a 36x36 transparent square with `rounded-md` 8px. Nav icons are 23px.
  - The comment at `base.css:410-449` still describes a 44px round glass chip with a 20px glyph. v0.9.56 (1cfcec91) killed it when the button moved to shadcn's Button.
  - Shots: `h-right-dark.png`, `st-rows-dark-1400.png` (the gear collides with a scrolled "Watch Now").
  - Source: `app/AppHeader.tsx:754`.
  - Fix: `size="icon"` plus `rounded-full size-11 bg-foreground/10 [&_svg]:size-5`.
- **HIGH. The capsule sits off-centre when there's no live source.** CONFIRMED.
  - Measured: capsule x 700 to 935, centre 817.5 against a viewport centre of 700. That's 117.5px off.
  - Shot: `state-nosrc-home-dark.png`.
  - Source: `base.css:584` (anchored on the mark, which isn't rendered).
  - Fix: centre the capsule itself when `.navcap__mark` is absent.
- **MED. The three header items sit on three different centrelines.** CONFIRMED.
  - Measured: clock 44, gear 49, capsule 59.5.
  - Shot: `h-focus-dark.png`.
  - Source: `base.css:225` (`padding: 27px 17px`), `base.css:403-408`.
  - Fix: `items-center` on one 65px row.
- **MED. The BETA chip is 8px and hard-coded white.** CONFIRMED.
  - Measured: 8px/700, 10px tall, `rgba(255,255,255,.75)` on `.14` white. In light that's about 1.5:1 on the grey pill.
  - Shots: `beta-light.png`, `beta-dark.png`.
  - Source: `base.css:386-401`.
  - Fix: shadcn `Badge variant="secondary"` at `text-[10px]`, token colours.
- **MED. The clock and version are near-invisible.** CONFIRMED.
  - Measured: clock 26px/200 at opacity .3 is 2.53:1. Version 11px/200 at .35 over muted is 1.88:1.
  - Shot: `h-brand-dark.png`.
  - Source: `base.css:355-370`.
  - Fix: `text-muted-foreground`, weight 400, no opacity.
- **LOW. Capsule geometry is off the 4px grid.** CONFIRMED.
  - Measured: padding 11/14, row gap 7, items 43x43, radius 33 (not pill).
  - Source: `base.css:593,605,638,889`, `tokens.css:99`.
  - Fix: 12/16 padding, 8 gap, 44 items, `rounded-full`.
- **LOW. Left edges don't line up across screens.** CONFIRMED.
  - Measured: clock x=17, Live sidebar x=12, Stream/Discover/Library gutter x=28.
  - Fix: one `--gutter` for header padding, sidebar margin and page padding.
- **MED. Light-theme capsule reads muddy.** CONFIRMED.
  - Measured: the active pill is text/30 (mid grey) on text/10, so every active state looks disabled.
  - Shot: `t-discover-light-1400.png`.
  - Fix: in light, a white thumb on a `muted` track (shadcn Tabs).

## Live guide

- **HIGH. "No Information" cells show through the sticky channel column when you scroll sideways.** CONFIRMED.
  - Measured: the dashed borders run through the card column and its 8px gutter.
  - Shot: `g-cell-hover-dark.png`.
  - Source: `live.css:476-487` (transparent column), `live.css:644-654` (`overflow: visible`).
  - Fix: give `.guide__channel` a `bg-background` fill, or clip the lane with `clip-path` to x ≥ column width.
- **MED. The channel card and programme cells in one row have different radii.** CONFIRMED.
  - Measured: card 14px (`--radius-card`), cell 8px.
  - Shot: `g-rows-dark.png`.
  - Source: `live.css:500,606`.
  - Fix: both `rounded-lg` (10).
- **MED. The now-line overshoots the last row by 8px.** CONFIRMED.
  - Measured: height 340 against 5 rows of 60 on a 68 pitch, so the rows end at 332.
  - Shot: `g-rows-dark.png`.
  - Source: `live.css:702-710`.
  - Fix: height = rows × 68 − 8.
- **MED. The logo slot overflows the card and the lettermark is bare.** CONFIRMED.
  - Measured: the logo box is 44x64 inside a 60px card (2px over, top and bottom). Images are square-cornered. The fallback is a bare 15/700 glyph with no tile.
  - Shots: `g-rows-dark.png`, `01-start-dark.png`.
  - Source: `live.css:513-532`.
  - Fix: 40x40 `rounded-md bg-muted` tile for both image and lettermark.
- **MED. Programme times are 10px and not tabular.** CONFIRMED.
  - Source: `live.css:684-690`.
  - Fix: `text-xs tabular-nums`.
- **MED. Ruler ticks are a literal pipe character.** CONFIRMED.
  - Measured: tick text is "| 4:30 AM", 13px/500 at opacity .75.
  - Source: `features/live/Guide.tsx:496`, `live.css:437-448`.
  - Fix: a 1px `border-l border-border pl-1.5`, `text-muted-foreground tabular-nums`.
- **MED. Channel card padding is lopsided.** CONFIRMED.
  - Measured: 0 12 0 5.
  - Source: `live.css:496`.
  - Fix: `px-3`.
- **MED. The selected channel has no visual state at all.** CONFIRMED (it's deliberate).
  - Measured: the selected card's background and border are identical to the rest.
  - Shot: `g-selected-dark.png`.
  - Source: `live.css:505-507`.
  - Fix: `bg-accent` or a 2px left bar. This is your call to overrule.
- **MED. The hero's chips don't match each other.** CONFIRMED.
  - LIVE badge: 17/700, 38px tall, radius 14.
  - "#1" chip next to it: 15/600, 23px tall, radius 10.
  - Channel name: 21px/600 with +0.06em tracking. Title: 41/700 (off-scale).
  - Preview: radius 12 with a hard-coded `#ffffff10` border.
  - Shots: `g-hero-dark.png`, `g-hero-light.png`.
  - Source: `live.css:812,839,854,882,739`.
  - Fix: `Badge` for both chips, text-4xl for the title, `border-border`, `rounded-xl`.
- **MED. The hero is inset on the right but the grid isn't.** CONFIRMED.
  - Measured: hero `padding-right: 50px`, while the grid runs to x=1400 with no gutter.
  - Source: `live.css:724`.
- **MED. The segmented track is invisible in dark.** CONFIRMED.
  - Measured: the mode-rail track `--surface-puck` equals the sidebar fill. Both are oklch 0.205.
  - Shot: `g-sidebar-top-dark.png`.
  - Source: `live.css:88`, `tokens.css:31`.
  - Fix: track `bg-background` (0.145) inside a card.
- **LOW. The sidebar group header uses yet another alpha, and pill radii drift.** CONFIRMED.
  - Measured: "Fake Panel" is 12/500 at `/0.7`. The 3/3 pill is 10px/700 at radius 1000 (not 999).
  - Source: `live.css:169,184`.
- **LOW. The airing cell is heavy in light.** CONFIRMED.
  - Measured: `rgb(218)` fill with a 36% near-black border.
  - Shot: `g-full-light.png`.
  - Source: `live.css:639-642`.
  - Fix: `bg-muted` with a 2px accent left edge.

## Sports board, multi-view entry and notice

- **HIGH. The multi-view screen collapses to a 540px strip.** CONFIRMED.
  - Measured: `.mvscreen` is 540.9px wide, the stage 202.9px, and each tile 97x831.
  - The rail starts at y=0 under the nav: the clock overprints tile 1 and the capsule covers the rail's "0/2" count.
  - Shots: `sp-mv-screen-dark.png`, `mv-screen-dark-1400.png`.
  - Source: `player.css:1129-1136` (a grid child of flex `.app-main` with no `flex:1`/`width:100%`, and no `--header-h` offset).
  - Fix: `flex-1 w-full pt-[calc(var(--header-h)+8px)]`.
- **HIGH. The multi-view notice sits top-right instead of centred.** CONFIRMED.
  - Measured: card at x 916 to 1352.
  - `.modal-backdrop--center` is used at `features/live/MultiviewNotice.tsx:42` but defined nowhere, so it inherits the top-right float from `settings.css:12-17`.
  - Shots: `sp-mv-notice-dark.png`, `mv-notice-card-dark.png`.
  - Fix: `justify-center items-center`, or move it to shadcn `Dialog`.
- **HIGH. The board has 111px of dead band, and its sidebar sits 12px lower than the Guide's.** CONFIRMED.
  - Measured: first content at y=226. Sidebar y=115 against the Guide's 103.
  - Cause: `.sportsboard__main` asks for `padding-top:0; padding-left:22px` (`sports.css:2178-2185`), but the element also carries `.discover`. `discover.css:13` is imported after `sports.css` (`index.css:114-115`) and wins, giving 111px and 28px. `.sportsboard` then adds `header-h + 12` (`sports.css:2173`).
  - Shots: `t-sports-dark-1400.png`, `t-sports-dark-1280.png`.
  - Fix: drop the `discover` class from the board, and use `pt-0 pl-[22px]` and `header-h` (not +12).
- **HIGH. The right carousel arrow paints over the team name.** CONFIRMED.
  - Measured: the arrow at x 1350 to 1386 sits on "Texas" (x 1311 to 1390). Arrows are transparent ghost buttons with no scrim.
  - Shots: `sp-arrow-right-dark.png`, `st-arrow-dark-1400.png`.
  - Source: `stream.css:260-269`.
  - Fix: `bg-background/70 backdrop-blur rounded-full` plus an edge-fade mask on the scroller.
- **MED. The two toggles on one board don't match.** CONFIRMED.
  - "Hide finished": 11px, padding 4/10, border 0.1.
  - "Compact results": 12px, padding 0/12, filled accent/18.
  - Shots: `sp-head-dark.png`, `sp-mid-dark.png`.
  - Source: `sports.css:66-110`.
  - Fix: one shadcn `Toggle size="sm"`.
- **MED. "Multi-view" and "Show earlier days" stack as two unrelated outline buttons above the first heading.** CONFIRMED.
  - Measured: y 226 and 272, 10px apart.
  - Source: `player.css:1258`, `sports.css:3787-3800`.
  - Fix: one toolbar row beside the "Today's Games" heading.
- **MED. The status line has three casings and two time formats.** CONFIRMED.
  - "Final" vs "FINAL" vs "6:52 - 2ND" (the ordinal is uppercased).
  - "6:00PM" (whitespace stripped, ignores the 12h/24h setting) vs "Started 4:00 PM" vs the guide's "4:30 AM".
  - Scores use a hyphen ("24-17", "14 - 10") while the guide uses an en dash.
  - Shots: `sp-mid-dark.png`, `sp-top-dark.png`.
  - Source: `features/sports/espn.ts:955-957`, `sports.css:291-296,1325-1335,1105`.
  - Fix: `formatClock`, no `uppercase` on status/time, U+2013 in scores.
- **MED. The sports card palette is off-token.** CONFIRMED.
  - Measured: dark card `rgb(15,15,15)` (between `--bg` 10 and `--surface` 23). Border white/.07 (the token is .10). Light ink `rgb(12,14,20)` is blue-tinted in a zero-chroma palette.
  - The comment says the page is `#f3f4f7`; it's pure white now, so the cards sit white on white.
  - Source: `sports.css:395-447`.
  - Fix: `bg-card`, `border-border`, `text-foreground`.
- **MED. Font sizes and spacing are fractional.** CONFIRMED.
  - Measured: sizes 18.46, 19.46, 21.3, 37.44; padding 42.6/25.56/19.88; grid gap 22.72; compact card height 48.27.
  - Fix: snap the scale factor to whole px: text-lg/xl/2xl, `gap-6`.
- **MED. A tall card in row 1 leaves a hole under the pills.** CONFIRMED.
  - Measured: two 48px pills plus a 181px card, so about 133px of empty space under the pills.
  - Shot: `sp-mid-dark.png`.
  - Source: `sports.css:225`.
  - Fix: pills in their own row, or `grid-auto-flow: dense` with pills spanning.
- **MED. Glare radii are stale.** CONFIRMED values, SUSPECTED visual.
  - Measured: `glareBorderRadius` is 63.9/42.6/25/30/60/100px while every card is 14px. `sports.css:471` itself says the two must stay in step.
  - Source: `features/sports/GameCard.tsx:126`, `features/stream/StreamScreen.tsx:2418`, and others.
  - Fix: `"14px"`, or read `--radius-card`.
- **LOW. Sibling cards hover differently.** CONFIRMED.
  - Measured: the compact card only brightens its border (.07 to .18). The upcard tilts to 1.03 with a 0.55 shadow.
  - Fix: same affordance for both.
- **LOW. The scroll clips on a hard edge.** CONFIRMED.
  - Measured: content is cut straight at y=115, while Discover and Settings fade.
  - Shot: `sp-mid-dark.png`.
  - Fix: 24px top `mask-image` fade.
- **LOW. The notice is built off-system.** CONFIRMED.
  - Measured: radius 22, an upward shadow `0 -13px 72.6px .73`, amber `#e0ab2b` with no token, weight 650, sizes 13.5/12.5/11.5, and a transparent glass card with no scrim.
  - Source: `player.css:870-981`.
  - Fix: shadcn `Dialog`, a `--warning` token, text-sm/xs.

## Stream home and title page

- **HIGH. Light theme: title-page buttons have invisible text.** CONFIRMED.
  - Measured: "Add to Library", its chevron and the genre pills are `rgb(242,242,244)` text on `oklch(1)`, about 1.1:1. "Back" is near-black on the dark red backdrop.
  - Shot: `dt-series-light.png`.
  - Source: `stream.css:686,789-790` (the body sets `#f2f2f4`, and outline Button inherits it on `bg-background`).
  - Fix: the scoped overlay needs dark-theme tokens: `data-theme="dark"` on `.vod-detail`, or `variant="secondary"` with explicit `text-foreground`.
- **MED. Movie and series pages disagree on left edge and order.** CONFIRMED.
  - Measured: movie info x=89.53 (`margin-left: 7%`) vs series x=32. Back sits at x=32 on both.
  - Order: movie is meta, cast, synopsis; series is synopsis, cast.
  - Shots: `st-detail-movie-dark-1400.png`, `st-detail-series-dark-1400.png`.
  - Source: `stream.css:707,734`.
  - Fix: one left edge (the 28px gutter) and one order.
- **MED. The movie page's vertical rhythm is uneven.** CONFIRMED.
  - Measured gaps: 65, 43, 31, 18, 12px. Title margins are 45.14/34.86.
  - Source: `stream.css:776-790`.
  - Fix: `space-y-4` from one scale.
- **MED. Source rows don't align their name column.** CONFIRMED.
  - Measured: name x 127.5 vs 115. "2160p ⚡" overflows the `min-width:104px` quality column. The zap is `#ffe57f` and an emoji.
  - Shot: `dt-sources-dark.png`.
  - Source: `stream.css:858-872`.
  - Fix: a fixed `w-28` column and a lucide `Zap` icon in `text-muted-foreground`.
- **MED. Hero meta uses spaces while cards use middots.** CONFIRMED.
  - Measured: "2024  118 min  Series" (spaces, `white-space: pre`) vs "2024 · 118 min" on cards.
  - Shots: `t-home-dark-1400.png`, `st-rows-dark-1400.png`.
  - Source: `stream.css:201-205`.
  - Fix: the same " · " separator.
- **LOW. The Back label uses a text arrow and misses the gutter.** CONFIRMED.
  - Measured: "← Back" is a text glyph, and the button sits at x=32 against the 28 gutter.
  - Fix: `ChevronLeft` icon and `-ml-2`.
- **LOW. Episode cards don't share the page's radii.** CONFIRMED.
  - Measured: item radius 10 vs poster 14 on the same page. The next-up ring is a 2px accent ring.
  - Fix: `rounded-xl`.
- **LOW. Light-theme hero glow haze.** CONFIRMED.
  - Measured: the ambient glow reads as a pink fog over white, and the header scrim is a white band.
  - Shots: `ac-home-light-3730ff.png`, `dt-series-light.png`.
  - Fix: gate the glow and scrim to dark, or use `mix-blend-mode: multiply` in light.

## Discover

- **MED. The first heading tucks under the open capsule.** CONFIRMED.
  - Measured: "By Genre" top at y=135, while the two-row capsule's bottom is at 142. `--header-h` (103) ignores the sub-row.
  - Shots: `t-discover-dark-1400.png`, `di-capsule-dark.png`.
  - Source: `discover.css:13`.
  - Fix: publish `--header-h` from the open capsule height.
- **MED. The search pill shows no focus state and its placeholder is cut.** CONFIRMED.
  - Measured: nothing changes on focus (no outline, no ring, same fill). The placeholder is clipped mid-word to "Search movies & serie". The CSS for `.disc-search` is dead.
  - Shots: `di-search-focus-dark.png`, `focus-search_input-dark.png`.
  - Source: `discover.css:26-66`.
  - Fix: `focus-within:ring-[3px] ring-ring/50`, and the placeholder "Search".
- **MED. The poster grid leaves a ragged right edge.** CONFIRMED.
  - Measured: the grid ends at x=1300 against the 1372 content edge at 1400px (72px). At 1920 it ends at 1624 against 1892 (268px).
  - Grid gap is 34/24, while row gaps elsewhere are 16.
  - Shot: `t-discover-dark-1920.png`.
  - Source: `discover.css:148-154`.
  - Fix: `repeat(auto-fill, minmax(260px,1fr))`, `gap-4`.
- **LOW. The empty search says "Results for".** CONFIRMED.
  - Measured: heading "Results for “zzzzqqq”" over "No results for “zzzzqqq”.", in 15px muted text.
  - Shot: `di-search-empty-dark.png`.
  - Fix: heading "Nothing for “…”", one line, an icon.
- **LOW. The recommender input and button don't match, and the copy is developer-facing.** CONFIRMED.
  - Measured: a 52px pill input beside a 36px square button, with the note "Add a TMDB key in the console with btvTmdb(...)". The sub-row label reads "REC".
  - Shot: `di-recommend-dark.png`.
  - Source: `discover.css:330-375`.

## Library

- **LOW. The save menu has nested-radius drift and a label that reads like an item.** CONFIRMED.
  - Measured: menu radius 8 with padding 4, items radius 6. "Save to" is 14/500 in foreground at the item inset.
  - Shot: `lib-menu-dark.png`.
  - Fix: `DropdownMenuLabel className="text-xs text-muted-foreground"`.
- **LOW. The new-list input is off-scale.** CONFIRMED.
  - Measured: radius 12 (off-scale), 14px/700 bold input text, centred placeholder.
  - Shot: `lib-newlist-dark.png`.
  - Source: `stream.css:1467-1473`.
  - Fix: `Input` with `rounded-md` and font-normal.
- **LOW. Saving gives no confirmation.** CONFIRMED.
  - Measured: no toast or live region appears after Add to Library.

## Settings

- **HIGH. The sheet overlaps the capsule and has no scrim.** CONFIRMED.
  - Measured: card top y=88 against capsule bottom 92, so 4px of the capsule are painted over at 1280, 1400 and 1920. The backdrop is transparent. The comment says "the card's own backdrop blur provides the separation", but the blur is gone.
  - Shots: `se-overlap-dark.png`, `t-settings-customize-dark-1280.png`.
  - Source: `settings.css:3-18`.
  - Fix: `pt-[calc(var(--header-h)+12px)]` plus `bg-black/40`, or shadcn `Dialog`'s overlay.
- **MED. The tab switcher is off-centre.** CONFIRMED.
  - Measured: centre 977.2 against the card centre 959, 18px off, because space-between puts a 72px title against a 36px close button.
  - Source: `settings.css:96-101`.
  - Fix: a 3-column grid `1fr auto 1fr`.
- **MED. The Live TV / Stream pill order flips between tabs.** CONFIRMED.
  - Measured: General reads "Live TV, Stream"; Customize → Media reads "Stream, Live TV".
  - Shot: `t-settings-customize-dark-1400.png`.
- **MED. Two row designs sit in one tab.** CONFIRMED.
  - "Show adult content" is a bordered card with a 16/400 title.
  - "Replay Onboarding" is a bare row with a 15/700 Title Case title.
  - Shot: `se-general-live-1-dark.png`.
  - Source: `settings.css:546-556`.
- **MED. Input heights differ.** CONFIRMED.
  - Measured: Xtream fields are 28px tall, the manifest field 36px. Labels carry `padding-left: 2px`, so they align with neither the input edge nor its text.
  - Shot: `se-general-live-0-light.png`.
  - Source: `settings.css:257-277`.
  - Fix: `h-9` and no label pad.
- **MED. Switches have three different right edges.** CONFIRMED.
  - Measured: 1204, 1306, 1327.
  - Fix: one trailing-control column.
- **MED. Catalog Row Size uses the native Chromium slider.** CONFIRMED.
  - Measured: `rgb(59,59,59)` track and `rgb(157,150,142)` warm-grey accent, with a ghost Button beside it showing "40".
  - Shot: `se-customize-a-1-dark.png`.
  - Fix: shadcn `Slider` and a `tabular-nums` value.
- **MED. On and off look almost the same on the detail chips.** CONFIRMED.
  - Measured: Card Details and Player Overlay chips are on = `oklch(0.269)` fill, off = transparent, same text. They're 36px tall next to 32px segmented controls.
  - Fix: shadcn `Toggle` with `data-[state=on]:bg-accent` and a check, `h-8`.
- **MED. Every action in a pane is a primary button.** CONFIRMED.
  - Measured: Add Playlist, Run Connection Test and Replay are all primary.
  - Fix: one primary per pane, the rest `variant="outline"`.
- **MED. Accent picker: the Default swatch's check is half-invisible, and the popover floats off its trigger.** CONFIRMED.
  - The check straddles the diagonal split, so half of it is black on black (`se-accent-row-dark.png`).
  - The selected ring and the focus ring are the same grey (`se-accent-focus-dark.png`).
  - The popover spans x 681 to 927 while its trigger "Custom" spans 927 to 1024, so it doesn't open under it.
  - The saturation area has radius 12 inside a radius-8 popover (`se-popover-dark.png`).
  - Source: `features/settings/AccentPicker.tsx`, `vendor.css`.
  - Fix: a check with a contrasting halo, `align="start"` on the trigger, and saturation radius 4.
- **LOW. Inactive segmented labels use opacity.** CONFIRMED.
  - Measured: opacity .5, which is 3.56:1 at 12px in light.
  - Source: `ui.css:30`.
  - Fix: `text-muted-foreground`.
- **LOW. The same control is 12px in Settings and 15px in onboarding.** CONFIRMED.
  - Source: `onboarding.css:373`.

## Onboarding

- **HIGH. Light theme breaks the forced-dark stage.** CONFIRMED.
  - Measured: the primary Continue is `oklch 0.205` on black, so it nearly vanishes. The segmented track goes white, and the inputs get bright 0.922 borders.
  - Shot: `ob-3-live-light.png`.
  - Fix: `data-theme="dark"` on `.onb` so shadcn parts read dark tokens.
- **LOW. Onboarding colours are hard-coded.** CONFIRMED.
  - Measured: subtitle `rgba(255,255,255,.62)`, error `rgba(255,150,150,.9)` at 13.5px, title 58.8px.
  - Source: `onboarding.css:232,298-301`.
  - Fix: `text-muted-foreground`, `text-destructive`.
- **LOW. The finale is stale and looks interactive.** CONFIRMED.
  - Measured: the map pills look like a toggle (solid white vs dark). The captions say "Home · Discover · My List" while the nav says Stream/Discover/Library. The tip still mentions themes.
  - Shot: `ob-6-finale-dark.png`.
  - Source: `app/Onboarding.tsx:805,811`, `onboarding.css:342-352`.

## Menus, tooltips, toasts

- **HIGH. The light-theme toast message is invisible.** CONFIRMED.
  - Measured: "Hid “…”" is `#fff` on a white toast. Only "Undo" shows.
  - Shot: `toast-light.png`.
  - Source: `live.css:1010`.
  - Fix: `text-foreground`.
- **MED. The folder menu item is centred over a left-aligned hint.** CONFIRMED.
  - Measured: the item text is centred (Button `justify-center`) above the left-aligned hint. Menu radius 8, padding 4, item radius 8.
  - Shot: `fm-dark.png`.
  - Source: `live.css:1062`.
  - Fix: `justify-start`, item `rounded-sm`.
- **LOW. The tooltip is custom and its class is misnamed.** CONFIRMED.
  - Measured: radius 10, shadow `inset 0 1px 0 white/.1, 0 8px 28px black/.45` (heavy in light). The class is `sports-tooltip` on every tooltip. The clipped guide names use native `title` tooltips instead.
  - Shots: `g-tooltip-dark.png`, `tip-gear-light.png`.
  - Source: `components/ui/tooltip.tsx:52`.
  - Fix: shadcn's stock inverted tooltip.
- **LOW. The toast has its own radius and type size.** CONFIRMED.
  - Measured: radius 12 (off-scale), 13.5px.
  - Source: `live.css:989,1009`.

## Empty, loading and error states

- **MED. Three error layouts, and the Guide's button is far from its message.** CONFIRMED.
  - Sports: icon, heading and body, no button (`state-sports-500-dark.png`).
  - Stream: heading, body and button (`state-home-dead-dark.png`).
  - Guide: one sentence, with "Try again" about 400px below it and the raw "Failed to fetch" shown twice (`state-guide-dead-dark.png`).
  - Sports uses a straight apostrophe ("Couldn't") where the others use a curly one.
  - Fix: one `Empty` pattern (icon, title, description, action).
- **LOW. The loading skeleton pulses; shadcn's shimmers.** CONFIRMED.
  - Measured: `.disc-skel` pulses opacity at 1.3s, radius 14, and matches the card. The generated `Skeleton` component is unused.
  - Shot: `state-discover-loading-dark.png`.

## Motion

- **MED. The motion tokens exist but most transitions ignore them.** CONFIRMED.
  - Measured: 54 distinct duration/easing pairs in CSS. Raw `ease` with 180/200/300/320/450ms. shadcn Button uses Tailwind's default `all 150ms cubic-bezier(0.4,0,0.2,1)` on 269 elements.
  - Fix: override `--default-transition-*` to 140ms and `--ease-out`, and use `transition-colors`, not `all`.
- **MED. Several thumbs and the capsule animate layout properties.** CONFIRMED from CSS; jank is SUSPECTED, not measured.
  - Chip-tabs thumb animates `left, width` (`ui.css:51`).
  - Nav pill animates `left, width`, labels `width`, capsule `margin-left, height, gap` (`base.css:619,666`).
  - Mode rail animates `width` (`live.css:101`).
  - Fix: `transform: translateX() scaleX()` on the same thumb. This keeps Adam's thumb constraint.
- **LOW. The switch track and thumb land at different times.** CONFIRMED.
  - Measured: track colour 220ms `ease`, thumb 260ms `--spring`.
  - Source: `ui.css:119,134`.

## Not covered from here

- The theater and player chrome (needs a Tauri IPC stub and real video).
- Real team and channel logos (ESPN's CDN was aborted, and the fixture posters are solid red).
- WebView2 text rendering and 1x-DPI hairlines.
- The glare sheen as it actually looks on hover.

## Distinct values in use (rendered, both themes)

- **Font sizes (31):**
  - Rendered: 8, 8.2, 10, 11, 11.5, 12, 12.5, 13, 13.5, 14, 15, 16, 17, 18, 18.46, 19, 19.46, 21, 21.3, 24, 26, 28, 31, 34, 37.44, 41, 42, 52, 58.8, 64.78, 84 (clamp at 1400).
  - Also in the CSS source: 14.5, 20, 22, and 9 `clamp()`s.
  - Per screen: the Guide screen alone shows 13 sizes.
- **Font weights (7):** 200, 300, 400, 500, 600, 650, 700.
- **Radii (24):** 2, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 22, 25, 30, 33, 42.6, 50%, 60, 63.9, 90, 100, 999, 1000, and 3.35e7 (`rounded-full`). The token scale is 6/8/10/14/999.
- **Shadows (15):**
  - `0 1px 2px /.05` (xs)
  - `0 1px 3px /.1 + 0 1px 2px -1px /.1` (sm)
  - `0 4px 6px -1px /.1 + 0 2px 4px -2px /.1` (float)
  - `0 10px 15px -3px /.1 + 0 4px 6px -4px /.1` (settings)
  - `inset 0 1px 0 white/.1 + 0 8px 28px /.45` (tooltip)
  - `0 -13px 72.6px /.73` (mv notice)
  - `0 14px 32px -12px /.45` (poster hover)
  - `0 17.04px 36.92px -14.2px /.55` (sports hover)
  - `0 0 6px accent` (live dot)
  - `0 0 10px red/.75` (game pip)
  - `0 0 0 2px accent` (episode, genre on)
  - `0 0 0 2px bg + 0 0 0 4px ring` (swatch)
  - `0 0 0 3px ring/50` (focus)
  - `0 2px 4px /.2` and `inset 0 0 0 1px /.05` (colour picker)
- **Durations (32):** 60, 100, 120, 140, 150, 160, 180, 200, 220, 240, 250, 260, 300, 320, 340, 380, 400, 450, 460, 650, 700, 830, 900, 1000ms, 1.3s, 1.4s, 1.6s, 2s, 2.4s, 2.8s, 9s, 90s.
- **Easings (15):** `ease`, `linear`, `ease-out`, `ease-in-out`, and cubic-beziers (0.4,0,0.2,1), (0.23,1,0.32,1), (0.77,0,0.175,1), (0.32,0.72,0,1), (0.34,1.2,0.42,1), (0.22,1,0.36,1), (0.45,0.05,0.2,1), (0.5,0,0.5,1), (0.55,0,0.55,0.2), (0.03,0.98,0.52,0.99), plus the `linear()` spring.
- **Greys:**
  - Token neutrals (9): oklch 0.145, 0.205, 0.269, 0.556, 0.708, 0.922, 0.97, 0.985, 1.
  - Off-token solids: `rgb(15,15,15)`, `rgb(37)` and `rgb(218)` (accent-surface), `#f2f2f4`, `rgb(12,14,20)`, `rgb(59,59,59)`, `rgb(157,150,142)`, `#ffffff10`.
  - Alpha variants of white: .045, .06, .07, .1, .14, .15, .18, .3, .5, .55, .6, .65, .7, .75, .8, .85.
  - Alpha variants of `#f2f2f4`: .55, .6, .65, .75, .8, .85.
  - Alpha variants of the light-theme sports ink: .07, .5, .55, .65, .72, .8.
  - Opacity-dimmed text: .3, .35, .4, .5, .75, .85.

The audit was read-only: no repo files touched, no git writes. I stopped my vite on 4302 and the fakes on 8081 and 8084, and closed all my browsers. Ports 4302 and 8081 to 8085 answer nothing. The vite servers on 4301 and 4199 belong to other auditors and are still running.

**DONE**. Nothing pushed, nothing to restart.

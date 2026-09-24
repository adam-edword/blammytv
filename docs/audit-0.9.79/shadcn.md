# BlammyTV shadcn / design-language audit (v0.9.79, `claude/nice-heisenberg-67k4uk`)

The app is not yet on shadcn where it makes sense. Button is the only primitive in wide use: 118 call sites across 25 files. Every other generated component has at most 3 consumers. Beyond the drift you'd expect, I found 5 confirmed breakages the harnesses can't see:

1. Every icon `size` prop inside a `<Button>` is dead, so the player's icons all render at 16px.
2. The pressed or armed state is gone from 6 controls, including the tournament draw filter.
3. Three icon-sized buttons hold text that overflows them.
4. A leftover `.accent-popover` rule sits on the new Popover, and I suspect it mispositions it.
5. In the light theme, the Live toast text is white on white and the Sports theater channel names are dark on dark.

Nothing was rendered. Every CONFIRMED is from reading the code and the cascade layer order (utilities outrank the `app` layer). Scratch data is in `/tmp/audit-shadcn/`: `buttons.txt`, `rows.json`, `css-*.tsv`, `deadcss.tsv`, `diffs.txt`, and upstream sources in `up/nyv4/`.

**Registry flavour:** all 14 components are shadcn's `new-york-v4` (Radix) style. I fetched the upstream registry and diffed each file. Upstream `new-york-v4/combobox` itself depends on `@base-ui/react`, so Base UI is not a second flavour. Radix-based recommendations are safe.

Format: `[SEV] C/S | claim | file:line | evidence | fix | effort` (C = CONFIRMED, S = SUSPECTED).

---

## Cross-cutting (several screens)

- **X1 [high] C** | Every icon `size={N}` inside a Button is overridden to 16px.
  - Evidence: the Button base class `[&_svg:not([class*='size-'])]:size-4` at `components/ui/button.tsx:7`. No icon carries a `size-*` class. No `.player__btn svg` sizing rule exists in `player.css`.
  - TheaterOverlay (these props are all dead): Play 26 (`TheaterOverlay.tsx:1745`), SkipBack/Fwd 24 (1726, 1754), NextEpisode 22 (1774), and size 20 at 1469, 1482, 1496, 1505, 1801, 1855, 1871, 1904, 1952. Also Play 18 (1403), Close 18 (1415), Check 14/15 (1833, 1886, 1918, 1934).
  - StreamScreen: Close 18 / 14 / 20 at 1452, 1615, 1650.
  - Recommender: 169 (14), 204 (20).
  - SaveButton: 138 (15), 156 (14).
  - AccentPicker: 135 (14).
  - SUSPECTED: flattening the play button to the same size as mute was not intended.
  - Fix: use `className="size-5/6"` or delete the props. Decide the player's icon scale once. S.

- **X2 [high] C** | v0.9.56 parked these state rules in `styles/old/` and nothing replaced them, so each state now looks like the resting state.
  - `.tourndraw__chip.is-on` (`old/buttons-blammytv.css:945`). `TournamentDraw.tsx:266` is `variant="outline"` plus `is-on`, and `sports.css:3368` only sets font-family. `grep "aria-pressed\]" styles/` is empty. **The draw filter shows no selected chip.**
  - `.player__btn.is-open` (old:536): menu-open state, `TheaterOverlay.tsx:1814,1855,1871,1904`.
  - `.track-menu__item.is-selected` (old:567).
  - `.playlist-row__delete--armed` colour (old:796). `settings.css:801` still promises "the danger voice".
  - `.leaguepick__x--armed` colour and border (old:901).
  - `.library__action--danger` / `--armed` (old:1250, 1294). `LibraryScreen.tsx:273,303` are now plain outline buttons with no red in any state.
  - Fix: pick the variant from state (`secondary`/`outline`, `destructive`), as meta-pick already does. S.

- **X3 [high] C, visual S** | Text inside `size="icon-sm"` (a 32×32 box with `whitespace-nowrap`):
  - `LeaguePicker.tsx:318-329`: the armed state reads "Remove from Favorites". `sports.css:2486` sets `inset:0` to cover the tile, but the `size-8` width/height utilities win, so the button stays a 32px box at top-left and the text overflows. Its `border-radius:14px` is dead as well.
  - `PlaylistsTab.tsx:247-282`: "Sure?".
  - `LibraryScreen.tsx:342-352`: "Remove", permanently.
  - Fix: `size={armed ? "sm" : "icon-sm"}`, or `h-auto w-auto` at the call site. S.

- **X4 [med] C** | verify-tailwind's OWNED set (`scripts/verify-tailwind.mjs:559-562`) lacks the `font` shorthand, `line-height` and `width`, so these dead rules pass:
  - `discover.css:321` `.rec__chip{font:500 14px/1}`
  - `discover.css:410` `.rec__again{font:600 13px/1}`
  - `player.css:88` `.tune__retry{font:600 14px/1}`
  - `player.css:645` `.track-menu__item{font:500 13px/1.2}`
  - Owned properties it should have caught but didn't:
    - `base.css:480` `.update-chip{transition}`: the entrance timing is dead against `transition-all`.
    - `live.css:73` `.live-collapse{border-radius}`
    - `live.css:231` `.live-folder{flex-shrink}`
    - `sports.css:2489`
  - The cause of the misses is S (multi-line values or grouping).
  - Fix: extend OWNED and debug the misses. S.

- **X5 [med] C** | Three tooltip systems.
  - `Hint` (Radix) is used at only 4 sites: `AppHeader.tsx:753`, `LiveScreen.tsx:844`, `SportsSidebar.tsx:209`, `SportsTheater.tsx:493`. `Hint.tsx:14` justifies itself on "92 aria-labelled controls".
  - Native `title=` covers 47 sites. On icon-only controls:
    - TheaterOverlay 1407, 1419, 1473, 1486, 1500, 1509, 1588, 1730, 1749, 1758, 1778, 1789, 1805, 1859, 1956
    - AccentPicker 113, 142, 195
    - AioStreamsTab 79, 88
    - CustomizeTab 449
    - PlaylistsTab 260
    - UpdatesSection 124
    - UpdateChip 69
    - LiveScreen 147, 237
    - LeaguePicker 248
    - Guide 650
  - Hand-rolled: `.live-tip`.
  - Fix: use `Hint`. The player chrome is your call. M.

- **X6 [med] C** | The z-index scale is not tokenized.
  - `tooltip.tsx:48` is z-50 and DropdownMenu is z-50 (upstream). Popover and Combobox are z-70. `.modal-backdrop` is 60 (`settings.css:10`).
  - The next Hint or DropdownMenu placed inside Settings will open behind the sheet. That is the third occurrence of the bug fixed in v0.9.68 and v0.9.79.
  - The `combobox.tsx:118` claim "Nothing in the app sits above it" is false: `live.css:797` is 200, boot and onboarding are 1000.
  - Fix: z tokens in `tokens.css`. S.

- **X7 [med] C** | Retry buttons come in 4 looks.
  - default/default: Discover 502, 535, 621; Live 958, 976; Stream 1470, 1818, 2796, 2980; SportsEmpty 58.
  - outline/sm "Retry" (`TheaterOverlay.tsx:2044`); outline/sm "Try next available source" (2052); secondary "Try again" (`UpdatesSection.tsx:145`).
  - Inline ones put a filled h-9 primary inside a `<p>` sentence (StreamScreen 1470, 2796, 2980; Discover 535, 621), although `stream.css:831` says "quiet".
  - Fix: `link`/`sm` inline, `default` standalone. S.

- **X8 [med] C** | Back buttons come in 5 looks.
  - ghost + `rounded-full hover:bg-black/60` + "← Back" glyph: LibraryScreen 251, StreamScreen 2747 and 2947, SportsTheater 519.
  - outline sm + BackArrowIcon: `TournamentDraw.tsx:164`. It is icon-only at size `sm`, not `icon-sm`.
  - ghost sm "&larr; Back": `Onboarding.tsx:858`.
  - ghost icon + BackArrowIcon: `TheaterOverlay.tsx:1469`.
  - Fix: one BackButton. S.

- **X9 [med] C** | Plan 014's documented `.vod-back` exception no longer holds.
  - The plan (plan 014:313-316) says "ghost plus the app's glass". `stream.css:760-767` now says "a plain ghost now, like every other back button".
  - All 4 call sites still add `rounded-full hover:bg-black/60`. Two are not over imagery, which breaks ROADMAP decision 1's own "scrim over imagery only" rule: `LibraryScreen.tsx:254` (in flow, `stream.css:1353` is `position:static`) and `SportsTheater.tsx:529` (the side column).
  - Fix: an `overlay` Button variant for the art cases and plain ghost elsewhere. Update plan 014. S.

- **X10 [med] C** | The arm-then-confirm pattern has 4 looks and 3 wordings.
  - destructive + ring, "Click again to confirm": `GeneralTab.tsx:104`
  - outline sm, same words: `LibraryScreen.tsx:273,303`
  - ghost icon-sm "Sure?": `PlaylistsTab.tsx:247`
  - icon-sm "Remove from Favorites": `LeaguePicker.tsx:318`
  - Fix: one ConfirmButton, or `shadcn add alert-dialog`. M.

- **X11 [med] C** | Pressed/selected chip styling comes in 5 looks.
  - secondary/ghost + `hover:bg-muted`: CustomizeTab 347, 387; StreamScreen 2999.
  - outline + a dead `is-on`: TournamentDraw 266.
  - `.sports__toggle.is-on` with an accent 18% tint (`sports.css:87`).
  - AccentPicker `ring-2 ring-ring ring-offset-2` (52).
  - Multiview `is-on` (known).
  - The selected league tile is accent-tinted (`sports.css:2272`) while selected rows in the same panel use `bg-sidebar-accent`. `sports.css:2270`'s claim that they speak "the same language" is stale.
  - Fix: `shadcn add toggle toggle-group`. M.

- **X12 [med] C** | 7 text-input treatments. Only `AccentPicker.tsx:209` uses `<Input>`.
  - `.settings-input` hand-copies Input (`settings.css:277`). Two drifts:
    - Its later `:focus` rule (365) recolours the border to text/30 after the ring rule (307).
    - It applies `input/30` in the light theme too.
    - Used by: AioStreamsTab 63, PlaylistsTab 454 and 547 (renders up to 4), LeaguePicker 148.
    - Two searches shrink it to 13px, 7px 12px: `settings.css:691`, `sports.css:2334`.
  - `.onb-input` ×7: documented.
  - `.rec__input`: a 52px pill.
  - Accent-bordered fields with an rgba fill: `.list-picker__input` (`stream.css:629`), `.rowcap__value--edit` (`settings.css:844`), `.library__new-input` / `__heading-input` (`stream.css:1467`, 12px radius, 700 weight).
  - Fix: Input, with an h-8 size for dense contexts. M.

- **X13 [med] C** | 3 quality-badge implementations.
  - `QualityBadge` (`Guide.tsx:545`, `ui.css:258-330`)
  - `.sportsrail__badge` (`SportsTheater.tsx:684`, `sports.css:2084`)
  - `.vod-source__quality`: 21px plus a ⚡ emoji in `#ffe57f` (StreamScreen 1493 and 2817, `stream.css:858,872`)
  - Fix: one component. S.

- **X14 [med] C** | Hand-rolled pills that should be Badge (generated, 0 consumers):
  - `.live-conns` (LiveScreen 141, `live.css:184`)
  - `.hero__live` (Hero 70, `live.css:812`: 17px, radius-card)
  - `.hero__number` (`live.css:855`)
  - `.chip-beta` (AppHeader 628, 8px)
  - `.leaguepick__clearcount` (LeaguePicker 204)
  - LIVE is drawn 3 ways: `.hero__live`, the Button at `TheaterOverlay.tsx:1785`, and `.gamepip`.
  - S each.

- **X15 [med] C** | Error and empty states come in 9 looks (`shadcn add empty alert`):
  - `SportsEmpty.tsx:45`
  - `.live-status`: `text-muted` plus `opacity:.6` (`live.css:1086`)
  - `.guide-empty` (opacity .6)
  - `.stream__note` (StreamScreen 1795-1826)
  - `.discover__note` (also in LibraryScreen 314)
  - `.discover--empty h2` at 28px
  - `.vod-sources__note` in `rgba(242,242,244,.6)`
  - `.rec__note--bad`
  - `.live-group__error`, `.playlist-row__status--error`
  - M.

- **X16 [low] C** | Text glyphs used as icons, next to real icons that exist:
  - "← Back" (LibraryScreen 256; StreamScreen 2753, 2953; SportsTheater 531; Onboarding 862) vs `BackArrowIcon`
  - "Sources ›" (StreamScreen 2574) vs `ChevronIcon`
  - "+" (SaveButton 147 and 226; LibraryScreen 434)
  - "✓/✗" (AioStreamsTab 131), "You're up to date ✓" (UpdatesSection 155)
  - "★" (StreamScreen 2327, 2766), "⚡" (1494, 2818)
  - S.

- **X17 [low] C** | Two icon families on screen. components/ui draws lucide (`combobox.tsx:6`, `dropdown-menu.tsx:3`), and the app draws coolicons/Fluent (`ui/icons.tsx`, 49 icons). The DropdownMenu tick and the player track-menu tick are different glyphs. Fix: pick one family. M.

- **X18 [low] C** | Copy inconsistencies.
  - Title Case: "Watch Now", "More Info", "Bring It Back", "Add Playlist", "Run Connection Test". Sentence case for the same kind of action: "Play now" (StreamScreen 1551 and 1596 vs "Watch Now" at 2337), "Try again", "Clear history".
  - US "Favorites" (LiveScreen 68, Guide 556, TheaterOverlay 1485, and the visible `LeaguePicker.tsx:328`) vs UK "favourites" (LeaguePicker 175, 181, 247, 268, 323). The armed button says "Favorites" while its aria-label says "favourites".
  - S.

- **X19 [low] C** | Muting done with opacity instead of tokens:
  - `.playlist-row__source` .3 (`settings.css:788`), `.source-row__type` .35 (722)
  - `.chip-tabs__tab` .5 (`ui.css:31`)
  - `.header__clock` .3 and `.header__version` .35 on top of `text-muted` (`base.css:355-370`)
  - `.live-status` / `.guide-empty` .6
  - `.rec__note` at 62% (`discover.css:364`)
  - S.

- **X20 [low] C** | `#f2f2f4` / `rgba(242,242,244,…)` is the pre-v0.9.57 `--text`, still hard-coded 17 times:
  - `stream.css`: 171, 194, 203, 473, 503, 686, 789, 790, 837, 881, 983, 989, 1062, 1279
  - `discover.css:138`, `player.css:109`, `ui.css:399`
  - The Stream hero mixes it with the new value: `.shero__title` uses `oklch(.985)` (`stream.css:189`) while `.shero__text` uses `#f2f2f4` (171).
  - Fix: an `--on-image` token. S.

- **X21 [low] C** | Literal glass survives `tokens.css`'s "NO LONGER GLASS" (`--float-blur:none`):
  - `tooltip.tsx:54-55`
  - `settings.css:440`
  - `live.css:1158`
  - `player.css:595` and 802
  - `stream.css:1023` and 1177
  - `discover.css:348`
  - `player.css:877` (multiview)
  - Over mpv these blur nothing (plan 014:233). S.

- **X22 [low] C** | Motion literals: 168 transition/animation declarations, 33 use `--dur-*`. Common literals: 150ms ×12, 200ms ×11, 180ms ×10 (not a token), 220/160/300ms. S.

- **X23 [low] C** | Off-token radii (the scale is 8 / 10 / 14 / pill):
  - 12px: `live.css:740`, 989; `player.css:165`, 243, 592; `stream.css:1473`; `discover.css:291`; `vendor.css:31`
  - 14px literal: `discover.css:402`, `settings.css:704`, `sports.css:2489`
  - 10px literal: `live.css:301`, 858; `player.css:1039`, 1221; plus `rounded-[10px]` at `tooltip.tsx:53`
  - 8px: `settings.css:847`, `stream.css:632`, `sports.css:1681`
  - 6px: `stream.css:403`, `player.css:1069`
  - 4px: `base.css:391`, `live.css:933`
  - 2 to 3px: `live.css:706`; `player.css:452`, 469; `stream.css:442`, 449; `sports.css:3698`
  - 100px or 1000px instead of `--radius-pill`: `live.css:188`; `sports.css:267`, 1862, 2086, 2115, 2126
  - Others: 22/9/13/11px (multiview), `sports.css:2006` (18px), `stream.css:72` (90px), `settings.css:339` (`0 24px 24px 0`)
  - Glare radii 25px (StreamScreen 2418, LibraryScreen 478), 30px (2865) and 60px (2297) sit on cards whose corner is 14px (`stream.css:122,290,556`)
  - S.

- **X24 [low] C** | Off-scale font sizes in chrome (Tailwind scale is 12/14/16/18/20/24):
  - base: 358 (11), 367 (26), 393 (8), 773 (13), 915 (15, nav)
  - ui: 268 (8.2, documented)
  - settings: 415, 484, 494, 531 (dead); 557 and 617 (15); 588 (11); 695 (13); 722 (11); 778 and 837 (15); 895 (12.5); 904 (13.5)
  - live: 190 (10), 245, 304, 442 (13); 521, 649, 676 (15); 687 (10); 822 (17); 847 (21); 861 (15); 886 (41); 1009 (13.5); 1070 (11.5)
  - player: 638 and 687 (11), 645 (13), 808 (13), 141 and 145 (13/10)
  - stream: 192, 330, 988, 1060, 1278 (15); 472, 637, 879, 1504 (13); 625 (11.5); 785 (31); 828, 865, 1228 (21); 1054 (11); 1440 (34)
  - discover: 131 (19), 183 (15), 202 (28), 350 (15), 366 and 410 (13)
  - sports chrome: `.sports__toggle--pill` 11 (100), `.sportsrail__badge` 10, `.leaguetile__name` 12/700, `.leaguepick__search` 13
  - Editorial hero, score and boot sizes are left alone. S.

- **X25 [low] C** | Off-grid spacing: 121 declarations, full list in `/tmp/audit-shadcn/css-spacing-off.tsv`. In chrome:
  - base: 225, 389, 593, 641, 663
  - ui: 27 (6px 15px)
  - settings: 182 (18), 235 (11), 338, 587, 609 (18/22/22), 694, 703, 765 (11/20), 794 (19)
  - live: 86, 187, 496, 543, 721 (25), 724, 816, 1154
  - stream: 213 (26), 238, 1173, 1267, 1347, 1378
  - discover: 69 (34), 152 (34), 245, 260
  - sports chrome: 46, 123, 1740, 1749, 2184, 2336, 3265, 3310, 3366, 3373, 3802

## app/

- **A1 [low] C** | `.header__action::after` mask rim (`base.css:431-446`) has no background or padding, so it paints nothing. Its comment (415-423) describes a circle, but the button is a square ghost. Delete. S.
- **A2 [low] C** | `.update-chip__dot` uses a hex conic (`base.css:498`) instead of `--rainbow-stroke`. Its entrance transition is dead (see X4).

## features/settings

- **S1 [high] C, visual S** | The legacy `.accent-popover` rule (`settings.css:430-455`, from the parked Themes modal) rides on Radix `PopoverContent` (`AccentPicker.tsx:186`).
  - Still applied: `position:absolute; top:calc(100% + 10px); right:0`, `display:flex` column with gap, `background:var(--card-glass)` (a gradient image over `bg-popover`), `blur(10px)`, and a 150ms transform plus `@starting-style` scale that doubles tw-animate's zoom.
  - Dead: z-index, padding, radius, shadow.
  - S: the absolute content collapses Radix's `max-content` wrapper to 0×0. The popover would then open left of the trigger, not start-aligned, and collision handling would measure an empty box. `verify-accent.mjs:79-87` only hit-tests the centre, so it passes either way.
  - Fix: drop the class, keeping a scope hook for `vendor.css`, and delete 429-455 and 983-995. S.
- **S2 [med] C** | Dead CSS with zero references in src (from `deadcss.tsv`):
  - `settings.css`: 370-427, 466-510, 519-543, 910-950, 966-977, 1002
  - `ui.css`: 59-93 (`.chip-tabs--bare`, no caller), 375-380, 426
  - `onboarding.css`: 387-415, 465
  - `discover.css`: 16, 26-66
  - `sports.css:1575`
  - About 220 lines. S.
- **S3 [med] C** | `AioStreamsTab.tsx:59-94` is InputGroup built by hand: raw label, raw input, and absolute tools with a gradient scrim (`settings.css:320-362`). Fix: InputGroup + InputGroupAddon inline-end + InputGroupButton icon-xs. S.
- **S4 [low] C** | `AccentPicker.tsx:200-205` positions a "#" prefix by hand. Use InputGroupText. S.
- **S5 [med] C** | AccentPicker swatches (107-156) fight the outline variant with inline `style`, per the comment at 143-147. It is single-select built from `aria-pressed`. Also `conic-gradient(#f43f5e,#f59e0b,…)` (180) duplicates `--rainbow-stroke`, and 187 falls back to the old `#c22727`. Fix: ToggleGroup single or RadioGroup. M.
- **S6 [med] C** | `PlaylistsTab.tsx:376` "Unhide" is a raw button with class `btn-quiet`, which has 0 rules anywhere, so it renders as bare text. Fix: `<Button variant="ghost" size="sm">`. S.
- **S7 [low] C** | `Field` (`PlaylistsTab.tsx:533-560`) and AioStreams use raw `<label>` plus raw input. `shadcn add label` (or `field`). S.
- **S8 [low] C** | `CustomizeTab.tsx:414` is a native range drawn by the OS with `accent-color` (`settings.css:832`). 425 is an accent-bordered number field. `shadcn add slider` plus Input. S.
- **S9 [low] C** | `.playlist-row` (`settings.css:757`), `.source-row` (703) and `.source-list` are Item built by hand. M.
- **S10 [low] C** | Stale comments:
  - `settings.css:561-577` still describes a Popover+Command combobox with a Button trigger.
  - `settings.css:1-20` still describes a glass card with no dim, but the card is solid.
  - `CustomizeTab.tsx:115-116` says the theme control "lives in the Themes panel".
- **S11 [med] C** | `:root[data-frost="0"] .settings{background:var(--bg)}` (`settings.css:92`) still switches the now-solid card from `--surface` to `--bg` depending on mpv's capability. Delete it. S.
- **S12 [med] C** | There is no light/dark control. A stored light theme is applied at boot (`main.tsx:42`) and the accent copy says "Default follows light and dark", but the toggle left with the Themes panel. Reset forces dark (`CustomizeTab.tsx:225`). Legacy light users are stuck with L1 and SP2. Product call.
- **S14 [low] C** | `ChipTabs` as the Settings tab switcher (`SettingsModal.tsx:89`) exposes `aria-pressed` rather than tablist/tab. ModeRail does implement tablist (`ModeRail.tsx:47-60`). ChipTabs' `className`, `thumbKey` and `trailing` props have no callers.

## features/live

- **L1 [high] C, light theme** | `.live-toast__msg{color:#fff}` (`live.css:1010`) sits on `--float-bg`, which is white in light (`tokens.css:306`). The text is invisible. The toast itself is hand-rolled (`LiveScreen.tsx:928-941`, `live.css:980-1030`, 12px radius, 13.5px). Fix: `text-popover-foreground` now, `shadcn add sonner` later. S/M.
- **L2 [med] C** | The folder context menu is hand-rolled: listeners at `LiveScreen.tsx:265-300`, the portal at 897-923, and `live.css:1031-1075`.
  - Its row is a ghost sm Button (h-8, rounded-md, px-3), not DropdownMenuItem geometry, despite the comment at `live.css:1038`. The same comment's "the last hand-rolled menu" is false.
  - Fix: `shadcn add context-menu`. M.
  - S: check Radix positioning under the root `style.zoom`.
- **L3 [med] C** | `.live-tip` (`LiveScreen.tsx:208-221,889`; `live.css:295-320`) sits beside a Hint (844) and native titles (175) in the same panel. Fix: `Hint side="right"`. S.
- **L4 [med] C, light theme** | `.live-conns` background `#00000050` (`live.css:189`). Use Badge. S.
- **L5 [low] C** | Hero progress `.hero__bar` (`live.css:926`) and continue-card progress (`stream.css:442`) should be one Progress. `.hero__live` / `.hero__number` are covered in X14.
- **L7 [med] S (player-chrome exception?)** | Track menus (`TheaterOverlay.tsx:1829-1950`) are `role="menu"` with no arrow-key handling (none in the file). Their glass is a no-op over mpv. Fix: DropdownMenu + RadioGroup, or drop `role=menu`. M.
- **L8 [low] C** | `player__btn--glass` has no rules; only the stale comment at `player.css:173-176` mentions it. It is still on 7 Buttons: TheaterOverlay 1469, 1482, 1496, 1505; StreamScreen 1452, 1615, 1650. `is-open`, `is-selected` and `is-fav` also have 0 rules. Dead hooks.

## features/stream

- **ST1 [med] C** | `StreamScreen.tsx:1380` "Cancel", the only exit from a resolve that can take 30 seconds, is `btn-quiet` and renders unstyled. Keep the `.tune__vodcancel` hook: `verify-resolve-cancel.mjs` uses it. S.
- **ST2 [med] C** | `vod-panel` is a hand-rolled Sheet (1427-1510; `stream.css:1155-1240`). It portals into the player chrome host, so converting it is a judgement call. M.
- **ST3 [low] C, legibility S** | The RowScroller arrows (2085-2104) are square ghost buttons. `stream.css:257` still says "glass circles".
- **ST4 [low] C** | The episode Item (3036-3083) overrides `outline`/`sm` with a card look. That belongs in a new Item variant. `.episode-card--next` uses a 2px accent shadow while other selected states use ring utilities.
- **ST5 [low] C** | SaveButton:
  - `.list-picker__count` at 11.5px should be `DropdownMenuShortcut`.
  - `.list-picker__input` has an accent border (see X12).
  - "+" is a text glyph.
- **ST6 [low] C** | The hero meta uses 3 spaces as a separator (2323) where the rest of the app uses " · ". The rating is `#ffd166` (`stream.css:206`) while the cached mark is `#ffe57f`.
- **ST7 [low] C** | `.shero__card` (2251) and `.continue-card` (2505) are `div role=button` with Buttons nested inside. The continue-card case is documented.

## features/discover

- **D1 [med] C** | The Recommender tag input is hand-built: a chips row (166-180), a 52px pill input (184) and an h-9 36px go button (204). The heights mismatch. HeroSourcesSection uses Combobox chips for the same pattern. Fix: ComboboxChips or InputGroup. M.
- **D2 [low] C** | `.rec__card img` has a 14px literal radius and a raw shadow (`discover.css:402-403`). `.rec__wallcard` is 12px. `.rec__note--bad` carries a `#ff6b6b` fallback.
- **D3 [low] C** | `.disc-skel` pulses opacity (`discover.css:157-180`). `.sports-skel` pulses colour (`sports.css:1654-1726`), and its comment says opacity is wrong. Skeleton is generated and unused. S.

## features/sports

- **SP1 [med] C** | `.sports__toggle` is a hand-built toggle: SportsScreen 827 and 869, SportsSidebar 278 and 295, `sports.css:66-102`. Plan 014:318-323 already names shadcn Toggle for it. `--pill` is 11px and still `rounded-md`. Hover uses the card-ink tokens on chrome. S.
- **SP2 [med] C, light theme** | `--sportsrail-bg:#131316` (`sports.css:1869`, also 2134) is unthemed, while text is `rgb(var(--card-ink))`, which flips to 12,14,20 in light (444). The result is near-black names on near-black rows in the Sports theater rail. The comments at 440-442 cite old page colours. S.
- **SP3 [low] C** | `<hr class="leaguepick__rule">` (LeaguePicker 209, `sports.css:2340`) should be Separator. S.
- **SP5 [low] C** | Confidence colours `#34d17e`, `#e8b84b` and `#e05c5c` (`sports.css:2149-2157`) are raw hex, although `--ok` and `--danger` exist. S.
- **SP7 [low] C** | `features/sports/Badge.tsx` exports `Badge`, which is a team-logo `<img>` and collides with shadcn's name. Rename it to `TeamMark`. S.
- **SP8 [low] C (new detail on known multiview)** | `var(--accent,#6c8cff)` ×3 (`player.css:1050,1191,1246`), `#e0ab2b` (894), and radii 22/13/11/9px.

## components/ui drift

- **U1 [med] C** | The documented tooltip edit (`tooltip.tsx:44-68`) rests on reasons that no longer hold.
  - It says "floats are the dark glass recipe", but `tokens.css` now says the opposite.
  - The arrow was removed because it "cannot work against a translucent surface", but `bg-popover` is opaque now.
  - It is now the app's only glass surface, with its own radius (`rounded-[10px]`), its own rgba shadow, and a `sports-tooltip` class that has 0 rules.
  - Fix: match Popover (`rounded-md border shadow-md`) and consider the arrow. S.
- **U2 [low] C** | `components/README.md` is stale.
  - It says `cn` comes from `@/lib/utils`, which does not exist; all 14 files import the `cn` package.
  - It lists 5 components.
  - `components.json` `aliases.utils` points at the missing file.
  - `clsx` and `tailwind-merge` are dependencies with 0 imports in src.
- **U3 [low] C** | `index.css:21-23` and the README say components "land in `@layer components`". They are utilities, and nothing is in that layer.
- **U4 [low] C** | `theme.css:58` `--color-accent: var(--accent)` is silently overridden at 156. The comment at 54-57 is false.
- **U5 [info] C** | Drift that is not documented is only the `"use client"` line dropped in `dialog.tsx` and `dropdown-menu.tsx` (harmless). Everything else is the forwardRef edits, z-70 and the tooltip, all documented.

---

## Legit exceptions (reason still holds)

- Nav capsule (`AppHeader.tsx:594-724`): Adam's Figma, "minus the nav bar".
- Guide cells and cards (`Guide.tsx:529,580,603`): virtualized. The resize separator (641) too.
- Player seek and volume rails (`TheaterOverlay.tsx:1588,1664,1965`): over mpv.
- Content cards as raw buttons (the art is the surface, per v0.9.56): stream-card, vod-more, library__card, vod-source, Game/Compact/Upcoming/Tournament cards, sportsrail, rec__card, genre-card, leaguetile.
- `RowScroller` (roving tab stop and drag; plan L2) and the Stream hero carousel.
- ChipTabs, Toggle and ModeRail thumbs: "take the surface, keep the thumb".
- `sidebarItem.ts` in place of `<Sidebar>`.
- `.library__new` empty slot.
- Onboarding and boot (exempt, `onboarding.css:279`).
- The global scrollbar skin (`base.css:31-68`).
- Score-card type, spacing and colour, and the card palette in `sports.css`.
- WeekendCard and GolfCard as divs.
- QualityBadge gradients ("hardware markings", `ui.css:257`).

## Counts

**Hand-written, by folder (raw JSX sites):**

| Folder | Hand-written |
|---|---|
| app | 4 buttons (nav, exempt); 8 inputs (1 nav, 7 onboarding, documented) |
| discover | 2 buttons (cards); 1 input |
| live | 8 buttons (3 guide, 5 multiview); 1 range; 4 `role=menu`; 1 dialog (known); 1 separator; 1 tooltip; 1 toast |
| settings | 1 button; 5 input sites (render up to 8); 2 `<label>`; 1 dialog (known) |
| sports | 12 buttons (6 cards, 4 toggles, 2 multiview); 2 inputs; 1 `<hr>` |
| stream | 9 buttons (7 cards/inner, 1 unstyled, 1 continue text); 2 `div role=button`; 1 sheet; 1 progress |
| ui | ChipTabs (11 call sites), Toggle (7), NameField (3), ModeRail (2) |

- **Totals:** 38 `<button>`, 18 `<input>`, 2 `<label>`, 1 `<hr>`, 4 menus, 2 dialogs, 47 native `title` tooltips.
- **Not legit** (excluding known multiview and planned ChipTabs/Toggle): 6 buttons (2 unstyled `btn-quiet`, 4 `sports__toggle`) and 7 input sites.

**shadcn consumers:**

| Component | Consumers |
|---|---|
| Button | 25 files, 118 sites (live 33, stream 28, settings 24, sports 14, onboarding 10, discover 6, other 3) |
| Button variant/size mix | ghost/icon 26, default 27 (incl. 6 lg, 2 sm), outline sm 11, ghost 9 each for default, sm and icon-sm |
| Tooltip | via Hint, 4 sites |
| Combobox | 3 |
| Input, Popover, DropdownMenu, Item | 1 each |
| InputGroup | 0 direct |
| Card, Dialog, Badge, Separator, Textarea, Skeleton | 0 |

## Biggest wins (lines deleted, rough)

1. **Dead Themes-era CSS plus the `.accent-popover` leftovers:** about 250 lines (S1, S2).
2. **Skeleton + Empty/Alert:** `disc-skel`, `sports-skel`, `live-status`, `guide-empty`, `stream__note`, `discover--empty`, about 180 CSS lines.
3. **Sonner + ContextMenu on Live:** about 100 CSS lines plus about 60 lines of listener and focus JS.
4. **Input + InputGroup + Label:** `settings-input` and field tools (`settings.css:257-366`) plus 4 accent-bordered edit fields, about 150 lines.
5. **Toggle/ToggleGroup:** `sports__toggle` plus the chip overrides, about 70 lines. It also fixes X2's draw chips and the armed states.

**DONE_WITH_CONCERNS.** Nothing was rendered: the visual consequences of X1, X3, S1, L1 and SP2 need a look in the app.

What to look for:
- Sports → open a tournament → the draw filter chips: none should look selected. That is X2.
- Settings → Customize → Accent → Custom: see whether the popover opens start-aligned under the chip or to its left. That is S1.
- The live theater bar: play, skip and mute icons should all be the same 16px. That is X1.
- Sports sidebar → a favourite tile's ✕ → click once: the "Remove from Favorites" text should overflow a small box. That is X3.
- The light-theme findings (L1, L4, SP2) only reach users with a stored light theme, and none can switch out except through Reset (S12).

Read-only audit: nothing committed, nothing to restart.

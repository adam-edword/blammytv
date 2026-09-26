# 019: Multi-view's look, on every tab

**Status: BUILT on `claude/multiview`, v0.10.1 to v0.10.11 (2026-09-26),
not yet merged.** Eight mockups (frames A to H) were sent in the chat, not
the repo. Adam, the same day: its own track, yes to D2 to D7, and the
source list revised (frame D, sent again): every line the addon sends, the
column to the bottom of the window, and grouped by Cached and Not cached
for any setup, not only his. See "Sources" below.

What shipped where: K1 v0.10.1, K2 v0.10.2, K3 v0.10.3, K4 to K6 v0.10.4,
K7 v0.10.5, K8 v0.10.6, K9 and K10 (and the sources) v0.10.7, K12 and K13
v0.10.8, K11 v0.10.9, the screens' own changes v0.10.10, and what the
full board found in those two v0.10.11. verify-kit measures every one of
them.

Left for later, each with its reason in the commit that skipped it:
- **Settings onto Dialog** (frame G, 016 3.3). Its comboboxes are Base UI,
  whose popups portal outside the sheet; under a Radix modal an option
  click would count as outside and close Settings. Needs a pass with
  someone clicking through Settings. (v0.10.10)
- **An episode's hover eyebrow and Sources chip** (frame E). Picking an
  episode already opens its sources, so the chip would be a second button
  for the same thing; the hover shows the scrim and the play cue.
  (v0.10.5)
- **Sports cards' LIVE pill and a "Couldn't link" chip** (frame F). The
  frame also says the cards are unchanged; only their live dot moved to
  the accent (D5). (v0.10.4)
- **The Sports theater's rail note** stays in the card's ink rather than
  the StateCard, as the other small in-place notes do. (v0.10.6)

*Origin: Adam, 2026-09-26: "take what was created in multiview, look at its
design language and components and apply it to the other tabs in the app."*

*Source: four read-only audits of v0.9.130 on 2026-09-26 (the Guide;
Sports; Stream and Library; Discover, Settings, the shell and the token
system), each claim checked against the code by the main session before it
went in here. Screenshots of every tab against the fake servers. The
mockups were drawn inside the running app: its real header, capsule,
tokens and Geist, and multi-view's own CSS classes used as they are. Only
the page under the header is replaced. The pictures are stand-ins (drawn
SVG scenes, not video or real art).*

---

## Where this sits

**Its own track** (Adam, 2026-09-26: "plan 18 is already done and pushing
live, so i think this is its own track"). Plan 014 says "a subtle layer of
liquid glass" on shadcn, and v0.9.54's takeover said "we can build up the
branding after" (`apps/app/src/styles/old/README.md`). Multi-view is the
first screen built after that. It is shadcn underneath (Dialog, Tooltip
through Hint) with the capsule's glass, round ends and a picture-first
manner on top, and Adam has used it for hours. This track takes that to
every tab.

It overlaps ROADMAP's M2 (the primitives) and M3 (every screen, the glass,
then 0.10.0), whose work list is plan 016's Tracks 3 and 4. So that
nothing is converted twice: **when this track builds a primitive or
reaches a screen, it does the 016 items that primitive or screen carries**,
and those items are done here, not again in M2 or M3. Each step below
names the 016 items it takes. 014's rule stands: ground up, by primitive,
never screen by screen (Adam, 2026-09-07).

---

## Multi-view's language

Line numbers are `apps/app/src/styles/player.css` unless named.

1. **Controls are the capsule's glass, round-ended.**
   `color-mix(in srgb, var(--text) 10%, transparent)` with
   `blur(5px) saturate(1.4)`: the segmented control (1093), the icon
   button (1228), the meter (1250). The same two lines are the capsule
   itself (`base.css:606-607`).
2. **One bright thing.** The white pill (`.mvbar__add`, 1287): `--text`
   fill, `--bg` ink, 40px, weight 650. At its limit it goes quiet, not
   away (1302).
3. **Chips on pictures.** `.mvchip` (1657): 30px, dark glass, a 14% white
   hairline.
4. **The picture is the content.** 16:9 at a 10px radius, `#111` until the
   first frame, the name **under** it (`.mvcap`, 2037), nothing on it at
   rest. A scrim, the information and the actions come with the pointer
   or keyboard focus (1570-1595).
5. **The accent is a signal.** It marks the sound (the ring and badge,
   1421-1429, 1519) and live (the dot, 1761). Selection is a text tint,
   16% on and 9% highlighted, not the accent.
6. **Muted by colour, never by opacity** (1922-1938, plan 018 U10).
7. **Nothing is just black.** An icon, what happened, a way on
   (`.mvtile__state`, 1457-1490).
8. **Eyebrows.** 11px, 650, 0.06em, uppercase, muted (`.mvpick__sec`,
   1901; `.mvtile__chan`, 1701). Numbers are tabular.
9. **Quiet at rest.** The bar dims to 0.35 after two idle seconds and
   stays clickable (1052-1065).
10. **Keyboard-complete, and it says so:** `<kbd>` hints (1852).
11. **Focus is its own ring,** outside everything else (1431-1440).
12. **Motion:** 140ms in, 200ms out, 260ms for layout, from 0.96 or 0.98
    and never from 0, and nothing done from the keyboard animates (017,
    "Motion").

Most of its values already have tokens: `--radius` (10px), `--radius-pill`,
`--dur-hover` (140ms), `--dur-enter` (200ms), `--dur-panel` (260ms),
`--ease-out` (`tokens.css:205-239`). Multi-view types the numbers instead.
The glass recipe and the two tints have no token at all, and the recipe is
copied by hand in five places (`base.css:606`, `player.css:1099, 1144,
1235, 1257`).

---

## What is there now

| Job | Today | Multi-view's |
| --- | --- | --- |
| **Segmented** | Four drawings. ChipTabs: a flat track, the inactive tab dimmed by opacity (`ui.css:6-54`). ModeRail: its track is the sidebar's own colour, so it can't be seen (`live.css:79-114`). `.sports__toggle`: bordered, `rounded-md`, on purpose ("a pill is for a badge, and this is a control", `sports.css:61-65`). The season bar: separate Buttons (`StreamScreen.tsx:3033`). | `.mvseg` |
| **Buttons** | shadcn Button everywhere: 8px corners, 36px, several primaries in one Settings pane. `.btn-primary` (14 uses), `.shero__btn-quiet` and `.player__btn--glass` are class names with no CSS: their paint went to `styles/old/buttons-blammytv.css` in v0.9.54 to 56 and isn't imported. Two `.btn-quiet` buttons are plain `<button>`s with nothing of their own: "Unhide" (`PlaylistsTab.tsx:378`) and the resolve screen's "Cancel" (`StreamScreen.tsx:1378`). | `.mvbar__add`, `.mvbar__icon`, `.mvchip` |
| **LIVE** | Three drawings (016 3.3 counted them): the hero's accent-bordered pill (`live.css:823`), Sports' red dot (`.gamepip`, `sports.css:150-157`, `--danger`), the theater's Button (`TheaterOverlay.tsx:1816`). | `.mvtile__live` |
| **The line** | "3/3" in a 10px pill (`.live-conns`, `live.css:184`). | `.mvmeter` |
| **Logos** | Free-floating, 44 by 64, the lettermark bare (`live.css:513`). 016 4.3 already asks for "40px logo tiles, and the lettermark on a tile". | `.mvlogo` |
| **Nothing here** | Nine layouts (016 3.3). The Guide's status is 14px text at opacity 0.6 (`live.css:345`); Stream's and Sports' have no icon, Sports' at twice multi-view's scale. | `.mvtile__state`, `.mvtile--empty` |
| **Labels** | Sentence case, 12px, 500, at 70% ("no chip and no caps", `sports.css:2449-2469`), and 16px, 600 in Settings. | `.mvpick__sec` |
| **Rows** | A source is a card: 14px corners, a shadow, the quality as 21px text, an unexplained ⚡ (`stream.css:861-914`). Playlist rows are cards too (`settings.css:618`). | `.mvpick__row` |
| **Focus** | One 3px ring at 50% everywhere (`ui.css:221`). | the double ring |

Also: Badge, Card, Skeleton, Separator and Textarea are generated and
imported by nothing (checked 2026-09-26). M2 says adopt or delete.

---

## The kit: one primitive per job (frame A)

Each becomes a shared component or a Button variant, and multi-view moves
onto it first, so the first consumer of every primitive is the screen it
was drawn from.

**K1. Tokens.** `--glass` and `--glass-fx` (the capsule's recipe),
`--tint-hover` (9%), `--tint-on` (16%), `--pic` (the `#111` behind a
picture), and 016 3.1's list with them (`--on-image`, `--warning`, the
z-index scale, no opacity-dimmed text). Multi-view's raw whites move onto
them, which is also what lets 016 4.8's light pass reach them.

**K2. Segmented.** `.mvseg`, with the thumb: the on segment is a 16% tint
that **slides**, as the capsule's own pill already does. Radix Tabs
underneath for roles and arrow keys (016 3.4); ChipTabs' measuring and
spring kept (Adam's constraint, 2026-09-06). Replaces ChipTabs, ModeRail,
`.sports__toggle`, the season bar and the draw filter. Frames B, E, F, G.

**K3. Buttons.** Button gets the variants multi-view drew: `pill` (the
white one), `glass` (40px round-ended), `icon` (40px round glass) and
`chip` (30px, on pictures). The rule: one white pill per screen, or none.
The dead `.btn-*` hooks go. 016 3.3's BackButton and ConfirmButton are
built on these. The Settings gear becomes the round glass icon, 40px to
match the bar beside it on multi-view (016 3.5 said 44). Frames C, D, G.

**K4. LivePill.** Multi-view's: 22px, 6px corners, a 14% white fill, the
accent dot; "Behind live · 12s" beside it. Replaces all three LIVEs.
Frames B, F.

**K5. LineMeter.** `.mvmeter`: one dash per stream the line allows.
The Guide sidebar's group, a playlist's row in Settings, multi-view's bar.
Frames B, G.

**K6. ChannelLogo.** `.mvlogo`: every channel logo on a white tile, a
lettermark on the same tile. The Guide's cards and hero, the palette, the
Sports theater's rail. Team logos stay as they are: they are drawn for a
dark ground. Frames B, H.

**K7. Tile.** A 16:9 picture, the caption under it, the chrome on hover
or focus. The Guide hero's preview, Continue Watching, episodes, and
multi-view's own tiles. Progress sits **between** the picture and the
caption, 3px and white, so the picture stays clean at rest. The next
episode up takes the sound tile's ring. Posters stay 2:3 but take the
10px radius and a caption under them everywhere, "More like this"
included. Frames C, D, E.

**K8. StateCard and EmptyPlace.** `.mvtile__state` for 016 3.3's nine
empty and error layouts; `.mvtile--empty`'s dashed place for Library's
New list and the Guide's lanes with no listings. Frame A.

**K9. Eyebrow and SectionLabel.** Frames B, D, F, G, H.

**K10. Row.** The picker's row: flat, a 9% tint under the pointer, as
tall as what it carries. The list is one tab stop and the arrows move
through it (rule 10). Sources (below), playlists, the Guide's folders at
36px. Frames B, D, G.

**K11. Palette.** The picker, grown to the whole app: channels, what is on
later, films and series, Settings. Ctrl+K anywhere, and a round search
button beside the gear. ROADMAP already has it under "Alongside", with
multi-view's picker as "its first shape". Frame H.

**K12. Focus and Kbd.** Multi-view's double ring everywhere, measured
against 016 3.1's 3:1; the `<kbd>` chip as a component.

**K13. Idle.** The header dims to 0.35 on the Guide's theater and the
Sports theater, as it does on multi-view. Chrome drawn on a picture still
hides fully, as it does today.

---

## Each screen, what changes and what does not

**B. Guide.** Changes: the mode rail is the glass segmented control, with
a track you can see (016 4.3); the source's name is an eyebrow with the
meter beside it; folders are 36px rows with the 9% tint; the hero's
preview is a tile; the hero leads with the logo tile and the channel as an
eyebrow; LIVE is the pill; the programme's progress is the 3px white
track between tabular times; every channel has a logo tile, lettermarks
too; card and cell share the 10px radius, and the ruler is 12px tabular
with a 1px tick (both 016 4.3); lanes with no listings are the dashed
place. Unchanged: the layout and every size in it, the hero title's
scale, the now-line, the airing cell's tint, the cell's spotlight and
press.

**C. Stream.** Changes: the hero's buttons are the white pill and a glass
one; meta takes " · " (016 4.5); Continue Watching is 16:9 tiles with
progress under the picture, the caption under that, and Sources as a chip
on hover; the row arrows are round glass. Unchanged: the carousel and its
glow, the poster rows, tilt and glare, hold-to-clear.

**D. A film's page.** Changes: Back is the round icon; Save is a glass
split pill; genres are small glass pills; the sources are one glass column
over the backdrop (014 says glass earns its place here), grouped, with a
`<kbd>` footer (the rules are the next section); "More like this" posters
get captions. Unchanged: the layout, the backdrop, the 420px column, and
every line a source carries.

### Sources

Adam, on frame D: "we need to make sure it accounts for all the data",
"'instant' would need to go to 'cached'", "i still want it to extend all
the way down when possible", and grouping "if it can work for anyone and
not just my config".

**All the data.** A source is what the addon wrote. The app derives one
field, the quality (the bingeGroup's resolution, else parsed from the
name, `mapper.ts:207-220`), and shows every line of the addon's
description as it came (`mapper.ts:79-84`). The rule today stays the rule
("EVERY line", `StreamScreen.tsx:2856-2860`: a truncated one hides the
audio track or the size that made it the right choice). The row:
- the quality in a small glass tile, top left;
- the first line in the text colour at 600, every other line muted, all
  of them, each on one line with an ellipsis and the whole text on hover,
  as today;
- the play glyph, brighter under the pointer.

The ⚡ leaves the quality block: the group says it. The addon's own lines
keep whatever markers they carry.

**All the way down.** The column starts under the header and runs to the
window's bottom edge, scrolling inside, with the group labels sticking to
its top as you pass them. A short list ends where it ends. The footer
(the keys, and the count) sits at the bottom of the column.

**Cached and Not cached, for anyone.** A source's cache status comes three
ways, most trusted first:
1. **AIOStreams' own data.** `streamData.service.cached`, true or false,
   for any formatter and any service, debrid or usenet. The app already
   asks for `streamData` (the `AIOStreams/` token, `stremio.ts:175-183`),
   and AIOStreams sends `service` as `{ id, cached }` on every stream that
   went through one (`packages/core/src/db/schemas.ts:1505-1510` and
   `transformers/stremio.ts:125-155` in Viren070/AIOStreams at `00fb93a`).
2. **The addon's text,** for older instances and other addons. Cached:
   the ⚡ or a `[RD+]`-style tag, as today (`mapper.ts:57-76`). Not
   cached, new: the ⏳ that AIOStreams' own formatters put on an uncached
   stream (its GDrive formatter writes `⚡]` or `⏳]` after the service,
   `utils/formatter-definitions.ts`), and Torrentio's `[RD download]`
   (per `mapper.ts:57-58`).
3. **Neither:** a direct link with no service, or an addon that marks
   nothing. Unknown, not "not cached".

`StreamSource.cached` stays the boolean auto-play trusts; the new field is
a three-way status beside it. The groups:
- **Cached**, then **Other sources** (the unknowns), then **Not cached**,
  each labelled with its count, only when it has a source in it.
- **No labels at all** when no source's status is known: a flat list, as
  a setup without debrid gets today, minus the ⚡.
- **The addon's order holds inside each group.** AIOStreams ranks and the
  app never re-sorts (`stremio.ts`, "we never re-sort"); grouping only
  moves a group ahead of another. AIOStreams' default config sorts cached
  first anyway (`sortCriteria.global[0]`,
  `packages/frontend/src/context/userData.tsx:401-405`), and its default
  formatter is the GDrive one quoted above.
- **Auto-play doesn't change.** It still plays only a cached source.

The same rows are the player's source panel (`.vod-panel`,
`StreamScreen.tsx:1437-1500`), where the playing one keeps its ring. The
column's states (finding sources, couldn't load, none) are the StateCard
(K8).

*Proof:* unit tests in `mapper.test.ts` for each rule (`service.cached`
true and false, ⚡, `[RD+]`, ⏳, `[RD download]`, none) and for the
grouping (order kept inside groups, empty groups dropped, no labels when
nothing is known).

**E. A series' page.** Changes: seasons are the segmented control;
episodes are tiles with captions; watched is a check in the caption and a
full track; the next episode wears the sound tile's ring; hover shows the
episode as an eyebrow and a Sources chip.

**F. Sports.** Changes: one toolbar row beside the heading (016 4.4) with
Multi-view and Show earlier days as glass pills; LIVE is the pill;
"Couldn't link" is a chip; the sidebar's rail, search and labels follow
the Guide's. Unchanged: the cards. Their shape, washes, tilt, type and
scores stay, which is 014's "Sports last" and the frame is there to show
it. The theater growing into multi-view is its own approved work.

**G. Settings.** Changes: the tabs and source pickers are the segmented
control; section labels are eyebrows; fields are 40px with a tint and no
border; one white pill per pane, quiet until it can be pressed; a
playlist's row carries its logo tile, its meter, the toggle and a glass X.
The sheet stays solid (014: a flat panel does not earn glass) and moves
onto Dialog (016 3.3).

**H. The palette.** Over any tab. Sections in order: channels, on later,
films and series, go to. Rows are the picker's, footer and all.

**Discover and Library** have no frame of their own: their cards are
Stream's `Card` and `RowScroller`, which this track moves into `ui/`
(M2's item), so frame C is theirs. Discover's filters already live in the capsule's second row.
Library's New list is frame A's empty place, and its Remove pill
(`LibraryScreen.tsx:360-374`) is already nearly `.mvchip`.

---

## Decisions

Taken by Adam, 2026-09-26: D1 as its own track, D2 to D7 as recommended.

**D1. Multi-view is what M2 and M3 build toward.** *Recommended yes.*
**Decided: its own track,** which does the 016 items it reaches (see
"Where this sits"), so nothing is converted twice either way.

**D2. Controls have round ends.** `sports.css:61-65` says "`rounded-md`
because a pill is for a badge, and this is a control". Multi-view's
controls and the capsule are round. *Recommend round for every button,
chip and segmented control; text fields keep 10px corners* (a field is
not a button, and multi-view's own search sits in a square-cornered
palette).

**D3. The thumb, in glass.** *Recommend the on segment as a sliding 16%
tint.* It keeps the 2026-09-06 constraint and is what the capsule does
already.

**D4. Section labels in capitals.** The shadcn pass took the capitals out
of the sidebars on purpose (`sports.css:2455-2459`, "the only label in the
app still shouting"); multi-view's picker put them back, quieter (11px,
650, muted, no chip). *Recommend multi-view's, everywhere.* That comment
itself says the Sports label and the Guide's "are the same object", and
the picker's label is the third copy. The other way is sentence case
everywhere, the picker included.

**D5. The live dot's colour.** Sports is red; the theater and multi-view
use the accent, which by default is near-white. *Recommend the accent,*
for one LIVE. Red is TV's convention, though, and this one is taste.

**D6. The palette in this plan.** *Recommend in, and last (K11).* It is
multi-view's biggest component, it gives the Guide the Ctrl+K search the
Live slate ranked first (ROADMAP, "Alongside"), and it needs nothing K1 to
K10 don't build.

**D7. The header dims on the theaters.** *Recommend yes* on the Guide's
and Sports' theaters (both are players), and never on a screen you browse.

---

## Build order

Ground up, by primitive. Each step ends green, with a check that fails
without it, and a version bump. All of it is frontend (hot reload), so
none of it waits on a rebuild.

1. **K1 tokens**, with 016 3.1. Multi-view moves onto them first and must
   not move a pixel: verify-multiview's geometry, plus a screenshot diff.
2. **K2 segmented**, with 016 3.4. Settings, the Guide's and Sports'
   sidebars, the Sports toggles, seasons, the draw filter, multi-view's
   Grid and Focus.
3. **K3 buttons**, with 016 3.3 item 8. The `.btn-*` hooks go.
4. **K4 to K6:** LIVE, the meter, logos (with 016 3.3 item 4's Badge).
5. **K7 and K8:** the tile, and the states (016 3.3 item 6).
6. **K9 and K10:** labels and rows, the sources' three-way cache status
   and groups with them.
7. **K12 and K13:** focus, kbd, idle.
8. **K11:** the palette.

Then each screen's own list from 016's Track 4 runs as its last consumers
move, in this track, and these frames are the target. Sports stays last.

Every conversion updates its harness checks in the same commit (the
v0.9.54 lesson). Multi-view's harnesses find things by `.mv*` classes, and
a second element wearing a harness's class has crashed one before
(`player.css:2083-2085`).

---

## Not in this plan

- **Sports' cards.** Their shape, washes and tilt stay (014, ROADMAP M3).
- **Tilt and glare** on posters and cards stay.
- **014's glass tiers.** The frames use the capsule's recipe; the tiers,
  `prefers-reduced-transparency` and verify-glass are still 014's and
  016 4.9's.
- **Light mode** (016 D1). K1 only makes it reachable.
- **Moving anything.** No screen changes its layout, and the clock stays
  on every tab but multi-view.

## Risks

- **Glass over mpv blurs the page, not the video** (014). On the Guide's
  hero and the theaters a chip is its 60% fill and nothing more, which is
  what the theater's own buttons are today.
- **Class names are harness locators.** Above.
- **The default accent is near-white**, so "the accent is a signal" reads
  as white on a default install. It works (it is what multi-view does
  today), but D5 is where it shows.

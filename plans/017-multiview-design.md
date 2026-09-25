# 017: Multi-view, designed

**Status: IN PROGRESS. P1 shipped in v0.9.105** (the tab, its bar, the
layout engine), **P2 in v0.9.107** (the tile), **P3a in v0.9.109** (the
picker and the line's limits), **P3b in v0.9.111** (live games), **P4a
in v0.9.116** (sound and keys), **P4b in v0.9.117** (the seam), **P5 in
v0.9.118** (motion) **and P6a in v0.9.119** (the ways out); P6b, the ways
in from the Guide, the player and a game card, is next. Decided
2026-09-24: Adam answered M1 to M9 the same day and added three things:
the Focus split is resizable,
multi-view gets its own tab between Guide and Sports, and every tile closes
from an X on the tile. Written after Adam's first real
multi-view sessions: the streams work (v0.9.101's proxy, v0.9.104's
buffering, 60s with 0 hitches), and the screen around them does not. His
words: "we need a MAJOR design pass", and "the players are also simply just
video. no controls, no volume, no info".

This plan **replaces plan 016's Track 2** and **plan 013's UI**. 013's
architecture stands (web tiles, one connection per tile, the line's cap as
the ceiling, one tile with the sound), and so do its two measured layout
calls (the 3-up is one big plus two, and the 2-up is side by side).

Seven mockups were rendered with the app's own tokens, the Geist face, the
app's icon paths, and video frames cropped from Adam's screenshots. They are
in the chat, not the repo (binaries). Referred to below as frames A to G:

- **A.** Focus layout, three streams, the pointer on the sound tile.
- **B.** Grid, four streams, one tile per state (sound, tuning, failed, muted).
- **C.** The channel picker, open over a three-stream Focus layout.
- **D.** Two streams at rest: the chrome gone, the sound marker faded to a
  hairline ring and a speaker in the name chip.
- **E.** How it opens: the channel you came from, and a place for the next.
- **F.** Dragging the Focus seam: the big tile at 77%, the stack smaller and
  centred against it, a dashed line where the natural split is.
- **G.** The Multi-view tab: the app's nav capsule in multi-view's bar,
  names under the pictures, nothing drawn on them at rest.

A to E predate Adam's answers and still show the name chip on the picture;
G is how a tile looks at rest now (M4).

---

## What is there now

From the screenshots Adam sent on 2026-09-24, the v0.9.79 audit
(`docs/audit-0.9.79/`: polish, a11y, perf, bugs), and the code. Line
numbers are as of v0.9.104.

**Layout**
1. It is a panel inside the Sports screen, not a viewing mode.
   `SportsScreen.tsx:687` swaps the board for `<MultiviewScreen>`, which lives
   in the app shell, so the header's clock and nav capsule are drawn over
   tile 1 and over the rail (Adam's screenshots 3 and 4; audit a11y MV2).
2. Tiles are not 16:9. `.mvgrid` (`player.css:1002-1034`) splits the stage
   into `1fr` rows and columns, and the video sits inside with
   `object-fit: contain`, so every tile is a black box with a picture
   letterboxed somewhere in it.
3. At some widths the whole thing collapses: `.mvscreen` measured 540px wide
   with 97x831 tiles (audit polish, HIGH), and Adam's first screenshot shows
   exactly that, two tall slivers.

**Tiles**
4. A tile is a bare `<video>` (`MultiviewTile.tsx`). No logo, no program,
   no score, no volume, no controls. The name is an 11.5px pill.
5. Which tile has the sound is shown only by a 2px border in the accent
   colour, and the way to move it (click a tile) is explained only in the
   one-time notice.
6. States: nothing while tuning (black), a grey "Stream failed" on any
   error, whatever the cause, and "Nothing here yet" in the corner of an
   empty cell.
7. A tile cannot be removed, replaced, moved, enlarged or handed to the
   main player. The only control is the rail.

**Picking**
8. The rail is a permanent 290px column of raw provider names
   ("NFHS Network 1337: Albany High School vs. W..."), no logos, nothing
   about what is on.
9. The grid size is a bare "2 / 3" pair with no label, and shrinking it
   silently drops picks (`MultiviewScreen.tsx:111-113`).
10. Closing multi-view forgets everything; reopening starts empty.
11. The only way in is a button on the Sports board. Multi-view takes any
    channel since v0.9.77, and the Guide has no way to it.

**Known bugs** (audit bugs.md, each CONFIRMED): F10 a running popout is not
stopped, F12 the resolve effect cancels its own in-flight resolves and a
failed pick holds a slot forever, F13 the sound follows an index rather than
a stream, F14 the size clamp overwrites the saved preference. The notice is
`aria-modal` without a focus trap (a11y MV1) and floats top-right because
`.modal-backdrop--center` is defined nowhere (polish, HIGH).

---

## What the shipping products do

Surveyed 2026-09-24 by a research agent. Page fetches were blocked by the
container's egress policy, so product claims come from search summaries of
the cited pages; two open-source apps were read first-hand. Only what
changed or confirmed a call here is listed.

- **One tile has the sound, moved by focus or a click.** Apple TV, YouTube
  TV, ESPN, Fubo, NBA, MLB, DirecTV, Channels DVR. The only exception found
  is ynotv, with a volume per tile. Confirms 013.
- **The sound tile is marked by a white border and a speaker icon** (YouTube
  TV, MLB web, NBA on Apple TV, Channels; a speaker on the tile at Fubo and
  on iPad). **YouTube TV made the marker fade after a few seconds** because
  the always-on highlight was called distracting
  ([Cord Cutters News](https://cordcuttersnews.com/youtube-tv-makes-a-big-changes-to-its-multiview-that-users-have-begged-for/)),
  and Channels DVR fades it by default with a setting to keep it
  ([docs](https://getchannels.com/docs/apps/usage/multiview/)). Adopted
  below: the ring and badge fade at rest.
- **Two layout families, an equal grid and one big plus a strip.** Apple
  (70/30 or equal at 2 and 4), ESPN, MLB web (Quad or Thumbnail), Channels,
  ynotv. Confirms Grid and Focus.
- **MLB.TV on the web is the closest thing to a desktop design found**
  ([MLB support](https://support.mlb.com/s/article/How-to-Use-Multi-view?language=en_US)):
  one large tile with three small on the right, sound from the large one,
  a click on a small one promotes it, a click on any tile takes its sound, an
  X on hover closes a tile, and a per-tile feed switcher. That is Focus, M2,
  Remove and Replace.
- **Entering from the player, with what you are watching as tile 1.** Apple,
  YouTube TV, NBA, DirecTV, Fubo, MLB web. Confirms the player entry, and
  makes it the main one.
- **A tile to full screen, and Back returns to the same grid.** Apple,
  YouTube TV, ESPN, DirecTV, Channels, Peacock. MLB's tvOS app brought the
  other tiles back paused or behind live, a named bug
  ([Six Colors](https://sixcolors.com/post/2024/04/mlb-tvos-app-adds-multiview-and-its-a-winner/)).
  M6 keeps them playing, which is why.
- **Presets.** YouTube TV, ESPN, DirecTV, Peacock and Apple's F1 build a grid
  in one tap, and "presets only" is the recurring complaint where there is
  nothing else. One tap alongside building by hand answers both. Adopted as
  M9.
- **The cap is stated, not discovered.** Apple shows an explicit error on a
  fifth stream. Confirms the connection meter and the disabled Add.
- **Adding from a row along the bottom** (Apple, Channels, Fubo) is a TV
  remote's idiom. MLB web opens an overlay above the video instead. M3
  keeps the palette for a keyboard and a pointer.
- **ynotv** (Tauri and mpv, this app's stack, read first-hand) drew extra
  tiles from mpv into a canvas over IPC and had to add backpressure after a
  2x2 grid "ballooned to multi-GB memory". It offers an in-browser engine as
  the fallback. The web tiles here are the right call.

Motion is thin in every source. No product was found animating tiles
between layouts, so the motion below is this app's own.

---

## What it should feel like

- **A place you go, not a panel.** Multi-view takes the whole window like
  the player does, with its own chrome, and gives it back when you leave.
- **Every tile is a real picture.** Exactly 16:9, sized to the window, the
  group centred. Black only between tiles, never inside one.
- **Sound, focus and size are one idea.** The tile you choose has the sound,
  the controls and (in Focus) the big spot. Choosing another moves all three.
- **The tile is the control surface.** What is on, and what you can do to
  that stream, lives on the stream. The top bar holds only what is about the
  whole grid.
- **Nothing is ever just black.** Tuning says it is tuning, a failure says
  why and what you can do, and an empty space says how to fill it.
- **Quiet at rest.** Chrome fades after two seconds without the pointer.
  What stays is small: a name chip per tile and a Sound badge on one.
- **Complete from the keyboard.**

---

## The design

### The Multi-view tab (frame G)

Multi-view is **a destination in the nav capsule, between Guide and Sports**
(M5), on the Live side, so it shows only when a live source exists, as those
two do. The capsule reads Guide, Multi-view, Sports, the app mark, Stream,
Discover, Library.

It is a tab that behaves like the player (M1). The page is `#000`, and the
app header is replaced by multi-view's own bar, **with the app's nav capsule
in its centre** where it always sits, so moving to another tab works as it
does everywhere. The bar dims to 35% after 2s idle and comes back on
pointer movement (never dimming while the pointer is on it or a menu is
open), capsule and all. It dims rather than going: Adam, on v0.9.105, "just
dim the top bar, not remove it entirely". It stays clickable.
The clock and the Settings gear stay off this tab; both are one tab away.

- **Left:** the connection meter (one dash per stream the line allows,
  filled per stream in use, "3 of 3 streams": 013's "visually note their
  instance cap" as a glance), then the layout switch (Grid / Focus, shown
  only where both exist).
- **Right:** the sound control (speaker, the sound tile's name, a volume
  slider), **Add channel** (disabled at the cap, with a tooltip naming it),
  and full screen.

Tiles never sit under the bar: the stage starts below it, so a revealed bar
covers black, not picture.

**Leaving the tab stops every tile**, so the connections are free for the
Guide or the player. Coming back restores the grid (M7) and tunes it again.

### Layouts

The count follows the channels. Add one and the grid grows, remove one and
it shrinks, up to the line's cap (4 at most). This replaces the "2 / 3 / 4"
size pick; see decision M8.

| Streams | Default | Other |
| --- | --- | --- |
| 1 | the stream, and an **Add a channel** space beside it (frame E) | |
| 2 | side by side, equal (frame D) | Focus: big plus one small |
| 3 | Focus: big plus two stacked (frame A) | Grid: two over one, centred |
| 4 | Grid: 2x2 (frame B) | Focus: big plus three stacked |

The defaults are 013's measured calls. The switch is remembered per count.

**Every tile has a caption row under it** (M4, frame G): the name lives in
the black between tiles, not on the picture. The engine reserves it: a cell
is a 16:9 picture plus a 30px caption.

**The Focus split is yours** (Adam's ask, frame F). Drag the seam between
the big tile and the stack to make the big one bigger or smaller. Every tile
stays exactly 16:9; whichever side comes out shorter centres against the
other. How far it goes: the big tile never gets narrower than half the
width, nor so narrow that the stack outgrows the window's height, and the
small tiles never get narrower than a fifth of the width. Double-click the
seam, or `\`, to go back to the natural split, where the big tile is
exactly as tall as the stack. `[` and `]` nudge it from the keyboard. The
split is remembered per count (M7). The drag follows the pointer 1:1 and
resizes the real videos as it goes; there is no preview box.

**The arithmetic** (prototyped in the mockups, `focusSplit()` and
`naturalBw()`): every picture 16:9, gap `g`, caption `c`. Focus takes the
big tile's width `bw` as its input: the small tiles are `sw = W − g − bw`
wide, the stack is `k·(sw·9/16 + c) + (k−1)·g` tall, the big tile
`bw·9/16 + c`, and the taller of the two sets the group's height. The
natural split solves big height = stack height for `bw`. Grid is the usual
cell fit. The group is centred in the stage. This is a pure function with
unit tests: every picture 16:9 within half a pixel, no two overlap, all
inside the stage, the natural split aligned top and bottom, and the split
clamped to its range at both ends.

### A tile (frames A, B, D)

**At rest nothing is drawn on the picture** (Adam, on M4: "as long as it
doesn't cover the content"). The caption under it carries the logo, the
channel name, and what is on in muted text; the sound tile's caption adds a
speaker glyph, and the tile gets a hairline ring on its outside edge. The
**Sound** badge (the accent colour, with three bars that move with the audio
level) and the full accent ring show when the sound moves, and on hover,
then fade after 3 seconds back to the hairline. YouTube TV and Channels DVR
both learned to fade this marker (see the survey above).

**Under the pointer, or when it is the keyboard's current tile:** a gradient
scrim and the full information, laid out the way the main player lays out
its own (channel over title):

- the channel's **logo, name and number** (`Channel.logo`, `.number`);
- **what is on**: the programme title and a thin progress line with start
  and end times, from the guide (`LiveData.programmes`). For a game picked
  from Sports, the **matchup with the live score and clock** instead,
  refreshed with the board;
- a **LIVE** pill, or "Behind live" with the seconds, if stalls have put it
  behind (there is no catch-up since v0.9.104, so this is how you would know);
- **actions**, top-right: *Watch in player*, *Replace*, and **an X that
  closes the stream** (Adam's ask). On a muted tile, a *Sound here* button
  joins them. The X is there whenever the pointer is on the tile, on every
  tile, in every state, including Tuning and a failure.

**States** (frame B), each with a line of what happened and a way forward:

| State | Shows | Actions |
| --- | --- | --- |
| Tuning | spinner, "Tuning {channel}", name and number | Remove |
| Stalled over 1s | the last frame dimmed, a spinner | none (it recovers) |
| Off air (proxy: could not connect, DNS) | "{channel} is off the air", the reason in words | Retry, Replace |
| Refused by the provider (403, 503) | "Your provider refused this one", and the code | Retry, Replace |
| Can't decode (HEVC and friends, from the codecs mpegts.js reports) | "This one needs the main player" | Watch in player, Replace |
| Proxy or network gone | "Can't reach your provider" | Retry |

The reasons come from data the app already has: v0.9.102's proxy puts the
cause in the 502's status text, and the tile already logs mpegts.js's error
type and the stream's codecs.

### Sound and volume

One tile has the sound (013). Choosing a tile moves it: a click on the tile,
*Sound here*, or its number key. In **Focus**, the sound tile is also the big
one, and choosing a small tile swaps it in (decision M2). In **Grid**, tiles
stay where they are and only the sound moves.

Volume is one control, in the top bar, for the sound tile, with mute. It is
remembered like the main player's. The Sound badge's bars follow the real
audio level (an `AnalyserNode` on the sound tile only), so a silent feed
looks silent.

### Adding, replacing, removing (frame C)

**The picker** is a search-first palette over the dimmed grid, not a
permanent rail. It opens from Add channel, the empty space, a tile's
Replace, or the `A` key, with the search field focused. Rows carry the logo,
name, number, quality badge and what is on now. Sections, in order:

1. **Live games** (the Sports matches that have a channel), with teams,
   score and clock. The shortcut 013 kept at the top of the rail.
2. **Favorites**, then **Recent**, before typing.
3. **Search results** as you type, across the whole catalogue, from names
   lowercased once (audit perf 8).

Arrow keys move, Enter adds (or replaces, when opened from a tile), Escape
closes. A channel already in the grid says "In the grid" and cannot be
added twice (one channel twice is two connections on one stream). The
footer counts what is left on the line.

**Remove** is the tile's X, or Delete on the keyboard's current tile. The
stream's connection is handed back at once (the proxy drops the provider
connection when the tile goes, proven in v0.9.101), and the grid reflows.
**Replace** swaps the stream in place: same slot, same sound state.

**Order.** Drag a tile onto another to swap them. Not in the first build
(see "What we are not doing").

The grid is **remembered**: leaving and coming back restores the channels
and the layout (decision M7). A remembered channel that no longer exists is
dropped quietly.

### Getting in and out

**In:** the Multi-view tab itself, and three shortcuts that land on it with
a channel added:
- **Sports:** the board's Multi-view button goes to the tab, and a game card
  gains a "Watch in multi-view" action, which adds that game.
- **From the player:** a Multi-view button in the player's top-right, which
  adds the channel you were watching as the first tile (frame E). The main
  player stops first, so its connection is free.
- **The Guide:** a channel gains an "Add to multi-view" action. Channels have
  no menu today (only folders do, `LiveScreen.tsx:183`), so this is the
  first; a right-click menu on a channel row is the natural home.

**Out:**
- Any other tab in the capsule. Leaving stops the tiles (see the tab).
- **Watch in player** on a tile: leaves multi-view and plays that channel in
  the main player (mpv), with its full controls. The other streams stop, so
  their connections are free.
- **Double-click a tile:** it fills the window, inside multi-view. The others
  keep playing out of sight, so coming back is instant; Escape or
  double-click again returns. (Decision M6.)

### Keyboard

| Key | Does |
| --- | --- |
| 1 to 4 | make that tile current (sound, and Focus's big spot) |
| Tab / arrows | move between tiles |
| A | open the picker |
| R | replace the current tile |
| Delete | remove the current tile |
| M | mute |
| Up / Down | volume |
| G | switch Grid and Focus |
| Enter / double-click | fill the window with the current tile |
| [ and ] | make Focus's big tile smaller or bigger |
| \ / double-click the seam | the natural split |
| F | full screen |
| Esc | closes, in order: the picker, a filled tile, full screen |

Keyboard actions do not animate: they happen dozens of times a sitting, and
motion on them reads as lag (Emil Kowalski's rule; the house motion plans
follow his curves already).

### Motion

- **Layout changes** (a tile added, removed, swapped into the big spot, Grid
  to Focus) move tiles to their new rects with FLIP on `transform` only,
  260ms `--ease-in-out`. A tile swapped into the big spot grows from where it
  was, so you can follow it (spatial consistency).
- **A new tile** fades and scales in from 0.96; a removed one fades out while
  the rest move. Never from scale 0.
- **Chrome** reveals in 140ms and fades out in 200ms.
- **The picker** scales from 0.98 with opacity, 200ms `--ease-out`; closing
  is faster than opening.
- **Reduced motion:** layout changes cross-fade, nothing moves.

`<video>` elements keep playing through all of it: they are moved, never
re-created, so a reflow never re-tunes a stream.

### Source limits (M8)

Adam's concern on M8. Every tile is one connection to the provider, and his
line allows 3. The rules:

- **Add can never go past the line's maximum.** The panel reports
  `max_connections`, the meter draws that many dashes, and Add disables at
  the last one with a tooltip that names it ("Your line allows 3"). The
  picker's footer counts what is left. M3U and Stalker report no limit;
  there everything up to 4 is offered and a refusal shows on the tile.
- **Streams elsewhere are shown, not guessed at.** The panel also reports
  `active_cons`, which counts every device on the line. Multi-view subtracts
  its own tiles and, if something else is holding one, the meter says so
  ("1 in use elsewhere") and Add stops one sooner. Panels take a few seconds
  to count a new stream and up to about 20 to notice one has gone
  (`connections.ts`), so the meter re-polls after every change rather than
  trusting one reading.
- **A refusal says it is the limit.** When the provider answers a tile with
  403 or 503 while the line is at or near its cap, the tile reads "Your line
  is at its limit" rather than a bare code, with Replace and Remove.
- **Nothing ever needs a spare connection.** Replace closes the old stream
  before opening the new one, and entering multi-view (from the player or a
  shortcut) stops the main player and any popout first (F10). Leaving the tab
  stops every tile.
- **Removing is instant.** The X hands the connection back the moment the
  tile goes.

### Accessibility

Each tile is one focusable group named "{channel}, {sound or muted}, {what is
on}". Moving the sound announces "Sound: {channel}" in a polite live region.
The picker is a Dialog (focus trapped, Escape closes). The notice becomes a
Dialog too, which fixes MV1 and the top-right float.

### The notice

Kept, rewritten for what is true now. Since v0.9.101 a provider without CORS
is no longer a failure, so what is left: tiles are decoded in the browser
(some formats, HEVC in particular, need the main player), and each tile is a
connection ("Your line allows 3 at once"). Shown once, on the Dialog
primitive, centred.

### What we are not doing

- **Drag to reorder**, first build. Swap-by-drag is worth having and is
  real work (pointer capture, a drop target per tile, the FLIP handoff).
  Replace covers the need until then.
- **More than four tiles.** 013's ceiling, and most lines cap below it.
- **Picture in picture, or free-floating tiles.** A second layout system
  for little gain.
- **Per-tile volume.** One tile has the sound. Mixing two commentaries is
  noise.
- **Catch-up to live.** v0.9.104 took it out, on data. "Behind live" makes
  the lag visible instead, and Watch in player is the way back to the edge.

---

## Decisions

Adam answered all nine on 2026-09-24, after the table below was written; his
answers are under it, and the design above already follows them.

| # | Question | Recommendation |
| --- | --- | --- |
| M1 | Immersive: multi-view takes the whole window, the app header gone, its own auto-hiding bar. | **Yes.** It is a way of watching, like the player, and every layout problem in the screenshots came from sharing the screen with the header. |
| M2 | In Focus, the sound tile is always the big one, and choosing another swaps it in. | **Yes.** It keeps 013's "one tile has the audio and the player controls" and gives the swap a reason to animate. Grid never moves tiles. |
| M3 | The picker: a centred, search-first palette over the grid, or a sheet from the side. | **Palette.** Fastest from the keyboard, the grid stays visible behind it, and it is the shape a channel search wants anywhere in the app (the ROADMAP's Live slate ranked a Ctrl+K channel search first). |
| M4 | At rest, each tile keeps a small name chip, and the sound marker fades to a speaker glyph in the chip. | **Yes.** With four channels you need to know which is which without moving the pointer, and YouTube TV's always-on audio highlight was the complaint that made them fade theirs. |
| M5 | Entry from the Guide and the player, not only Sports. | **Yes.** Tiles take any channel since v0.9.77; hiding it in Sports undersells it. |
| M6 | A tile can fill the window inside multi-view (double-click), as well as Watch in player. | **Both.** Filling is for "let me look at this play" and comes back instantly. Watch in player is for "I'm done with the grid". |
| M7 | Remember the grid between visits. | **Yes, across launches.** The channels are stable ids, and rebuilding a grid is the most tedious part of using one. |
| M8 | The grid size follows how many channels you add, instead of a 2 / 3 / 4 pick. | **Yes.** This changes a call you made in 013 ("people can decide to just watch two or 3 or 4"): you still decide, by adding and removing, but there are no empty boxes to fill and nothing is dropped when you change your mind. |
| M9 | One tap to fill the grid with live games, alongside picking by hand. | **Yes, as one action, not a preset system.** The picker's Live games section gets "Fill with live games": up to the cap, followed teams first (ESPN puts favorites first). "Presets only" was the survey's recurring complaint, and this keeps building by hand as the main path. |

**Adam's answers:** M1 yes. M2 yes. M3 yes, and bookmark an app-wide
palette as a feature of its own (now in the ROADMAP's "Alongside" list).
M4 yes, "as long as it doesn't cover the content": the at-rest name moved
off the picture into a caption. M5 yes, and multi-view gets **its own tab
between Guide and Sports**. M6 sure. M7 yes. M8 yes, with a concern about
source limits, answered in "Source limits" above. M9 yes. His additions: a
**resizable Focus split**, and **an X on every tile** to close its stream.

---

## Build order

Each phase ends green, with a check that fails without it (plan 016's rule),
and a version bump. The work is frontend unless marked.

**P1. The tab, the shell and the layouts.** The Multi-view tab in the
capsule between Guide and Sports, the bar with the capsule in it and
auto-hide, full screen, leaving the tab stopping every tile, and the layout
engine as a pure function with caption rows and the Focus split as an input
(the natural split for now). Tiles as they are today, placed by the engine.
*Proof:* `layout.test.ts` (16:9 within half a pixel, no overlap, in bounds,
natural split aligned, the split clamped; at 1400x900, 1920x1080 and
1280x720). A new `verify-multiview.mjs` under the IPC stub: the tab sits
between Guide and Sports, the capsule navigates away, every picture is
16:9, nothing overlaps, nothing covers a picture at rest, and leaving the
tab closes every stream.

**P1 done in v0.9.105.** `mvLayout.ts` with 137 unit tests
(`mvLayout.test.ts`), `MultiviewTab.tsx`, and `verify-multiview.mjs` (28
checks), each mutation-tested. Where it differs from the above:
- **The tab icon is Adam's**, a regular and filled pair (`ui/icons/
  multiview*.svg`), off and on like the rest of the capsule.
- **The rail stays** on the right until P3's palette replaces it, so the
  stage is narrower than frame G's. The Tiles size switch (2, 3, 4) stays
  in the bar for the same reason: count-follows-channels is P3.
- **The live games** in the rail come from the Sports board's last look
  (`multiviewEntry.ts`), dropped after 30 minutes. Only the board fetches
  games, and fetching the whole board again from here is 151 requests a
  day. P3's palette reads the same snapshot.
- **The Grid / Focus switch** is in P1 rather than waiting for its key in
  P4, and remembered per count.
- **F14 is fixed in P1**, as a side effect of the size moving into the tab:
  the clamp to the line is no longer written back over your choice.
- **The sound tile's ring is an outline** outside the picture, not a
  border: a border took 4px out of a picture that is exactly 16:9.
- **The bar drops its words on a narrow window.** The capsule's left edge
  is about 291px short of the midline on this tab, and the window goes
  down to 1000px, so under roughly 1260px the controls would meet it. It
  is measured, not a media query, because the UI scale moves the number.
- **Full screen this tab turned on is turned off on the way out.** One it
  found already on is left alone.
- **The bar dims instead of hiding** (v0.9.106, Adam's call after using
  v0.9.105). 0.35 was picked from screenshots of 0.25, 0.35 and 0.5 over
  the grid, and it is the header's own quiet level.

**P2. The tile.** The rest and hover chrome, the Sound badge, the info (guide
now and next, game score), the states table with reasons from the proxy
and the codecs, and the tile actions.
*Proof:* harness checks per state, driven by the fake panel (a 404, a
never-answering stream, a slow one); the info against a fake guide.

**P2 done in v0.9.107.** `mvTile.ts` (the failure wording, the codec check,
what is on, behind live) with 21 unit tests, the tile in
`MultiviewTile.tsx`, and `verify-mvtile.mjs` (19 checks), each
mutation-tested. Where it differs from the above:
- **Actions in P2 are the X and Sound here.** Replace needs P3's palette and
  Watch in player needs P6's hand-off, so each lands with its phase. A
  codec failure says "The Guide's player can" until then.
- **No game score yet.** The board stops polling when you leave Sports, so
  a score here would be up to half an hour old. P3's palette needs live
  games too; both get a fresh source there. A game tile shows the
  channel's guide meanwhile.
- **F13 is fixed in P2**, not P4: the X made it bite. The sound follows a
  stream's id and falls to the first tile left when that stream goes.
- **A failed tile cannot take the sound**, and does not offer Sound here:
  there is nothing to hear.
- **Behind live is the time spent stalled**, since nothing catches up
  (v0.9.104), shown from three seconds.
- **Tuning and Buffering use the main player's pulse**, not a spinner: the
  app has none, and the two players should read the same.
- **The tile's information goes when the bar dims**: a pointer left resting
  on a tile is watching it.
- **A cold start is fixed.** Launching on Stream and going straight to
  Multi-view left the search empty for the visit (v0.9.105): nothing had
  loaded the catalog. The tab now loads it through `useLiveData`, the hook
  Sports' catalog was already using, moved out so both share it.

**P3. Picking and limits.** The palette (Dialog), the empty space, Replace
(closing the old stream first) and Remove, count-follows-channels (M8), the
meter's "in use elsewhere", the grid remembered (M7), Fill with live games
(M9). F12 and F14 go here.
*Proof:* add, replace, remove, a duplicate refused, the cap refused, a
replace at the cap that never holds two connections, the grid restored after
leaving and after a reload.

**P3 is shipping in two parts.** P3a in v0.9.109: the picker, the empty
place, Replace, count-follows-channels, the meter with "in use elsewhere",
Add stopping at the line's limit, the grid remembered, and F12. `mvGrid.ts`
(18 unit tests), `MultiviewPicker.tsx`, and `verify-mvpick.mjs` (15 checks),
each mutation-tested; verify-multiview grew the count and the limit.
**P3b** is Fill with live games (M9) and a fresh live-games source: until
then the picker's Live games are the Sports board's last look, as the rail's
were. Where P3a differs from the above:
- **The picker is Base UI's Autocomplete** rendered `inline open` in the
  app's Radix Dialog, which is Base UI's own documented command-palette
  recipe: the keyboard and screen-reader wiring are the library's. Base UI
  was already a dependency (the Combobox primitive).
- **What is already in the grid sorts last** in each section. The list
  highlights its first row and Enter takes it; a disabled first row left
  Enter doing nothing.
- **A number finds its channel first** ("209").
- **Adding records the channel as recent**, so the picker's Recent and the
  Guide's know what went into a grid.
- **Elsewhere waits 25 seconds.** A panel takes up to about 20 to notice a
  stream has gone (connections.ts), so a count read sooner would blame a
  stream the grid just closed on another device.
- **The meter leads with the line's total** (v0.9.110): "3 of 3 streams in
  use · 1 elsewhere", the number the Guide's sidebar pill shows, from the
  same panel read. v0.9.109 led with this grid's count, which read as the
  line's and was not. verify-mvpick checks the two numbers agree.
- **A refusal on a full line reads as the limit** ("Your line is at its
  limit", with the code and what to do); on a line with room it is the
  code alone.
- **A lone stream keeps a place to add beside it**; from two streams on the
  grid is exactly the streams, and Add or A adds more.
- **Escape closes the picker, not full screen too.** App's full-screen
  handler now leaves an Escape a dialog has taken.
- **The generated Dialog's overlay forwards its ref** (React 18), the same
  fix button.tsx and combobox.tsx carry; without it Radix could not wait
  for the overlay's fade.

**P3b shipped in v0.9.111**: multi-view's own look at today's games, Fill
with live games (M9), and the score on a game's tile. `mvGames.ts` (7 unit
tests) and `verify-mvgames.mjs` (9 checks), each check mutation-tested.
- **The tab asks ESPN itself, and only while it needs to**: the picker is
  open, or a tile is a game. The board's manners: what you follow (or the
  whole catalog when you follow nothing) on the first look, then only the
  leagues that answered, every 90 seconds, through the same 30-second
  response cache. Until the first answer lands the picker shows the board's
  last look, as before.
- **A game picked as a game stays one.** The pick carries its fixture id and
  league, the league is asked for while the tile is up, and the tile shows
  the score and clock ("BUF 17 – 24 KC · 7:22 - 3rd") in the caption and
  under the pointer, in place of the guide. A game that drops off today's
  list falls back to the guide.
- **Fill ranks your teams, then your leagues, then the rest.** A followed
  league counts as followed everywhere else, so ranking on that alone put an
  NFL game ahead of the Chelsea match for someone following both leagues and
  Chelsea. The harness caught it. One game per channel: a channel is one
  stream.
- **Fill only says "the ones you follow first" when one of them is.**
- **"Sky Sports" does not claim "Fake Sky Sports FHD"**: it scores 40 (loose,
  the extra word), under the 70 a game needs for a channel. The harness uses
  the fake panel's own name for it rather than lowering anything.
- **The picker is a fresh dialog on every opening.** Escape and then a
  quick click on Add (inside the 50ms between the overlay's fade and the
  picker's) either did nothing or opened a picker whose rows could not be
  clicked: the fading picker's held outside-press closed the new one, or
  the overlay came back on top of it. P3a's bug; P3b's extra work on open
  made verify-mvtile catch it about one run in four. verify-mvpick now
  stretches the fade so the click lands in it every run.

**P4. Sound, keys and the seam.** Sound follows the stream, not an index
(F13), the top-bar volume and mute, the level meter, the keyboard table, and
the draggable Focus seam (pointer capture, 1:1, clamped, double-click
resets, remembered).
*Proof:* sound stays on the same stream through a removal and a swap; every
key in the table does its thing; a drag moves the seam and keeps every
picture 16:9; a double-click restores the natural split.

**P4a, sound and keys, shipped in v0.9.116.** In Focus the sound tile is
the big one: choosing a small tile swaps the two (`swapToFront`, so nothing
else moves), and switching to Focus brings the sound tile up. In Grid only
the sound moves. The bar has the volume and mute, for the sound tile only,
remembered (`multiviewVolume`); ↑ also unmutes, as in the main player. The
Sound badge's three bars follow the tile's real level: `captureStream()`
into an `AnalyserNode`, on the sound tile only, low, mid and high bands
(`mvLevel.ts`). Keys: 1 to 4, ← →, A, R, Delete, M, ↑ ↓, G and F. None
while typing, with a dialog open or with a modifier held, and a focused
volume slider keeps its own arrows (`mvKeys.ts`). A with the line full does
nothing, as the Add button does. Left for P4b: the seam, `[`, `]` and `\`.
Enter (fill the window) is P6's. verify-mvsound proves it, 23 checks, each
one mutation-tested; the level comes from a stubbed `captureStream()`
playing a real oscillator, since nothing decodes in the test Chromium.

**P4b, the seam, shipped in v0.9.117.** A grab strip over the gap between
Focus's big tile and its stack (`.mvseam`, a `separator`). A drag holds
its own split until it lets go, so every tile follows the pointer 1:1
with the real videos resized as it goes, then keeps it for this count
(`multiviewSplits`). The tip ("Big tile 77% · double-click to reset") and
a dashed line at the natural split show while it moves, as frame F drew
them. Double-click or `\` goes back to natural, which is stored as no
entry at all, so it keeps following the window; a click that does not
move the seam does not pin it. `[` and `]` step 2% of the pictures'
width. Focused, it is a splitter: ← → move it and not the sound, Home and
End go to the ends. Grid has no seam. `splitAt` is plain arithmetic, not
a search: the range stops each end where a column would outgrow the
stage, so inside it the pictures always span the stage and the seam moves
linearly (a unit test holds that). verify-mvseam, 14 checks, each caught
by its own mutation.

**P5. Motion.** FLIP on layout changes, the swap into the big spot, enter
and leave, the picker, reduced motion. Checked in slow motion by eye, and by
a harness check that a reflow never re-creates a `<video>`.

**P5 shipped in v0.9.118** (`mvMotion.ts`). A change to which tiles there
are, their order, or Grid and Focus moves every tile from where it is
DRAWN (read during the render that changes it, transforms and all, so a
change mid-move starts from wherever the tile had got to), 260ms on the
strong ease-in-out, captions moving with their tiles without scaling. A
new tile scales in from 0.96 with a fade (220ms ease-out, 40ms apart when
several arrive); one closed from its X leaves a stand-in, its last frame,
that fades out in 150ms while the rest move in. Nothing from the keyboard
animates: the modality is tracked on every key and pointer press, so 2,
G, Delete, a row chosen with Enter, and the picker opened with A or shut
with Escape all happen at once. A resize or a seam drag stops a move in
flight. Reduced motion fades what moved or arrived and moves nothing. The
picker takes the plan's timing (0.98, 200ms in, 150ms out) in place of
the shared Dialog's, through inline variables, because player.css sits
in a lower cascade layer than the utilities. Watched at a tenth of its
speed (CDP), the tile swapped into the big spot slid UNDER the one leaving
it: a growing tile now rides above the rest for the length of its move.
Two bugs found on the way: closing the sound tile left its id behind, so
adding that channel back handed it the sound and the big spot; and a
picker still fading out after a click held the keyboard for its last
150ms. verify-mvmotion, 19 checks, each caught by its own mutation;
verify-mvpick's reopen race now closes with a click, since Escape leaves
no fade to race.

**P6. The ways in and out.** Player, Guide and game-card entries, Watch in
player (stopping the grid first), fill-the-window, the popout stopped on
entry (F10), and the notice on Dialog (MV1).

**P6a shipped in v0.9.119: everything inside the tab.** Double-click a
tile, or Enter, and it fills the window (the largest 16:9 the stage holds,
its caption under it) and takes the sound; the others keep playing out of
sight, hidden rather than closed, so coming back is instant. The filled
tile is the sound tile, so 1 to 4 and the arrows flip the whole window
between channels. Escape or a double-click puts it back; Escape is taken
before the app's own, so full screen waits for the next press. Adding or
closing a tile goes back to the grid, so nothing arrives unseen. Enter on
a tile is now the grid's (fill), Space still takes the sound, and Enter on
a button stays that button's. Watch in player, a new button on the tile,
hands its channel to the Guide through a mailbox (`requestWatchInPlayer`):
App flips to the Guide, which stops every tile by leaving the tab, and the
Guide tunes it in the theater. F10: a LIVE popout stops as the tab opens,
since it holds one of the line's connections; a VOD popout never touches
the line and is left playing (tracked where `tauriPopoutOpen` is told
which it is). MV1: the notice is on the shared Dialog, centred over a
backdrop with focus kept inside it, still acknowledge-only, and its first
point no longer says HEVC "can come up blank" (it converts, v0.9.112).
The motion's lift now goes to the tile whose size changes most, ties to
the one growing, because on the way back from a fill it is the shrinking
tile you follow; and a move cancelled by the next no longer drops that
next one's lift a tick later. verify-mvfill, 16 checks, each caught by
its own mutation.

**Alongside, native (a rebuild):** allow mpegts.js's worker in the CSP so
transmuxing leaves the main thread (audit perf 6 said this "is native"; the
freeze that made that a blocker is lifted). Measured before and after with
`btvMultiviewStats`.

**HEVC in a tile, shipped in v0.9.112 (native).** Adam's Falcons at Packers
tile said "needs the main player": WebView2 decodes HEVC only through
Windows' HEVC Video Extensions (Edge goes through Media Foundation, where
Chrome goes to the GPU through D3D11), his RTX 4090 notwithstanding, and the
free listing of that package would not install for him. Weighed against mpv
tiles for HEVC (full quality, but every multi-view feature built twice and
the native multi-tile setup v0.9.94 backed out of), he chose converting
(2026-09-25):
- **The proxy converts** (`mvconvert.rs`). The tile asks when this webview
  can't play HEVC; the stream's first packets (PAT, PMT) say whether it is
  HEVC; if so ffmpeg reads the provider's bytes on stdin and writes H.264
  and AAC as MPEG-TS on stdout. Still one provider connection: the bytes
  read to find out are ffmpeg's first bytes. Everything else passes through
  untouched.
- **ffmpeg is shinchiro's build**, the same builder as our libmpv, fetched
  by `scripts/fetch-ffmpeg.mjs` and bundled like the DLL. 26MB compressed,
  107MB on disk. BtbN's LGPL build was 136MB. It has everything needed:
  D3D11 decoding, NVIDIA, Intel and AMD encoders, libx264, and libplacebo.
- **What this machine can do is asked once**, with the conversion's own
  options on a generated picture: D3D11 decoding (frames kept on the GPU, so
  a quiet fall back to the CPU doesn't count), the first encoder of
  h264_nvenc, h264_qsv, h264_amf and libx264 that works, and libplacebo.
  Not `-hwaccel auto`: measured, it went from a missing CUDA to VAAPI, whose
  loader aborted the whole process.
- **The picture:** at most 1080 lines (a tile is never bigger), BT.709, HDR
  tone mapped on the GPU by libplacebo. Without it (no Vulkan), scaled on
  the CPU and HDR is not tone mapped; the console says so.
- **Measured here** (Linux, 4 cores, CPU only): first byte 4.8s at ffmpeg's
  default 5-second analysis, 0.2 to 0.8s with a 1-second one; 4K HDR10 to
  1080p SDR with CPU tone mapping kept up with live (448 of ~450 frames).
  Synthetic picture decodes far more easily than broadcast, so the GPU
  path on Adam's machine is the real measurement.
- **Tested for real** in mvproxy.rs against a real ffmpeg: HEVC in, H.264
  and AAC out; H.264 untouched byte for byte even when asked; HEVC passed
  through when not asked; a closed tile ends its ffmpeg and hands the
  provider connection back; a conversion that can't start says why. CI's
  Windows job runs them with the bundled build (no GPU there: the CPU path).

**v0.9.113, after Adam's first converted tile** ("it does play now";
colours "pretty funky", "real warm"; "much further behind than source"):
- **The H.264 was not fully tagged.** Measured: it came out
  `bt709/unknown/unknown`, the encoder's -color_primaries and -color_trc
  never reaching it, so the webview guessed the primaries and transfer.
  The frames are now tagged with `setparams` (all four BT.709), and the CPU
  path converts its matrix to BT.709 rather than keeping the source's.
  Whether that was the whole of the warmth is his next look: the log now
  prints the source's own `Stream #` line (codec, pixel format, colour
  tags) and the output's.
- **A tile never catches up to live** (multiviewTuning.ts, on purpose), so
  every second a conversion took to start stayed. His first HEVC tile gave
  its first bytes after 4.3s, which included asking what the machine can
  do. That is now asked when the tab opens (`mv_convert_warm`), and its
  three questions run at once, not in a row. NVENC holds no frames back
  (`-delay 0`, `-zerolatency 1`), and ffmpeg is told the input is MPEG-TS.
  NOT `+nobuffer`, which looked like the obvious one: measured, it
  corrupts HEVC decoding (40 and 94 "Could not find ref" errors on two
  test streams, 0 without).
- **An A/B for the colour question:** `BLAMMYTV_MV_PLACEBO=0` turns GPU
  tone mapping off for a run.
- **Volume** is P4, next.

**On v0.9.113, measured on his line:** the TNF feed is HDR10
(`yuv420p10le(tv, bt2020nc/bt2020/smpte2084)`, 1080p59.94) and comes out
`bt709`; the warmth was the comparison monitor, not the tile. First bytes
after 1.7s, down from 4.3s, the machine's answer taken at the tab (1.7s,
three questions at once). It sits "a good minute behind" the Prime app,
which is the restream's delay if the Guide's player shows the same.

**v0.9.114: "the whites keep fluctuating".** libplacebo's dynamic peak
detection re-bends the tone curve from each frame's highlights (20-frame
smoothing, a third of a second at 59.94), so the score bug dimmed as the
picture brightened. `peak_detect=0`: the curve follows the stream's HDR10
metadata and holds still.

**v0.9.115: the tile's colours match the Guide's.** Same HDR10 feed, the
tile darker and punchier than the Guide. Adam's `mpvGet` said why: mpv tone
maps to the display's reported SDR white, 80 nits, and ffmpeg's libplacebo
filter cannot be given a target, so it assumes 203. 1000 nits squeezed into
80 keeps the midtones far higher against white: a 20-nit patch sat at 0.44
of the signal in the Guide and 0.32 in the tile. Three spline constants
through `extra_opts` pull the tile's curve onto mpv's (fitted with a port of
libplacebo's spline across peaks of 600 to 10000 nits, then checked against
a real render of a PQ grey ramp through the exact filter string): the
distance fell from 0.09 to 0.017 at 1000 nits. Also taken from his mpv:
gamma 2.2 out (not BT.1886) and no contrast recovery. The frames stay
tagged BT.709, which Chromium puts on the screen as-is. What it cannot
match: mpv measures each frame's peak and the tile holds still on purpose
(v0.9.114), so a very dark or very bright scene will still differ a little.

## Risks

- **The guide for a channel** may be missing (1545 of 8459 channels in
  Adam's line carry an EPG id). A tile with no guide shows its name and
  number and no programme line, not "No information".
- **Four HD streams in WebView2** decode on the GPU; Adam's machine did three
  at 0 drops. Four is untested. P1's harness cannot measure this; Adam's run
  of `btvMultiviewStats` with four tiles is the check.
- **The picker's catalogue** is 26k channels. Search runs on pre-lowered
  names (audit perf 8), capped at 40 rows, so it stays under a frame.

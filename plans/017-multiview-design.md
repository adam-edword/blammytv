# 017: Multi-view, designed

**Status: DESIGN (2026-09-24, v0.9.104).** Written after Adam's first real
multi-view sessions: the streams work (v0.9.101's proxy, v0.9.104's
buffering, 60s with 0 hitches), and the screen around them does not. His
words: "we need a MAJOR design pass", and "the players are also simply just
video. no controls, no volume, no info".

This plan **replaces plan 016's Track 2** and **plan 013's UI**. 013's
architecture stands (web tiles, one connection per tile, the line's cap as
the ceiling, one tile with the sound), and so do its two measured layout
calls (the 3-up is one big plus two, and the 2-up is side by side).

Five mockups were rendered with the app's own tokens, the Geist face, the
app's icon paths, and video frames cropped from Adam's screenshots. They are
in the chat, not the repo (binaries). Referred to below as frames A to E:

- **A.** Focus layout, three streams, the pointer on the sound tile.
- **B.** Grid, four streams, one tile per state (sound, tuning, failed, muted).
- **C.** The channel picker, open over a three-stream Focus layout.
- **D.** Two streams at rest, the chrome faded out.
- **E.** How it opens: the channel you came from, and a place for the next.

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

### The shell (frames A to E)

A full-window layer above the app shell, as the player's stage is, on
`#000`. The app header is not drawn. Its own top bar, over a gradient,
reveals on pointer movement and fades after 2s idle (never while the pointer
is on it or a menu is open):

- **Left:** Back (leaves multi-view), the title, and a connection meter: one
  dash per stream the line allows, filled per stream in use, with "3 of 3
  streams". That is 013's "visually note their instance cap" as a glance,
  not a sentence.
- **Right:** the layout switch (Grid / Focus, with icons, shown only where
  both exist), the sound control (speaker, the sound tile's name, a volume
  slider), **Add channel** (primary; disabled at the cap with a tooltip
  naming the cap), and full screen.

Tiles never sit under the bar: the stage starts below it, so a revealed bar
covers black, not picture.

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

**The arithmetic** (prototyped in the mockups, `layout()`): every tile
16:9, gap `g`. For Focus with `k` small tiles stacked on the right, the big
tile's height is `k·sh + (k−1)·g`, so the group is
`(k+1)·sh·16/9 + g + (k−1)·g·16/9` wide by `k·sh + (k−1)·g` tall, and
`sh = min(fromWidth, fromHeight)`. Grid is the usual cell fit. The group is
centred in the stage. This is a pure function with unit tests: every rect is
16:9 within half a pixel, no two overlap, all sit inside the stage, and the
Focus big tile is exactly aligned with the stack's top and bottom.

### A tile (frames A, B, D)

**At rest:** the picture, a name chip bottom-left (logo and channel name,
translucent), and top-left either the **Sound** badge (the accent colour,
with three bars that move with the audio level) or a small muted speaker.

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
- **actions**, top-right: *Watch in player*, *Replace*, *Remove*. On a
  muted tile, a *Sound here* button joins them.

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

**Remove** is the tile's X or Delete on the current tile, and the grid
reflows. **Replace** swaps the stream in place: same slot, same sound state.

**Order.** Drag a tile onto another to swap them. Not in the first build
(see "What we are not doing").

The grid is **remembered**: leaving and coming back restores the channels
and the layout (decision M7). A remembered channel that no longer exists is
dropped quietly.

### Getting in and out

**In:**
- **Sports:** the board's Multi-view button (as now), and a game card gains
  a "Watch in multi-view" action, which opens with that game.
- **From the player:** a Multi-view button in the player's top-right, which
  opens with the channel you were watching as the first tile (frame E). The
  main player stops first, so its connection is free.
- **The Guide:** a channel gains an "Add to multi-view" action. Channels have
  no menu today (only folders do, `LiveScreen.tsx:183`), so this is the
  first; a right-click menu on a channel row is the natural home.

**Out:**
- Back or Escape (Escape closes the picker first, then full screen, then
  multi-view).
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
| F | full screen |
| Esc | picker, then full screen, then leave |

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

## Decisions for Adam

Each has a recommendation. One message can settle all of them.

| # | Question | Recommendation |
| --- | --- | --- |
| M1 | Immersive: multi-view takes the whole window, the app header gone, its own auto-hiding bar. | **Yes.** It is a way of watching, like the player, and every layout problem in the screenshots came from sharing the screen with the header. |
| M2 | In Focus, the sound tile is always the big one, and choosing another swaps it in. | **Yes.** It keeps 013's "one tile has the audio and the player controls" and gives the swap a reason to animate. Grid never moves tiles. |
| M3 | The picker: a centred, search-first palette over the grid, or a sheet from the side. | **Palette.** Fastest from the keyboard, the grid stays visible behind it, and it is the shape a channel search wants anywhere in the app (the ROADMAP's Live slate ranked a Ctrl+K channel search first). |
| M4 | At rest, each tile keeps a small name chip. | **Yes.** With four channels you need to know which is which without moving the pointer. Everything else fades. |
| M5 | Entry from the Guide and the player, not only Sports. | **Yes.** Tiles take any channel since v0.9.77; hiding it in Sports undersells it. |
| M6 | A tile can fill the window inside multi-view (double-click), as well as Watch in player. | **Both.** Filling is for "let me look at this play" and comes back instantly. Watch in player is for "I'm done with the grid". |
| M7 | Remember the grid between visits. | **Yes, across launches.** The channels are stable ids, and rebuilding a grid is the most tedious part of using one. |
| M8 | The grid size follows how many channels you add, instead of a 2 / 3 / 4 pick. | **Yes.** This changes a call you made in 013 ("people can decide to just watch two or 3 or 4"): you still decide, by adding and removing, but there are no empty boxes to fill and nothing is dropped when you change your mind. |

---

## Build order

Each phase ends green, with a check that fails without it (plan 016's rule),
and a version bump. The work is frontend unless marked.

**P1. The shell and the layouts.** The full-window layer, the top bar with
auto-hide, Back and Escape, full screen, and the layout engine as a pure
function. Tiles as they are today, placed by the engine.
*Proof:* `layout.test.ts` (16:9 within half a pixel, no overlap, in bounds,
Focus aligned; at 1400x900 and 1920x1080 and 1280x720). A new
`verify-multiview.mjs` under the IPC stub: nothing of the app header is
drawn, every tile's box is 16:9, nothing overlaps, Escape leaves.

**P2. The tile.** The rest and hover chrome, the Sound badge, the info (guide
now and next, game score), the states table with reasons from the proxy
and the codecs, and the tile actions.
*Proof:* harness checks per state, driven by the fake panel (a 404, a
never-answering stream, a slow one); the info against a fake guide.

**P3. Picking.** The palette (Dialog), the empty space, Replace and Remove,
count-follows-channels (M8), the grid remembered (M7). F12 and F14 go here.
*Proof:* add, replace, remove, a duplicate refused, the cap refused, the
grid restored after leaving and after a reload.

**P4. Sound and keys.** Sound follows the stream, not an index (F13), the
top-bar volume and mute, the level meter, the keyboard table.
*Proof:* sound stays on the same stream through a removal and a swap; every
key in the table does its thing.

**P5. Motion.** FLIP on layout changes, the swap into the big spot, enter
and leave, the picker, reduced motion. Checked in slow motion by eye, and by
a harness check that a reflow never re-creates a `<video>`.

**P6. The ways in and out.** Player, Guide and game-card entries, Watch in
player (stopping the grid first), fill-the-window, the popout stopped on
entry (F10), and the notice on Dialog (MV1).

**Alongside, native (a rebuild):** allow mpegts.js's worker in the CSP so
transmuxing leaves the main thread (audit perf 6 said this "is native"; the
freeze that made that a blocker is lifted). Measured before and after with
`btvMultiviewStats`.

## Risks

- **The guide for a channel** may be missing (1545 of 8459 channels in
  Adam's line carry an EPG id). A tile with no guide shows its name and
  number and no programme line, not "No information".
- **Four HD streams in WebView2** decode on the GPU; Adam's machine did three
  at 0 drops. Four is untested. P1's harness cannot measure this; Adam's run
  of `btvMultiviewStats` with four tiles is the check.
- **The picker's catalogue** is 26k channels. Search runs on pre-lowered
  names (audit perf 8), capped at 40 rows, so it stays under a frame.

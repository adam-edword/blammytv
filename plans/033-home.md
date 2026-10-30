# Plan 033: Home, behind the logo

Status: BUILT. Phase 1 in v1.0.26, phase 2 (live rows) in v1.0.35, phase 3 (Saved, Trakt, Needs a Source, Strand import) in v1.0.38. Trakt cards have no posters yet (Trakt sends none).

Open from phase 1: with no live source the mark isn't drawn (it divides the
live tabs from Stream's), so Home is reachable only through Start On. Mockup (v9):
https://claude.ai/artifact/8Aj6udrLVFGeZFSQSjRzyz

The logo in the middle of the nav opens Home: one page built from rows of
films and shows, live channels, games and recordings, in the order you set.
The rows are edited in Settings → Home. Layouts exported from Strand import.

## Decided (Adam)

- **Rows**, not blocks or sections or shelves.
- **The editor is its own Settings page, "Home"**, not in place on Home.
- **The logo's selected look is the BTV glow:** the brand conic gradient
  behind the mark, blurred 12px, at 40% opacity, with the hollow centre
  washed 20% black. On any other tab the glow is gone and the mark looks as
  it does today. The pill sits on no tab while you're on Home.
  Rejected: a ring, a dot, greying the mark on other tabs, 90% and 25% glow,
  a mask on the glow (it changed the outside).
- **Strand JSON import**, from Adam's sample export (below).
- From the Stream rows work (1.0.15), still standing: posters 240px, the
  title always shown and the meta on hover, the ambient colour. No glow on
  rows, no ranked numbers, no Wide movies.

## Calls made here (Adam can overrule)

- **Stream's own page doesn't change.** Home is the mix; Stream, Discover and
  Library stay the deep views. Until you edit Home, it's Stream's page plus
  the live rows.
- **Catalog rows can be switched off but not removed.** They come from your
  sources, and a removed one would only come back next launch. A catalog row
  that's new since Home was set up is added at the end, switched on.
- **Start On gains Home, but the default stays Live TV.** A changed default
  would move every user who never picked one.

## How it's built

### Home is a second root of StreamScreen

Everything a title needs (its page, sources, the resolve screen, the player,
Continue Watching's actions) lives in `StreamScreen`. Home renders inside it
as a second root page, `<StreamScreen root="home" />`, so a title opened from
Home opens there and Back returns to Home. No hand-off through
`openRequest.ts`, which would flip you to the Stream tab.

- `Home` (StreamScreen.tsx:2184) is split into row renderers, one per kind:
  the carousel, Continue Watching, Up Next (`UpNextRows`, `JfUpNextRow`), and
  a catalog row by id. Stream's page draws them in today's fixed order; Home
  draws them in the saved order. One renderer, two layouts, so the two can't
  drift. Stream's states (no sources, loading, error, all empty) stay as they
  are.
- Home's scroll position is kept under its own key, not Stream's
  (`readStreamScroll(configKey())`).

### The destination

- `Section` (AppHeader.tsx:56) gains `"home"`. The mark's button gets
  `data-dest="hub"` and goes Home, as well as spinning. `"home"` is already
  Stream's page key (`StreamTab`, `data-dest="home"`, every harness's
  `goTo(page, "home")`), so the new destination's key is `"hub"`. Renaming
  Stream's key would touch every harness for nothing a user sees.
- App renders `dest === "hub"` as `<StreamScreen root="home" />`. Pressing the
  mark while on Home goes back to Home's top, like pressing Stream on Stream
  (`onStreamHome`).
- The mark on Home: `aria-current="page"`, aria-label and Hint "Home"
  (was "BlammyTV"). `place()` hides the pill when no tab is current.
- The glow, from the mockup:

  ```css
  .navcap__mark--on { position: relative; overflow: visible; isolation: isolate; }
  .navcap__mark--on > b { position: relative; z-index: 1;
    background: radial-gradient(closest-side, rgb(0 0 0 / .2) 60%, transparent 100%); }
  .navcap__mark--on::before { content: ""; position: absolute; z-index: 0;
    left: 50%; top: 50%; width: 40px; height: 40px; margin: -20px 0 0 -20px;
    border-radius: 12px; pointer-events: none;
    background: conic-gradient(from var(--logo-angle, 146.36deg), var(--logo-stops));
    filter: blur(12px); opacity: .4; transition: opacity 260ms ease; }
  ```

  It fades out when you leave Home. The spin turns the glow with the mark,
  since both read `--logo-angle`. Under reduced motion the fade is 1ms, like
  the rest of the capsule.
- Start On (`startupTab.ts`): `"home"` joins `STARTUP_TABS` as "Home", first
  in the list, for Settings and onboarding alike. App's launch mapping and
  onboarding's `onFinish` both learn it.

### The layout store

`features/home/layout.ts`, key `homeRows`, version 1, through
`lib/storage`:

```ts
type HomeRow =
  | { id: string; kind: "carousel" | "continue" | "upnext"; on: boolean; title?: string }
  | { id: string; kind: "catalog"; on: boolean; title?: string }   // id = the catalog row's own id
  | { id: string; kind: "onnow" | "recent" | "games" | "recordings"; on: boolean; title?: string }
  | { id: string; kind: "saved"; list: string; on: boolean; title?: string }
  | { id: string; kind: "trakt"; list: "trending_movies" | "trending_shows" | "popular_movies" | "popular_shows"; on: boolean; title?: string }
  | { id: string; kind: "needs"; on: boolean; title: string; strand: unknown };
```

- `title` set means renamed; unset means the row's own name.
- Validated on load like every other store: unknown kinds are dropped, not
  trusted.
- **Seeding**, the first time Home is opened: the carousel (on or off to
  match Appearance's Featured Carousel switch, `showHero.ts`), Continue Watching, Up Next, On Now
  and Today's Games when there's a live source, then every catalog row in
  Stream's order.
- In the settings export and Ctrl+K (settingsIndex: "Home Rows", the page).

### Settings → Home

A sixth page in `SETTINGS_PAGES`, after Appearance. From the mockup:

- **Rows**, a list on `ui/Sortable.tsx` (drag by the handle, and the
  keyboard), the same as the playlist rows editor
  (`features/xtvod/RowsEditor.tsx`). Each row: handle, an editable title, its
  kind in grey, a switch, and a remove button. The carousel is pinned to the
  top and can only be switched. Continue Watching, Up Next and catalog rows
  can be switched off but not removed.
- **Add Row**: a sheet grouped Watching (Up Next, Saved), Live TV (On Now,
  Recent Channels, Recordings), Sports (Today's Games), Films & Shows
  (Trakt). Saved asks which Library list; Trakt asks which of its four.
  Rows that already exist and can only exist once are left out.
- **Import Layout** (phase 3).
- Changes show on Home behind Settings as they're made: the store fires a
  change event and Home listens, the way card details do
  (`onCardMetaChange`). Not the way the carousel switch works today, which
  only lands when Settings closes.

### The rows

| Row | Data | A click | Hidden on Home when |
| --- | --- | --- | --- |
| Carousel | today's `Hero` / `LargeHero`, with Carousel Style | as today | switched off, or no featured titles |
| Continue Watching | `watching` | as today | empty |
| Up Next | `UpNextRows`, `JfUpNextRow` | as today | empty |
| Catalog row | the AIOStreams, Jellyfin and playlist rows | the title's page | empty |
| On Now | `loadFavorites()`, now and next from the guide data, a progress bar | `requestWatchInPlayer(id)` | no live source, or no favourites |
| Recent Channels | `loadRecents()`, same cards | same | none yet |
| Today's Games | the Sports board's games for your leagues (`follows.ts`, `espn.ts fetchBoard`) | opens that game the way the Sports board does | no games today |
| Recordings | `recordings/store.ts`, newest first | `playRequest.ts`, the Library's Play | none |
| Saved | a Library list (`lists.ts`) | the title's page | the list is empty or gone |
| Trakt | `/movies/trending`, `/shows/trending`, `/movies/popular`, `/shows/popular` through `traktJson` | the title's page | not signed in to Trakt, or it fails |
| Needs a Source | (an imported row we can't fill) | none | always on Home; listed in the editor |

- A row with nothing in it isn't drawn on Home, the way Up Next works today.
  The editor says why under the row ("Star channels in the Guide to fill
  this row.", "Sign in to Trakt to fill this row.").
- Live rows reuse a channel card the app already has (the Guide's or
  Multi-view's picker), not a new one; the builder says which and why. Game
  cards are the Sports board's (`CompactCard` or `GameCard`).
- Trakt and Saved titles are Library entries (imdb id, title, kind, year);
  draw them the way `LibraryScreen` draws a list's titles.
- Home with every row off or empty: a StateCard, "Nothing on Home", with an
  "Edit Home" button that opens Settings → Home.

### Strand import (phase 3)

Strand exports its shelves as JSON:

```json
{"id":"…","isEnabled":true,"sortOrder":0,"source":{"continueWatching":{}},"style":"row_classic","title":"Continue Watching"}
```

Adam's sample (scratchpad `home/strand-sample.json`) has `continueWatching`,
`localWatchlist` and four `traktBuiltIn` values. Mapped:

- `continueWatching` → Continue Watching (already there, so it isn't added;
  `isEnabled: false` switches ours off);
- `localWatchlist` → Saved, on the Trakt watchlist's list (`TRAKT_LIST`)
  when there is one, else the Library's first list;
- `traktBuiltIn` `trending_movies`, `trending_shows`, `popular_movies`,
  `popular_shows` → the Trakt row with that list;
- anything else → a Needs a Source row that keeps Strand's JSON, so a later
  version can fill it. Only the sample's kinds are mapped: we haven't seen
  the shape of Strand's other sources.

`sortOrder` sets the order, `title` the title and `isEnabled` the switch.
`style` is ignored (we have one). Imported rows go after the existing ones.

The dialog: a box to paste into, an "Add Rows" button, and a line saying
how many were added. Text that isn't a Strand layout gets an error under
the box: "This isn't a layout exported from Strand."

## Phases

1. **The frame.** The hub destination, the glow, StreamScreen's second root
   with the row renderers split out, the layout store and its seeding,
   Settings → Home (list, rename, switch, reorder, remove, Add Row for the
   kinds this phase has), Start On, the export and Ctrl+K. Rows: carousel,
   Continue Watching, Up Next, catalog rows.
2. **Live rows.** On Now, Recent Channels, Today's Games, Recordings.
3. **Lists and import.** Saved, Trakt, Needs a Source, Import Layout.

Each phase ships on its own.

## Checks

- Unit: `layout.ts` (validation drops unknown kinds, seeding, a new catalog
  row appended once), the Strand mapper against the sample, `startupTab`.
- Harness `verify-home.mjs`:
  - the mark goes to Home: `data-screen="hub"`, `aria-current`, the glow's
    opacity at .4, no tab current and the pill hidden; another tab takes the
    glow away;
  - the seeded order on a fresh profile;
  - Settings → Home: reorder, rename, switch off and remove each land on
    Home without closing Settings;
  - a title opened from Home and Back returns to Home, at its scroll;
  - Start On Home launches on Home;
  - phase 2: On Now's cards and a click tuning the channel; phase 3: the
    sample imports to the right rows, and junk shows the error.
- Stream's page doesn't move: verify-stream, verify-shero, verify-lhero,
  verify-streamrows and verify-cw-sources stay green, unchanged.
- Mutations: a switched-off row still drawn must fail; the glow left on
  another tab must fail; a catalog row appended twice must fail.

## Can't check here

- How the glow reads on Adam's screen next to the real capsule (it was signed
  off in the mockup).
- Trakt's trending and popular against the real API: the harness uses a fake.
- Strand sources other than the sample's.

## Size

L. Phase 1 is the bulk (the StreamScreen split and the editor); phases 2 and
3 are a batch each.

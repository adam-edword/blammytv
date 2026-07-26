# 009: Library: multiple lists, and a home for everything you've watched

- **Status**: COMPLETE. All five phases shipped: data layer + migration,
  Library screen, list management, save affordance, polish. The visible half
  of 0.8.0 (plan 008 is the plumbing).
- **Severity**: MEDIUM (feature, not a defect)
- **Category**: Stream section / saved content
- **Estimated scope**: new data layer + migration, one screen rebuilt with a
  drill-down, a changed save affordance on the detail screen, cover images.
- **Decided with Adam, 2026-07-24**: Library is BOTH a row and a grid card;
  the save button adds to a default list with a picker for the rest; the
  Stream tab KEEPS its Continue Watching row; the tab is renamed "Library".

## Problem

"My List" is one flat list (`myList.ts`, a `ListEntry[]` under a single
key) rendered as one grid. Two things are missing:

- **You cannot organise anything.** Everything saved lands in the same pile,
  so the feature stops being useful at about thirty titles.
- **Watch history has no home.** `watching.ts` records everything you have
  started, but the only way to see it is the Continue Watching row on Stream
  home, which is capped by the row-cap setting. Anything that falls off the
  end is effectively lost even though the app still knows about it.

## Target

The tab becomes **Library**, laid out like Discover: a row section on top, a
grid below. Discover puts genres in the row and titles in the grid; Library
puts Continue Watching in the row and **your lists** in the grid.

```
┌───────────────────────────────────────────────┐
│  Continue Watching                            │
│  [card] [card] [card] [card] →                │  ← the row (recent)
├───────────────────────────────────────────────┤
│  Your lists                                   │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐  │
│  │Library │ │ Anime  │ │Comfort │ │   +    │  │  ← the grid (collections)
│  └────────┘ └────────┘ └────────┘ └────────┘  │
└───────────────────────────────────────────────┘
```

- **The row** is recent Continue Watching, same cards and same
  hold-to-clear as Stream home. Stream home keeps its row too: it is the
  fast path back into something, and removing it would cost a click for the
  most common action in the app.
- **The Library card** is built in and cannot be deleted. It opens
  **everything** you have started, uncapped, which is the part the row
  cannot show.
- **List cards** open that list's contents. Cover art is the first entry's
  poster, or an image you upload.
- Clicking any card drills into a grid of its contents with a Back control.

## Data model

Today's single list is one key holding a flat array. The new shape keeps
`ListEntry` exactly as-is (it is a good card-shaped snapshot) and wraps it:

```ts
interface UserList {
  id: string;        // stable; generated once, never derived from the name
  name: string;
  cover?: string;    // data URL, bounded (see below). Absent = derive art.
  at: number;        // created-at, the grid's default order
  entries: ListEntry[];
}
```

**Migration is the load-bearing part.** Existing users have saved titles
under the old key and must not lose them. On first read of the new store:
if no lists exist and the old `myList` key has entries, create one list
named "My List" containing them, in order. **The old key is left in place,
not deleted**, so a downgrade still finds its data and so a botched
migration is recoverable. It is simply ignored afterwards.

There is always at least one list. If a user deletes every list, the next
save recreates a default rather than failing.

## Cover images

Uploaded via a plain `<input type="file">`, which needs no new Tauri plugin
and no Rust at all. The file is **downscaled through a canvas to a bounded
thumbnail** (target ~320px on the long edge, JPEG) before storage, so a 4MB
photo becomes tens of KB.

Stored as a data URL **inside the list record**, in localStorage. The
alternative is IndexedDB, which has a far larger quota, but it makes every
cover an async load and adds a second store to keep consistent. At a bounded
~40KB per cover, twenty lists is under 1MB, which localStorage carries
comfortably alongside the app's other small config. **If that ceiling is
ever hit, moving covers to IndexedDB is a contained change** and this
paragraph is the note explaining why it was not done first.

Guard the write: if `save` throws (quota), keep the list and drop the cover
rather than losing the list.

## Save affordance

The detail screen's "+ My List" becomes a split control: **clicking adds to
the default list**, and a chevron opens a picker with every list plus "New
list…". The label reflects membership ("In Anime", "In 2 lists").

This is the part that touches the most existing surface: the button appears
on the detail screen and the saved-state feeds the card badges. Keep
`inMyList(id)` working as "is it in ANY list" so nothing that only asks the
yes/no question has to change.

## Phases

1. **Data layer + migration.** `lists.ts` beside `myList.ts`, tests for the
   migration first (that is the part that can lose user data). `myList.ts`
   keeps its exported API as a thin shim over the default list so nothing
   else breaks in the same commit.
2. **Library screen.** Row + grid + drill-down, reusing Discover's layout
   language and the existing Card and RowScroller.
3. **List management.** Create, rename, delete, set cover. Reuse the Live
   sidebar's portaled context-menu pattern rather than inventing one.
4. **Save affordance.** Split button and picker on the detail screen. The
   main half saves to the default list; with the title already in exactly
   one list it removes it, and in two or more it opens the picker rather
   than wiping it out of all of them on one click.
5. **Polish.** Empty states (no lists, empty list, empty history), the "+"
   card, and the reduced-motion pass on anything new. The built-in Library
   card only appears once there IS history: a card reading "0 titles" is a
   dead end, and the first-run note above the grid says what the page is
   for instead.

## Risks

- **Data loss on migration is the only irreversible failure here.** Tests
  before implementation, and the old key is never deleted.
- **The row and Stream home's row must stay one implementation.** They are
  the same cards with the same hold-to-clear; duplicating them means fixing
  every future card bug twice.
- **`toggleMyList` currently returns a boolean** and is called from the
  detail screen and the cards. Widening it to multi-list must not silently
  change what those call sites mean.
- Cover upload is user-supplied image data rendered in the app. It is a data
  URL in an `<img>`, so there is no script execution path, but do not ever
  interpolate it into CSS or markup as a raw string.
- The grid holds two card TYPES (a list, and the built-in Library). Give
  them one component with a variant, not two that drift.

## Verification

- A user with saved titles upgrades and finds them all in "My List", in the
  same order. **Test this before anything else works.**
- Deleting every list, then saving a title, produces a usable default.
- A list with no entries and no cover still renders a sensible card.
- Library shows titles the capped Stream row does not.
- Cover upload survives a restart; a huge image does not blow the quota.
- Continue Watching still works identically on Stream home.

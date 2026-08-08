# 011: Live TV needs a home screen

**Status: DESIGN, not started.** Written 2026-08-08 off the back of a look at
Desktop Telly. Nothing is built. There are three open questions at the bottom
that want answering before code, and one of them wants a number only Adam's
machine can produce.

## The problem, stated precisely

Live TV's default view is **every channel from every source, in provider
order**. `LiveScreen.tsx:249` starts `folder` at `null`, and the playlist
branch reads a null folder as "no filter":

```tsx
return channels
  .filter((c) => !folder || c.folderId === folder)   // LiveScreen.tsx:583
  .map(attach);
```

So the first thing on screen is whatever the provider happened to list first.
On a real Xtream playlist that is something like `Big Brother | Time Tri…`,
followed by ten thousand more in an order nobody chose.

**It is not a rendering problem.** The guide is properly virtualised —
`channels.slice(renderFrom, renderTo)` over a 36-row window plus overscan
(`Guide.tsx:278-294`) — so the DOM cost of "all channels" is bounded. Do not
plan around perf here; the complaint is that the first screen is arbitrary,
not that it is slow.

Two smaller gaps found alongside it:

- **Nothing persists.** `mode` and `folder` are both plain `useState`
  (`LiveScreen.tsx:246,249`), so every visit to Live TV resets to the
  firehose even for someone who only ever watches one category.
- **No per-folder counts.** `LiveFolder` is `{ id, name }` (`model.ts:43-46`).
  Telly shows a count per category and it makes the sidebar scannable.

## What Telly does, and why we should not copy it

Telly leaves the whole content area empty until you pick a category:
*"Select a category from the sidebar to browse channels."*

That is honest, and it is the cheapest possible fix. It is also a dead launch
screen. Telly needs it **because it has no memory** — with nothing to
personalise, an empty prompt beats an arbitrary list. We can do better by
having memory, and then we never need the empty state at all.

## The shape: a Live home of rows

Live TV becomes two screens, not one:

- **Home** — the landing view. Rows of channel cards, the layout Stream,
  Discover and Library already use.
- **Guide** — the existing EPG grid, reached by picking a category, a row
  header, or the mode rail.

This is the same move plan 009 made for the Library ("Discover's shape, with
Continue Watching where the genre row sits"). One house pattern, three
features.

### Candidate rows, in order

1. **Continue watching** — from `recents.ts`. Most recently tuned first.
   This is the row that makes the screen worth landing on.
2. **Favourites** — from `favorites.ts`, in the user's hand-sorted order
   (the same order `mode === "favorites"` already renders).
3. **On now** — channels whose current programme is worth surfacing.
   **Gated on question 1 below.**
4. **A row per category**, biggest first, capped — each row's header opens
   the guide filtered to that folder.

### What a channel card looks like

Not the Stream poster card: those are 2:3 portrait, and channel art is a wide
logo on a dark plate. Closer to the sports `GameCard` proportions. Per card:

- the channel logo (`Channel.logo`), with the name as fallback — a lot of
  playlists have no logo, so the fallback is not an edge case
- the current programme title and a progress bar, when EPG exists for it
  (`epg.ts#progress` already computes exactly this for the hero)
- the quality badge (`Channel.quality`) and channel number when present

### Handoff into the guide

- Clicking a **card** tunes it, same as clicking a guide lane today.
- Clicking a **row header** opens the guide filtered to that folder.
- The mode rail keeps Playlist / Favorites / Recents; Home becomes the
  fourth, and the default.

## What already exists to build on

| Piece | Where | Note |
|---|---|---|
| `RowScroller` | `StreamScreen.tsx:1720` (exported) | One tab stop per row, arrow keys, edge arrows. Reusable as-is. |
| `favorites` / `recents` | `live/favorites.ts`, `live/recents.ts` | Plain id lists; already resolved against loaded channels in `LiveScreen.tsx:570-582`. |
| `epg.progress()` | `live/epg.ts:50` | Programme progress, already used by the hero. |
| `programmes` map | `LiveData` | `Map<channelId, Programme[]>`, keyed the same way `visible` uses it. |
| Channel model | `live/model.ts:10-33` | logo, quality, number, folderId all present. |

## Open questions — answer before building

**1. What is the real EPG coverage?** The "On now" row only works if a decent
fraction of channels have a current programme; if coverage is 5%, that row is
mostly blank cards and should be cut. The number is **already logged on every
load** — `source.ts:415-421` prints:

```
[live] <name>: EPG coverage — N channels, M carry an epg id,
       guide declares G, P matched
```

Adam: open devtools on a normal launch and paste that line. `P / N` decides
whether row 3 exists. This cannot be measured in the container — there is no
real playlist here.

**2. Does Home replace the guide as the default, or sit beside it?** Two
readings, materially different work:
   - *Home is the landing screen*, guide is a drill-down. Strongest answer,
     but it means the EPG grid — the thing Live TV currently IS — becomes a
     secondary view, and anyone who lives in the guide now has an extra click.
   - *Home is a fourth mode* on the existing rail, defaulted to. Cheaper,
     fully reversible, and a guide-dweller just picks Playlist once… except
     nothing persists today, so "picks it once" is currently a lie. Fixing
     persistence is a prerequisite either way.

**3. How many category rows, and which?** Biggest-first is the obvious
default and is probably wrong — on the screenshot playlist that leads with
SiriusXM (441) and Amazon Prime (745), neither of which is live TV in any
meaningful sense. Options: biggest-first, a fixed cap with "browse all" at
the end, or let the user pin categories to Home. Wants a real playlist to
judge.

## Prerequisites, worth doing regardless

These stand on their own and are much smaller than the home screen. If the
home screen stalls on the questions above, these still fix most of the
complaint:

- **Persist `mode` and `folder`** across sessions. Land where you left.
- **First-run fallback** for a user with no history: Favourites → Recents →
  all, so the firehose is only ever a brand-new user's first screen.
- **Per-folder channel counts** in the sidebar. Needs a count on
  `LiveFolder`, or a derived `Map<folderId, number>` computed once with the
  channel list.

## Rig

There is **no live harness** — `apps/app/harness/` has sports, golf, race and
theater, but nothing for Live TV. A `live.html` with a fixture playlist (a few
hundred channels across a dozen folders, some with EPG and some without) is a
prerequisite for building this headlessly, and would pay for itself on the
guide too. The fixture must include channels with **no logo and no EPG**,
because that is the common case on a real playlist and it is the case a
pretty mock will hide.

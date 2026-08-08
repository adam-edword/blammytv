---
title: Stream & VOD
description: Browsing and playing movies and shows through AIOStreams.
---

The **Stream** tab is movies and shows, served by your own
[AIOStreams](/sources/aiostreams/) instance. It has three views on the rail:
**Home**, **Discover** and **Library**.

## Home

Rows of posters, one per browsable catalog your addon exposes, with a featured
hero at the top.

- **Catalog Row Size** (Settings) controls how many titles each row holds;
  40 by default.
- **Hero Sources** (Settings) pins which catalogs the hero draws from. Leave it
  empty for the default mix.
- Rows load independently, so one failing catalog goes missing rather than
  taking the page down with it.

## Discover

Search across your catalogs. Same cards, same behaviour — this is the view to
use when you know what you want.

## Opening a title

Clicking a card opens its detail page: artwork, synopsis, and the list of
**sources** the addon resolved for it. Pick one to play.

**One-click play** (Settings, off by default) changes this for *movies*: a
click starts the best already-resolved source immediately instead of opening
the page. Series always open their page, because there is no single obvious
thing to play. If nothing is resolved yet, the click falls back to the detail
page rather than appearing to do nothing.

The **Sources** button is also on Continue Watching cards, and on the card's
title — so you can jump straight back into the source list for something you
are part-way through without opening it first.

## The player

Same player as [Live TV](/using/live-tv/), and the [same keyboard
shortcuts](/using/live-tv/#keyboard-shortcuts), with two differences that
matter for VOD:

- **A scrubber**, because there is something to seek through.
- **`Escape` toggles theater and fullscreen** rather than stepping down and
  out. The ✕ is the only way out of the player. Live TV keeps the ladder; VOD
  does not, so a stray keypress can't dump you out of a film.

### Continuity between episodes

Your last **explicit** choices — audio language, subtitle language, playback
speed — carry to the next thing you play. They are matched by language, not by
track number, because track numbering is per-file and means nothing across
episodes.

Only real choices count. Playing an episode that happens to default to a
different track does not silently become your new preference.

Volume and mute are separate: those ride every playback, live included.

## When a source dies mid-play

By default, nothing happens automatically — the card offers **Try next
available source** and waits for you.

Turn on **Auto source-failover** in Settings if you would rather it jump to
the next source by itself. It is off by default deliberately: an automatic
jump burns through your resolved sources without asking, which is the wrong
default when a stream stalls for a moment and would have recovered.

---
title: Live TV
description: The channel guide, favourites, the player and its keyboard shortcuts.
---

The Live TV tab is a programme guide over every channel your
[playlists](/sources/) supply. Pick a channel to tune it; the player opens over
the guide.

## The sidebar

Three modes, on the rail at the left:

- **Playlist** — your categories, as your sources organise them
- **Favorites** — channels you have starred, in the order you arranged them
- **Recents** — what you have tuned lately, newest first

Below the mode rail, Xtream sources show a **connection badge** — `2/5` means
two active streams against a cap of five. See [Connection
limits](/troubleshooting/connections/).

:::note[The default view is everything]
With no category selected, the guide shows every channel from every enabled
source, in provider order. On a large playlist that means the first thing you
see is whatever your provider happened to list first. Hiding the categories
you never watch (per source, in Settings) is the fastest way to make this
screen yours.
:::

## The guide

A standard EPG grid: channels down the side, time across the top. It renders
only the rows in view, so a hundred-thousand-channel playlist scrolls at the
same speed as a small one.

Channels with no programme data show **No Information** lanes. That is a
property of your source, not a fault — see [Sources](/sources/) for which
kinds carry a guide.

The guide often arrives a moment after the channels do. It is the largest
download of the load, so the channel list paints first and the programmes fill
in when they land.

## The player

Playback opens in a **mini** window over the guide, and expands to **theater**
and then **fullscreen**. Live TV keeps a ladder on `Escape`: close the menu,
then leave fullscreen, then collapse back to mini.

Press <kbd>i</kbd> in theater or fullscreen for a stats overlay — what mpv is
actually doing, which is the fastest way to tell a dead source from a slow one.

## Keyboard shortcuts

These work whether the player has focus or the guide does.

| Key | Does |
|---|---|
| <kbd>Space</kbd> / <kbd>K</kbd> | Play / pause |
| <kbd>M</kbd> | Mute |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Volume up / down (5% a step; <kbd>↑</kbd> also unmutes) |
| <kbd>←</kbd> / <kbd>→</kbd> | Back / forward 5 seconds |
| <kbd>J</kbd> / <kbd>L</kbd> | Back / forward 10 seconds |
| <kbd>F</kbd> | Fullscreen |
| <kbd>T</kbd> | Theater — expands from mini, collapses from theater |
| <kbd>I</kbd> | Stats overlay (theater and fullscreen only) |
| <kbd>Esc</kbd> | Step back down: menu → fullscreen → mini |

Volume and mute persist across everything you play, including the Stream tab.

## Favourites and recents

Star a channel to put it in **Favorites**, where you can arrange it by hand —
that order is yours and is not re-sorted. **Recents** is maintained
automatically.

Both survive restarts. Neither leaves your machine.

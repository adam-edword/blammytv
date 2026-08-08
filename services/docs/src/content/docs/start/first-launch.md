---
title: First launch
description: What the setup flow asks for, and what you can skip.
---

The first time you open BlammyTV it runs a short setup. Five questions, and
you can leave any of them for later. Nothing here is permanent, and all of it
lives in **Settings** afterwards.

## 1. Your streams

The AIOStreams manifest URL that powers the **Stream** tab, which is movies
and shows. Paste it and BlammyTV will test it before accepting it.

Skip this if you only want live TV. See [AIOStreams](/sources/aiostreams/).

## 2. Your live TV

A playlist for the channel guide. Pick the kind you have (**Xtream**, **M3U**,
or **Stalker/MAG**) and fill in the fields for it.

Skip this if you only want movies and shows. See [Sources](/sources/).

:::note[Setup verifies, it doesn't just collect]
Both source steps run a real connection when you press Continue, using the
same machinery the app uses in anger rather than a URL format check. If it
fails you get the actual reason and a **Continue anyway** button.
Verification never blocks setup, so a provider that's down for ten minutes
can't lock you out of your own app.
:::

## 3. Accent colour and clock

Cosmetic. Pick an accent from the presets and choose 12- or 24-hour time. Both
are changeable any time in **Settings → Customize**.

## 4. Which tab to open on

Where BlammyTV lands when you start it: **Live TV**, **Stream · Home**, or
**Stream · Discover**. The default is Live TV.

Set this honestly rather than aspirationally. It's the screen you'll see every
single launch.

## 5. Done

A map of the tabs, and a nudge towards Settings. That's it.

## After setup

If you skipped a source, add it in **Settings → Playlists** for live TV, or
**Settings → AIOStreams** for movies and shows. The Playlists tab has the same
form the setup flow used. The AIOStreams tab adds a **Connection Test** that
reports which endpoint failed rather than just that something did.

## Where to go next

- [Sources](/sources/), what each playlist kind needs
- [Live TV](/using/live-tv/), the guide, favourites and the player
- [Stream & VOD](/using/stream/), browsing movies and shows
- [Themes](/using/themes/), nine looks, five of them free

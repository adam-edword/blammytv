---
title: First launch
description: What the setup flow asks for, and what you can skip.
---

The first time you open BlammyTV it runs a short setup. Five questions and a
short tour. Skip any of them: it's all in **Settings** later.

## 1. Sign in to AIOStreams

Type your AIOStreams address, like `aiostreams.example.com`, and press
**Continue**. BlammyTV shows a 6-digit code. Press **Open AIOStreams**, then on
your configure page choose **Save & Install**, **Jellyfin apps**, **Connect**,
and enter the code. BlammyTV notices on its own and moves on. This powers the
**Stream** tab, which is movies and shows. Once you're in, any app signed in
to your AIOStreams picks up where you left off.

If your instance has its Jellyfin side off, press **Use a Manifest URL
Instead** and paste your manifest URL. BlammyTV will test it before accepting
it.

Skip this if you only want live TV. See [AIOStreams](/sources/aiostreams/).

## 2. Your live TV

A playlist for the channel guide. Pick the kind you have (**Xtream**, **M3U**,
or **Stalker/MAG**) and fill in the fields for it.

Skip this if you only want movies and shows. See [Sources](/sources/).

:::note[Setup tests each source]
The source steps run a real connection when you press Continue, using the
same connection the app makes. If it fails you get the reason and a
**Continue Anyway** button.
:::

## 3. Follow what you watch

Optional. **Connect** Trakt, MyAnimeList, or both, and they keep track of what
you watch here and bring back what you watched elsewhere. Each has its own
button, and **Continue** is always there. You can connect them later in
**Settings → Accounts**.

## 4. Accent colour and clock

Cosmetic. Pick an accent from the presets and choose 12- or 24-hour time. Both
are changeable any time in **Settings → Appearance**.

## 5. Which tab to open on

Where BlammyTV lands when you start it: **Live TV**, **Stream**, or
**Stream · Discover**. The default is Live TV.

Pick the one you use most. You'll see it every launch.

## A few things to find

Three lines on **Multi-View**, **Discover** and **Sports**, so you know they're
there.

## Done

A pointer to Settings.

## After setup

If you skipped a source, add it in **Settings → Sources**: **Live
TV** for a playlist, **Stream** for movies and shows. The Live TV pane has the
same form the setup flow used. The Stream pane has the same sign-in, and adds
a **Connection Test** that reports which request failed.

## Where to go next

- [Sources](/sources/), what each playlist kind needs
- [Live TV](/using/live-tv/), the guide, favorites and the player
- [Stream & VOD](/using/stream/), browsing movies and shows
- [Themes](/using/themes/), your accent colour and light or dark

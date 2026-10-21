---
title: Xtream Codes
description: Connect an Xtream Codes panel for live TV, an EPG, connection limits, and its movies and shows.
---

Xtream is the richest of the live TV source kinds. It carries a channel list,
categories, a programme guide, and a connection count the app can read and
show you.

## What you need

Three things, from whoever supplies your service.

| Field | Looks like |
|---|---|
| **Server URL** | `http://example.com:8080` |
| **Username** | your panel username |
| **Password** | your panel password |

Add it under **Settings → Sources → Live TV → Xtream**, or during
[first launch](/start/first-launch/). Leaving the name blank is fine. You get
a numbered default like "Xtream Playlist 2".

The server field wants the panel's base address. If your provider gave you a
long `get.php?username=…` URL, that's an [M3U link](/sources/m3u/), not an
Xtream server. Either add it as an M3U source, or pull the host, username and
password out of it and use those here.

## What you get

- **Channels and categories**, as the panel organises them.
- **A programme guide**, downloaded separately from the channel list. It's the
  largest download of the three and often lands a few seconds after the
  channels appear. Empty lanes read "No Information" until it does. It's
  downloaded once every 12 hours, not on every launch, while the channel list
  still reloads each time. **Refresh Now**, under your playlists in
  **Settings → Sources**, fetches a fresh one sooner.
- **Connection limits** in the sidebar. See
  [Connection limits](/troubleshooting/connections/).
- **Its movies and shows**, if your panel has them. See below.

## Movies and shows

If your provider's panel carries movies and shows, they can be rows in the
[Stream](/using/stream/) tab. Nothing shows up until you pick the folders you
want, so a panel with hundreds of folders doesn't flood the page.

- **Pick your folders.** With no other movie source set up, the Stream tab
  opens on **Choose Folders**: your provider's folders as cards. Pick the
  ones you want, then **Show Rows**. If you already use AIOStreams or
  Jellyfin, the **Add Rows from Your Playlist** button at the bottom of
  Stream opens the same list, and **Done** puts your picks on the page.
- **Change them later** in **Settings → Sources → Live TV**, under
  **Movies and Shows**. **Your Rows** are the folders you show, in the order
  they appear: drag one to move its row. **More Folders** has the rest.
  **Save** puts your changes on the Stream page.
- **Turn it off.** The **Show in Stream and Discover** switch beside the
  playlist's name takes its movies and shows out of Stream and Discover.
  Live TV isn't touched.
- **Discover** gets each playlist's movies and its shows, newest first, and
  its search looks through every folder, picked or not.
- **A title opens like any other**, with each copy your panel has (4K, HD)
  listed as a source, the best first. Shows list their seasons and episodes.
  Everything plays straight from your provider.

Only Xtream playlists get movies and shows. M3U and Stalker sources stay
live TV only.

## Categories you don't want

Every source has a per-category visibility list. Open the source's folder
editor and switch off the categories you never watch. They disappear from the
Live TV sidebar without touching the rest of the playlist. There's a bulk
toggle for acting on a whole search at once.

Do this on a large playlist. Providers routinely ship tens of thousands of
channels across hundreds of categories, and the guide shows all of them in
provider order until you say otherwise.

## If it fails to connect

The setup flow and Settings → Sources both report the real error. The common
ones:

- **Wrong server format.** It needs a scheme and usually a port:
  `http://host:8080`, not `host` on its own.
- **Sign-in refused.** Username or password wrong, or the account is expired.
- **Connection limit reached.** A panel at its cap refuses a new session,
  which reads as a sign-in failure. See
  [Connection limits](/troubleshooting/connections/).

## A note on the container extension

Live streams are requested with a container extension. The app defaults to
`ts`, which is what nearly every Xtream panel serves. A small number use
`m3u8` instead. If channels resolve but nothing ever plays, that's a plausible
culprit: the channel list is fine, and the stream URL is being built with the
wrong extension.

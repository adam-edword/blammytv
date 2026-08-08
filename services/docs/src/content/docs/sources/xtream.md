---
title: Xtream Codes
description: Connect an Xtream Codes panel for live TV, an EPG and connection limits.
---

Xtream is the richest of the live TV source kinds: it carries a channel list,
categories, a programme guide, and — uniquely — a connection count the app can
read and show you.

## What you need

Three things, from whoever supplies your service:

| Field | Looks like |
|---|---|
| **Server URL** | `http://example.com:8080` |
| **Username** | your panel username |
| **Password** | your panel password |

Add it under **Settings → Playlists → Xtream**, or during
[first launch](/start/first-launch/). Leaving the name blank is fine — you get
a numbered default like "Xtream Playlist 2".

The server field wants the panel's base address. If your provider gave you a
long `get.php?username=…` URL, that is an [M3U link](/sources/m3u/), not an
Xtream server — either add it as an M3U source, or pull the host, username and
password out of it and use those here.

## What you get

- **Channels and categories**, as the panel organises them
- **A programme guide**, downloaded separately from the channel list — it is
  the largest download of the three and often lands a few seconds after the
  channels appear. Empty lanes read "No Information" until it does.
- **Connection limits** in the sidebar. See
  [Connection limits](/troubleshooting/connections/).

## Categories you don't want

Every source has a per-category visibility list. Open the source's folder
editor and switch off the categories you never watch — they disappear from the
Live TV sidebar without touching the rest of the playlist. There is a bulk
toggle for acting on a whole search at once.

This is worth doing on a large playlist. Providers routinely ship tens of
thousands of channels across hundreds of categories, and the guide shows all
of them in provider order until you tell it otherwise.

## If it fails to connect

The setup flow and the Playlists tab both report the real error. The common
ones:

- **Wrong server format.** It needs a scheme and, usually, a port —
  `http://host:8080`, not `host` on its own.
- **Sign-in refused.** Username or password wrong, or the account is expired.
- **Connection limit reached.** The panel will refuse a new session when you
  are already at your cap, which reads as a sign-in failure. See
  [Connection limits](/troubleshooting/connections/).

## A note on the container extension

Live streams are requested with a container extension, and the app defaults to
`ts`, which is what nearly every Xtream panel serves. A small number use
`m3u8` instead. If channels resolve but nothing ever plays, this is a
plausible culprit — the channel list is fine, the stream URL is being built
with the wrong extension.

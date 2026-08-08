---
title: M3U playlists
description: Add a plain M3U playlist by URL.
---

The simplest live TV source: a playlist file served over HTTP. If your
provider handed you a single long link ending in `get.php?…` or `.m3u`, this
is the kind you want.

## What you need

One field, the **playlist URL**. Add it under **Settings → Playlists → M3U**.

BlammyTV downloads the playlist and reads it in place. There's no separate
sign-in step, because an M3U has no API to sign in to. Whatever credentials
your provider needs are already baked into the URL, which is why that URL
should be treated as a password.

## What you get

- **Channels**, in playlist order.
- **Categories**, taken from each entry's group, in the order they first
  appear in the file.
- **Logos and channel names**, where the playlist supplies them.

## What you don't get

- **No connection count.** An M3U is a static file. No endpoint reports how
  many streams you have open, so the sidebar shows no badge rather than a
  made-up number.
- **A guide only if the playlist carries one.** M3U entries can reference EPG
  ids, but the file itself isn't a guide. Channels with no programme data show
  "No Information" lanes. That's a property of the playlist, not a fault.

## If it fails

- **The download failed.** The URL is wrong, expired, or the host is refusing
  you. Providers regenerate these links often, so re-copy it from wherever you
  got it.
- **It downloaded but produced nothing.** The file isn't an M3U, or it's an
  error page served with a 200 status. Some providers return HTML explaining
  that your subscription lapsed instead of an HTTP error.
- **Huge playlists take a while.** A six-figure channel list is a real
  download followed by a real parse. It isn't stuck. Watch the loading label,
  which names the stage it's on.

Hide the categories you never watch once it loads. See the note on
[Xtream](/sources/xtream/#categories-you-dont-want), which works the same way
for every source kind.

---
title: Where your data goes
description: BlammyTV talks to your providers directly. There is no BlammyTV server in the path.
---

BlammyTV asks you for provider credentials, so it's fair to ask what it does
with them. Short answer: they stay on your machine, and every request goes
straight from your machine to the provider you configured.

## The whole path

```
your machine                              the internet
─────────────                             ────────────
BlammyTV  ──── channel list, EPG ───────▶  your Xtream panel
          ──── catalogue, streams ──────▶  your AIOStreams instance
          ──── video ────────────────────▶ whatever host those two hand back

          ──── update check ────────────▶  github.com (release manifests)
```

That's the complete list of hosts BlammyTV contacts. There's no BlammyTV
account, no telemetry endpoint, no analytics, and no proxy in front of your
provider. If your panel is down, the app is down with it. Nothing sits in
between that could have cached it.

## What is stored, and where

Settings and credentials live in the app's local WebView2 profile under your
Windows user account, alongside the rest of BlammyTV's per-user data in
`%LOCALAPPDATA%`. Uninstalling removes the app. Clearing that folder removes
the settings.

:::caution[Credentials are stored in the clear]
Playlist passwords, portal MAC addresses and your AIOStreams URL are saved as
plain text, not encrypted. Anything running as your Windows user can read
them. That's the same posture as most desktop IPTV clients, but you should
know rather than assume otherwise. If your machine is shared, your provider
credentials are shared.
:::

## Playback

Video is decoded and rendered locally by [mpv](https://mpv.io/), loaded at
runtime from `libmpv-2.dll` next to the executable. Hardware decoding is on by
default and falls back to software when the GPU can't handle a codec. Streams
are pulled by mpv directly from the URL your provider returned. The app
doesn't re-encode, re-host or relay anything.

## What BlammyTV does not do

- It doesn't host, index or supply any content.
- It doesn't send your credentials, viewing history or playlists anywhere.
- It doesn't phone home. The only outbound request the app makes on its own
  behalf is the update check against GitHub.

## Related

- [Why Windows flagged it](/how-it-works/defender/), the unsigned-binary story
- [Updates](/how-it-works/updates/), how a package is verified before it applies

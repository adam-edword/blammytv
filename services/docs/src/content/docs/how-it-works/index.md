---
title: Where your data goes
description: BlammyTV talks to your providers directly. There is no BlammyTV server in the path.
---

BlammyTV asks you for provider credentials, so the fair question is what it
does with them. The short version: they stay on your machine, and every
request goes straight from your machine to the provider you configured.

## The whole path

```
your machine                              the internet
─────────────                             ────────────
BlammyTV  ──── channel list, EPG ───────▶  your Xtream panel
          ──── catalogue, streams ──────▶  your AIOStreams instance
          ──── video ────────────────────▶ whatever host those two hand back

          ──── update check ────────────▶  github.com (release manifests)
```

That is the complete list of hosts BlammyTV contacts. There is no BlammyTV
account, no telemetry endpoint, no analytics, and no proxy in front of your
provider. If your panel is down, the app is down with it — there is nothing
in between that could have cached it.

## What is stored, and where

Settings and credentials live in the app's local WebView2 profile under your
Windows user account, alongside the rest of BlammyTV's per-user data in
`%LOCALAPPDATA%`. Uninstalling removes the app; clearing that folder removes
the settings.

:::caution[Credentials are stored in the clear]
Playlist passwords, portal MAC addresses and your AIOStreams URL are saved as
plain text, not encrypted. Anything running as your Windows user can read
them. This is the same posture as most desktop IPTV clients, but it is worth
knowing rather than assuming otherwise: if your machine is shared, your
provider credentials are shared.
:::

## Playback

Video is decoded and rendered locally by [mpv](https://mpv.io/), loaded at
runtime from `libmpv-2.dll` next to the executable. Hardware decoding is on by
default and falls back to software when the GPU cannot handle a codec. Streams
are pulled by mpv directly from the URL your provider returned — the app does
not re-encode, re-host or relay anything.

## What BlammyTV does not do

- It does not host, index or supply any content.
- It does not send your credentials, viewing history or playlists anywhere.
- It does not phone home. The only outbound request the app makes on its own
  behalf is the update check against GitHub.

## Related

- [Why Windows flagged it](/how-it-works/defender/) — the unsigned-binary story
- [Updates](/how-it-works/updates/) — how an update is verified before it applies

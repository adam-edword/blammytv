---
title: Where your data goes
description: Every host BlammyTV contacts, what each one gets, and what stays on your machine.
---

BlammyTV asks you for provider credentials, so it's fair to ask what it does
with them. They stay on your machine, and every request for your content goes
straight from your machine to the provider you configured.

Below is every host the app talks to, and what each one receives.

## Your content

```
your machine                              the internet
─────────────                             ────────────
BlammyTV  ──── channel list, EPG ───────▶  your Xtream panel / M3U / portal
          ──── catalogue, streams ──────▶  your AIOStreams instance
          ──── video ────────────────────▶ whatever host those two hand back
```

Nothing sits in between. There's no BlammyTV server, so if your panel is down
the app is down with it and nothing could have cached it for you.

## Everything else it contacts

| Host | When | What it gets |
|---|---|---|
| `github.com` | Update checks | Nothing about you. It's a public file request. |
| `site.api.espn.com` | You open **Sports** | Which leagues you follow, as schedule requests |
| `a.espncdn.com` | You open **Sports** | Requests for the team logos on your board. ESPN's schedule names the image; your machine fetches it. |
| `v3-cinemeta.strem.io` | Browsing **Stream** | The IMDb id of titles whose artwork or synopsis your catalog didn't carry |
| `api.aniskip.com` | Starting an anime episode | Which episode you're starting, to fetch Skip Intro timings |
| `raw.githubusercontent.com` | First anime episode | A public id-mapping dataset. Nothing about you. |
| `api.themoviedb.org` | Asking **Discover** for ideas (REC) | The words you typed, and a lookup for the title it suggests back. Never your library or what you watch. |
| `auth.trakt.tv`, `api.trakt.tv` | **Only if you connect Trakt** | Your sign-in, then what you play and how far in, and your watch history, paused positions and watchlist, both ways |
| `myanimelist.net`, `api.myanimelist.net` | **Only if you connect MyAnimeList** | Your sign-in, then the episode count of an anime when you finish an episode, and your list's counts back |
| Your AIOStreams instance | Browsing **Stream**, once you've set it up | Signed in: your sign-in, then requests for your catalogs, a title's details and, when you open a title, the search for its sources. It also gets what you play and how far in, and a played mark when you finish something, and it sends back what you watched in its other apps, where you left off, and what's next. With a manifest URL instead: that URL, for the same requests, and no reports of what you play. |

If you sign in to AIOStreams, it looks up skip markers for what you play. That
lookup is the instance's own setting, not BlammyTV's: it sends the title,
season and episode to IntroDB, AniSkip and PMDB, and BlammyTV only reads the
answer.

## Nothing of ours

None of those hosts is BlammyTV's, and there's no server of ours for the app
to report to.

## What BlammyTV does not do

- It doesn't host, index or supply any content.
- **It has no account of its own.** There is nothing to sign up for. Trakt
  and MyAnimeList are optional, and they're your accounts with them. Signing in
  to AIOStreams is optional too, and it's your own instance.
- **It sends your credentials nowhere.** Playlist passwords, portal MAC
  addresses and your AIOStreams manifest URL, if you use one, never leave your
  machine. They're scrubbed out of error messages too, so a diagnostic can't
  carry one by accident.
- **It has no analytics.** No page views, no session tracking, no third-party
  analytics service. The only things that report what you watch are Trakt,
  MyAnimeList and your AIOStreams instance, if you connect them, because that's
  their job.

Viewing activity does reach two third parties as a side effect of features:
Cinemeta learns the id of a title whose artwork was missing, and AniSkip
learns which anime episode you started. Both are requests for data about the
thing, not reports about you, and neither carries an identifier. If that
matters to you, they only fire on the Stream tab and on anime respectively.
TMDB sees the words you type into Discover's REC, and nothing else.

## What is stored, and where

Settings and credentials live in the app's local WebView2 profile under your
Windows user account, alongside the rest of BlammyTV's per-user data in
`%LOCALAPPDATA%`. Uninstalling removes the app. Clearing that folder removes
the settings.

:::caution[Credentials are stored in the clear]
Playlist passwords, portal MAC addresses and, if you use one, your AIOStreams
manifest URL are saved as plain text, not encrypted. Anything running as your
Windows user can read them. That's the same posture as most desktop IPTV
clients, but you should know rather than assume otherwise. If your machine is
shared, your provider credentials are shared.

Trakt, MyAnimeList and your AIOStreams sign-in are the exception: they're kept
in Windows Credential Manager, not in the app's profile. Signed in, none of
AIOStreams' credentials are stored in the clear. The manifest URL is, and only
when you use it instead. The profile does hold your instance's address and
your user name, and neither opens anything on its own.
:::

## Playback

Video is decoded and rendered locally by [mpv](https://mpv.io/), loaded at
runtime from `libmpv-2.dll` next to the executable. Hardware decoding is on by
default and falls back to software when the GPU can't handle a codec. Streams
are pulled by mpv directly from the URL your provider returned.

Multi-view is the exception. Its tiles play inside the app's own window, so
each stream goes through a small proxy the app runs on your machine, on
loopback, where nothing else can reach it. A stream in HEVC, which that
window can't decode, is converted there by a copy of ffmpeg that ships with
the app. Nothing is re-hosted, and none of it leaves your computer.

## Related

- [Why Windows flagged it](/how-it-works/defender/), the unsigned-binary story
- [Updates](/how-it-works/updates/), how a package is verified before it applies

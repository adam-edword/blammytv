---
title: Where your data goes
description: Every host BlammyTV contacts, what each one gets, and what stays on your machine.
---

BlammyTV asks you for provider credentials, so it's fair to ask what it does
with them. They stay on your machine, and every request for your content goes
straight from your machine to the provider you configured.

This page lists every host the app talks to. It used to list four and there
are nine, which is the sort of thing a privacy page has no business getting
wrong, so the full set is below with what each one receives.

## Your content

```
your machine                              the internet
─────────────                             ────────────
BlammyTV  ──── channel list, EPG ───────▶  your Xtream panel / M3U / portal
          ──── catalogue, streams ──────▶  your AIOStreams instance
          ──── video ────────────────────▶ whatever host those two hand back
```

Nothing sits in between. There's no BlammyTV proxy, so if your panel is down
the app is down with it and nothing could have cached it for you.

## Everything else it contacts

| Host | When | What it gets |
|---|---|---|
| `github.com` | Update checks | Nothing about you. It's a public file request. |
| `site.api.espn.com` | You open **Sports** | Which leagues you follow, as schedule requests |
| `v3-cinemeta.strem.io` | Browsing **Stream** | The IMDb id of titles whose artwork or synopsis your catalog didn't carry |
| `api.aniskip.com` | Starting an anime episode | Which episode you're starting, to fetch Skip Intro timings |
| `raw.githubusercontent.com` | First anime episode | A public id-mapping dataset. Nothing about you. |
| `themes.eddtv.org` | **Only if you own a paid theme** | Your licence key and a per-install id, on launch |

## The licence check, stated plainly

This is the one host that's ours, and the only request the app makes on its
own behalf rather than to do a job you asked for.

**If you have never bought a theme, it never runs.** The code returns
immediately when no key is stored, so a free install does not contact it at
all, ever.

If you do own one, the app checks your licence on each launch and sends two
things: the key itself, and a random identifier generated on your machine the
first time it was needed. That identifier is a UUID, not a hardware
fingerprint, and it exists so a key can count how many machines it has been
activated on (the limit is 3).

Being straight about the consequence: a server we run therefore sees, for
paying users, a stable id and an IP address each time the app starts. That is
enough to know roughly where and how often you launch it. Nothing is done
with it, the database holds no email or name by design, but "we don't look"
is a promise about behaviour and this page is about what's technically true.

## What BlammyTV does not do

- It doesn't host, index or supply any content.
- **It has no account.** There is nothing to sign up for and no password.
- **It sends your credentials nowhere.** Playlist passwords, portal MAC
  addresses and your AIOStreams URL never leave your machine. They're scrubbed
  out of error messages too, so a diagnostic can't carry one by accident.
- **It has no analytics.** No page views, no session tracking, no third-party
  analytics service, and nothing that reports what you watch.

Viewing activity does reach two third parties as a side effect of features:
Cinemeta learns the id of a title whose artwork was missing, and AniSkip
learns which anime episode you started. Both are requests for data about the
thing, not reports about you, and neither carries an identifier. If that
matters to you, they only fire on the Stream tab and on anime respectively.

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

## Related

- [Why Windows flagged it](/how-it-works/defender/), the unsigned-binary story
- [Updates](/how-it-works/updates/), how a package is verified before it applies

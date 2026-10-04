---
title: AIOStreams
description: Point BlammyTV at your AIOStreams manifest to fill the Stream tab.
---

AIOStreams powers the **Stream** tab: movies and shows, browsed as rows of
posters, played through whatever your own AIOStreams instance resolves them
to. It's separate from your [live TV sources](/sources/), so you can run one,
the other, or both.

BlammyTV doesn't host an AIOStreams instance and doesn't supply one. You bring
your own.

## What you need

One field, your **manifest URL**. It comes from your instance's configure
page, and looks something like:

```
https://your-instance.example.com/<config>/manifest.json
```

Add it under **Settings → AIOStreams**, or during
[first launch](/start/first-launch/).

:::caution[The manifest URL is a credential]
Your addon configuration is embedded in that URL. Anyone who has it has your
setup, including whatever debrid credentials it carries. BlammyTV never logs
it and scrubs it out of error messages, but that only covers this app. Treat
the URL itself the way you'd treat a password.
:::

## The Connection Test

**Settings → AIOStreams → Connection Test** runs three real requests, in
order, and tells you which one failed.

| Step | What it proves |
|---|---|
| **Manifest** | The URL resolves and returns a valid addon manifest |
| **Catalog** | A browsable catalog actually returns titles |
| **Streams** | A known test title returns playable sources |

It uses the same network path the app itself uses, so it can't pass while the
app fails. That distinction matters more than it sounds. An external `curl`
test once reported everything healthy while the app got a 403 on every
request, because the two weren't making the same kind of request at all.

When a step fails it also reports who rejected it: the status, the serving
host's headers, and how the response body starts. That one line is usually the
whole diagnosis.

## Two failures worth naming

**Cloudflare bot protection.** If the test reports a challenge, the host in
front of your instance is demanding an interactive browser check. Nothing on
your machine and nothing in this app can pass that, and it affects
Stremio-style clients generally. The fix is on the hosting side. Whoever runs
the instance needs to exempt it from bot protection, or you need to move your
config to a different instance.

**A 401 or 403 on a URL that used to work.** Your config link has most likely
expired or been regenerated. Re-copy the manifest URL from the configure page
and submit it again. If it still fails, the problem is on the server hosting
your manifest.

## What you get

- **Catalog rows** on the Stream home tab, one per browsable catalog your
  addon exposes.
- **A featured hero**, drawn from your catalogs. You can pin which ones it
  uses under **Settings → Hero Sources**, or leave it on the default mix.
- **Search**, on the Discover tab.
- **Artwork and synopses**, filled in from Cinemeta where your catalog is
  sparse.

One bad catalog never sinks the tab. Rows are fetched independently, so a
single failing one goes missing while everything else loads.

## Sync with AIOStreams

Every AIOStreams config is also a Jellyfin-compatible server, and BlammyTV can
sign in to it. Once it's connected:

- **What you play here shows in AIOStreams' other apps**, with how far you got.
  Something you finish is marked played.
- **What you watched there comes back.** Where you left off joins Continue
  Watching, episodes you've played tick in the episode grid, and **Next Up**
  and **Upcoming** rows appear under Continue Watching on the Stream home.
- **Skip Intro, Skip Recap and Skip Credits** for films and shows, from
  AIOStreams' markers. Anime keeps BlammyTV's own AniSkip timings.

It's optional, and it needs AIOStreams 2.35 or later with its Jellyfin side
on, which it is by default.

To connect, go to **Settings → General → Accounts → AIOStreams sync** and
press **Connect**. BlammyTV shows a 6-digit code. Press **Open AIOStreams**,
then on your configure page choose **Save & Install**, **Jellyfin apps**,
**Connect**, and enter the code. If your config has household users, you pick
yours there. BlammyTV notices on its own.

Your sign-in is kept in Windows Credential Manager, never in the app's
profile. Changing or clearing the manifest URL disconnects it, since the
sign-in belongs to that config. **Disconnect** signs this device out and
leaves your watch state on AIOStreams alone.

:::caution[Leave Trakt trackers out of your AIOStreams setup]
If you connect Trakt in BlammyTV, it already reports what you play. A Trakt
tracker in your AIOStreams config would count every play twice.
:::

The skip markers come from IntroDB, AniSkip and PMDB, looked up by AIOStreams
with the title, season and episode. That's your instance's setting. See
[where your data goes](/how-it-works/).

## Tuning

- **Catalog Row Size** (Settings) sets how many titles each row holds. The
  default is 40.
- **One-click play** (Settings, off by default) makes a click on a *movie*
  card start the best already-resolved source instead of opening its detail
  page. Series always open their detail page, since there's no single obvious
  thing to play. When nothing is resolved yet, the click falls back to the
  detail page rather than hanging.

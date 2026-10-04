---
title: AIOStreams
description: Sign in to your AIOStreams to fill the Stream tab, or paste its manifest URL if it can't.
---

AIOStreams powers the **Stream** tab: movies and shows, browsed as rows of
posters, played through whatever your own AIOStreams instance resolves them
to. It's separate from your [live TV sources](/sources/), so you can run one,
the other, or both.

BlammyTV doesn't host an AIOStreams instance and doesn't supply one. You bring
your own.

## Signing in

You need one thing: your instance's address, like `aiostreams.example.com`.
It's the address your configure page lives at. A pasted manifest URL or
configure URL works too, and BlammyTV takes the address out of it.

Go to **Settings → General → Sources → Stream**, type the address and press
**Connect**. You can do the same during [first launch](/start/first-launch/).

1. BlammyTV shows a 6-digit code.
2. Press **Open AIOStreams**. It copies the code and opens your configure page.
3. On the configure page choose **Save & Install**, then **Jellyfin apps**,
   then **Connect**, and enter the code.
4. If your config has household users, you pick yours there.

That's it. BlammyTV notices the approval on its own, and the Stream tab fills
in.

Nothing secret lands in the app's profile. Your sign-in is kept in Windows
Credential Manager, and the app's pages never see it. **Disconnect** (same
place) signs this device out and leaves your watch state on AIOStreams alone.
If you change your AIOStreams password or PIN, the sign-in stops working.
BlammyTV notices and shows you signed out, and you connect again.

It needs AIOStreams 2.35 or later with its Jellyfin side on, which it is by
default.

### What signing in costs

Browsing over the sign-in is not quite the same as browsing over a manifest:

- **25 sources per title.** The instance can raise that to 50. Your config can
  only lower it.
- **The first 20 catalogs** show. Any past that don't.
- **Discover stops 250 titles deep** into any one catalog.

If any of that gets in your way, the manifest still works. See below.

## Sync

Signing in also syncs what you watch with your other AIOStreams apps:

- **What you play here shows in AIOStreams' other apps**, with how far you got.
  Something you finish is marked played.
- **What you watched there comes back.** Where you left off joins Continue
  Watching, episodes you've played tick in the episode grid, and **Next Up**
  and **Upcoming** rows appear under Continue Watching on the Stream home.
- **Skip Intro, Skip Recap and Skip Credits** for films and shows, from
  AIOStreams' markers. Anime keeps BlammyTV's own AniSkip timings.

**Settings → General → Sources → Stream** shows when it last synced, and
**Sync now** runs one on the spot.

:::caution[Leave Trakt trackers out of your AIOStreams setup]
If you connect Trakt in BlammyTV, it already reports what you play. A Trakt
tracker in your AIOStreams config would count every play twice.
:::

The skip markers come from IntroDB, AniSkip and PMDB, looked up by AIOStreams
with the title, season and episode. That's your instance's setting. See
[where your data goes](/how-it-works/).

## Use a manifest URL instead

Some instances can't sign in. ElfHosted ships with the Jellyfin side off, and
a sign-in needs it. For those, there's still the manifest URL.

Under **Settings → General → Sources → Stream**, press **Use a manifest URL
instead**. It's one field, your **manifest URL**, from your instance's
configure page. It looks something like:

```
https://your-instance.example.com/<config>/manifest.json
```

The first launch has the same fallback, on its AIOStreams step.

:::caution[The manifest URL is a credential]
Your addon configuration is embedded in that URL. Anyone who has it has your
setup, including whatever debrid credentials it carries. BlammyTV never logs
it and scrubs it out of error messages, but that only covers this app. Treat
the URL itself the way you'd treat a password. It's also the one thing of
AIOStreams' that BlammyTV stores in the clear, and only when you use it.
:::

The manifest way doesn't sync, and it has none of the limits above. Sign in
later and the sign-in takes over. BlammyTV deletes the manifest URL it was
holding, because it's a password in plain text and you don't need it any
more.

## The Connection Test

**Settings → General → Sources → Stream → Connection Test** runs real
requests, in order, and tells you which one failed. It uses the same network
path the app itself uses, so it can't pass while the app fails.

Signed in, it runs two:

| Step | What it proves |
|---|---|
| **Catalogs** | Your sign-in works and your catalogs come back |
| **Sources** | A known test title returns playable sources |

With a manifest URL, it runs three:

| Step | What it proves |
|---|---|
| **Manifest** | The URL resolves and returns a valid addon manifest |
| **Catalog** | A browsable catalog actually returns titles |
| **Streams** | A known test title returns playable sources |

That distinction matters more than it sounds. An external `curl` test once
reported everything healthy while the app got a 403 on every request, because
the two weren't making the same kind of request at all. When a manifest step
fails, the test also reports who rejected it: the status, the serving host's
headers, and how the response body starts. That one line is usually the whole
diagnosis.

## Two failures worth naming

**Cloudflare bot protection.** If the test reports a challenge, the host in
front of your instance is demanding an interactive browser check. Nothing on
your machine and nothing in this app can pass that, and it affects
Stremio-style clients generally. The fix is on the hosting side. Whoever runs
the instance needs to exempt it from bot protection, or you need to move your
config to a different instance.

**A 401 or 403 on a manifest URL that used to work.** Your config link has
most likely expired or been regenerated. Re-copy the manifest URL from the
configure page and submit it again. If it still fails, the problem is on the
server hosting your manifest.

## What you get

- **Catalog rows** on the Stream home tab, one per browsable catalog your
  config exposes.
- **A featured hero**, drawn from your catalogs. You can pin which ones it
  uses under **Settings → Hero Sources**, or leave it on the default mix.
- **Search**, on the Discover tab.
- **Artwork and synopses**, filled in from Cinemeta where your catalog is
  sparse.

One bad catalog never sinks the tab. Rows are fetched independently, so a
single failing one goes missing while everything else loads.

## Tuning

- **Catalog Row Size** (Settings) sets how many titles each row holds. The
  default is 40.
- **One-click play** (Settings, off by default) makes a click on a *movie*
  card start the best already-resolved source instead of opening its detail
  page. Series always open their detail page, since there's no single obvious
  thing to play. When nothing is resolved yet, the click falls back to the
  detail page rather than hanging.

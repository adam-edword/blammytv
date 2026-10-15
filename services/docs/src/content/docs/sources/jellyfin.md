---
title: Jellyfin
description: Sign in to your own Jellyfin server and its movie and show libraries show up in Stream and Discover.
---

Your own Jellyfin server can be a source for the **Stream** tab, next to
AIOStreams or without it. Its movie and show libraries become rows of posters,
and a title you open from one plays the file on your server.

BlammyTV doesn't host a Jellyfin server and doesn't supply one. You bring your
own, and it's tested on Jellyfin 12.x.

## Signing in

Go to **Settings → Sources → Stream → Jellyfin**. You need your server's
address, like `jellyfin.example.com` or `192.168.1.20:8096`.

Two ways in:

- **User name and password.** Type the address, your user name and your
  password, and press **Sign in**.
- **Quick Connect.** Type the address and press **Use Quick Connect**.
  BlammyTV shows a code. In Jellyfin, open your user menu, then Quick Connect,
  and type it. BlammyTV notices on its own.

Your password goes to the app once, to sign in, and isn't kept. The sign-in
that comes back is stored in Windows Credential Manager, and the app's pages
never see it. **Disconnect** (same place) signs this device out of Jellyfin
too, so the server stops accepting it.

If you sign in with an address that starts with `http://` to another machine,
Settings says so: your sign-in and the video cross your network unencrypted.
That's normal for a server at home, but think about it before using it over
the internet. Use `https` when you can.

One server at a time. Signing in to a second one means disconnecting the first.

## What you get

- **Your libraries as rows** on the Stream home, one for each movie or show
  library. Music, books, collections, mixed libraries and Live TV aren't shown.
- **Discover** searches your libraries and filters them by genre, beside the
  addon's. A title in both your Jellyfin and your addon is two cards, and the
  one you click decides where it plays. BlammyTV doesn't merge them.
- **A title's page** with its artwork, synopsis and, for a show, its seasons
  and episodes. Its sources are the files your server has for it, so a title
  kept in two versions shows two.
- **Subtitle files beside the video.** A `.srt` that sits next to the video
  shows up in the subtitle menu with its name and language. It isn't forced
  on. Your subtitle language setting, or the file's default or forced flag,
  decides whether it's showing. Subtitles inside the video file work as they
  always do.
- **Skip Intro, Recap and Credits** from your server's own markers, where it
  has them. Where it has none, anime falls back to BlammyTV's own AniSkip
  timings. Markers from AIOStreams are never used on a file from your server,
  because they were made against a different file.

:::note[Not yet run on a real Windows build]
BlammyTV was built from the answers of a real Jellyfin 12.2 and tested against
a stand-in made from them. UNCHECKED on a live server: Discover's search and
genre filter (they use the calls Jellyfin's own API documents), subtitle files
in the real player, and artwork in the real app window.
:::

## Where you left off

Signing in also lets you pick up where you left off in any of your Jellyfin
apps. It isn't a watch history: for that, connect Trakt or MyAnimeList in
**Settings → Accounts**.

- **What you play here is reported to your server**, with how far you got.
  The server's own rules decide when something counts as finished, the same
  as in its own apps. BlammyTV never marks anything played by itself.
- **Where you left off comes back.** Your server's resume points join
  Continue Watching, one card per title.
- **What you watched there ticks here.** Episodes you've played show a tick in
  the episode grid.
- **Next Up** gets a row under Continue Watching on the Stream home.
- **Clearing a card from Continue Watching resets that item on your
  server.** BlammyTV sets its position back to 0 and leaves it unplayed
  (`PlaybackPositionTicks: 0`, `Played: false`), so the next sync doesn't bring
  the card back. It does this only for items with a saved position that aren't
  finished, and never removes a played mark. Apart from the reports of what you
  play, this is the only place BlammyTV writes watch state to your server.

It syncs when the app opens, when you come back to it after a while, after you
sign in, and from **Sync now**. **Settings → Sources → Stream → Jellyfin**
shows when it last ran.

:::caution[Trakt and your Jellyfin]
If you connect Trakt in BlammyTV, it already reports what you play. UNCHECKED:
if your Jellyfin runs a Trakt plugin, it may log the same watch that BlammyTV
scrobbles. This hasn't been tried with the plugin installed.
:::

Watched marks from your server never go to Trakt or MyAnimeList. They tick the
episode grid and nothing else, so an episode both Jellyfin and Trakt know about
is counted once in each.

### Limits of the sync

- **It assumes Jellyfin's default thresholds** for when something counts as
  started and finished (watched past 5% to be resumable, past 90% to be
  played). A server set to other values may mark things differently than
  BlammyTV expects.
- **It reads your 5,000 most recently played movies and episodes.** Anything
  older stops ticking.
- **UNCHECKED:** a half-watched episode might be listed in both Continue
  Watching and Next Up. The Next Up request asks the server to leave those
  out, but a real server's answer to that hasn't been looked at.

## Where it's kept

Your sign-in lives in Windows Credential Manager. Export Settings never writes
it into a file, and **Settings → App → Clear All Login Info** removes it and signs the device out on the server. The
profile holds your server's address and your user name, and neither opens
anything on its own. See [where your data goes](/how-it-works/).

## Not here

- **Jellyfin's Live TV.** Live channels come from the [live TV
  sources](/sources/).
- **More than one server.**
- **Older servers, as a promise.** It's only been tried on Jellyfin 12.x, so
  an older server may not work.
- **More Like This** on a title's page still comes from your addon, not from
  Jellyfin.

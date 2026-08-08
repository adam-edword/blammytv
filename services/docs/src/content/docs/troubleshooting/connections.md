---
title: Connection limits
description: The n/m badge in the sidebar, and what to do when you run out of connections.
---

Most Xtream providers cap how many streams you can pull at once. BlammyTV
shows that cap in the Live TV sidebar as a badge. `2/5` means two active
connections against a limit of five.

## Where the number comes from

It's the provider's own figure, not an estimate. The Xtream panel API reports
`active_cons` and `max_connections` on the same endpoint the app uses to
authenticate, and the badge shows exactly what comes back.

Two things follow from that:

- **It includes you.** If you're watching a channel, one of those connections
  is yours.
- **Xtream only.** Stalker portals rarely expose a limit and M3U has no API at
  all, so those show no badge rather than a number that would be a guess.

## Why it can lag

The badge is polled, not pushed. The panel gets asked roughly once a minute,
and again a few seconds after you change channels. Panels are also slow to
notice a session that has *ended*. Stopping playback frees the connection
immediately on your side, but the provider's count can take a while to catch
up. If you stop watching and the badge still reads `1/3`, wait for the next
refresh before concluding anything is stuck.

## Running out

At the limit, the provider refuses new streams and playback fails to start.
Usually that means another device, another app, or a session that wasn't
closed cleanly. Close other players, or wait for the provider's own timeout to
reap the stale session. BlammyTV can't free a connection it doesn't own.

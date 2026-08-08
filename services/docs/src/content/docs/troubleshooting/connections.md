---
title: Connection limits
description: The n/m badge in the sidebar, and what to do when you run out of connections.
---

Most Xtream providers cap how many streams you can pull at once. BlammyTV
shows that cap in the Live TV sidebar as a badge — `2/5` means two active
connections against a limit of five.

## Where the number comes from

It is the provider's own figure, not an estimate. The Xtream panel API reports
`active_cons` and `max_connections` on the same endpoint the app uses to
authenticate, and the badge shows exactly what it returns.

Two consequences worth knowing:

- **It includes you.** If you are watching a channel, one of those connections
  is yours.
- **Xtream only.** Stalker portals rarely expose a limit and M3U has no API at
  all, so no badge is shown for them rather than a number that would be a
  guess.

## Why it can lag

The badge is polled, not pushed — the panel is asked roughly once a minute,
and again a few seconds after you change channels. Panels are also slow to
notice a session that has *ended*: stopping playback frees the connection
immediately on your side, but the provider's count can take a little while to
catch up. If you stop watching and the badge still reads `1/3`, wait for the
next refresh before concluding anything is stuck.

## Running out

If the count is at its limit, the provider will refuse new streams and playback
fails to start. Usually that means another device, another app, or a session
that was not closed cleanly. Closing other players, or waiting for the
provider's own timeout to reap a stale session, is the fix — there is nothing
BlammyTV can do to free a connection it does not own.

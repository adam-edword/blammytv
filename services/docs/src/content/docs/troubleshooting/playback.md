---
title: Playback
description: Streams that buffer, stall, refuse to start, or play without a picture.
---

Playback problems split into three groups, and telling them apart is most of
the work. Start here.

## First: ask the player what it thinks

Press <kbd>i</kbd> in theater or fullscreen for the stats overlay. It reports
what mpv is actually doing rather than what the interface can infer, and it
separates the three cases below immediately.

The interface cannot tell "the source is dead" from "we left it paused" from
"the video output never started" — all three look like a stalled screen. The
overlay can.

## It buffers forever, then errors

The source is not delivering. Nothing on your machine will fix a stream that
is not arriving.

- **Try another source.** On VOD, the card offers **Try next available
  source**. This is by far the most common fix, because individual sources go
  bad constantly.
- **Turn on Auto source-failover** (Settings) if you would rather it move on
  by itself. It is off by default on purpose — automatic jumping burns through
  your resolved sources without asking, including on stalls that would have
  recovered.
- **Check your connection count.** A provider at its cap refuses new streams.
  See [Connection limits](/troubleshooting/connections/).

## Channels list, but nothing plays

The channel list and the stream URL come from different parts of your
provider's setup, so one can be fine while the other is wrong.

- On [Xtream](/sources/xtream/), the stream container extension may be wrong
  for your panel — the app defaults to `ts`, and a minority of panels serve
  `m3u8`.
- On [M3U](/sources/m3u/), the playlist may have downloaded successfully while
  being an error page rather than a playlist. Some providers return a lapsed
  subscription notice with a 200 status.

## Sound but no picture, or a black player

Usually the video output, not the source.

- **Try another source** first — a stream with a codec your machine cannot
  decode behaves this way.
- If it happens on *everything*, hardware decoding is the suspect. BlammyTV
  uses it by default and falls back to software when the GPU cannot handle a
  codec, but a broken or very old GPU driver can fail in ways the fallback
  does not catch. Update the display driver.

## It stutters

- Check the stats overlay for **frame drops**. Drops mean decode or output is
  behind — that is a machine or driver problem. No drops with visible stutter
  means the picture is arriving fine and something else is hitching.
- **Close other players.** Two apps pulling from the same provider compete for
  your connection cap and your bandwidth.

## The whole app is slow, not just playback

- Hide categories you do not watch. A six-figure channel list is real work to
  load, even though the guide only renders what is on screen.
- Reduce **Catalog Row Size** (Settings) if the Stream tab is the slow part.

## Nothing here helped

The app is open source, and the parts that touch playback are the parts most
worth reading: see [Architecture](/contributing/architecture/). Issues are
welcome on
[GitHub](https://github.com/adam-edword/blammytv/issues) — the stats overlay
screenshot is the single most useful thing to attach.

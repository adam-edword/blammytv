---
title: Sources
description: The four kinds of source BlammyTV can connect to.
---

BlammyTV ships with no content. Everything you see in the app comes from a
source you add yourself, and there are four kinds:

| Kind | What it is | What it needs |
|---|---|---|
| [Xtream Codes](/sources/xtream/) | A panel API | Server URL, username, password |
| [M3U playlist](/sources/m3u/) | A plain playlist file over HTTP | A URL |
| [Stalker / MAG portal](/sources/stalker/) | A portal endpoint | Portal URL and a MAC address |
| [AIOStreams](/sources/aiostreams/) | A Stremio-style manifest | Your manifest URL |

The first three are **Live TV** sources — they fill the channel guide, and
all three load through the same pipeline, so a mixed setup behaves as one
list. AIOStreams is separate: it powers the **Stream** tab, which is movies
and shows rather than channels. You can run both, either, or neither.

Add as many as you like. Each has its own on/off switch, so you can keep a
source configured without loading it, and you can hide individual categories
per source rather than all-or-nothing.

Credentials are stored on your machine — see [Where your data
goes](/how-it-works/).

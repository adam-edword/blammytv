---
title: Sources
description: The four kinds of source BlammyTV can connect to.
---

BlammyTV ships with no content. Everything you see in the app comes from a
source you add yourself, and there are four kinds:

| Kind | What it is | Status |
|---|---|---|
| [Xtream Codes](/sources/xtream/) | A panel API — username, password, server URL | Supported. Live TV with an EPG, and the only kind that reports connection limits |
| [AIOStreams](/sources/aiostreams/) | A Stremio-style manifest | Supported. Movies and shows, resolved through your own debrid setup |
| [M3U playlist](/sources/m3u/) | A plain playlist file or URL | **Not yet.** The app accepts one and stores it, but nothing fetches it |
| [Stalker portal](/sources/stalker/) | A portal endpoint with a MAC address | **Not yet.** Same — accepted and stored, not yet fetched |

M3U and Stalker exist in the settings UI because the data model already
carries them, and they will start working when their clients land. Adding one
today gets you an entry in the list and no channels.

You can add as many as you like and enable or disable them individually.
Credentials are stored on your machine — see [Where your data
goes](/how-it-works/).

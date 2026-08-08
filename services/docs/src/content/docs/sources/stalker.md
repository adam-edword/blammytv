---
title: Stalker / MAG portals
description: Connect a Stalker portal using its URL and a MAC address.
---

Stalker (also called MAG) portals are the set-top-box protocol some providers
offer instead of, or alongside, Xtream. BlammyTV speaks it directly, so you
don't need the box.

## What you need

| Field | Looks like |
|---|---|
| **Portal URL** | `http://example.com` or `http://example.com/c/` |
| **MAC address** | `00:1A:79:XX:XX:XX` |

Add it under **Settings → Playlists → Stalker/MAG**.

The MAC is the credential here. Portals authorise a device address rather than
a username and password, so anyone with your MAC has your subscription. Treat
it exactly as you would a password.

## The endpoint probe

Stalker installs disagree about where the handshake lives. Some answer at
`load.php`, others at `portal.php`. BlammyTV probes for the one your portal
uses when you add it, then remembers the answer so later loads go straight
there.

If you move the portal to a different host, remove the source and re-add it
rather than editing the URL, so the probe runs again.

## What you get

- **Channels and genres**, as the portal organises them.
- **Adult genres are recognised** and hidden unless you've turned adult
  content on. Portals flag these explicitly, so filtering here is more
  reliable than name-matching.

## What you don't get

**No connection count.** Portals rarely expose one, so the sidebar shows no
badge rather than a guess.

## If it fails

- **The handshake was refused.** Usually the MAC isn't authorised on that
  portal, or the subscription attached to it has lapsed.
- **Nothing answered.** The portal URL is wrong or the host is down. The probe
  tries the common endpoint paths before giving up, so a failure here means
  none of them responded.

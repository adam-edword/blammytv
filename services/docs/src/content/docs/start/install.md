---
title: Install
description: Download and install BlammyTV on Windows.
---

BlammyTV is a Windows desktop app. Download the latest installer from the
[Releases page](https://github.com/adam-edword/blammytv/releases/latest) and
run it.

There is no account to create and no server to sign in to — the app is useless
until you give it a source, which is the next page.

:::note[Windows may warn you]
BlammyTV is not code-signed, so SmartScreen shows an "unrecognised app" prompt
and Defender occasionally deletes the download outright. This is expected, it
is not a compromise, and [there is a whole page on
it](/how-it-works/defender/) explaining why and what to do.
:::

## Updating

The app updates itself. When a new version is available it downloads and
verifies the update, then applies it on the next restart. Update packages are
signed, and the app refuses any package whose signature does not match — see
[Updates](/how-it-works/updates/).

## System requirements

- Windows 10 or 11, 64-bit
- A GPU with hardware video decoding (essentially any machine from the last
  decade — BlammyTV uses it by default and falls back to software decoding if
  it is unavailable)

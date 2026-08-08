---
title: Install
description: Download and install BlammyTV on Windows.
---

BlammyTV is a Windows desktop app. Download the latest installer from the
[Releases page](https://github.com/adam-edword/blammytv/releases/latest) and
run it.

There's no account to create and no server to sign in to. The app does nothing
until you give it a source, which is the next page.

:::note[Windows may warn you]
BlammyTV isn't code-signed, so SmartScreen shows an "unrecognised app" prompt
and Defender occasionally deletes the download outright. This is expected and
it isn't a compromise. [There's a whole page on it](/how-it-works/defender/)
explaining why, and what to do.
:::

## Updating

The app updates itself. When a new version is available it downloads and
verifies the update, then applies it on the next restart. Update packages are
signed, and the app refuses any package whose signature doesn't match. See
[Updates](/how-it-works/updates/).

## System requirements

- Windows 10 or 11, 64-bit
- A GPU with hardware video decoding. Essentially any machine from the last
  decade qualifies. BlammyTV uses it by default and falls back to software
  decoding when it isn't available.

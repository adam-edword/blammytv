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
and Defender occasionally deletes the download outright. It's a false
positive. [There's a whole page on it](/how-it-works/defender/)
explaining why, and what to do.
:::

## Updating

The app updates itself. A new interface build downloads in the background and
applies the next time you open the app. A new version of the app waits until
you press **Install**, in the header or in **Settings → App → Updates**. Update packages are
signed, and the app refuses any package whose signature doesn't match. See
[Updates](/how-it-works/updates/).

## System requirements

- Windows 10 or 11, 64-bit
- A GPU with hardware video decoding. Any PC from the last ten years has one.
  BlammyTV uses it by default and falls back to software decoding when it
  isn't available.

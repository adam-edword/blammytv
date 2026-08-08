---
title: Why Windows flagged it
description: Windows Defender sometimes deletes BlammyTV. What that means, how to get it back, and how to check the download yourself.
---

Some people have had BlammyTV disappear off their PC mid-use, with no warning.
That is Windows Defender removing it, and the detection is a false positive.
This page explains why it happens, because "trust me" is not an answer when
something has just deleted a program off your computer.

## Get it back first

1. Open **Windows Security** → **Protection history**.
2. Find the BlammyTV entry.
3. **Actions** → **Restore**.
4. Install the latest version over the top.

If the entry has already expired out of the history, just reinstall from the
[Releases page](https://github.com/adam-edword/blammytv/releases/latest).
Nothing is lost — your playlists and settings are stored separately from the
program files and survive a reinstall.

## What the detection actually said

The verdict people saw was `Trojan:Win32/Bearfoos.A!ml`. The part that matters
is the **`!ml` suffix**: it marks a machine-learning verdict, not a signature
match. Defender did not recognise BlammyTV as a known piece of malware — a
model guessed, from how the file looked, that it might be one.

Two things about how we shipped invited that guess:

- **The program was called `app.exe`** — a generic name, sitting in a folder
  where unwanted software commonly hides. As of v0.8.167 it is `BlammyTV.exe`,
  which removes a large part of the signal.
- **The installer is not code-signed.** An unsigned binary from an unknown
  publisher starts with no reputation at all, and reputation is a large input
  to that model.

## Why it is not signed

Not for want of trying. Since June 2023, CA/Browser Forum rules require
code-signing keys to live in FIPS-140 certified hardware — a physical token or
a cloud HSM. That turned code signing from "buy a certificate once" into an
ongoing subscription with identity validation attached. For a free app with no
revenue, that is a real cost, and it is being weighed rather than ignored.

Signing would also not fix this immediately. SmartScreen reputation accrues
per-certificate over time and download volume, so a brand-new certificate
still shows warnings for a while. It is the right long-term fix and a slow one.

## Verify the download yourself

You do not have to take our word for any of this. Every release ships a
detached signature, and update packages are checked automatically by the app
before they are ever applied — see [Updates](/how-it-works/updates/).

If you want to inspect the app's behaviour directly rather than trust a
verdict, the source is public: [the whole
repository](https://github.com/adam-edword/blammytv), including the installer
configuration and every network call the app can make. [Where your data
goes](/how-it-works/) describes that surface in plain language.

## Reporting the false positive

If you would like to help, Microsoft accepts false-positive submissions at
[the Defender submission
portal](https://www.microsoft.com/en-us/wdsi/filesubmission). Each report
nudges the model. It is entirely optional, and you should not feel obliged to
do unpaid QA for an antivirus vendor.

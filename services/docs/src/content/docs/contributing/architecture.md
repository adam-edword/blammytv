---
title: Architecture
description: How BlammyTV is put together, for anyone reading the source.
---

This page is orientation for contributors, enough to find your way around.
It's deliberately shallow. The deep design notes live in the repository.

## The stack

- **Tauri v2** for the desktop shell. The native side is Rust, and the only
  browser target is WebView2, so there's no other engine to support.
- **React + TypeScript** for the interface, built with Vite.
- **libmpv** for playback, loaded at runtime from `libmpv-2.dll` rather than
  linked at build time.

## Repository layout

```
apps/app/          the desktop application
  src/             React front end
  src-tauri/       the Rust shell and native commands
services/site/     the marketing site at eddtv.org
services/docs/     this documentation site
plans/             design notes, one file per piece of work
scripts/           release and verification tooling
```

## The player

The interesting part. mpv renders into its own child window rather than into a
canvas the web layer owns, so the two can't simply be stacked in document
order. BlammyTV uses what the codebase calls the inverted arrangement: mpv's
window sits at the **bottom** of the z-order, the webview is transparent and
sits above it, and the interface punches a hole through itself with a CSS
`clip-path` wherever video should show through.

Internalise this before touching that code: the video is not an element on the
page. Nothing in CSS can move it, and the hole and the native window have to
be kept in agreement by hand.

There's a second consequence. mpv's window binding is set once, at
initialisation, and can't be re-targeted afterwards. So the app keeps a single
long-lived mpv instance and resets per-file state between loads, instead of
creating a new player per stream.

## Native commands

The front end can't call arbitrary code. It can only invoke commands the Rust
side has explicitly registered, and those are the entire native surface. Worth
remembering when reasoning about what the interface is capable of.

Sync commands run on the UI thread inside WebView2's callback, so anything
slow in one of them shows up directly as interface stutter.

## Where the real detail lives

`plans/` in the repository holds a file per piece of work, written at the time
with the measurements that justified each decision. That's the honest record.
This page is the map.

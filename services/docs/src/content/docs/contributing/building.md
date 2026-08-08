---
title: Building from source
description: Get BlammyTV running locally.
---

## Prerequisites

- **Node 22+** and **pnpm**
- **Rust**, stable toolchain
- The Tauri v2 [Windows
  prerequisites](https://v2.tauri.app/start/prerequisites/) — MSVC build tools
  and WebView2

## Run it

```sh
git clone https://github.com/adam-edword/blammytv.git
cd blammytv
pnpm install
pnpm tauri dev
```

Front-end changes hot-reload. Anything under `src-tauri/` needs the dev
command restarted, since it triggers a Rust rebuild.

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test
```

All three run in CI on every pull request against `main`, so a change that
fails one locally will fail there too.

## Contributing

Read `CLAUDE.md` in the repository root before opening a pull request — it is
the working agreement the project is actually developed under, and it is short.

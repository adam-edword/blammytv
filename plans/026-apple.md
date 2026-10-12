# Plan 026: Apple: a Mac app, and a live TV app for Apple TV, iPhone and iPad

**Status: PARKED (2026-10-12).** Talked through in chat at v0.11.35 and
parked. Adam: "Can you log this somewhere in repo? We can park it for now."
Nothing is built. This file is where the conversation landed, what each
call rests on, and what was never checked.

## Where it landed

1. **The Mac app is this app** (Tauri), with libmpv as its player.
2. **No full rewrite in Swift.** A Swift app, yes, but scoped to live TV.
3. **On Apple TV, iPhone and iPad: live TV first, native Swift.** Movies
   and shows are left to Strand, which already does them well off the same
   AIOStreams.

## 1. Mac: the Tauri app, with libmpv

Adam asked which player the Mac app should use.

**libmpv, drawn through mpv's render API.** Everything built on mpv
carries over: `mpv.rs`'s commands and properties, the player settings
(`mpvprefs.rs`), the status poll, and `ending.ts` with v0.11.33's
dead-link fail-fast, which was measured against mpv's real behaviour.

**What doesn't port is the embedding.** On Windows mpv draws into a child
window parked under the webview (`inv.rs`, `#![cfg(windows)]`, `--wid`).
mpv's own manual lists `--wid` for X11, win32 and Android only, not macOS
(`DOCS/man/options.rst` on master, read 2026-10-12). On a Mac, libmpv draws
through the render API into a layer under a transparent WKWebView. The
render API offers OpenGL or software and nothing else (`include/mpv/render.h`).
That is IINA's route, and IINA is a Swift app built on libmpv.

- **The risk:** Apple deprecated OpenGL in macOS 10.14 (2018). IINA still
  ships on it.
- **The real cost is shipping, not code:** a Mac libmpv we trust, pinned
  and hash-checked the way `scripts/deps.json` pins the Windows build, with
  every dylib in it signed and notarized.
- **Swift where it counts:** the Mac player layer (the video surface, media
  keys, Now Playing) can be Swift called from Rust. The UI stays React.
- **Multi-view comes along:** its tiles are already web video
  (`MultiviewTile.tsx`).

Not chosen:

- **VLCKit.** The easiest embed (it draws into an NSView), and Telly's Mac
  multi-view tiles use VLC (`telly-2.0.5.md`). But it's a second player to
  write, and everything measured against mpv would need measuring again.
- **AVPlayer.** It can't play MKV, DTS or ASS subtitles, and most debrid
  files are MKV.

## 2. Not a full Swift rewrite

Adam: "I also would eventually like to rebuild it all in swift as like the
2.0 release or something".

Recommended against, as a whole-app rewrite:

- Swift's UI frameworks (SwiftUI, AppKit, UIKit) only exist on Apple
  platforms. A Swift BlammyTV means dropping Windows, where the app lives
  today, or keeping two apps in step for good.
- It throws away the React app, with 2021 unit tests and 72 harnesses
  (1811 checks) at v0.11.35.
- Refactor size is a deterrent (CLAUDE.md, Adam: "that should be a
  deterrent").

The Swift idea fits better as section 3: one new app with a narrow scope.

## 3. Apple TV, iPhone, iPad: live TV first

**Strand covers movies and shows.** Adam: "Strand exists for Mac tv and iOS
which is kind of end game quality. It's really good". Strand is a Jellyfin
client. It reads AIOStreams through AIOStreams' Jellyfin Connect, the same
side our Stream tab signs in over (plans 023 and 024). A BlammyTV that does
the same on Apple devices would be a lot of work to match an app Adam
already has.

**Live TV is the gap.** Adam: "It does do live but not very good. The guide
is kinda just a spreadsheet". What BlammyTV would bring is what a Jellyfin
client doesn't: the guide, sports with scores, and multi-view.

- **Native Swift.** tvOS has no WKWebView, so an Apple TV app can't be the
  Tauri app. Scoped to live, it's a new app, not a rewrite.
- **Player: libmpv through MPVKit**, which builds for iOS, macOS and tvOS.
  Three catches:
  - The App Store needs its LGPL build. Its `-GPL` bundles are GPL v3
    (MPVKit README), and GPL is why VLC was pulled from the App Store
    in 2011.
  - Its README says it "is only suitable for learning `libmpv` and will
    not be maintained too frequently."
  - It doesn't come with AVPlayer's PiP and AirPlay.
- **App Review.** Bring-your-own-playlist live apps get through: Streamly
  is on iPhone, iPad, Mac and Apple TV. A debrid sources screen under a
  movie catalog is the part I'd expect review to reject (an expectation,
  not checked). Live first stays clear of it.
- **The cost:** the live and sports logic is TypeScript today
  (`features/live/epg.ts`, `m3u.ts`, `guideFix.ts`, `data/xtream.ts`,
  `data/stalker.ts`, `features/sports/`). It gets rewritten in Swift. What
  carries over is what we learned the hard way: the guide's rules, the
  sports pairing, and the harnesses, which work as a spec for the new code.
- **What it needs:** Adam has a Mac (2026-10-12), and Xcode is the only way
  to build and sign for iOS and tvOS. Installing on your own devices
  without review takes a paid Apple developer account ($99 a year).

## Open, for when it's unparked

- **Which first:** the Mac app (Tauri, mostly native work) or the Apple TV
  app (Swift, new).
- **iPhone and iPad:** share the Swift TV app, or run this app (Tauri 2
  builds for iOS) with a touch layout. Hover, keyboard shortcuts, the
  theater and the Guide grid all assume a desk today.
- **Never checked from here:**
  - where a Mac libmpv comes from (MPVKit's macOS build, or our own on a
    macOS runner);
  - whether WKWebView plays multi-view's HEVC tiles without `mvconvert`;
  - whether AIOStreams answers Apple's TLS stack as it does Windows' (the
    403 in CLAUDE.md was a TLS fingerprint);
  - how Strand does sports and multi-view, if at all.

## Sources

- mpv manual, `--wid`: https://github.com/mpv-player/mpv/blob/master/DOCS/man/options.rst
- mpv render API: https://github.com/mpv-player/mpv/blob/master/include/mpv/render.h
- MPVKit: https://github.com/mpvkit/MPVKit
- ElfHosted, AIOStreams with Jellyfin (Infuse, Swiftfin, Strand): https://docs.elfhosted.com/guides/media/aiostreams-jellyfin/
- ElfHosted, Stremio on Apple TV: https://docs.elfhosted.com/guides/media/stremio-on-apple-tv/
- Streamly IPTV Player: https://hunted.space/product/streamly-iptv-player

# Plan 025: Settings, replanned

**Status: PROPOSAL, 2026-10-10. Nine calls are Adam's (end of this file);
nothing is built.** Asked for by Adam: "replan our settings and think about
what we should add, how to organize it & whatever else. I think comparing
to Telly is smart." Read against Desktop Telly 2.0.5 (`telly-2.0.5.md`) and
the AIOStreams desktop app (`aiostreams-app.md`), whose settings screens
were inventoried control by control.

## Where ours stands

Two tabs in a 786px card, filed by question since 0.8.0 ("what the app
DOES" and "how it LOOKS", never by screen), each with a Live TV / Stream
pill (`features/settings/SettingsModal.tsx:12-25`):

- **General:** Sources (Live TV: playlists, Refresh now, Content; Stream:
  AIOStreams sign-in or manifest, Connection Test), Accounts (Trakt, MAL),
  App (Updates, Replay Onboarding), Danger Zone (Clear All Login Info)
  (`GeneralTab.tsx:82-130`).
- **Customize:** Interface (Accent, Appearance, Startup Tab, Clock Format);
  Media, Stream (Featured Carousel and its sources, Card Details, Player
  Overlay, Catalog Row Size, One-Click Play Movies, Auto Source Failover,
  Preferred Language, Skip Behavior); Media, Live TV (Channel Numbers);
  Danger Zone (Reset Appearance) (`CustomizeTab.tsx:226-588`).
- **On their own screens, on purpose:** the Sports sidebar fold, the
  theater's side width and fold, Hide finished games, Ranked only, Compact
  results, Stream's hero toggle; the Guide's hidden folders; multi-view's
  layout per count. These stay where they are used.
- The palette has three Settings entries (General, Sources, Customize;
  `features/palette/Palette.tsx:188-190`).

## What's wrong with it

1. **Four playback rows sit under "how it looks".** One-Click Play, Auto
   Source Failover, Preferred Language and Skip Behavior are what the app
   does. The filing rule from 0.8.0 is right; these rows break it.
2. **There is nowhere for what's coming.** Every item the two comparisons
   recommend (Up Next timing, auto-skip, audio output, subtitle size and
   delay, keyboard shortcuts, diagnostics, export) is a playback or an app
   setting, and neither tab has a section for them. General already holds
   four groups and two of the biggest forms in the app.
3. **Two Danger Zones,** one per tab, for two unrelated resets.
4. **Stale copy:** Customize says "Connect an AIOStreams manifest under
   General → Sources" (`CustomizeTab.tsx:278-284`); sign-in has been the
   default since plan 024.

## What the other two do

**Telly:** 13 tabs in a vertical rail (Playlists, General, Appearance,
Video, Controls, Multi-View, Account, Debrid, Media Libraries,
OpenSubtitles, Backup, Networking, Privacy). Filed by feature, so the same
question lands in several places (playback is in General, Video and the
player's own subtitle panel). Opens on Playlists every time. No search, no
global reset; nine per-section resets; four different confirmation styles
for destructive actions, several with none (deleting a theme, re-issuing a
licence key).

**AIOStreams app:** a left column in two groups, **Watching** (Playback,
Audio, Subtitles) and **App** (Interface, Shortcuts, Theme, Account,
Desktop app, About), each tab with an icon and a one-line description, then
cards of rows. Rows hide when they don't apply (Countdown hides when the
prompt is Never). Help text follows the value. Each card says where it is
kept ("Kept on this device" / "Saved to your account"). The tab is in the
address. No search; per-item resets, no Danger Zone.

**What to take:** a rail with a short description per page; rows that hide
when they don't apply; help text that follows the value; per-page resets.
**What not to take:** filing by feature (Telly), thirteen pages, settings
split between the sheet and the player (Telly's subtitle panel saves
nothing).

## The proposal: five pages, still filed by question

A rail down the left of the card, one page per question. The 0.8.0 rule
stands; it gets three more questions instead of being stretched over two
tabs.

| Page | The question | What's on it |
| --- | --- | --- |
| **Sources** | What you watch | Live TV: playlists, Refresh now, Content. Stream: AIOStreams sign-in or manifest, Connection Test. Later, per playlist under "Advanced": a guide URL and a User-Agent. |
| **Playback** | How it plays | Stream: One-Click Play, Auto Source Failover, Up Next, Skipping, Audio and subtitle language. Audio: Channels. Subtitles: Size, Delay step. Pop-out: size and corner. Later, Live: rewind length, deinterlace (after measuring). |
| **Appearance** | How it looks | Accent, Appearance, Startup Tab, Clock Format, Channel Numbers, Featured Carousel and its sources, Card Details, Player Overlay, Catalog Row Size. Its own Reset. |
| **Accounts** | Who you are | Trakt, MAL. |
| **App** | The app itself | Updates (with What's new), Keyboard shortcuts (a list now, remapping later), Privacy and data (we send nothing, Copy diagnostics, Export and import settings), Replay Onboarding, About (app, mpv and FFmpeg versions), Clear All Login Info. |

- **The rail** is 180px with an icon, name and a one-line description per
  page. Below about 640px it becomes the segmented row the tabs are today.
- **The pill stays** where a page differs per world (Sources, Playback,
  Appearance). One mental model, said the same way on each page.
- **Opens where you left it,** as today (`settingsTab.ts`).
- **The palette indexes every row:** Ctrl+K, "subtitle", Enter, and
  Settings opens on Playback scrolled to the row, highlighted for a moment.
  That is settings search without a second search box.
- **Resets per page,** in the page's own footer, with the app's two-step
  confirm. Clear All Login Info stays the one destructive action, on App.
- **Sports and multi-view stay on their own screens.** Neither comparison
  argues for moving them, and doing so would break the rule twice.

## What to add, and from where

| Item | Page | Seen in | Why | Cost |
| --- | --- | --- | --- | --- |
| Up Next: autoplay on/off, when the prompt shows (credits / N seconds before the end / never), countdown length | Playback | Telly, AIO | Ours is fixed: a 10s countdown at EOF only | Small, frontend |
| Skipping per type: button / automatic / nothing, for Intro, Recap, Credits, Preview | Playback | Telly, AIO | We have the button only; both have auto-skip | Small, frontend |
| Audio channels: Automatic / Stereo / 5.1 / 7.1 | Playback | AIO | v0.11.21 stopped forcing stereo; this is the way back for a receiver that misbehaves | Small, native command |
| Subtitle size and delay | Playback | Telly, AIO | Neither exists; delay is the one people need mid-film | Small to medium, native (`sub-*` is outside `mpv_set`'s release families) |
| Keyboard shortcuts, listed | App | AIO | Our keys are undiscoverable | Small |
| What's new in the update row | App | Telly | `latest.json` carries notes; `check_update` drops them | Small, native |
| Copy diagnostics (versions, last log lines) | App | AIO | We have no release log at all; support today is screenshots | Medium (needs the release log) |
| Export and import settings | App | Telly | Moving machines loses playlists, lists and looks | Medium |
| About: app, mpv, FFmpeg versions | App | AIO | Support | Small |
| Per-playlist guide URL and User-Agent, under Advanced | Sources | Telly | Providers with thin guides or picky servers | Medium |
| Pop-out size and corner | Playback | Telly | Ours always opens at half size, centred | Small, native |

**Not adding, and why:** telemetry (we send nothing and say so);
SOCKS5 with a kill switch (VPN territory, and it must route WebView2 too);
portable mode; custom mpv parameters (a support burden the stats overlay
can't explain); an account or licence; custom CSS and a theme editor (theme
packs are parked, `CustomizeTab.tsx:106-107`); gamepad and remotes (Adam,
2026-10-10: skip unless watched from a couch); close to tray (nothing runs
in the background until recording does).

## Build order

1. **P1, the move.** Five pages, every existing row filed by the table above,
   no new settings, the stale copy fixed. Screens before and after: only the
   Settings scenes may differ. verify-kit and the settings harnesses carried
   across.
2. **P2, the palette indexes every row.**
3. **P3, Playback additions:** Up Next, Skipping, Audio channels, subtitle
   size and delay, pop-out placement.
4. **P4, App additions:** shortcuts list, What's new, About; then the
   release log, Copy diagnostics and Export/import together.
5. **P5, Sources advanced:** guide URL and User-Agent per playlist.

## Calls for Adam

Recommendations first; each is one reply.

- **D1. Structure.** **(a) Five pages in a rail (recommended).** (b) Keep two
  tabs and only move the four playback rows under General: smallest change,
  but General becomes very long and every addition lands there. (c) One
  scrolling page with a jump list: findable, but long and flat.
- **D2. Up Next settings** (autoplay, prompt timing, countdown):
  **yes (recommended)** / no.
- **D3. Skipping** becomes per type with "automatic", keeping "Combine
  credits and preview": **yes (recommended)** / keep today's three options.
- **D4. Audio channels control:** **yes, Automatic by default
  (recommended)** / no.
- **D5. Subtitles:** **size and delay now, styling later (recommended)** /
  full styling now / neither.
- **D6. Export settings:** **logins left out (recommended)**, or included
  with a password, or included plain.
- **D7. Discord presence:** off by default if ever added. **Later
  (recommended)**, now, or never.
- **D8. Keyboard:** **a list now, remapping later (recommended)** / remap now.
- **D9. Per-playlist guide URL and User-Agent:** **yes, under Advanced
  (recommended)** / no.

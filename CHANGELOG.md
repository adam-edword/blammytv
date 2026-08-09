# BlammyTV: Changelog

What's new in the BlammyTV desktop app, newest first.

## 0.8.178: A followed club stops disappearing (2026-08-09)

### Fixed

- **Following one club no longer shows an empty Sports board that blames the
  club.** If you followed, say, Arsenal and they were not playing for a few
  days, the board went empty and said they had "no fixtures published, not
  even further out". That was simply untrue: their league was mid-season, so
  nothing had ever gone looking for Arsenal's own next game. The board now
  reaches forward for an idle club the way it already did for a whole league,
  and their next fixture appears with its real date.
- **The empty board stopped overstating what it checked.** A followed league
  is asked an open-ended "when are you next on", so an empty one really has
  published nothing. A club is asked about the coming fortnight. The message
  now says which of those it means instead of claiming the stronger one for
  both.

## 0.8.177: Pick your language once (2026-08-09)

### New

- **A preferred language for movies and shows.** Settings → Customize → Stream
  now has **Preferred Language**, with separate pickers for audio and
  subtitles. Every stream tries to load them, so a fresh install can be set to
  Japanese audio and English subs without touching a track menu.

  The player already remembered languages, but only by watching what you
  picked, which meant it did nothing until you had already picked something,
  and one click on one show quietly changed the default for every other show.
  What you set here is not overwritten that way.

  A track you choose by hand on a particular show still wins for that show,
  and anything a stream doesn't carry is left alone rather than forced.

## 0.8.175: The player stops rebuilding itself (2026-08-08)

### Improved

- **Changing channel is faster.** The video player used to be torn down and
  rebuilt from scratch every single time you switched, and the teardown
  blocked the app while it waited for the old stream's network threads to
  finish. Now one player is built when the app starts and simply told what to
  play next.
- Switching no longer flashes the desktop for a moment between channels.
- The connection count in the sidebar updates when a stream actually stops,
  instead of showing a stale number for up to a minute.

### Fixed

- Resuming something from Continue Watching asks for the artwork and the
  sources at the same time rather than one after the other, which removes a
  wait of a second or more when the title is not already on screen.
- Playback speed, audio track, subtitle track and the Settings glass effect
  no longer carry over from the last thing you watched.

## 0.8.167: The disappearing app (2026-08-08)

Some of you had BlammyTV vanish off your PC this week, mid-use. That was
Windows Defender, and it was our fault in a fixable way.

Defender's machine-learning scanner flagged the app and removed it. The
detection was a false positive, but two things about how we shipped invited
it: the program file was called `app.exe`, a generic name sitting in a
folder where unwanted software usually hides, and our installer carries no
code-signing certificate. This release renames the program to
`BlammyTV.exe`. The certificate is being sorted out separately.

**If your copy disappeared:** open Windows Security, go to Protection
history, find the BlammyTV entry, choose Actions, and pick Restore. Then
install this version over the top.

### Fixed

- The app is now `BlammyTV.exe` instead of `app.exe`, which is a large part
  of why Defender took an interest in it.
- **Sources** on a Continue Watching card takes you to the source list. On
  the Stream tab it did nothing at all for anything not in the currently
  loaded rows — which is most of what you have been watching. On the Library
  tab it quietly did the same thing as clicking the card. Both now open the
  sources.
- Dragging the playback scrubber is smoother. It was re-measuring the bar on
  every single mouse movement, which is roughly a third of the work it was
  doing.

### New

- Clicking a Continue Watching card's **title** opens its source list too.
  The artwork plays it, the words tell you where it is coming from.

## 0.8.163: Sports (2026-08-05)

A whole new half of Live TV. Sports is a hub whose objects are **games**,
not channels — it knows that Chiefs vs Bills is a thing that exists, works
out which of your own channels is showing it, and gets you watching in one
click.

That was the gap this app had. Finding a game used to mean knowing which
network had it, then hunting that network yourself among ~1,900 channels
named things like `US| ESPN2 HD`.

### New

- **A Sports tab in Live TV.** What is on right now across the top, then a
  grid per day for the next three days. Live first, because the question
  the screen answers is "what can I watch".

- **Your channels, on the card.** Every game says where you can actually
  watch it — "Live on 3 channels" — and clicking one plays it in a theater
  built on the same player the rest of the app uses. Several channels is
  normal and good: three chances at one that is not buffering.

- **151 leagues.** A picker with your favourites as tiles up top and
  everything else in one searchable column, grouped by sport. Search
  matches the sport as well as the league, so "hockey" finds all four
  hockey leagues.

- **Every sport gets the card it needs.** Two sides and a score for most of
  them; a race weekend's schedule; a tennis tournament that opens into its
  full day's draw with per-set scores and courts; and a golf leaderboard
  with the field, the flags and the score to par.

- **Racing is a league like any other.** Formula 1 sits in the defaults,
  sessions land on their real days, and a race weekend three weeks out
  shows as one schedule card rather than five loose sessions.

- **The board reaches past its own window.** Follow only F1 in August and
  the board used to be empty for eighteen days. Now a followed league with
  nothing in the next three days shows its next event on its real date, and
  a racing league shows its whole remaining season.

### Improved

- **Light mode.** The sports cards are themed rather than dark cards on a
  white page, and a pass over the whole feature lifted the small text that
  the theme change had left too faint to read.

- **The app says only what it knows.** A game we cannot connect to one of
  your channels says so plainly rather than claiming it is not on. Where we
  know a league's usual home but the schedule says nothing — most of
  tennis, and a lot of non-US football — the card offers that instead, and
  words it as the guess it is.

### Fixed

- A credential leak, a content-security policy, two Windows-only defects
  and a handful of races found by a fresh-eyes review.
- The first launch no longer waits on the guide before showing the catalog.
- Mouse back and Escape work on the sports screens, and Escape no longer
  closes the screen behind an open Settings.

## 0.8.0: Library (2026-07-26)

Your saved titles grow up. "My List" was one flat pile; now you can keep as
many lists as you like, and everything you have ever started has a home of
its own.

### New

- **Multiple lists.** Make a list for anything: Anime, Comfort Shows,
  Watch With Mum. The My List tab is now **Library**, laid out like
  Discover: Continue Watching along the top, your lists as poster cards
  below. Give a list its own cover image, or let it use the newest thing
  you put in it.

- **A home for your watch history.** The built-in **Library** card opens
  everything you have started, uncapped. Continue Watching on the Stream
  tab only shows a handful by design, so anything that scrolled off the end
  used to be effectively lost even though the app still remembered it.
  There is a Clear history action when you want it gone.

- **Save to any list from a title page.** The old "+ My List" button is now
  **Add to Library**: one click saves to your default list, and the chevron
  opens a picker with every list plus New list. The button tells you where
  a title already is ("In Anime", "In 2 lists").

- **Settings, rebuilt.** Two tabs instead of three, and everything filed by
  what you are actually asking:
  - **General**: where your content comes from (playlists and AIOStreams,
    now behind one Live TV / Stream switch), plus updates and onboarding.
  - **Customize**: how the app looks. Themes, interface, and per-side
    settings behind the same Live TV / Stream switch.

  Danger Zone is always the last thing in a tab now, instead of sitting
  halfway up the page next to ordinary settings.

### Improved

- **Back actually goes back.** Every screen now has real back/forward, and
  the mouse side buttons work everywhere, including the Library. Backing
  out of a title you opened from Discover returns you to Discover instead
  of dumping you on the Stream home page.

- **You keep your place.** Back restores the scroll position you left,
  Discover remembers what you were browsing when you flip away and back,
  and the Stream tab holds its position across tab switches. Going deeper
  into something still starts you at the top, as it should.

- **Per-show playback settings.** Subtitles, audio track and speed are
  remembered per show, so an anime and a Western drama stop fighting over
  one global preference. Volume stays global, because that is a property of
  your speakers, not your show.

- Settings scrolls to the edges of its card and fades under the header
  instead of being cut off mid-row.

- More Like This posters lean and glare like every other poster in the app.

- The settings glass no longer gives up for the rest of the session if you
  open Settings while a channel is still tuning.

### Under the hood

- **Groundwork for smaller updates.** Most releases change nothing native,
  yet every one costs a 35MB installer. The app can now accept a small,
  signed frontend-only update that applies on the next launch, with a
  signature check, a strict match against the version of the app it was
  built for, and an automatic rollback if a bundle fails to start. Nothing
  changes for you yet: this release is the first one that can carry it.

---

**Updating:** installs on 0.2.0 or newer update themselves on next launch.
On something older? Grab the installer from the release below once, and you
are on the auto-update track from there.

## 0.5.2: Themes (2026-07-13)

The first release since **0.4.43**, and it's all about making BlammyTV *yours*: a real theming system, a redesigned Customize panel, and the groundwork for premium theme packs.

### New

- **Theme packs: pick a whole look, not just light or dark.** Four packs ship free:
  - **Classic**: the original BlammyTV look, pure black.
  - **Void**: OLED true black with crushed, inky surfaces.
  - **Slate**: cool graphite with a blue-tinted edge.
  - **Paper**: warm cream by day, warm charcoal by night.

  Packs sit on top of everything else you already control: light/dark, accent color, corner style, and UI scale all still work, so you can mix and match freely.

- **Redesigned Customize panel.** Settings → Customize is now organized behind a clean pill rail (**General · Theme · Display**) with a visual pack picker (each card shows a live swatch preview) and a one-tap **Reset Appearance**.

### Coming soon

- **Premium theme packs.** The app now has a home for premium packs (first up: **Nebula**), unlocked with a license key and working offline once activated. The store isn't open yet. Every pack above is free and live today.

### Unchanged

Everything from 0.4.43 (onboarding, the boot flow, the player, Live TV, and Discover) carries forward untouched.

---

**Updating:** installs on 0.4.43 or any 0.2.0+ build update themselves on next launch. On something older? Grab the installer from the release below once, and you're on the auto-update track from here on.

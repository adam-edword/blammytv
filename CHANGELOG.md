# BlammyTV: Changelog

What's new in the BlammyTV desktop app, newest first.

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

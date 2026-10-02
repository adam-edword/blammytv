# Draft: the next installer release's changelog

Week of 2026-09-28, item 5. **A draft, not sent.** It covers v0.10.15 to
v0.10.74, everything on `claude/nice-heisenberg-67k4uk` since 0.10.14. At
release: pick the version, move the entry into `CHANGELOG.md` (newest
first), and trim what you don't want to say. Every line was checked against
its commit; the version each came from is in the comment after it, for
checking, and comes out at release.

Before it can ship, from the week's audits (details in
`week-2026-09-28.md`):
- **The Trakt and MAL keys in `.env.local` on the build machine.** They are
  baked into the native build; without them the Accounts rows ship saying
  "no keys" to everyone. RELEASING.md now says so.
- **A first real sign-in to each**, on a build with the keys: the harnesses
  run against fakes, and plan 015 and 021 list what only the real services
  can confirm.
- **The release script's guards** (version match, libmpv and ffmpeg size,
  verify-release, writing latest.json itself) and **the Download button**
  (a hot release marked latest with no installer attached sends new users
  to nothing). Both are release-process calls, yours.
- **Decision 3**, signed or not.

---

## 0.11.0: Trakt, MyAnimeList, and the player (DATE)

<!-- Version is a suggestion: an installer release with two new services
     reads as a minor bump. 0.10.62 is the other choice. -->

Connect Trakt and MyAnimeList, a new look for the player, and a long round
of fixes. This one is a full update, like 0.10.0: parts of it are in the
app itself, not only its screens, so it installs rather than arriving in
the background.

### Trakt

- **Connect in Settings → General → Accounts.** The app shows a code; Open
  Trakt takes you to the page to enter it. Nothing talks to Trakt until
  you do. <!-- v0.10.36 -->
- **What you watch here goes to Trakt.** Playing, paused and finished,
  films and episodes. Past 80% it counts as watched, on Trakt and here.
  Close the app at the credits and the watch still counts. <!-- v0.10.35, v0.10.48 -->
- **What you watched elsewhere comes in.** Episodes you watched on another
  app tick here, and where you paused something elsewhere joins Continue
  Watching. <!-- v0.10.35 -->
- **Your Trakt Watchlist is a list in your Library**, kept in step both
  ways within seconds. <!-- v0.10.35 -->
- **A film's page says when you watched it**, "Watched Sep 12". <!-- v0.10.36 -->
- Clearing a Continue Watching card clears it on Trakt too. Disconnect
  signs you out on Trakt, and Clear All Login Info includes it. <!-- v0.10.35, v0.10.36 -->

### MyAnimeList

- **Connect under Trakt**, in your browser. <!-- v0.10.41 -->
- **An anime episode you finish here moves your MAL count up to it**:
  watching, or completed at the last episode. An anime film you finish
  marks it completed. It never lowers a count you set on MAL. <!-- v0.10.41, v0.10.44 -->
- **Your MAL counts tick episodes here.** <!-- v0.10.41 -->
- Offline, or MAL busy? It waits and sends at the next sync. Disconnect
  forgets the counts here; your list on MAL isn't touched. <!-- v0.10.41 -->

### The player

- **A new look.** The controls sit in two capsules, like the nav bar, with
  Play as the white circle. <!-- v0.10.22 -->
- **A tooltip on every button**, and every tooltip in the app is the app's
  own now, not the browser's. <!-- v0.10.22, v0.10.23 -->
- **Loading a film or episode shows its art**, blurred, with its logo and
  a bar that moves as it finds a source, opens the stream and buffers.
  <!-- v0.10.21 -->
- A show's logo on its page lines up with the title under it. <!-- v0.10.20 -->

### Around the app

- **Search, Settings and the clock sit on the nav bar's line**, and with
  no Live TV source the nav bar sits in the middle. <!-- v0.10.15, v0.10.34, v0.10.37 -->
- **Ctrl+K is simpler to read**, one line per result, and Multi-view's
  picker matches it, live games included. <!-- v0.10.25, v0.10.26 -->
- **A title's sources are easier to scan**: bigger text, the quality and
  the play arrow centred on each row, and half stars drawn properly.
  <!-- v0.10.16, v0.10.17 -->
- **UI Scale is gone** from Settings → Customize. If you'd set it, the app
  opens at its normal size. <!-- v0.10.24 -->
- **Light mode is back**, in Settings → Customize → Appearance: Dark,
  Light, or Match Windows, which follows Windows as it changes. Its page is
  a light grey with white cards on it. Dark stays the default, and if you
  picked light in 0.9, it's back on. <!-- v0.10.64, v0.10.65 -->
- **Menus, Ctrl+K and tooltips are glass again**, and Settings is a
  thicker glass that stays easy to read over bright art. Turn off
  Transparency effects in Windows and they all go solid. <!-- v0.10.66 -->
- **Every time on screen follows your 12h or 24h setting**, the player's
  and Sports' included. <!-- v0.10.56 -->
- **Multi-view:** drag the live scores row with the mouse, channels with
  MP3 audio play, and the bar fits the smallest window. <!-- v0.10.18, v0.10.54, v0.10.16 -->
- **Multi-view plays `.m3u8` channels through the app's own connection**,
  as it has `.ts` since 0.9, so a provider that redirects them or leaves
  out the browser's permission header no longer stops them. <!-- v0.10.67 -->

### Fixed

- **The Guide going black on some folders.** A provider that lists a
  channel in two categories could crash it. <!-- v0.10.50 -->
- **Clear All Login Info clears everything.** A playlist and its password
  could come back, and the guide's saved copy stayed. <!-- v0.10.49 -->
- **Escape closes Settings the first time**, even right after tabbing
  through it. <!-- v0.10.43 -->
- **Golf dates and episode air dates** no longer show a day early west of
  US Eastern. <!-- v0.10.45 -->
- **A failed guide refresh keeps the guide you had**, `.xml.gz` guides
  load, and odd programme times are read instead of dropped. <!-- v0.10.50, v0.10.53 -->
- **Sports:** a game's card opens once the game is near, "Show more"
  can't add another filter's days, and the board can't get stuck loading.
  <!-- v0.10.51, v0.10.55 -->
- **Sports finds the right channel more often:** CBS Sports Network and
  FOX Sports 1 under the names ESPN uses, no college town mistaken for a
  team's channel, and MLB Network no longer offered beside a game's own
  feeds. A team's own station comes first, even from a folder you hid in
  the Guide. <!-- v0.10.70, v0.10.73 -->
- **A game's channel list folds to its heading** in the Sports theater, so
  the other games' scores below it come up; the channel playing stays in
  view, and the list stays folded until you open it. <!-- v0.10.74 -->
- **Onboarding** opens on the tab you picked, and Enter during a check no
  longer skips a step. <!-- v0.10.51 -->
- **Multi-view:** holding Delete closes one tile, not the grid; a tile
  from a playlist that failed to load plays from the saved one or says
  why. <!-- v0.10.49, v0.10.54 -->
- **Editing a Stalker playlist's portal or MAC** takes effect at once.
  <!-- v0.10.61 -->
- **An update never restarts the app over something playing**, Multi-view
  included, and a full update shows ahead of a smaller waiting one.
  <!-- v0.10.59 -->
- **The Guide scrolls lighter**: a third of the layout work each time the
  rows move, and opening from the saved guide skips a pass over every
  programme. <!-- v0.10.62 -->
- **Discover, Stream's rows and Sports open faster**: a card waits until
  you point at it to measure itself for its tilt. <!-- v0.10.63 -->
- Smaller: Ctrl+K's channel search keeps working past half an hour, the
  mini player's Retry stays mini, Continue Watching keeps its wide art,
  dragging the accent colour saves once, and the Guide only takes back a
  pop-out it opened. <!-- v0.10.49, v0.10.51, v0.10.57, v0.10.58 -->

### Safer updates

- A version that has started fine before gets a second chance if one
  launch fails (a power cut, closing it in the first second), instead of
  being rolled back. <!-- v0.10.38 -->
- Updates only move forward, to exactly the files they're signed for.
  <!-- v0.10.46, v0.10.47 -->

# Copy audit before 0.12 (2026-10-15)

Adam had the Settings rail's subtitles removed (v0.11.56): "AI loves to do
this, its starting to become a tell tale sign". This is the rest of the app's
user-facing copy read for the same tells. Four read-only reviewers (onboarding
and Settings; Stream, Live, Sports and the player; the docs; the website,
CHANGELOG and README), each line checked here against the file it names.

The target voice is the site's FAQ ("Yup." "Nope." "None.") and CLAUDE.md's
Writing style. "Fix" is my call; "yours" is taste that is Adam's to make;
"keep" means leave it.

## The app: onboarding, Settings, Ctrl+K

| Where (apps/app/src/) | Now | Proposed | Call |
|---|---|---|---|
| app/Onboarding.tsx:833 | "We'll check the connection for real before moving on." | "We check it before you move on." | fix |
| aiojf/AioCode.tsx:40, settings/AioStreamsTab.tsx:323, settings/TraktSection.tsx:167 | "Copied!" | "Copied" | fix |
| app/Onboarding.tsx:1151 | "You're all set" | "Done." | fix |
| app/Onboarding.tsx:1159 | "Settings holds a lot more to make BlammyTV yours: sources, playback, and a few surprises." | "The rest is in Settings." | fix |
| app/Onboarding.tsx:1073 | "Make it yours" | "Accent and clock" | fix |
| app/Onboarding.tsx:731 | "Signed in as {name}. Nice." | drop "Nice." | fix |
| app/Onboarding.tsx:495 | "Connected, {n} catalogs found. Nice." | "Connected. {n} catalogs." | fix |
| app/Onboarding.tsx:907 | "Light up channels and the guide. Pick the format your provider..." | "Pick the type your provider gave you." | fix |
| app/Onboarding.tsx:832 | "Paste your AIOStreams manifest URL to power movies and series." | "Paste your AIOStreams manifest URL. Stream's movies and series come from it." | fix |
| app/Onboarding.tsx:915 | "...already connected. Adding another is optional." | drop the second sentence | fix |
| app/Onboarding.tsx:1076 | "Pick an accent and a clock. There's more in Settings." | delete | fix |
| app/Onboarding.tsx:1106 | "The screen BlammyTV opens on. You can change it anytime in..." | delete | fix |
| settings/PlaylistsTab.tsx:51 | "Connect an Xtream Codes account: the server URL, username, and password from your provider." | delete (the fields say it) | fix |
| settings/PlaylistsTab.tsx:52 | "Point at an M3U playlist URL from your provider." | keep only the guide sentence | fix |
| settings/PlaylistsTab.tsx:54 | "Connect a Stalker/MAG portal: the portal URL and the MAC address your provider registered." | "Use the MAC address your provider registered." | fix |
| settings/AioStreamsTab.tsx:246, :298 | "It powers the movies and series..." | "Stream's movies and series come from it..." | fix |
| settings/AppearancePage.tsx:207 | "Light, dark, or whatever Windows is set to." | delete | fix |
| settings/AppearancePage.tsx:217 | "Where the app opens." | delete | fix |
| settings/AppearancePage.tsx:227 | "How the header clock reads." | delete | fix |
| settings/ShortcutsSection.tsx:29 | "Every key the app answers to, by where it works." | delete | fix |
| settings/AboutSection.tsx:39 | "What this install is made of. Handy to have when you ask for help." | "Send these when you ask for help." | fix |
| settings/AppPage.tsx:66 | "Walk through the welcome setup again. Nothing gets reset." | "Nothing gets reset." | fix |
| settings/PlaylistsTab.tsx:497, HeroSourcesSection.tsx:132 | "...Check the playlist's credentials, and note the browser..." | "Couldn't reach the server. Check the playlist's login." / "...Check the URL." | fix |
| settings/aioProbe.ts:91 | "This instance sits behind Cloudflare bot protection, which is..." (four sentences) | "Cloudflare's bot check on this instance is blocking app traffic from your network. Nothing on your PC can fix it. Ask whoever hosts it to exempt it, or move your config to another instance." | fix |
| settings/aioProbe.ts:100 | "The instance rejected the request. If this URL worked before, ..." (five sentences) | "The instance refused the request. Copy the manifest URL from its configure page again. Still refused? Ask whoever runs it to check for a firewall or bot protection." | fix |
| AioStreamsTab:178, JellyfinTab:139, TraktSection:149, MalSection:152, UpdatesSection:126 | "Last sync hit a snag:" / "Update check hit a snag:" | "Last sync failed:" / "Update check failed:" | fix |
| settings/PlaybackPage.tsx:214 | "What happens at an intro, recap, credits or preview, from the..." | "From the file's chapters and skip markers. Combine makes the credits and the preview after them one jump." | fix |
| settings/AppearancePage.tsx:258 | "The big sliding banner at the top of Stream. Off removes it entirely and the rows start at the top." | "The big sliding banner at the top of Stream." | fix |
| settings/AppearancePage.tsx:405 | "Show the provider's channel number beside the name." | "From your provider." | fix |
| settings/SettingsFilesSection.tsx:123 | Export's note (long) | "Saves your settings to a file, for another PC or a backup. Playlists, and the favourites, recents, guide fixes and multi-view grid that point at them, go in only if you tick the box. Sign-ins never do." | fix |
| settings/SettingsFilesSection.tsx:210 | Import's note (five sentences, the list twice) | "Replaces your settings with a file from Export. Your sign-ins stay. A file with playlists brings its favourites, recents, guide fixes and grid too. The window restarts." | fix |
| settings/UpdatesSection.tsx:127 | "Updates install themselves with one click and keep your playlists." | | keep: "keep your playlists" answers a real worry |
| SourcesPage.tsx:38, AccountsPage.tsx:13 | the "Sources" / "Accounts" eyebrow repeating the page name | | keep: layout, not copy |

## The app: Stream, Discover, Live TV, Sports, the player

| Where (apps/app/src/features/) | Now | Proposed | Call |
|---|---|---|---|
| stream/StreamScreen.tsx:2219-2221 | "...or just try again in a minute." (3) | "...or try again in a minute." | fix |
| stream/StreamScreen.tsx:2219 | "You're signed in, but every catalog came back empty. Check your AIOStreams sign-in..." | "Every catalog came back empty. Try again in a minute." | fix |
| sports/SportsScreen.tsx:785 | "The game is still on; your provider just doesn't carry the networks showing it." | "Your provider doesn't carry the networks showing it." | fix |
| sports/SportsScreen.tsx:1003 | "That is rare, so it is worth looking again shortly." | "Check back later." | fix |
| live/TheaterOverlay.tsx:2449, :2450 | "This source isn't responding. It's the stream, not you." | "This source isn't responding." | fix |
| stream/StreamScreen.tsx:2140 | "Movies and shows, one tab over from live" | "No movies or shows yet" | fix |
| discover/DiscoverScreen.tsx:519 | "Something new to watch" | "Nothing to discover yet" | fix |
| stream/StreamScreen.tsx:2141, discover/DiscoverScreen.tsx:520 | "...and the catalog appears here." / "...and this tab fills itself." | "Sign in to your AIOStreams or your Jellyfin in Settings → Sources → Stream." | fix |
| live/LiveScreen.tsx:971, :972 | "Starred channels fill the guide here." / "Recently watched channels land here." | delete | fix |
| live/Hero.tsx:88 | "This channel has no programme data right now." | delete (under "No Information") | fix |
| discover/DiscoverScreen.tsx:667-668 | "Nothing here" / "The catalog returned no titles" | "No titles", no second line | fix |
| live/MultiviewGrid.tsx:583 | "A live game or any channel. Or press..." | "Or press A" | fix |
| live/MultiviewScoresFilter.tsx:32 | "The sports it shows. Changes apply as you make them." | delete | fix |
| sports/SportsScreen.tsx:784 | "None of these are matched to channels yet. Add a playlist in Settings and BlammyTV will line these games up against it." | "Add a playlist in Settings → Sources to match these to channels." | fix |
| sports/SportsScreen.tsx:956, :986 | "...this usually clears itself. Nothing is lost while it does." | "It retries on its own." | fix |
| sports/SportsScreen.tsx:990 | "Favourite a few more sports and the board fills itself." | delete (the button says it) | fix |
| stream/LibraryScreen.tsx:445-446 | "Anything you start watching lands in your Library on its own. Make..." | "What you watch lands here. Make a list for the rest." | fix |
| live/MultiviewNotice.tsx:71-72 | "Normal playback is unaffected." | delete | fix |
| live/LiveScreen.tsx:1145 | "Recents fill in as you tune around." | delete | fix |
| sports/SportsSidebar.tsx:269 | "Clubs appear here once there are games to follow them to." | "No clubs yet. They show up once they have games." | fix |
| live/TheaterOverlay.tsx:2480 | "Try next available source" | "Try the next source" | fix |
| stream/StreamScreen.tsx:1979 | "Bring It Back" | "Bring it back" | fix |
| sports/LeaguePicker.tsx:340 | "Remove from Favorites" | "Remove from favorites" | fix |
| live/MultiviewTile.tsx:717 | "Trying again." | delete (the title says it) | fix |
| discover/Recommender.tsx:194 | "What do you want to watch?" | | yours: it's a question to you in a box you type into |

## The docs (services/docs/src/content/docs/)

Fix all of these unless marked. The reviewer found no em dashes, emoji or
buzzwords beyond "elegant".

- start/first-launch.md:32-35: "Setup verifies, it doesn't just collect" / "uses in anger rather than a URL format check" / "the actual reason" → "Setup tests each source" / "the same connection the app makes" / "the reason".
- start/first-launch.md:57-58: "Set this honestly rather than aspirationally. It's the screen you'll see every single launch." → "Pick the one you use most. You'll see it every launch."
- start/first-launch.md:67: "A nudge towards Settings. That's it." → "A pointer to Settings."
- start/first-launch.md:74: "rather than just that" → drop it.
- start/first-launch.md:7-8, :36: reassurance padding → "Five questions and a short tour. Skip any of them: it's all in Settings later." and drop :36.
- start/install.md:30: "Essentially any machine from the last..." → "Any PC from the last ten years has one."
- start/install.md:15-16: "This is expected and it isn't a compromise." → "It's a false positive."
- sources/aiostreams.md:29: "That's it. BlammyTV notices the approval..." → "BlammyTV notices the approval and fills the Stream tab."
- sources/aiostreams.md:43, :129, :133, :161: "not quite the same as browsing over a manifest", "That distinction matters more than it sounds.", "That one line is usually the whole diagnosis.", "One bad catalog never sinks the tab." → delete each.
- sources/aiostreams.md:126, :136, :140: "actually returns titles", "Two failures worth naming", the doubled emphasis → "returns titles", "Two common failures", one clause.
- sources/index.md:26, sources/m3u.md:34, :45, sources/stalker.md:21, sources/jellyfin.md:124: "worth an", "a property of the playlist, not a fault", "a real parse", "exactly as you would", "as a promise" → plain.
- using/stream.md:25, :46-49, :61, :64: "Same cards, same behaviour.", "two differences that matter for VOD", "because there's something to seek through", "Only real choices count", "ride every playback" → plain.
- using/live-tv.md:26-27, :37, :51: "make this screen yours", "a property of your source, not a fault", "actually doing" → plain.
- troubleshooting/playback.md:7, :9, :12, :16-17, :21, :25-26, :65, :73-74: "Start here.", "First, ask the player what it thinks", "actually doing rather than", the drumbeat closer, "not just playback", "worth reading" → plain ("## Open the stats overlay", "## The whole app is slow").
- how-it-works/index.md:6, :10, :62, :102: throat-clearing and the "No page views, no session tracking, no third-party" triple → plain. Keep :49 ("Nothing of ours"): the privacy page can say it twice.
- how-it-works/defender.md:3, :8-9, :18, :23, :25, :41, :45, :53, :68: "Here's why it happens, because 'trust me' isn't an answer...", "Not for want of trying.", "actually said", "weighed rather than ignored", "entirely optional", "You don't have to take our word" → plain.
- contributing/architecture.md:6, :7, :31, :32, :50-51, :59-60 and contributing/building.md:40: "The interesting part.", "That's the honest record. This page is the map.", "simply", "Worth remembering", "actually developed under" → delete or plain.
- index.mdx:3, :6, :31 and astro.config.mjs:19: "A free, elegant IPTV and Stremio player" → "A free IPTV and Stremio player"; "Here's the whole path." → "Every host it talks to, listed."

Facts the reviewers tripped over (not tells, but wrong):
- index.mdx's "Add your sources" card lists Xtream, M3U, Stalker and AIOStreams, not Jellyfin.
- how-it-works/updates.md "Turning it off" never says how to turn updates off.
- Settings → Appearance's Reset note ("Accent, appearance and clock back to defaults") leaves out that it turns channel numbers back on.

## The website (services/site/index.html): yours

The site reads like you wrote it, so this is your call line by line. Two are
rule breaks I'd fix whatever you decide, and two are bugs:

- fix: :6 the page title has an em dash ("BlammyTV" then a dash) → "BlammyTV: a free IPTV and Stremio player for Windows".
- fix: :723 "Windows may show 'Unknown publisher', then a dash" → two sentences.
- fix (bug): :529-537, :610 the screenshots' alt text is copy-pasted and wrong ("BlammyTV discover grid" on the Guide shot, "theme customization" on the player).
- fix (bug): :692 "$12.50*" has an asterisk with no footnote.
- yours: "elegant", "premium", "beautiful", "beautifully", "Seamless onboarding", "Native Viewing Experience", "in one app", "You bring the content; BlammyTV makes it beautiful.", "Elegant, Premium, Yours!", "make it truly yours", "Enjoy", "the best way to support". My pick: drop the adjectives and "experience", keep your own jokes ("Cute!", "Themes key lost! Help!", "Glow Up with Themes").

## CHANGELOG.md (Unreleased)

- fix: :10-11, the intro sentence restating the heading → delete.
- fix: :59 "**More of Playback is yours:**" → "**New in Settings → Playback:**".
- fix: :12 "A full update, like 0.11.12: parts of it are in the app itself, so it installs." → "This one runs the installer, like 0.11.12."
- fix: :55 "**Surround reaches a surround setup.**" → "**5.1 and 7.1 play in surround.**"
- fix: :83 "scrolls more smoothly" (never measured) → delete.
- fix: :93 "tidy icon rail" → "a rail of icons".
- fix: :99-101, the multi-view sound sentence → "On some PCs Multi-view was silent in 0.11.12. A tile plays its own sound until the app's copy has some, and takes it again if it goes quiet."
- keep: :22 and :44 "picks up where you left off" (chosen today).
- at release: :7-8, the "held for plan 027" note goes.

## README.md

Fix all:
- :69, :79 em dashes → colons.
- :7 the tagline triad under the header → delete.
- :23 "built for one job: making live TV and on-demand feel effortless" → "a free Windows player for live TV and on-demand."
- :25 "the whole design goal is a boomer-proof experience: ... just watch" → "The goal is boomer-proof: anyone can open it and watch."
- :29, :31, :33 "Live TV with a real guide", "A player that doesn't compromise", "Personal & local" → "Live TV", "Native player", "Profile and theme".
- :23, :89 "real 4K60" / "true 4K60" → "4K60"; :39 "battle-tested" → drop; :89 "the interesting bit:" → drop.
- :15-16 "(It's an unsigned indie app, not malware.)" and "That's all you need to start watching" → delete.
- :37 "v0.0.x: a ground-up rebuild, targeting the new Figma designs" is stale (the app is 0.11) → rewrite or delete the Status block.

## Also decided here

- One spelling for "favorites": the app and docs mix "favourites" and
  "favorites". Pick US "favorites" (Adam is in the US and the code says it),
  in the user-visible text only.
- Harnesses that assert exact copy get the new text in the same change.

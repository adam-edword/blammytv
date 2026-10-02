# Plan 015: Trakt

**Status: BUILT, v0.10.27 to v0.10.36 (2026-09-27), not yet run against
the real Trakt.** B1 to B5 and D6 are in: the native side (v0.10.27), the
rules as pure functions (v0.10.28), scrobbling, sync and the Trakt
Watchlist (v0.10.35), and the Settings row and the film page's mark
(v0.10.36). What is left is Adam's: register the Trakt app, put its keys
in `.env.local`, rebuild, and connect. ROADMAP M4's first half. MAL is the
second half and gets its own plan after this ships.

**Unchecked against the real Trakt**, because the build box cannot reach
it: an episode's history entry dated `"unknown"` (the docs allow it, the
contract's schema says datetime), a film scrobble with `title` and `year`
beside the IMDb id, the redirect URI a refresh sends, and whether the
access token lives 7 days or 24 hours. Each is one line to change if the
first real run says otherwise.

**Adam's picks, 2026-09-27:** D2 (b), a "Trakt Watchlist" list of its own;
D3, both sides count (the three-way merge); D4 (a), the secret in the app
and the tokens in Windows Credential Manager; D6 (b), a "Watched" mark on
the film's page. All four as recommended. D1 (T1 to T5) and D5 (skip
titles with no IMDb id) were not put to him separately and follow the
recommendation; D7 is his to keep in mind, no code.

Adam, 2026-09-27: "then we can plan out Trakt". Trakt has been a 1.0 gate
since July (ROADMAP decision 2), with one condition: a plan before any
code, "the conflict rules are the hard part and should be decided on
paper". This is that paper. Seven decisions below, each with a
recommendation.

## What Trakt offers, checked

Read on 2026-09-27 from Trakt's own API source (github.com/trakt/trakt-api,
the contract and the developer guides; its docs site is blocked from the
build box), not from memory:

- **Sign-in is the device flow**, made for apps like this one: the app asks
  `auth.trakt.tv/oauth/device/code` for a short code, shows it with
  `trakt.tv/activate`, and polls until you approve it in a browser. No
  redirect, no local web server.
- ~~The client secret is required to finish the sign-in, to refresh and
  to sign out.~~ **Changed by 2026-10-02:** Trakt no longer issues a
  secret (a new app's page says "Not issued"; it moved to PKCE), and its
  API source marks `client_secret` optional and deprecated on every
  `/oauth` body, never to be sent from a desktop app. The device sign-in
  takes the code and the client id. The app sends no secret since v0.10.68.
- **Tokens:** the device guide says an access token lasts 7 days; Trakt's
  March 2025 announcement says 24 hours. The code reads `expires_in` and
  never assumes either. **Refresh tokens are single-use:** each refresh
  returns a new one and kills the old, so two refreshes at once sign you
  out.
- **Scrobbling:** `scrobble/start`, `/pause`, `/stop`, each with the
  progress in percent. A stop above 80% counts as watched and lands in
  your history; between 1% and 79% it is saved as paused progress
  (`/sync/playback`), which is how other apps resume where you left off.
  Under 1% is refused (422); the same item twice in a row is refused (409).
- **Sync:** watched history, watched progress, paused progress, watchlist,
  lists, ratings, collection, all under `/sync`, plus `last_activities`,
  one call that says what changed since you last looked.
- **Rate limits:** one write per second per user, 500 reads per 5 minutes.
  Plenty for this; the queue below keeps writes to one a second.
- **Free accounts are capped** on the watchlist and personal lists (a 420
  with the limit in a header). Reported caps: two personal lists of 100
  items, a watchlist of 250 since 2026. History and scrobbling are not
  capped.
- **Ids line up.** Trakt takes IMDb ids, and every title BlammyTV stores is
  keyed by one (`tt1234567`, episodes `tt1234567:1:2`). Titles from
  catalogs keyed by something else (Kitsu, for anime) have no IMDb id.
- **Registering the app** needs a Trakt account with a verified GitHub
  account connected. Its terms include: "Trakt data cannot be used in apps
  or websites that promote copyright infringement or piracy."

## What BlammyTV has today

| Store | What it holds | Limits |
|---|---|---|
| `lists` | Your Library lists, "My List" first. Card snapshots, keyed by IMDb id. | none |
| `watchedEpisodes` | Episode checkmarks per series, marked when an episode plays to its end. | 600 per series |
| `watching` | Continue Watching, and the Library's history view. Position and duration; a movie at 90% counts as finished. | 20 entries |

There is no ledger of watched MOVIES (a finished film is a Continue
Watching entry past 90%), and no ratings.

## What it does (recommended scope, D1)

**T1. Connect.** Settings → General, a Trakt row: Connect shows the code
and opens `trakt.tv/activate`; once approved it shows your name, when it
last synced, Sync now and Disconnect (which revokes the token).

**T2. What you watch goes to Trakt.** Playing a film or an episode
scrobbles it: start, pause, stop, with the real percentage. When Trakt
answers "scrobble" (it counted as watched), BlammyTV marks it watched
too, so the two never disagree about the 80% line. Offline, a finished
watch is queued and sent later as a history entry with the time you
watched it.

**T3. What you watched elsewhere comes in.** Episodes watched on Trakt
(another app, your phone) tick in the episode grid, and the series' next
episode follows. Films watched on Trakt are remembered (D6 decides where
that shows).

**T4. Where you left off comes in.** Trakt's paused progress joins
Continue Watching, the most recent first. Clearing a card (hold to clear)
clears its paused progress on Trakt too, or it would come back on the
next sync.

**T5. The watchlist.** Two-way, per D2.

**Not in this plan:** Trakt's personal lists (a free account gets two, of
100), ratings, collection, check-ins, comments, recommendations,
calendars. And MAL.

## Decisions

**D1. Scope.** T1 to T5 above. *Recommend all five.* T2 alone makes
BlammyTV a good Trakt citizen, but T3 and T4 are why anyone connects: your
phone's progress showing up here.

**D2. Which list is the watchlist.**
- (a) "My List" is the Trakt watchlist. One list, one button. On connect
  the two merge, so up to 250 of your saved titles go to Trakt (a free
  account's cap), and disconnecting leaves the merged result.
- (b) **A "Trakt Watchlist" list** appears in Library, two-way. My List
  stays yours and is never sent anywhere. Saving to it is choosing that
  list in the save menu.
*Recommend (b)*: nothing you have is touched or uploaded by connecting,
the free cap can only bite on that one list, and disconnecting is clean.
(a) is less clutter, if you would rather have one list.

**D3. The conflict rules.** The hard part, decided per kind of data:
- **Watched:** a watch is a fact, so nothing is ever deleted. BlammyTV
  only adds to Trakt's history. Coming in, Trakt is the ledger: an episode
  you un-mark on Trakt un-ticks here too, since BlammyTV has no un-mark of
  its own and Trakt is where a mistake gets fixed. On first connect, what
  BlammyTV already ticked goes to Trakt once.
- **Progress:** the newest position wins, by its timestamp, whichever
  side it came from.
- **The watchlist:** a three-way merge against the last synced copy.
  Added on either side since then: added to both. Removed on either side
  since then: removed from both. Removed on one side and added again on
  the other: kept. The first sync has no last copy, so it is the union.
  An item Trakt refuses at the cap stays local and says why.
*Recommend all three.* The alternative for the watchlist, "Trakt always
wins", loses anything you added here while offline; "never delete" means
removing a title on your phone never takes it off here.

**D4. Where the secret and your tokens live.**
- (a) **The client secret is built into the app** (from `.env.local` at
  build time, never committed, like the TMDB key), your tokens live in
  Windows Credential Manager, and every Trakt call is made from Rust, so a
  token never reaches the page or localStorage.
- (b) The secret stays on `services/keybox`, which does the sign-in and
  every refresh for the app. The secret never ships, but every refresh
  (daily, if the 24-hour figure holds) needs keybox up.
- (c) Tokens in localStorage, where playlist passwords are today.
*Recommend (a).* A secret inside any desktop app can be dug out of the
binary, so it was never going to be what keeps you safe; your token is,
and (a) keeps it in the OS's own vault. (b) protects the secret at the
price of a server that has to be up for you to stay signed in. It is a
native change, so a rebuild.

**D5. Titles with no IMDb id** (anime from Kitsu-keyed catalogs).
*Recommend skipping them* silently. MAL covers anime next.

**D6. Where a film watched on Trakt shows.** (a) Nowhere yet, stored for
later. (b) **A "Watched" mark on the film's page.** (c) A tick on every
poster too. *Recommend (b)*: it makes the sync visible where you would
look, and the poster tick is a design question for its own day.

**D7. The terms.** Trakt's API terms rule out apps that "promote copyright
infringement or piracy". BlammyTV plays the sources you bring and
promotes none, and the site and the app's copy should keep it that way.
*No code; yours to keep in mind*, since Trakt can revoke an app's key.

## What Adam does

1. Create the Trakt app at `app.trakt.tv/settings/apps` (needs your
   GitHub connected on Trakt). Name BlammyTV; for the redirect URI, the
   out-of-band `urn:ietf:wg:oauth:2.0:oob` (the device flow never
   redirects, but a refresh sends back whatever is registered); no CORS
   origins, since the calls come from Rust.
2. Put its Client ID in `apps/app/.env.local` as `TRAKT_CLIENT_ID`. Never
   paste it in chat. (There is no secret any more: the app page says "Not
   issued".)

## Build order

1. **B1, native (a rebuild):** `trakt.rs`. Sign-in and polling at the
   interval Trakt gives, the tokens in Credential Manager, one request
   command that adds the headers, refreshes on 401 and retries once, one
   refresh at a time behind a lock (single-use refresh tokens), honours
   `Retry-After` on 429, and a write queue at one a second.
2. **B2:** the Settings row (T1).
3. **B3:** scrobbling and the offline queue (T2).
4. **B4:** watched and progress in (T3, T4), each sync opening with
   `last_activities` and skipping what has not changed. It runs at
   launch, when the window comes back after 15 minutes away, after a
   playback ends, and on Sync now.
5. **B5:** the watchlist (T5, D2, D3).

**Harness:** `scripts/fake-trakt.mjs`, a fake Trakt the way `fake-aio`
is a fake AIOStreams, so nothing touches the real one on CI. A
`verify-trakt` covering the sign-in (code shown, pending, approved,
denied, expired), the scrobble calls a play, a pause and an ending send,
a tick arriving from Trakt, a paused film joining Continue Watching,
every watchlist merge case in D3, a 420 at the cap, a 401 that refreshes,
and Disconnect. The merge itself is a pure function with unit tests, one
per rule.

## Risks

- **Two refreshes at once sign you out** (single-use refresh tokens). One
  lock in Rust, and a test that fires two expired requests together.
- **Trakt changes the rules again.** The token lifetime moved once in
  2025 and the free caps twice. Read `expires_in` and `X-Account-Limit`;
  hard-code neither.
- **What cannot be checked from the build box:** the real sign-in, the
  real caps on your account, and Credential Manager. Those are Adam's
  first run.

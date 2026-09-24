Full report below.

## Audit report: BlammyTV v0.9.79 (claude/nice-heisenberg-67k4uk), bugs and security

**Tool results (all read-only):**
- `pnpm typecheck`: pass (exit 0).
- `pnpm test`: 64 files, 810 of 810 tests pass. The only stderr is the expected `localStorage is not defined` warnings from node.
- `pnpm lint`: clean (exit 0).
- `node scripts/check-rust.mjs`: passed.
- `cargo clippy --target x86_64-pc-windows-gnu`: 9 warnings, all at `mpv.rs:89-103`. That is the baseline, so nothing new.
- IPC cross-check: all 35 `invoke(...)` calls (in `lib/tauri.ts`, `lib/http.ts` and `lib/playerPerf.ts`) match a registered `#[tauri::command]` by name, camelCased argument names and types. No mismatch found. Five commands are registered but no frontend code calls them: `open_external`, `inv_focus`, `inv_stop_slot`, `mpv_blur` and `mpv_snapshot`. `openExternal` and `tauriMpvBlur` exist in `tauri.ts` but nothing calls them.

Scratch notes are in `/tmp/audit-bugs/notes.md`; the node repro for F6 and F8 is `/tmp/audit-bugs/scrub.mjs`.

---

### F1. HIGH. Sports tuning and multi-view stop working 30 minutes after the catalog loads. CONFIRMED
- **Where:**
  - `apps/app/src/features/live/source.ts:153-158` (`peekLive`)
  - `features/sports/catalog.ts:21-29` (`tunedChannel`)
  - `features/sports/SportsTheater.tsx:180-184`
  - `features/sports/MultiviewScreen.tsx:72,90`
- **Evidence:**
  - `return cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS ? cache.data : null;`
  - `const real = tunedChannel(channel.id); ... if (!real) return;`
- **Trigger:** open the Sports tab (or a game) and stay more than 30 minutes (`CACHE_TTL_MS`). Nothing refreshes the catalog: `useCatalog` only loads once on mount, and LiveScreen is unmounted. From then on:
  - Clicking a rail channel, a game's autoplay and failover all silently do nothing.
  - The multi-view search returns nothing, and picks never resolve to a URL.
  - The board keeps showing matches, because `useCatalog` holds its own copy of the catalog.
- **Also immediately after launch:** a disk-hydrated launch sets `cache.at = disk.at` (source.ts:207). That value is usually hours old, so `peekLive()` is null right away until the guide phase lands, which is up to a minute on a big provider.
- **Fix:** give `tunedChannel` and MultiviewScreen the catalog `useCatalog` already holds, or add a `peekLive({ allowStale: true })` for id lookups.

### F2. MED. A `loadLive` call during a stale window defeats the guard against downgrading the guide. CONFIRMED
- **Where:** `features/live/source.ts:167-170` against the guard at `:315-319`.
- **Evidence:** `if (Date.now() - cache.at < CACHE_TTL_MS) return cache.data; cache = null;`
- **Trigger:** launch with a disk snapshot more than 30 minutes old, then go to Sports while the XMLTV is still downloading.
  - `useCatalog` calls `loadLive`, which nulls the cache.
  - The background channel-phase write then sees `cache == null`, so the `downgrades` check is false and it writes the channels-only snapshot.
  - Returning to the Guide shows empty "Guide still downloading" lanes in place of the hydrated guide. This is the regression the guard's own comment describes.
- **Fix:** don't null a stale cache when an in-flight load for the same key exists. Let the join happen and keep the old snapshot until something newer lands.

### F3. MED. A guide phase from an older config overwrites the cache and the disk snapshot of the newer one. CONFIRMED
- **Where:** `features/live/source.ts:271-291`
- **Evidence:** `cache = { key, at, data: full }; scheduleDiskPut(key, at, full); announceRefresh();`. Nothing checks that `key` is still the current config.
- **Trigger:** hide a folder or flip the adult filter (both change the cache key) while the first load's XMLTV is still downloading. Load A's guide phase lands after config B's channel phase. Then:
  - The cache holds key A, so `peekLive()` is null for B.
  - The single IndexedDB record is overwritten with A.
  - `announceRefresh` makes LiveScreen call `loadLive` for B, which starts another full playlist and XMLTV download.
- **Fix:** before writing, check that `key === cacheKey(enabledSources())` (or compare with a generation counter). Skip both the write and the announce otherwise.

### F4. MED (security). The Recommender puts unscrubbed transport errors on screen: the addon manifest URL (a credential) and the TMDB `api_key`. CONFIRMED
- **Where:** `features/discover/Recommender.tsx:121-126`, rendered at `:232`.
- **Evidence:** `message: e instanceof Error ? e.message : String(e),` then `<p className="rec__note rec__note--bad">{state.message}</p>`
- **How it leaks:**
  - `resolveVodItem` calls `fetchMeta`, which goes to `http_get`. A reqwest timeout or DNS error string is `error sending request for url (<full URL>)`.
  - TMDB's `ask()` puts `api_key=` in the query (`tmdb.ts:144-148`).
  - This app's bug reports are screenshots, so the text on screen ends up shared.
- **Trigger:** use the recommender with the addon host or TMDB unreachable, or timing out.
- **Fix:** `message: scrubbedMessage(e)`. Also strip the query from TMDB URLs, not just keep the origin.

### F5. LOW-MED (security). Console probes print credentials on transport errors. CONFIRMED
- **Where:**
  - `features/discover/tmdb.ts:371`: `return \`failed: ${e instanceof Error ? e.message : String(e)}\`` is printed by `btvTmdb()` at `discover/probe.ts:85` and includes `api_key`.
  - `discover/probe.ts:69,134,218`: `console.error("[probe] discover failed:", e)` prints the raw error, which contains the manifest URL (the header of probe.ts promises it never does).
- **Trigger:** run `btvTmdb()` or `btvDiscover()` while the network fails.
- **Fix:** pass every probe error through `scrubbedMessage`.

### F6. LOW (security). The URL scrubber stops at `)`, `'` and `"`, so the rest of a credential leaks. CONFIRMED with node
- **Where:** `apps/app/src/lib/errors.ts:10`: `/https?:\/\/[^\s"')]+/gi`
- **Repro:** `...password=se)cret&type=m3u)` becomes `http://h.example/…)cret&type=m3u)`.
- **Why it happens:** M3U URLs are the user's raw string, and `encodeURIComponent` does not escape `'()!*`, so a password containing these characters survives into the Xtream stream path.
- **Fix:** match up to the closing `)` of reqwest's `for url (...)` wrapper, or run `URL` parsing on each candidate span and drop everything after the origin.

### F7. LOW. The popout leaks an initialized mpv instance (an orphan PiP window) when the URL contains a NUL byte. CONFIRMED path
- **Where:** `src-tauri/src/mpv.rs:377-388`
- **Evidence:** `let curl = CString::new(url).map_err(|_| "url has a null byte")?;` runs after `mpv_initialize` and never calls `terminate_destroy`, and no watcher thread is spawned.
- **How the NUL gets in:**
  - `validUrl` (`features/live/source.ts:851-858`) and `httpUrl` (`stream/mapper.ts:273-277`) return the raw string, not `u.href`.
  - `new URL("http://h/a\u0000b.ts")` parses fine (it becomes `%00`), which I verified.
- **Trigger:** a playlist or addon URL containing `\0`, then clicking Pop out. The in-app player is already torn down by then.
- **Fix:** build the `CString` before `mpv_create`, and have `validUrl` return `u.href`.

### F8. LOW (security). The hot channel's version string accepts `..` and `.`, and the manifest fields are not covered by the signature. CONFIRMED with node
- **Where:** `src-tauri/src/frontend.rs:377-382` (validator), `:405-407`, and `:563-593`.
- **Evidence:** the validator only rejects chars outside `[A-Za-z0-9.-]`, so `..` passes. That gives `let dest = root.join(version); let _ = std::fs::remove_dir_all(&dest);`, and `remove_dir_all` then deletes `%APPDATA%\com.blammytv.app`.
- **The signature gap:** `verify()` signs only the bundle bytes. `version`, `nativeVersion` and `url` in `frontend.json` are unsigned. A tampered manifest can therefore:
  - pair a genuinely signed old bundle with a new version name, or
  - lie in `nativeVersion`, which is "the whole safety property" of the hot channel.
- **Trigger:** needs the ability to publish the release manifest. The test `refuses_a_version_that_is_not_a_version` does not cover `".."` or `"."`.
- **Fix:** reject version strings without a digit, or any path component equal to `.` or `..`. Sign the manifest, or embed version and nativeVersion inside the signed tarball and check them there.

### F9. MED. LiveScreen mounts its `#inv-chrome` host whether or not anything plays, and two checks read it as "playing". CONFIRMED
- **Where:**
  - `features/live/LiveScreen.tsx:766-774` (appended on mount with `[]` deps)
  - `lib/playingNow.ts:15-19`
  - `features/settings/UpdatesSection.tsx:120-125`
  - `app/AppHeader.tsx:208`
- **Evidence:** `playingNow.ts` claims the host is "appended to the body only while a stream is mounted", which is false for Live. SportsTheater (`:410-419`) and StreamScreen guard against exactly this; LiveScreen does not.
- **What breaks:**
  - On the Guide with nothing playing, Settings → Updates "Restart now" is disabled with "Finish watching first".
  - The `/`, Ctrl+K and Ctrl+F search shortcut is dead on the Guide.
  - After Stop or Pop out, the host keeps its last inline left/top/width/height as an empty `position:fixed; z-index:45` layer. If it keeps the theater or fullscreen rect, it swallows clicks on the guide (or the whole window). SUSPECTED: it depends on whether a rAF re-places it at the mini rect before InvertedPlayer unmounts.
- **Fix:** key the host effect on `playUrl`, as SportsTheater does.

### F10. LOW. Multi-view never stops a running popout, so it takes an extra provider connection and plays double audio. CONFIRMED
- **Where:** `features/live/MultiviewTile.tsx` and `features/sports/MultiviewScreen.tsx`. The only `tauriPopoutStop` calls in the app are in StreamScreen. mpv's `play_wid` is the only enforcement of "one connection" (`mpv.rs:698`), and the web tiles bypass it.
- **Trigger:** pop out a Live channel, go to Sports → Multi-view, and fill the grid up to the line's cap. One tile fails to tune, and the PiP audio plays over the focused tile.
- **Fix:** call `tauriPopoutStop()` when MultiviewScreen mounts.

### F11. LOW. LiveScreen's popout-closed listener reclaims popouts it did not start. CONFIRMED
- **Where:** `features/live/LiveScreen.tsx:543-548`: `return onPopoutClosed(() => { if (heroIdRef.current) setPlaying(true); });`
- **Trigger:** pop out in the Sports theater, switch to Guide, then close the PiP. Live auto-plays its last recents channel, not the game.
- **Fix:** record which host popped out (a module flag set in `onPopout`) and ignore the event otherwise.

### F12. LOW. The MultiviewScreen resolve effect cancels its own in-flight resolves, and failed picks hold a slot forever. CONFIRMED
- **Where:** `features/sports/MultiviewScreen.tsx:86-105`
- **Evidence:** deps `[picked, urls]`, plus `if (!real) continue;` and a silent `() => undefined` on rejection.
- **What happens:**
  - Every URL that lands re-runs the effect, sets `dead = true` on the other picks' in-flight Stalker `create_link` calls, and fires them again. That is duplicate token requests per pick.
  - A pick whose channel lookup or resolve fails stays in `picked` and counts toward `cap`, while its tile reads "Nothing here yet" with no error.
- **Fix:** track in-flight ids in a ref and drop `urls` from the deps. Remove or flag picks that fail.

### F13. LOW. Multi-view tile focus is an index, so the audio jumps between streams. CONFIRMED
- **Where:** `features/live/MultiviewGrid.tsx:37,80-86` (`focused={i === focus}`)
- **Trigger:** either of these moves sound to a different channel with no click:
  - deselect an earlier pick while listening to a later one, or
  - have Stalker picks resolve out of order (`streams` is filtered by resolution).
- **Fix:** hold focus as a stream id.

### F14. LOW. The grid-size clamp overwrites the saved preference. CONFIRMED
- **Where:**
  - `features/live/MultiviewGrid.tsx:49-51`: `if (usable !== null && usable !== size) onSize(usable);`
  - `onSize` is `setGrid`, which calls `saveGridSize` (`features/sports/SportsScreen.tsx:203-206`).
- **Trigger:** choose 4 on a 5-connection line, open multi-view on a 3-connection line, go back. It stays at 3, which contradicts `multiviewAck.ts`'s "clamped on read" design.
- **Fix:** clamp at render (`usable`) and don't persist it.

### F15. LOW. Console probe `mpvGet("path")` prints the stream URL with credentials, and `mpv_set` lets the webview write any mpv property. CONFIRMED (the second is SUSPECTED as an exploit, since it needs XSS)
- **Where:** `lib/playerPerf.ts:335-337`, `src-tauri/src/lib.rs:273-276`.
- **Detail:**
  - `playerDiag` deliberately hides `path`, but `mpvGet` does not.
  - The `mpv_set` comment says it "cannot load a file", yet all of these are writable runtime properties:
    - `stream-record=<path>` gives an arbitrary file write.
    - `glsl-shaders`, `external-files` or `sub-files` set to a UNC path leak NTLM credentials.
    - `ytdl-raw-options` is a command-execution vector if yt-dlp is installed.
- **Fix:** denylist `path`, `filename`, `stream-open-filename` and `playlist*` in `mpvGet`. Allowlist keys in `mpv_set`, or compile it only in debug builds.

### F16. LOW. ESPN fetches have no timeout and sit behind a 6-slot gate. SUSPECTED (network-dependent)
- **Where:** `features/sports/espn.ts:476-480`: `raw = await gate(async () => { const res = await fetch(url, { signal }); ...`. `loadMore` and `loadEarlier` (`useGames.ts:695,746`) pass no signal at all.
- **Trigger:** six stalled responses hold all six slots, so every later board request queues forever and the board sits in "loading".
- **Fix:** `AbortSignal.any([signal, AbortSignal.timeout(15000)])`.

### F17. LOW. The XMLTV parser drops spec-valid programmes. CONFIRMED
- **Where:** `features/live/xmltv.ts:128,176-179`
- **Detail:**
  - The regex needs all 14 digits (`YYYYMMDDhhmmss`), but the XMLTV spec makes the rightmost fields optional. A `200607011800 +0100` feed parses to nothing.
  - `stop` is optional in the spec, yet `stop == null` drops the programme. A guide with no stop times ends up empty.
- **Fix:** make the seconds optional (and the minutes too). When stop is missing, infer it from the next programme's start.

### F18. LOW. M3U channel names that contain a comma are truncated. CONFIRMED
- **Where:** `features/live/m3u.ts:111-114` (the name is taken after the LAST unquoted comma).
- **Trigger:** `#EXTINF:-1 tvg-id="x",Law, Order SVU` gives the name "Order SVU".
- **Fix:** take everything after the first unquoted comma that follows the duration and attributes.

### F19. LOW. The hot-channel boot sentinel is armed on every boot, so one interrupted launch quarantines a good bundle permanently. CONFIRMED
- **Where:** `src-tauri/src/frontend.rs:134-143,186-193`
- **Trigger:** close the app, crash, or lose power before React mounts on any launch of a staged bundle, not just the first. That version is quarantined and never re-staged, so the user runs the embedded frontend until the next release.
- **Fix:** only arm the sentinel on the first boot of a version (check `active.previous != active.version`), or require N consecutive failures.

### F20. LOW. The Updates row hides the native installer when a hot bundle is pending, and native install restarts mid-playback. CONFIRMED
- **Where:** `features/settings/UpdatesSection.tsx:94-105,76-85`. The `pending` branch replaces the "Install vX" button. `install()` has no `isPlaying()` check, unlike "Restart now".
- **Fix:** show both, and gate install the same way.

### F21. LOW. The overlay's programme start label ignores the 12h/24h setting. CONFIRMED
- **Where:** `features/live/stream.ts:200-203`: `programme.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })`. The Guide, Hero and header all use `formatClock(..., clockFmt)`.
- **Fix:** use `formatClock` with `loadClockFormat()`.

### F22. SUSPECTED (needs live ESPN data). Games can fall off the board when ESPN's date bucket differs from the local (Central) date
- **Where:** `features/sports/useGames.ts:415-418`: `games: onDay(all[i].games, date, i === 0)`. Each day's fetch is filtered only against its own date.
- **Trigger:** a game at 11pm to midnight Central (for example a Hawaii home game) that ESPN files under the next Eastern date. It is filtered out of day i+1 and never fetched for day i, so it appears nowhere.
- **Fix:** pool the games from all fetched days, then bucket by local date.

### F23. LOW (perf only). The accent colour drag writes four localStorage keys and restyles the root on every pointer move. CONFIRMED
- **Where:** `features/settings/AccentPicker.tsx:187`: `onChange={pickCustom}`, where `pickCustom` calls `saveCustomAccent`, `saveAccent`, `saveAccentStyle` and `saveAccentPairedBy`.
- **Fix:** apply live while dragging, persist on pointer-up or with a debounce.

---

**Checked and found fine:**
- `http_get` and `http_probe` log only the origin.
- `mpv_diag` excludes `path`.
- Stalker `create_link` URLs are http(s)-only.
- Addon stream URLs are scheme-checked.
- The CSP has `script-src 'self'`, and the only `dangerouslySetInnerHTML` renders vendored, build-time SVGs.
- Capabilities are minimal.
- Listeners, intervals and observers balance in every file.
- The hls.js and mpegts.js instances are destroyed on unmount.
- `InvertedPlayer` and `useDirectOverlay` clean up.
- The popout watcher's lock ordering holds.
- Sports `dayLabel` survives DST (it rounds against midnight).
- `windowStart` is correct in local time.

**Not checkable from here:** anything needing real video, the Windows build, libmpv runtime behaviour, a real Stalker portal, or live ESPN and TMDB responses. That covers the F9 click-eating timing, F16 and F22.

**Status: DONE.** Read-only audit; nothing was edited and nothing was committed.

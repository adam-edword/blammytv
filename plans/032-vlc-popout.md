# Plan 032: Pop out films and shows in VLC

Status: DECIDED (2026-10-28, Adam and Chad). Native half built in v1.0.20; the page half waits on Home phase 1 (plan 033), which is splitting StreamScreen.

Chad's request: watch films and episodes in VLC instead of BlammyTV's own
player.

## Decided

- Scope: films and episodes only. Live pop-out stays in BlammyTV for now.
- The in-app player is unchanged.
- No Skip Intro or Up Next in VLC.
- Tracking stays on: Continue Watching, resume and Trakt, all from the app side.

## Setting

- Settings → Playback: Pop Out Films and Shows In, BlammyTV (default) or VLC.
- Stored like the other playback settings, in Ctrl+K and the settings export.

## Native (Rust)

- Finding VLC: look in the registry (`HKLM\SOFTWARE\VideoLAN\VLC`, then the
  32-bit view), then the default Program Files paths.
- Not found: return a clear error, and the page shows "VLC isn't installed"
  with a download link to videolan.org.
- The launch: start `vlc.exe` with:
  - the source URL (http/https only, the same rule as `mpvurl::http_only`);
  - the playlist's User-Agent (`--http-user-agent`);
  - the title (`--meta-title`);
  - the resume position (`--start-time`);
  - the web interface on, bound to 127.0.0.1, with a random port and a
    random password for each launch (`--extraintf=http --http-host=127.0.0.1
    --http-port=<n> --http-password=<random>`).
- The command line: the URL and password must never reach the logs. Same
  rule as mvproxy.rs and rec.rs ("never logs a path or query"): origins only,
  through `mvproxy::origin_of`.
- Tracking: poll `http://127.0.0.1:<port>/requests/status.json` every 5s or
  so for position, length and state (playing, paused, stopped). Emit a
  `vlc-progress` event to the page.
- Shutdown: stop polling when the VLC process exits or the endpoint stops
  answering.
- Leftovers: BlammyTV leaves no VLC processes behind on exit beyond the
  user's own window. Open: whether quitting BlammyTV closes VLC. Leaning
  towards leaving VLC open.

## Page

- Branching: the VOD pop-out checks the setting. VLC means the native launch
  instead of today's pop-out window (mpv.rs's popout).
- Progress: `vlc-progress` drives the same paths the in-app player uses:
  saving position for Continue Watching, marking watched near the end, and
  Trakt scrobble start, pause and stop.
- Live: live pop-out is untouched.

## Checks

- Host crate:
  - the VLC finder against a fake registry and paths;
  - argument building (escaping, User-Agent, start time; the password never
    logged);
  - the status poller against a fake `status.json` server (playing, paused,
    ended, gone).
- Harness:
  - the setting's default and storage;
  - a VOD pop-out with VLC chosen calls the native command, not the pop-out
    window;
  - a live pop-out still opens in BlammyTV;
  - fake `vlc-progress` events update Continue Watching and send Trakt calls;
  - the "VLC isn't installed" message.
- Mutations:
  - live going to VLC must fail;
  - progress being ignored must fail.

## Can't check here

- A real VLC on Windows.
- Whether the 127.0.0.1-only listener triggers a Windows Firewall prompt
  (confirm on Adam's PC).
- The exact `status.json` fields across VLC versions.

## Size

M. Native launch and poller about a day; page wiring and checks about a day.

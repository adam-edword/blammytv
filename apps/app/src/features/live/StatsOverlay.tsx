import { useEffect, useState } from "react";
import { tauriMpvStats, type MpvStats } from "../../lib/tauri";
import { StatsIcon } from "../../ui/icons";

/**
 * "Stats for nerds" — a compact glass panel of live playback telemetry for the
 * inverted player's theater/fullscreen chrome. Polls `mpv_stats` once a second
 * while mounted (independent of the OverlayApi — the numbers come straight from
 * the Tauri command, so it works on either the direct or bridge api path) and
 * renders a labeled key/value list. Missing properties skip their row.
 */

/** Resolution as `1920×1080` — decoded picture size, falling back to output. */
function resolution(s: MpvStats): string | null {
  const w = s.videoW ?? s.width;
  const h = s.videoH ?? s.height;
  return w && h ? `${w}×${h}` : null;
}

/** A bits/sec rate as `X.X Mbps`. */
function mbps(bits: number): string {
  return `${(bits / 1e6).toFixed(1)} Mbps`;
}

/** Build the ordered, formatted rows, dropping any field mpv didn't report. */
function buildRows(s: MpvStats): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  const res = resolution(s);
  if (res) rows.push(["Resolution", res]);
  // 3 significant figures, trailing zeros trimmed (25 fps, 59.9 fps, 30 fps).
  if (s.fps != null) rows.push(["Frame rate", `${Number(s.fps.toPrecision(3))} fps`]);
  if (s.videoCodec) rows.push(["Video", s.videoCodec]);
  if (s.videoBitrate != null) rows.push(["Video rate", mbps(s.videoBitrate)]);
  if (s.audioCodec) rows.push(["Audio", s.audioCodec]);
  if (s.audioBitrate != null) rows.push(["Audio rate", mbps(s.audioBitrate)]);
  if (s.hwdec) rows.push(["Hardware decode", s.hwdec]);
  if (s.dropped != null) rows.push(["Dropped frames", String(s.dropped)]);
  if (s.cache != null) rows.push(["Buffer", `${s.cache.toFixed(1)} s`]);
  return rows;
}

export function StatsOverlay() {
  const [stats, setStats] = useState<MpvStats | null>(null);

  useEffect(() => {
    let live = true;
    const poll = () => {
      tauriMpvStats()
        .then((s) => {
          if (live) setStats(s);
        })
        .catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, 1000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, []);

  const rows = stats ? buildRows(stats) : [];

  return (
    <div className="stats-overlay" data-interactive aria-live="polite">
      <p className="stats-overlay__head">
        <StatsIcon size={14} />
        Stats for nerds
      </p>
      {rows.length === 0 ? (
        <p className="stats-overlay__empty">Gathering…</p>
      ) : (
        <dl className="stats-overlay__list">
          {rows.map(([label, value]) => (
            <div className="stats-overlay__row" key={label}>
              <dt className="stats-overlay__key">{label}</dt>
              <dd className="stats-overlay__val">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

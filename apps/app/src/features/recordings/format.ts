import { scrubbedMessage } from "../../lib/errors";
import type { RecRecord } from "../../lib/tauri";
/** How a recording reads in a row: how long, how big, why it stopped. */

/** "0:07", "12:34", "1:02:03". Whole seconds, rounded down; never negative. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "0 KB", "512 KB", "4.2 MB", "48 MB", "1.5 GB". Binary units, one decimal
 * where it earns its place (under 10 MB, and in GB). */
export function formatSize(bytes: number): string {
  const b = Math.max(0, bytes);
  if (b < 1024 ** 2) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 ** 3) {
    const mb = b / 1024 ** 2;
    return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
  }
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

/** Native's reason is a lowercase fragment ("stream lost"); said as a
 * sentence it is "Stream lost." */
export function reasonLine(reason: string): string {
  const r = reason.trim().replace(/\.+$/, "");
  return r ? `${r[0].toUpperCase()}${r.slice(1)}.` : "";
}

/**
 * What a finished recording says about its work (plan 029, Phase 4), or "" when
 * there is none to say. The status slot of its row: a job waiting for its turn
 * ("Waiting to Shrink"), under way with how far ("Shrinking 70%"), and once
 * done, what the repackaging and shrinking took off the file ("Saved 1.2 GB").
 * "Finishing" is the repackaging, which the person didn't ask for and needn't
 * know the name of.
 */
export function jobLine(r: Pick<RecRecord, "job" | "progress" | "saved">): string {
  if (r.job) {
    const shrink = r.job === "shrink";
    if (r.progress == null) return shrink ? "Waiting to Shrink" : "Waiting to Finish";
    const pct = Math.round(Math.min(1, Math.max(0, r.progress)) * 100);
    return `${shrink ? "Shrinking" : "Finishing"} ${pct}%`;
  }
  return r.saved ? `Saved ${formatSize(r.saved)}` : "";
}

/** What Record says when it could not start: the fragment native gave, as the
 * app says every other fragment ("Couldn’t load: …"), and how to fix it where
 * the fix is the person's. */
export function startFailure(reason: string): string {
  const r = reason.trim().replace(/\.+$/, "");
  const fix = /folder|disk space/i.test(r) ? " Pick another folder in Settings → Playback." : "";
  return `Couldn’t record${r ? `: ${r}` : ""}.${fix}`;
}

/** A rejection as the words in it: native rejects with a string, a failed
 * link lookup with an Error, whose words can carry the lookup's URL (a Stalker
 * one holds the portal's token), so it goes through the app's scrub. */
export const plainError = scrubbedMessage;

import { fetchConnections } from "../../data/xtream";
import { tauriRecScheduleFail } from "../../lib/tauri";
import { loadLive, lookupLive } from "../live/source";
import { resolveStreamUrl, streamUserAgent } from "../live/stream";
import { loadPlaylists } from "../settings/playlists";
import { loadRecordingsFolder } from "../settings/recordingsFolder";
import { plainError } from "./format";
import { endsBefore, handOver } from "./schedule";
import { listNow, startRecording, stopRecording, type Recording } from "./store";

/**
 * A scheduled programme's start has come (plan 029, Phase 3): native says so
 * (`due`) and the page does the one part native cannot, which is finding the
 * link. The index never holds one, so a provider's credentials are not in a
 * file on disk, and a Stalker link, which expires, is made as it is needed.
 *
 * Then it is `rec_start` as Record in the player does it, with the scheduled
 * record's id: native starts the recording in the record's place, and stops it
 * at the record's stop time, with or without this page.
 *
 * Padding never clashes: back to back on a one-stream line, this start comes
 * due a minute before the earlier programme ends, and that recording is still
 * running (and would run a minute more). It is stopped at its programme's end
 * and this one starts then (`makeRoom`).
 *
 * A start native refused leaves the record Failed with native's reason. Only
 * a link this page could not make is reported back (`rec_schedule_fail`),
 * which native ignores for a record that is no longer waiting.
 */
const claiming = new Set<string>();

/** The channel's link now, and the playlist's User-Agent. Throws a plain
 * fragment (as native's reasons are) when there is none. */
async function target(rec: Recording): Promise<{ url: string; userAgent?: string }> {
  const live = lookupLive() ?? (await loadLive(new Date()));
  const channel = live.channels.find((c) => c.id === rec.channelId);
  if (!channel) throw "the channel is no longer in the playlist";
  const url = await resolveStreamUrl(channel);
  if (!url) throw "there is no link for this channel";
  return { url, userAgent: streamUserAgent(channel.id) };
}

/** The line's limit, for an Xtream playlist that reports one. Null for the
 * rest, and when it can't be asked: then nothing is stopped and the start is
 * left to say what the provider thinks, as for a line with no limit. */
async function lineOf(playlistId: string): Promise<{ max: number } | null> {
  const p = loadPlaylists().find((x) => x.id === playlistId);
  if (p?.kind !== "xtream") return null;
  return fetchConnections(p).catch(() => null);
}

/** When the line is full only because an earlier recording is in its padding,
 * wait for that programme's end and stop it. Whatever goes wrong here, the
 * start is still tried. */
async function makeRoom(rec: Recording): Promise<void> {
  try {
    // Asked only when there is such a recording: no request otherwise.
    if (!endsBefore(listNow(), rec.playlistId, rec.startedAt).length) return;
    const plan = handOver(listNow(), await lineOf(rec.playlistId), rec.playlistId, rec.startedAt);
    if (!plan) return;
    await new Promise((done) => setTimeout(done, Math.max(0, plan.at - Date.now())));
    // Cancelled meanwhile: the earlier one runs to its own padding.
    if (!listNow().some((r) => r.id === rec.id && r.status === "scheduled")) return;
    for (const id of plan.stop) await stopRecording(id).catch(() => {});
  } catch {
    // The start below finds out whether there was room.
  }
}

export async function claimDue(rec: Recording): Promise<void> {
  if (claiming.has(rec.id)) return;
  claiming.add(rec.id);
  try {
    await makeRoom(rec);
    const { url, userAgent } = await target(rec);
    await startRecording({
      url,
      userAgent,
      channel: rec.channel,
      programme: rec.programme ?? undefined,
      playlistId: rec.playlistId,
      folder: loadRecordingsFolder(),
      scheduleId: rec.id,
    });
  } catch (e) {
    await tauriRecScheduleFail(rec.id, plainError(e).replace(/\.+$/, "")).catch(() => {});
  } finally {
    claiming.delete(rec.id);
  }
}

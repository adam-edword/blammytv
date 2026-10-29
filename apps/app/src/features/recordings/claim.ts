import { tauriRecScheduleFail } from "../../lib/tauri";
import { loadLive, lookupLive } from "../live/source";
import { resolveStreamUrl, streamUserAgent } from "../live/stream";
import { loadRecordingsFolder } from "../settings/recordingsFolder";
import { plainError } from "./format";
import { startRecording, type Recording } from "./store";

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

export async function claimDue(rec: Recording): Promise<void> {
  if (claiming.has(rec.id)) return;
  claiming.add(rec.id);
  try {
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

import { formatWhen } from "../../lib/time";
import type { Channel, Programme } from "../live/model";
import { resolveStreamUrl, streamUserAgent } from "../live/stream";
import { loadClockFormat } from "../settings/clockFormat";
import { loadRecordingsFolder } from "../settings/recordingsFolder";
import { plainError, startFailure } from "./format";
import { PAD_MS, clash } from "./schedule";
import {
  deleteRecording,
  listNow,
  playlistOf,
  scheduleRecording,
  startRecording,
} from "./store";

/**
 * Right-click a programme in the Guide → Record (plan 029, Phase 3). Each
 * answers with the line the Guide's toast says, and never rejects.
 *
 * A programme that is on starts now and stops a minute after its end, through
 * the same `rec_start` as Record in the player (the reason it could not start
 * is the toast). One that is yet to come is kept by native (`rec_schedule`),
 * which starts it a minute before. Either way the line is counted first, over
 * the span the recording will hold a connection, and a clash is said now.
 *
 * Always a stream of its own, never the player's buffer (D3): that has no
 * end time, so a one-connection line records a programme that is on only when
 * nothing else holds the line.
 */
export async function recordProgramme(
  channel: Channel,
  programme: Programme,
  line: { max: number } | null,
  now = Date.now(),
): Promise<string> {
  const playlistId = playlistOf(channel.id);
  const start = programme.start.getTime();
  const end = programme.end.getTime();
  const on = start <= now;
  const verb = on ? "record" : "schedule";
  const why = clash(listNow(), line, playlistId, on ? now : start - PAD_MS, end + PAD_MS);
  if (why) return `Couldn’t ${verb}: ${why}.`;
  try {
    if (on) {
      const url = await resolveStreamUrl(channel);
      if (!url) throw "there is no link for this channel";
      await startRecording({
        url,
        userAgent: streamUserAgent(channel.id),
        channel: channel.name,
        programme: programme.title,
        playlistId,
        folder: loadRecordingsFolder(),
        until: end,
      });
      return `Recording ${programme.title}.`;
    }
    await scheduleRecording({
      channelId: channel.id,
      channel: channel.name,
      programme: programme.title,
      playlistId,
      start,
      end,
    });
    const when = formatWhen(programme.start, new Date(now), loadClockFormat());
    return `Scheduled to record ${programme.title} (${when}).`;
  } catch (e) {
    const reason = plainError(e);
    return on ? startFailure(reason) : `Couldn’t schedule: ${reason.replace(/\.+$/, "")}.`;
  }
}

/** Cancel a scheduled programme. */
export async function cancelProgramme(id: string): Promise<string> {
  try {
    await deleteRecording(id);
    return "Recording canceled.";
  } catch (e) {
    return `Couldn’t cancel: ${plainError(e).replace(/\.+$/, "")}.`;
  }
}

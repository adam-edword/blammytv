import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Hint } from "../../ui/Hint";
import { RecordIcon } from "../../ui/icons";
import { loadRecordingsFolder } from "../settings/recordingsFolder";
import { formatDuration, plainError, startFailure } from "./format";
import { findRunning, recKey, startRecording, stopRecording, useRecordings } from "./store";

/** What the player knows when Record is pressed: the stream to ask for NOW
 * (a Stalker link is fetched fresh, its token is short-lived) and the
 * playlist's own User-Agent. Null when there is no link to record. */
export type RecordTarget = { url: string; userAgent?: string } | null;

const WHY_MS = 12_000;

/**
 * Record, in the live player's controls (plan 029, D1 and D2). Pressing it
 * hands the channel's link to native, which records on its own: switching
 * channel, Go Live and closing the player leave it running. A channel with a
 * running recording shows Stop Recording, a red dot and how long, whenever
 * the player comes back to it (matched by playlist and name, as the record
 * keeps them).
 *
 * The reason it could not start sits next to the button until the next press.
 */
export function RecordButton({
  playlistId,
  channel,
  programme,
  resolve,
  className,
}: {
  playlistId: string;
  channel: string;
  /** The programme on now, when the guide has one. */
  programme?: string;
  resolve: () => Promise<RecordTarget>;
  /** The capsule's paint (TheaterOverlay's IN_CAPSULE). */
  className?: string;
}) {
  const recs = useRecordings();
  const mine = recKey(playlistId, channel);
  const running = findRunning(recs, playlistId, channel);
  // Which channel the press was for: a press outlives a channel switch, and
  // its busy state and its reason belong to the channel it was made on.
  const [busy, setBusy] = useState<{ key: string; what: "start" | "stop" } | null>(null);
  const [why, setWhy] = useState<{ key: string; text: string } | null>(null);
  const whyTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(whyTimer.current), []);
  const say = (key: string, text: string) => {
    setWhy({ key, text });
    window.clearTimeout(whyTimer.current);
    whyTimer.current = window.setTimeout(() => setWhy(null), WHY_MS);
  };

  // The clock, only while there is something to count.
  const [now, setNow] = useState(() => Date.now());
  const runId = running?.id;
  useEffect(() => {
    if (!runId) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [runId]);

  const mineBusy = busy?.key === mine ? busy.what : null;

  const press = async () => {
    if (mineBusy) return;
    window.clearTimeout(whyTimer.current);
    setWhy(null);
    const key = mine;
    if (running) {
      setBusy({ key, what: "stop" });
      try {
        await stopRecording(running.id);
      } catch (e) {
        say(key, `Couldn’t stop: ${plainError(e).replace(/\.+$/, "")}.`);
      } finally {
        setBusy((b) => (b?.key === key ? null : b));
      }
      return;
    }
    setBusy({ key, what: "start" });
    try {
      const target = await resolve();
      if (!target) throw "there is no link for this channel";
      await startRecording({
        url: target.url,
        userAgent: target.userAgent,
        channel,
        programme,
        playlistId,
        folder: loadRecordingsFolder(),
      });
    } catch (e) {
      say(key, startFailure(plainError(e)));
    } finally {
      // Only this channel's: a press on another while this one waited is its own.
      setBusy((b) => (b?.key === key ? null : b));
    }
  };

  const label = running
    ? mineBusy === "stop"
      ? "Stopping Recording…"
      : "Stop Recording"
    : mineBusy === "start"
      ? "Starting Recording…"
      : "Record";
  const text = why?.key === mine ? why.text : null;

  return (
    <div className="theater-tracks rec-btn">
      <Hint side="top" label={label} off={!!text}>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          className={
            "player__btn " +
            (className ?? "") +
            (running ? " rec-btn--on w-auto gap-2 px-3.5" : "")
          }
          aria-label={label}
          aria-pressed={!!running}
          aria-busy={!!mineBusy}
          aria-disabled={!!mineBusy}
          onClick={() => void press()}
        >
          {running ? (
            <>
              <span className="rec-dot" aria-hidden />
              <span className="rec-btn__time">{formatDuration(now - running.startedAt)}</span>
            </>
          ) : (
            <RecordIcon size={20} className={mineBusy ? "rec-btn__wait" : undefined} />
          )}
        </Button>
      </Hint>
      {text && (
        <p className="track-menu rec-btn__why" role="alert">
          {text}
        </p>
      )}
    </div>
  );
}

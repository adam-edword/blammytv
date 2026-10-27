import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Hint } from "../../ui/Hint";
import { RecordIcon } from "../../ui/icons";
import { loadRecordingsFolder } from "../settings/recordingsFolder";
import { loadRecordingWarning, saveRecordingWarning } from "../settings/recordingWarning";
import { formatDuration, plainError, startFailure } from "./format";
import { recordWay } from "./recordWay";
import {
  findRunning,
  recKey,
  startBufferRecording,
  startRecording,
  stopRecording,
  useRecordings,
} from "./store";

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
 * On a line that allows one connection there is none to spare for a second
 * stream, so Record reads the player's own buffer instead (D3, recordWay),
 * after a dialog that says what that means. It ends when the player's
 * channel does, and the button follows native's word on that like any other.
 *
 * The reason it could not start sits next to the button until the next press.
 */
export function RecordButton({
  playlistId,
  channel,
  programme,
  resolve,
  line,
  className,
}: {
  playlistId: string;
  channel: string;
  /** The programme on now, when the guide has one. */
  programme?: string;
  resolve: () => Promise<RecordTarget>;
  /** This channel's line, as the panel last reported it: its limit decides
   * whether Record can open a connection of its own. Null when the playlist
   * reports none (Stalker, M3U) or has not answered yet. */
  line?: { max: number } | null;
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

  // The buffer dialog, and its "Don't Show Again" box. It belongs to the
  // channel it was opened on.
  const [ask, setAsk] = useState(false);
  const [dontAsk, setDontAsk] = useState(false);
  useEffect(() => setAsk(false), [mine]);

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
    // `true`: this button is only drawn by the player, for the channel it shows.
    // recordWay's other branch is for a caller that records some other channel.
    const way = recordWay(line, true, loadRecordingWarning());
    if (way === "ask") {
      setDontAsk(false);
      setAsk(true);
      return;
    }
    await begin(way);
  };

  /** Start it, and show why not if it cannot. Native refuses a second buffer
   * recording itself, so a double press needs no guard beyond `busy`. */
  const begin = async (way: "stream" | "buffer") => {
    const key = mine;
    setBusy({ key, what: "start" });
    try {
      const folder = loadRecordingsFolder();
      if (way === "buffer") {
        await startBufferRecording({ channel, programme, playlistId, folder });
      } else {
        const target = await resolve();
        if (!target) throw "there is no link for this channel";
        await startRecording({
          url: target.url,
          userAgent: target.userAgent,
          channel,
          programme,
          playlistId,
          folder,
        });
      }
    } catch (e) {
      say(key, startFailure(plainError(e)));
    } finally {
      // Only this channel's: a press on another while this one waited is its own.
      setBusy((b) => (b?.key === key ? null : b));
    }
  };

  const go = () => {
    setAsk(false);
    if (dontAsk) saveRecordingWarning(false);
    void begin("buffer");
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
      <Dialog open={ask} onOpenChange={setAsk}>
        <DialogContent showCloseButton={false} className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Record What You’re Watching</DialogTitle>
            <DialogDescription>
              Your line allows one stream, so this records from the picture you’re watching. It stops
              if you change channels, go live, or the stream reconnects.
            </DialogDescription>
          </DialogHeader>
          <label className="settings-check">
            <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
            <span>Don’t Show Again</span>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAsk(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={go} autoFocus>
              Start Recording
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { tauriRecShow } from "../../lib/tauri";
import { formatWhen } from "../../lib/time";
import { loadClockFormat } from "../settings/clockFormat";
import { formatDuration, formatSize, jobLine, plainError, reasonLine } from "./format";
import { deleteRecording, stopRecording, useRecordings, type Recording } from "./store";

const STATUS: Record<Recording["status"], string> = {
  recording: "Recording",
  done: "Done",
  partial: "Partial",
  failed: "Failed",
  scheduled: "Scheduled",
  missed: "Missed",
};

/** "Couldn’t delete: the file is in use or read-only." */
const couldnt = (what: string, e: unknown): string =>
  `Couldn’t ${what}: ${plainError(e).replace(/\.+$/, "")}.`;

/** Delete takes two presses, like Library's Delete and Clear History: the
 * second inside four seconds. */
function DeleteButton({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <Button
      variant={armed ? "destructive" : "outline"}
      size="sm"
      type="button"
      className={armed ? "" : "hover:border-destructive hover:text-destructive"}
      onClick={() => {
        window.clearTimeout(timer.current);
        if (!armed) {
          setArmed(true);
          timer.current = window.setTimeout(() => setArmed(false), 4000);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? "Click Again to Confirm" : "Delete"}
    </Button>
  );
}

/**
 * The recordings, newest first (plan 029, D4): the Live TV sidebar's
 * Recordings mode and Library's section are this one list. A running one
 * counts its size as native reports it and offers Stop Recording where
 * Delete would be, because native refuses to delete a file it is writing.
 *
 * A programme scheduled from the Guide (Phase 3) is a row with no file yet:
 * its programme's start where the date goes, "Scheduled" for the status and
 * Cancel Recording for the only action. One whose start was missed says so and
 * can only be deleted.
 */
export function RecordingList({
  playingId,
  onPlay,
  onBeforeDelete,
  empty = null,
}: {
  /** The recording the player has open, which a Delete lets go of first. */
  playingId?: string | null;
  onPlay: (id: string) => void;
  /** Called just before a Delete: Windows refuses to delete a file the
   * player holds. */
  onBeforeDelete?: (id: string) => void;
  /** What to draw with no recordings at all. */
  empty?: ReactNode;
}) {
  const recs = useRecordings();
  const [errs, setErrs] = useState<Record<string, string>>({});
  const say = (id: string, text: string | null) =>
    setErrs((m) => {
      const next = { ...m };
      if (text) next[id] = text;
      else delete next[id];
      return next;
    });

  // The clock of a running one, ticking only while one runs.
  const [now, setNow] = useState(() => Date.now());
  const anyRunning = recs.some((r) => r.status === "recording");
  useEffect(() => {
    if (!anyRunning) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [anyRunning]);

  if (recs.length === 0) return <>{empty}</>;
  const clock = loadClockFormat();
  return (
    <ul className="rec-list">
      {recs.map((r) => {
        const running = r.status === "recording";
        const waiting = r.status === "scheduled";
        // Neither a scheduled nor a missed recording has a length or a size.
        const empty = waiting || r.status === "missed";
        const ms = (r.endedAt ?? now) - r.startedAt;
        const when = formatWhen(new Date(r.startedAt), new Date(now), clock);
        const reason = r.reason ? reasonLine(r.reason) : "";
        // A reason is for a job that ended; one being tried again doesn't show it.
        const jobWhy = r.jobReason && !r.job ? reasonLine(r.jobReason) : "";
        // A job under way takes the status slot; what it saved follows the size.
        const work = jobLine(r);
        return (
          <li
            key={r.id}
            className={"rec-row" + (r.id === playingId ? " rec-row--playing" : "")}
            data-id={r.id}
            data-status={r.status}
            data-job={r.job ?? undefined}
            aria-current={r.id === playingId ? "true" : undefined}
          >
            <div className="rec-row__main">
              <h4 className="rec-row__title">{r.programme ?? r.channel}</h4>
              <p className="rec-row__sub">
                {r.programme ? `${r.channel} · ` : ""}
                {when}
              </p>
              <p className="rec-row__meta">
                <span className={"rec-row__status rec-row__status--" + r.status}>
                  {running && <span className="rec-dot" aria-hidden />}
                  {r.job ? work : waiting && r.due ? "Starting" : STATUS[r.status]}
                </span>
                {!empty && ` · ${formatDuration(ms)} · ${formatSize(r.bytes)}`}
                {!r.job && work && ` · ${work}`}
              </p>
              {reason && <p className="rec-row__why">{reason}</p>}
              {jobWhy && <p className="rec-row__why">{jobWhy}</p>}
              {errs[r.id] && (
                <p className="rec-row__err" role="alert">
                  {errs[r.id]}
                </p>
              )}
            </div>
            <div className="rec-row__actions">
              {running || waiting ? (
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => {
                    say(r.id, null);
                    // Cancelling a scheduled one is deleting its record: it has no file.
                    (running ? stopRecording(r.id) : deleteRecording(r.id)).catch((e) =>
                      say(r.id, couldnt(running ? "stop" : "cancel", e)),
                    );
                  }}
                >
                  {running ? "Stop Recording" : "Cancel Recording"}
                </Button>
              ) : (
                !empty && (
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={r.status === "failed" && r.bytes === 0}
                    onClick={() => onPlay(r.id)}
                  >
                    Play
                  </Button>
                )
              )}
              {!empty && r.path && (
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => {
                    say(r.id, null);
                    tauriRecShow(r.id).catch((e) => say(r.id, couldnt("show the folder", e)));
                  }}
                >
                  Show in Folder
                </Button>
              )}
              {!running && !waiting && (
                <DeleteButton
                  onConfirm={() => {
                    say(r.id, null);
                    const held = r.id === playingId;
                    onBeforeDelete?.(r.id);
                    // The player lets go of the file a moment after it is told to.
                    window.setTimeout(
                      () => deleteRecording(r.id).catch((e) => say(r.id, couldnt("delete", e))),
                      held ? 400 : 0,
                    );
                  }}
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

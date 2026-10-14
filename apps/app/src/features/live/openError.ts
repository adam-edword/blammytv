import type { OpenAnswer } from "../../lib/tauri";

/**
 * The reason on a VOD's dead card, from what the link answered (native's
 * mpv_open_error), in the app's voice. mpv itself only ever says "loading
 * failed", never the status. The card keeps its own first line ("It's the
 * stream, not you."); this goes under it.
 *
 * Null is "no claim", and the card stays as it was. That is the answer for a
 * link that DID answer like a video (a 2xx, or a 206 for the single byte we
 * asked for): the link is fine and whatever stopped it is not ours to name.
 * Same for anything this does not know a sentence for. A wrong reason is worse
 * than none.
 *
 * It is given only what native sent, which carries no part of the address. A
 * debrid link holds the account's key, so nothing here may take one in, and
 * nothing the server said is echoed back: the content type is compared, never
 * shown.
 */
/** A Jellyfin stream the player was given the sign-in for, and the server
 * still said no: a login problem, not a stream that is bad. The probe sent
 * the same header, which is what makes the answer mean that. */
export function jellyfinRefused(a: OpenAnswer): boolean {
  return a.signedInToJellyfin === true && (a.status === 401 || a.status === 403);
}

export function openErrorLine(a: OpenAnswer): string | null {
  if (a.failure) return "The server didn’t answer.";
  const s = a.status;
  if (s === null || !Number.isInteger(s)) return null;
  if (jellyfinRefused(a))
    return `Your Jellyfin refused the file (${s}). Your sign-in may have ended: sign in again under Settings → Sources → Stream.`;
  if (s === 403)
    return "The link answered 403 (Forbidden). Debrid links expire; try another source.";
  // 410 is the same news as 404 for a link: it is gone.
  if (s === 404 || s === 410) return `The link answered ${s} (Not found).`;
  if (s >= 400 && s <= 599) return `The link answered ${s}.`;
  if (s >= 200 && s <= 299) {
    const type = (a.contentType ?? "").split(";")[0].trim().toLowerCase();
    return type === "text/html" ? "The link sent a web page, not a video." : null;
  }
  return null;
}

import { scrubbedMessage } from "./errors";

/**
 * Text made safe to leave this PC (plan 025, P4b). Everything the app writes
 * to its log file from the page, and everything Copy Diagnostics puts on the
 * clipboard, goes through here, so a line that was a credential on its way in
 * is not one on its way out. CLAUDE.md: never log tokens or credentials, debrid
 * URLs included.
 *
 * Four rules, in this order:
 *
 *  1. A URL becomes its origin. Xtream puts the user name and password in the
 *     path, AIOStreams puts the whole config there, and a debrid link carries
 *     its key. `scrubbedMessage` already does this for every error the app
 *     shows (v0.9.91's lessons are in it: a password may hold `)` or `'`), so
 *     it is the one place that knows how. It leaves `http://host:8080/…`, the
 *     slash and the dots saying a path was there.
 *  2. A MAC address (Stalker portals) is masked, whichever of `:` or `-` it is
 *     written with.
 *  3. A Windows user folder loses the name: `C:\Users\adam\AppData` is
 *     `C:\Users\…\AppData`.
 *  4. A run of 32 or more hex, base64 or base64url characters is `<redacted>`.
 *     That is what an access token, an API key or a session id looks like
 *     whatever it was called, and the first three rules do not see one that is
 *     not in a URL. The slash and plus of base64 are in the set on purpose: a
 *     token with a `/` in it is otherwise cut in two halves under the limit,
 *     and both get through. A run needs 16 letters or digits in it, so a rule of
 *     dashes is not one.
 *
 * It errs towards removing too much: a 40-letter word is redacted, and so is a
 * path of that length. A line that has lost a word is a nuisance and one that
 * has kept a key is not.
 *
 * Running it twice changes nothing more, so a line scrubbed when it was sent
 * can be scrubbed again when it is copied.
 */
export function scrub(text: string): string {
  return noteRuns(noteUserFolders(noteMacs(scrubbedMessage(text))));
}

/** Six pairs of hex digits joined by `:` or `-`. */
const MAC = /\b[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}\b/gi;

function noteMacs(text: string): string {
  return text.replace(MAC, (m) =>
    // One separator all the way along, or it is not an address: `:` and `-`
    // mixed is some other run of bytes.
    m.includes(":") && m.includes("-") ? m : "xx:xx:xx:xx:xx:xx",
  );
}

/** `X:\Users\<name>` with either slash. The name runs to the next separator, and
 * may hold spaces (`John Smith`) and the ~ of a short name. It stops at what a
 * file name cannot hold. */
const USER_FOLDER = /\b([a-z]:[\\/]users[\\/])[^\\/:*?"<>|\r\n]+/gi;

function noteUserFolders(text: string): string {
  return text.replace(USER_FOLDER, "$1…");
}

/** Letters, digits, and base64's `+ /` and base64url's `- _`, 32 or more, and
 * the `=` base64 pads with. */
const RUN = /[A-Za-z0-9+/_-]{32,}={0,2}/g;

/** A run is a token when it holds 16 or more letters or digits, so a rule of
 * dashes is not one. */
const isToken = (run: string): boolean => run.replace(/[^A-Za-z0-9]/g, "").length >= 16;

function noteRuns(text: string): string {
  return text.replace(RUN, (run) => (isToken(run) ? "<redacted>" : run));
}

/**
 * Whether rule 4 would redact something in `text`: the same run, the same test,
 * asked as a question. The settings export asks it of the pieces of an artwork
 * URL (features/settings/settingsExport.ts), so what it calls a key is what the
 * log calls one.
 */
export function hasTokenRun(text: string): boolean {
  for (const m of text.matchAll(RUN)) if (isToken(m[0])) return true;
  return false;
}

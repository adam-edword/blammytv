/**
 * Credential-safe error text. Addon/panel URLs EMBED credentials (the
 * AIOStreams manifest path is the user's config; Xtream creds ride the
 * query), and transport-level errors echo the whole URL (reqwest appends
 * ` for url (…)` with no redaction) — so anything user-facing or logged
 * must pass through here first. Scrubs every URL down to its origin.
 */
export function scrubbedMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  // The URL runs to whitespace or a double quote, NOT to the first `)` or
  // `'`. Those stopped the match before v0.9.91, and they are legal in a
  // password: `encodeURIComponent` leaves `'()!*` alone, so
  // `password=se)cret` kept everything after the `)`. Nothing past the
  // origin survives now, whatever the credential contains. Punctuation the
  // message wrapped AROUND the URL (reqwest's `for url (…)`, a quote, a
  // full stop) is peeled off the end first and put back after it.
  return raw.replace(/https?:\/\/[^\s"]+/gi, (m) => {
    const tail = /[)'.,;:!]+$/.exec(m)?.[0] ?? "";
    try {
      return new URL(m).origin + "/…" + tail;
    } catch {
      return "https://…" + tail;
    }
  });
}

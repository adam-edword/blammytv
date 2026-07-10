/**
 * Credential-safe error text. Addon/panel URLs EMBED credentials (the
 * AIOStreams manifest path is the user's config; Xtream creds ride the
 * query), and transport-level errors echo the whole URL (reqwest appends
 * ` for url (…)` with no redaction) — so anything user-facing or logged
 * must pass through here first. Scrubs every URL down to its origin.
 */
export function scrubbedMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/https?:\/\/[^\s"')]+/gi, (m) => {
    try {
      return new URL(m).origin + "/…";
    } catch {
      return "https://…";
    }
  });
}

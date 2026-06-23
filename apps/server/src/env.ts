/**
 * Shape of an Xtream account, consumed by the client. Credentials come from the
 * sources store (entered in the app's settings), never from the repo. They stay
 * server-side.
 */
export interface XtreamConfig {
  /** e.g. http://line.example.com:8080 (no trailing slash). */
  baseUrl: string;
  username: string;
  password: string;
  /** Live container extension for the playable URL (ts | m3u8). */
  liveExt: string;
}

/**
 * The AIOStreams manifest URL — the single, decoupled connection for VOD
 * (movies + shows). It embeds the user's private config (debrid keys etc.), so
 * it's a server-only secret: read from the environment / a gitignored `.env`,
 * never committed and never placed in the config blob.
 */
export function aiostreamsUrl(): string | undefined {
  const url = process.env.BLAMMY_AIOSTREAMS_URL?.trim();
  return url || undefined;
}

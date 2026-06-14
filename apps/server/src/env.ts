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

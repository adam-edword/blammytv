/**
 * A playlist's own User-Agent (plan 025, P5).
 *
 * Some providers only answer the app they sell: a panel that checks the agent
 * on the channel list checks it on the guide and the stream too. A playlist
 * can carry one (Settings → Sources → a playlist → Advanced), and then every
 * request for that playlist's URLs sends it. Empty means the app's own, as it
 * always was.
 *
 * Its own file, apart from lib/http.ts and settings/playlists.ts, because both
 * are replaced wholesale by the tests of what calls them: the rule lives where
 * a mock of either cannot take it away.
 *
 * The rule is native's too (mpvagent.rs `clean`), which owns it: the page
 * ships apart from the binary, so what reaches mpv and the proxy is checked
 * there as well. Printable ASCII and no more than USER_AGENT_MAX of it:
 * what every server reads the same way, and nothing that could carry a line
 * break into a header.
 */

/** The longest an agent may be. Real ones run to about 150. */
export const USER_AGENT_MAX = 300;

/** Whether the form may hold `value`: nothing (no agent of its own) or an
 * agent. Spaces around it are not part of it. */
export function userAgentOk(value: string): boolean {
  const t = value.trim();
  return t === "" || (t.length <= USER_AGENT_MAX && /^[\x20-\x7e]+$/.test(t));
}

/** The agent a playlist sends, or undefined for the app's own. Anything that
 * is not a clean string is none, so a damaged save (or one made by hand) can
 * never put a bad header on a request. */
export function cleanUserAgent(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  return t !== "" && userAgentOk(t) ? t : undefined;
}

/** The headers a request for that playlist's URLs adds, or undefined for none.
 * Undefined and not `{}`: a playlist without an agent makes the same calls it
 * always made. */
export function agentHeaders(agent: string | undefined): Record<string, string> | undefined {
  return agent ? { "User-Agent": agent } : undefined;
}

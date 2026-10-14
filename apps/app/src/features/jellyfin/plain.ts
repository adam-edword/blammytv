/**
 * Whether an address goes out over plain http, to somewhere other than this
 * PC, so Settings can say the sign-in and the video are not encrypted.
 *
 * `withScheme` mirrors jf.rs `with_scheme`: a bare host gets http when it
 * names a port, is localhost or is an IP address, and https otherwise. The
 * native side is what actually connects; this only decides whether to warn,
 * and a warning that is wrong in either direction is cheap.
 */

/** Same rule as jf.rs `with_scheme`. */
function withScheme(address: string): string {
  const head = address.search(/[/?#]/);
  const hostPort = head < 0 ? address : address.slice(0, head);
  const colon = hostPort.indexOf(":");
  const after = colon < 0 ? "" : hostPort.slice(colon + 1);
  if (!hostPort.startsWith("[") && colon >= 0 && (after === "" || !/^\d+$/.test(after))) return address;
  const port = /^(.*):(\d+)$/.exec(hostPort);
  const bare = (port ? port[1] : hostPort).replace(/^\[|\]$/g, "");
  const ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(bare) || bare.includes(":");
  const local = !!port || bare.toLowerCase() === "localhost" || ip;
  return `${local ? "http" : "https"}://${address}`;
}

/** This PC, which nothing crosses a network to reach. */
function isLoopback(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || /^127(\.\d{1,3}){3}$/.test(h);
}

/** True for an `http:` address to anything but this PC. Anything that does not
 * parse is not flagged: the sign-in refuses it with its own message. */
export function sendsPlain(address: string | undefined): boolean {
  const a = (address ?? "").trim();
  if (!a) return false;
  try {
    const url = new URL(withScheme(a));
    return url.protocol === "http:" && !isLoopback(url.hostname);
  } catch {
    return false;
  }
}

export const PLAIN_NOTE =
  "This address is not encrypted (http). Your password and your video cross the network as plain text. Fine on your home network, not over the internet.";

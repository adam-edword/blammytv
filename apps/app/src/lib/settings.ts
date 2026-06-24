/**
 * On-device app config (self-contained build): the AIOStreams manifest URL the
 * app talks to directly. Stored in localStorage on the device, like the other
 * preferences. (Xtream playlists will join this here in a later phase.)
 */

const AIO_URL_KEY = "blammytv.aiostreamsUrl";

export function getAioUrl(): string {
  try {
    return (localStorage.getItem(AIO_URL_KEY) ?? "").trim();
  } catch {
    return "";
  }
}

export function setAioUrl(url: string): void {
  try {
    localStorage.setItem(AIO_URL_KEY, url.trim());
  } catch {
    /* storage unavailable — it just won't persist */
  }
}

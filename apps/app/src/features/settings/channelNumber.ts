import { load, save } from "../../lib/storage";

/** Whether the hero shows the provider's channel number chip beside the
 * channel name. Saving notifies listeners (the hero) so it flips live. */

const KEY = "showChannelNumber";
const VERSION = 1;
const EVENT = "blammytv:channel-number";

export function loadShowChannelNumber(): boolean {
  return load<boolean>(KEY, VERSION, true);
}

export function saveShowChannelNumber(show: boolean): void {
  save(KEY, VERSION, show);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: show }));
}

export function onShowChannelNumberChange(
  cb: (show: boolean) => void,
): () => void {
  const handler = (e: Event) => cb(!!(e as CustomEvent<boolean>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

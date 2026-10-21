import { load, save } from "../../lib/storage";

/**
 * The channel you set as NFL RedZone from the Guide's right-click menu, by
 * id. Null leaves it to the name match (sports/redzone.ts), which can pick
 * the wrong one of several: Adam's provider has more than one channel with
 * RedZone in its name.
 */

const KEY = "redzoneChannel";
const VERSION = 1;

export function loadRedzoneChannel(): string | null {
  const id = load<unknown>(KEY, VERSION, null);
  return typeof id === "string" ? id : null;
}

export function saveRedzoneChannel(id: string | null): void {
  save(KEY, VERSION, id);
}

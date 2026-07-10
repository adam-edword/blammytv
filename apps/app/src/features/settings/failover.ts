import { load, save } from "../../lib/storage";

/** Auto source-failover for VOD: when the playing source dies, jump to
 * the next available one automatically. OFF by default (Adam's call) —
 * when off, the dead card offers a manual "Try next available source". */

const KEY = "sourceFailover";
const VERSION = 1;

export function loadSourceFailover(): boolean {
  return load<boolean>(KEY, VERSION, false);
}

export function saveSourceFailover(on: boolean): void {
  save(KEY, VERSION, on);
}

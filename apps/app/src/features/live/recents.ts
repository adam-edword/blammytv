import { load, save } from "../../lib/storage";

/** Recently tuned channels (ids, most recent first), capped so the list
 * stays a shortlist rather than a history. */

const KEY = "recents";
const VERSION = 1;
const MAX = 30;

export function loadRecents(): string[] {
  return load<string[]>(KEY, VERSION, []);
}

export function recordRecent(list: string[], id: string): string[] {
  const next = [id, ...list.filter((x) => x !== id)].slice(0, MAX);
  save(KEY, VERSION, next);
  return next;
}

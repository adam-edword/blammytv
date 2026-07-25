import { load, save } from "../../lib/storage";
import type { VodItem } from "./model";
import type { ListEntry } from "./myList";

/**
 * User lists (plan 009). Supersedes the single `myList` array: a user can
 * keep several named collections, each holding the same thin card-shaped
 * snapshots `myList` always stored (enough to paint a grid instantly, no
 * network round-trip).
 *
 * `myList.ts` still exists as a thin shim over the DEFAULT list, so call
 * sites that only ask "is this saved" did not all have to change in one
 * commit.
 */

export interface UserList {
  /** Stable, generated once. NEVER derived from the name, which renames. */
  id: string;
  name: string;
  /** Bounded data-URL thumbnail. Absent = derive art from the first entry. */
  cover?: string;
  /** Created-at; the grid's default order. */
  at: number;
  entries: ListEntry[];
}

const KEY = "lists";
const VERSION = 1;
/** The pre-009 single list. Read once to migrate, then left alone forever. */
const OLD_KEY = "myList";
const OLD_VERSION = 1;
const DEFAULT_NAME = "My List";

/** Set once the old key has been folded in, so migration runs exactly once
 * even when it produced nothing. Without this, a user who migrates and then
 * deletes every list would have the old titles resurrected on next load. */
const MIGRATED_KEY = "listsMigrated";

function newId(): string {
  // Not crypto: these only have to be unique within one user's lists.
  return `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Never throws. A cover that cannot be stored must cost the cover, not the
 * list, so callers can treat saving as best-effort. */
function write(lists: UserList[]): void {
  save(KEY, VERSION, lists);
}

export function loadLists(): UserList[] {
  const existing = load<UserList[] | null>(KEY, VERSION, null);
  if (existing) return existing;
  if (load<boolean>(MIGRATED_KEY, VERSION, false)) return [];

  // First run under the new shape: fold the old single list in, in order.
  // The old key is deliberately NOT deleted, so a downgrade still finds its
  // data and a bad migration is recoverable.
  const old = load<ListEntry[]>(OLD_KEY, OLD_VERSION, []);
  save(MIGRATED_KEY, VERSION, true);
  if (old.length === 0) return [];
  const migrated: UserList[] = [
    { id: newId(), name: DEFAULT_NAME, at: Date.now(), entries: old },
  ];
  write(migrated);
  return migrated;
}

export function createList(name: string, cover?: string): UserList {
  const list: UserList = {
    id: newId(),
    name: name.trim() || DEFAULT_NAME,
    at: Date.now(),
    entries: [],
    ...(cover ? { cover } : {}),
  };
  write([...loadLists(), list]);
  return list;
}

export function renameList(id: string, name: string): void {
  write(
    loadLists().map((l) =>
      l.id === id ? { ...l, name: name.trim() || l.name } : l,
    ),
  );
}

export function deleteList(id: string): void {
  write(loadLists().filter((l) => l.id !== id));
}

/**
 * A cover is the one value here big enough to hit a storage quota, and the
 * failure mode is already safe: `storage.ts` swallows a failed write, and
 * localStorage is atomic per key, so a rejected write leaves the PREVIOUS
 * record intact. The cover is lost, the list is not. Verified by test
 * rather than defended by an unreachable catch.
 */
export function setCover(id: string, cover: string | undefined): void {
  write(
    loadLists().map((l) =>
      l.id === id ? { ...l, ...(cover ? { cover } : { cover: undefined }) } : l,
    ),
  );
}

/** The list a plain save targets: the first one, or a fresh default. */
function defaultListId(lists: UserList[]): string | null {
  return lists[0]?.id ?? null;
}

const toEntry = (item: VodItem): ListEntry => ({
  id: item.id,
  title: item.title,
  kind: item.kind,
  ...(item.poster ? { poster: item.poster } : {}),
  ...(item.backdrop ? { backdrop: item.backdrop } : {}),
  ...(item.logo ? { logo: item.logo } : {}),
  ...(item.year != null ? { year: item.year } : {}),
  ...(item.rating != null ? { rating: item.rating } : {}),
  ...(item.runtimeMin != null ? { runtimeMin: item.runtimeMin } : {}),
  at: Date.now(),
});

/**
 * Save into `listId`, or into the default list when null. Creates a default
 * if the user has deleted every list: the save button must always have
 * somewhere to put things.
 */
export function addToList(listId: string | null, item: VodItem): string {
  let lists = loadLists();
  let target = listId ?? defaultListId(lists);
  if (!target) {
    const created = createList(DEFAULT_NAME);
    lists = loadLists();
    target = created.id;
  }
  write(
    lists.map((l) =>
      l.id !== target || l.entries.some((e) => e.id === item.id)
        ? l
        : { ...l, entries: [toEntry(item), ...l.entries] },
    ),
  );
  return target;
}

export function removeFromList(listId: string, itemId: string): void {
  write(
    loadLists().map((l) =>
      l.id === listId
        ? { ...l, entries: l.entries.filter((e) => e.id !== itemId) }
        : l,
    ),
  );
}

/** Every list holding this title. Drives the save button's label. */
export function listsContaining(itemId: string): UserList[] {
  return loadLists().filter((l) => l.entries.some((e) => e.id === itemId));
}

/** The old yes/no question, unchanged in meaning: saved ANYWHERE. */
export function inAnyList(itemId: string): boolean {
  return loadLists().some((l) => l.entries.some((e) => e.id === itemId));
}

/** Art for a list card: the uploaded cover, else the newest entry's poster. */
export function listArt(l: UserList): string | undefined {
  return l.cover ?? l.entries.find((e) => e.poster)?.poster;
}

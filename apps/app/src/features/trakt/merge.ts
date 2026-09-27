/**
 * The watchlist's conflict rule (plan 015, decision D3, Adam: "both sides
 * count"): a three-way merge against the copy both sides agreed on at the
 * last sync.
 *
 * - Added on either side since then: added to both.
 * - Removed on either side since then: removed from both.
 * - Removed on one side and added again on the other: kept. A title still
 *   on this side looks the same whether it never left or came back, so the
 *   tell is WHEN it was added: after the last sync means it came back.
 *   BlammyTV keeps that time on every saved title (`at`), and Trakt on every
 *   watchlist item (`listed_at`).
 * - The first sync has no agreed copy, so it is the union.
 *
 * Pure: it says what to do, the caller does it and records what actually
 * happened as the next agreed copy (a title Trakt refused at a free
 * account's cap is not on both sides, so it is not agreed).
 */

export interface Snapshot {
  /** Titles on both sides after the last sync. */
  ids: string[];
  /** When that sync finished, ms. */
  at: number;
}

export interface MergePlan {
  addRemote: string[];
  removeRemote: string[];
  addLocal: string[];
  removeLocal: string[];
  /** What both sides hold once the plan is carried out. */
  final: string[];
}

/**
 * @param local  this side's titles, id → when it was added (ms)
 * @param remote Trakt's titles, id → when it was listed (ms)
 */
export function mergeWatchlist(
  base: Snapshot | null,
  local: ReadonlyMap<string, number>,
  remote: ReadonlyMap<string, number>,
): MergePlan {
  const plan: MergePlan = { addRemote: [], removeRemote: [], addLocal: [], removeLocal: [], final: [] };
  const was = new Set(base?.ids ?? []);
  const since = base?.at ?? 0;
  const all = new Set([...was, ...local.keys(), ...remote.keys()]);
  for (const id of all) {
    const l = local.has(id);
    const r = remote.has(id);
    let keep: boolean;
    if (!base) {
      // First sync: the union.
      keep = l || r;
      if (l && !r) plan.addRemote.push(id);
      if (r && !l) plan.addLocal.push(id);
    } else if (l && r) {
      keep = true;
    } else if (!l && !r) {
      keep = false;
    } else if (l) {
      // Only here. New since the last sync, or re-added after Trakt dropped
      // it: send it. Agreed before and not re-added: Trakt removed it.
      keep = !was.has(id) || (local.get(id) ?? 0) > since;
      (keep ? plan.addRemote : plan.removeLocal).push(id);
    } else {
      keep = !was.has(id) || (remote.get(id) ?? 0) > since;
      (keep ? plan.addLocal : plan.removeRemote).push(id);
    }
    if (keep) plan.final.push(id);
  }
  return plan;
}

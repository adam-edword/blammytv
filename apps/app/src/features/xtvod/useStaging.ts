import { useState } from "react";
import type { XtKind } from "./keys";
import { commitDraft, isDirty, reordered, stagedOf, toggled, type Draft } from "./staging";
import type { XtPick } from "./store";

/**
 * A view's draft of the picks (staging.ts) as state. Closing or unmounting the
 * view drops it; `commit` is the view's button writing it, `discard` its way to
 * put it back.
 */
export function useStaging() {
  const [draft, setDraft] = useState<Draft>({});
  const edit = (pid: string, next: (now: readonly XtPick[]) => readonly XtPick[]) =>
    setDraft((d) => ({ ...d, [pid]: next(stagedOf(d, pid)) }));
  return {
    picks: (pid: string) => stagedOf(draft, pid),
    /** Stage the folder as a row at the end, or take it out when it is staged. */
    toggle: (pid: string, kind: XtKind, id: string) => edit(pid, (now) => toggled(now, kind, id)),
    /** Stage the shown picks in this order. */
    reorder: (pid: string, order: readonly XtPick[]) => edit(pid, (now) => reordered(now, order)),
    dirty: isDirty(draft),
    commit: () => {
      commitDraft(draft);
      setDraft({});
    },
    discard: () => setDraft({}),
  };
}

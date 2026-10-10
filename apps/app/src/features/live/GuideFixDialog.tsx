import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { loadGuideFixes, removeGuideFix, saveGuideFix } from "./guideFix";
import { candidates, guideStanding, rankGuideChannels } from "./guideFixSearch";
import type { Channel, GuideChannel } from "./model";
import { refreshLiveNow } from "./source";

/**
 * Fix guide…: match one channel to the guide's own channel by hand.
 *
 * For the channel the guide did not match, because the provider gave it a
 * wrong id or none. It searches the channels the guide declares (the parse
 * keeps that list on the source's group), the closest names first, and
 * saves the pick (guideFix.ts).
 *
 * A fix reaches the screen the way every guide change does: through the
 * forced refresh, which downloads each guide and parses it with the fix in
 * the index. That is a download of up to a minute, so it is said (`onNotice`)
 * and the lane fills when the guide lands.
 *
 * One layer: Escape closes this and nothing behind it (Radix marks the key
 * as taken, which the app's other Escape handlers already respect).
 */
export function GuideFixDialog({
  open,
  onOpenChange,
  channel,
  playlistId,
  guideChannels,
  onNotice,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: Channel;
  playlistId: string;
  guideChannels: readonly GuideChannel[];
  onNotice: (message: string) => void;
  /** Where focus goes as it closes: the dialog has no trigger of its own
   * for Radix to go back to (it opens from a context menu). */
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [fixedId] = useState<string | undefined>(
    () => loadGuideFixes(playlistId)[channel.id],
  );
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => candidates(guideChannels), [guideChannels]);
  const { rows, more } = useMemo(
    () => rankGuideChannels(all, channel.name, query),
    [all, channel.name, query],
  );
  const standing = useMemo(
    () => guideStanding(guideChannels, channel.epgId, fixedId),
    [guideChannels, channel.epgId, fixedId],
  );
  const current = standing.kind === "none" ? null : standing.id;
  const optionId = (id: string) => `${listId}-${rows.findIndex((r) => r.id === id)}`;

  const pick = (id: string) => {
    setPicked(id);
    // The row may be below the fold of a list of fifty.
    requestAnimationFrame(() =>
      listRef.current?.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" }),
    );
  };

  const done = (message: string) => {
    onNotice(message);
    onOpenChange(false);
    void refreshLiveNow();
  };
  const apply = () => {
    if (!picked) return;
    saveGuideFix(playlistId, channel.id, picked);
    done("Saved. The guide takes a moment to refresh.");
  };
  const remove = () => {
    removeGuideFix(playlistId, channel.id);
    done("Fix removed. The guide takes a moment to refresh.");
  };

  // The arrows and Enter work from the field, as in a combobox, so fifty
  // rows are one tab stop and not fifty.
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (rows.length === 0) return;
      e.preventDefault();
      const at = rows.findIndex((r) => r.id === picked);
      const step = e.key === "ArrowDown" ? 1 : -1;
      const next = at === -1 ? (step === 1 ? 0 : rows.length - 1) : (at + step + rows.length) % rows.length;
      pick(rows[next].id);
    } else if (e.key === "Enter" && picked) {
      e.preventDefault();
      apply();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-3 sm:max-w-md"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader className="gap-1.5">
          <DialogTitle className="truncate pr-6">{channel.name}</DialogTitle>
          <DialogDescription>
            {standing.kind === "fixed"
              ? `Fixed by you: ${standing.name}`
              : standing.kind === "matched"
                ? `Matched to ${standing.name}`
                : "No guide matched"}
          </DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search the guide's channels"
          aria-label="Search the guide's channels"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={picked && rows.some((r) => r.id === picked) ? optionId(picked) : undefined}
          autoComplete="off"
          spellCheck={false}
        />

        <div className="grid gap-1">
          {!query.trim() && rows.length > 0 && (
            <p className="px-1 text-xs text-muted-foreground">Closest names first</p>
          )}
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="The guide's channels"
            className="mvpick__body rounded-lg border border-border"
          >
            {rows.length === 0 ? (
              <p className="mvpick__empty">Nothing matches that.</p>
            ) : (
              <div className="mvpick__group">
                {rows.map((r, i) => (
                  <div
                    key={r.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={picked === r.id}
                    data-id={r.id}
                    data-highlighted={picked === r.id ? "" : undefined}
                    className="mvpick__row"
                    onClick={() => pick(r.id)}
                  >
                    <span className="mvpick__meta">
                      <span className="mvpick__name">
                        <span className="mvpick__nametext">{r.name}</span>
                      </span>
                      <span className="mvpick__sub">{r.name === r.id ? "" : r.id}</span>
                    </span>
                    {r.id === current && <span className="mvpick__best">Current</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          {more > 0 && (
            <p className="px-1 text-xs text-muted-foreground">
              And {more.toLocaleString()} more. Keep typing to narrow it.
            </p>
          )}
        </div>

        <DialogFooter>
          {fixedId && (
            <Button type="button" variant="ghost" onClick={remove}>
              Remove fix
            </Button>
          )}
          <Button type="button" disabled={!picked} onClick={apply}>
            Use this guide
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronIcon } from "../../ui/icons";
import { NameField } from "../../ui/NameField";
import {
  addToList,
  createList,
  listsContaining,
  loadLists,
  removeFromList,
  type UserList,
} from "./lists";
import type { VodItem } from "./model";

/**
 * The detail screen's save control (plan 009, phase 4).
 *
 * A split button: the main half saves to the default list in one click, the
 * chevron opens a picker with every list plus "New list". The label reports
 * membership, because with several lists "saved" is no longer a yes/no
 * answer worth showing on its own.
 *
 * What the main half does when the title is ALREADY saved depends on how
 * many lists hold it:
 *
 * - one list  → removes it from that list (the old toggle, unchanged)
 * - several   → opens the picker instead of guessing. Wiping it out of
 *               three lists on one click is not something a click should
 *               ever be able to do by accident.
 *
 * Before this, the button wrote through `myList.ts` to the pre-009 storage
 * key, which the Library does not read: after the one-time migration, a
 * save from a title page vanished. Everything here goes through `lists.ts`.
 */

/** Where the picker hangs. Fixed coords, measured off the button. */
type Anchor = { x: number; y: number };

export function SaveButton({ item }: { item: VodItem }) {
  const [lists, setLists] = useState<UserList[]>(loadLists);
  const [inIds, setInIds] = useState<string[]>(() =>
    listsContaining(item.id).map((l) => l.id),
  );
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [creating, setCreating] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLDivElement | null>(null);

  // The detail screen swaps `item` in place when full meta lands, and the
  // same mounted button serves the next title you open. Re-read on identity,
  // not on mount.
  useEffect(() => {
    setLists(loadLists());
    setInIds(listsContaining(item.id).map((l) => l.id));
  }, [item.id]);

  const reread = useCallback(() => {
    setLists(loadLists());
    setInIds(listsContaining(item.id).map((l) => l.id));
  }, [item.id]);

  const close = useCallback(() => {
    setAnchor(null);
    setCreating(false);
    // Focus goes back where it came from, or it lands on <body> and the
    // next Tab starts over at the top of the page.
    btnRef.current?.querySelector("button")?.focus();
  }, []);

  /** The menu's focusable rows, in visual order. Read from the DOM at press
   * time rather than tracked in state: the list changes as lists are
   * created and as the New-list field replaces its own row. */
  const rows = () =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );

  const moveFocus = useCallback((delta: number, to?: "first" | "last") => {
    const items = rows();
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      to === "first"
        ? 0
        : to === "last"
          ? items.length - 1
          : // Wraps: a menu this short is faster to circle than to reverse.
            (at + delta + items.length) % items.length;
    items[next]?.focus();
  }, []);

  // Click-away and Escape, plus the same portal reasoning as the Live
  // sidebar's folder menu: a fixed overlay inside .app-shell gets cut away
  // by the player's clip hole, so it hangs off document.body instead.
  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t))
        close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close();
      // Only while the menu owns focus: the detail page behind it has its
      // own arrow-key meaning and must keep it.
      if (!menuRef.current?.contains(document.activeElement)) return;
      // ...and not while naming a new list. In a text field the arrows
      // belong to the caret, and Home/End to the line.
      if (document.activeElement instanceof HTMLInputElement) return;
      const move: Record<string, () => void> = {
        ArrowDown: () => moveFocus(1),
        ArrowUp: () => moveFocus(-1),
        Home: () => moveFocus(0, "first"),
        End: () => moveFocus(0, "last"),
      };
      const fn = move[e.key];
      if (!fn) return;
      e.preventDefault(); // arrows would scroll the page under the menu
      fn();
    };
    // The coordinates are measured once, so a scroll would leave the menu
    // floating away from its button. Close instead of chasing it.
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [anchor, close, moveFocus]);

  // Opening with the keyboard has to land somewhere: the first row. Runs on
  // every open, and after the menu has rendered, so the rows exist.
  useEffect(() => {
    if (anchor) rows()[0]?.focus();
  }, [anchor]);

  const openPicker = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    // Keep it on screen: the detail page's save button can sit low enough
    // that a menu hanging below it would run off the bottom.
    const h = Math.min(320, 56 + lists.length * 36);
    const y = Math.min(r.bottom + 8, Math.max(8, window.innerHeight - h - 8));
    const x = Math.min(r.left, Math.max(8, window.innerWidth - 308));
    setAnchor({ x, y });
  }, [lists.length]);

  const toggleIn = useCallback(
    (listId: string) => {
      if (inIds.includes(listId)) removeFromList(listId, item.id);
      else addToList(listId, item);
      reread();
    },
    [inIds, item, reread],
  );

  const primary = useCallback(() => {
    if (inIds.length === 0) {
      addToList(null, item); // default list, created if there is none
      reread();
      return;
    }
    if (inIds.length === 1) {
      removeFromList(inIds[0], item.id);
      reread();
      return;
    }
    openPicker();
  }, [inIds, item, reread, openPicker]);

  const commitNew = useCallback(
    (name: string) => {
      setCreating(false);
      if (!name.trim()) return;
      const list = createList(name);
      addToList(list.id, item);
      reread();
    },
    [item, reread],
  );

  const saved = inIds.length > 0;
  // "Library" is what the tab is called, so that is where a user thinks
  // this puts things. Which LIST inside it only becomes worth naming once
  // the title is actually in one.
  const label =
    inIds.length === 0
      ? "Add to Library"
      : inIds.length === 1
        ? `In ${lists.find((l) => l.id === inIds[0])?.name ?? "list"}`
        : `In ${inIds.length} lists`;

  return (
    <div className="vod-save-split" ref={btnRef}>
      <button
        type="button"
        className={"vod-save" + (saved ? " vod-save--on" : "")}
        onClick={primary}
      >
        {saved ? <CheckIcon size={15} /> : <span aria-hidden>+</span>} {label}
      </button>
      <button
        type="button"
        className="vod-save vod-save__more"
        aria-label="Choose lists"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={() => (anchor ? close() : openPicker())}
      >
        <ChevronIcon size={14} />
      </button>

      {anchor &&
        createPortal(
          <div
            ref={menuRef}
            className="list-picker"
            role="menu"
            aria-label="Save to list"
            style={{ left: anchor.x, top: anchor.y }}
          >
            <p className="list-picker__title">Save to</p>
            {lists.map((l) => {
              const on = inIds.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  className={
                    "list-picker__item" + (on ? " list-picker__item--on" : "")
                  }
                  onClick={() => toggleIn(l.id)}
                >
                  <span className="list-picker__check" aria-hidden>
                    {on ? <CheckIcon size={13} /> : null}
                  </span>
                  <span className="list-picker__name">{l.name}</span>
                  <span className="list-picker__count">{l.entries.length}</span>
                </button>
              );
            })}
            {creating ? (
              <NameField
                initial=""
                placeholder="List name"
                ariaLabel="New list name"
                className="list-picker__input"
                onCommit={commitNew}
                onCancel={() => setCreating(false)}
              />
            ) : (
              <button
                type="button"
                role="menuitem"
                className="list-picker__item list-picker__new"
                onClick={() => setCreating(true)}
              >
                <span className="list-picker__check" aria-hidden>
                  +
                </span>
                <span className="list-picker__name">New list</span>
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

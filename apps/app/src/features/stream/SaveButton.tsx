import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
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
 *
 * THE PICKER IS A SHADCN DropdownMenu as of v0.9.72. It used to be a
 * hand-rolled portal: a fixed menu placed from a measured button rect, plus
 * its own mousedown, Escape and scroll listeners, its own arrow/Home/End
 * roving, its own first-row autofocus and its own off-screen clamping. All
 * of that is what DropdownMenu is, and it does two of them better — the
 * clamp becomes real collision handling, and the menu now FOLLOWS the button
 * on scroll instead of closing, which the old comment called out as a
 * limitation it could not fix ("the coordinates are measured once… close
 * instead of chasing it").
 *
 * Not a Popover, even though the rows are checkboxes and one of them turns
 * into a text field: the menu is a list you arrow through, and DropdownMenu
 * is the only primitive here that brings roving focus and typeahead with it.
 * The text field's own keys are fenced off where it is rendered.
 */

export function SaveButton({ item }: { item: VodItem }) {
  const [lists, setLists] = useState<UserList[]>(loadLists);
  const [inIds, setInIds] = useState<string[]>(() =>
    listsContaining(item.id).map((l) => l.id),
  );
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

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

  // Closing resets the New-list field: reopening should offer the row
  // again, not a stale half-typed name.
  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setCreating(false);
  }, []);

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
    // Two or more lists: don't guess, show the picker. Radix anchors it to
    // the Trigger (the chevron half) wherever it was opened from, so the
    // left half can open it without owning a position of its own.
    setOpen(true);
  }, [inIds, item, reread]);

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
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <div className="vod-save-split">
        <Button
          variant="outline"
          type="button"
          // The seam, as utilities: square the inside edge and pull the right
          // half a hairline left so the two 1px borders do not read as 2px.
          // Radius and margin are Button's own utilities, so this is the only
          // place it can be said — see the note in stream.css.
          className={
            "vod-save rounded-r-none" +
            (saved ? " vod-save--on border-primary" : "")
          }
          onClick={primary}
        >
          {saved ? <CheckIcon size={15} /> : <span aria-hidden>+</span>} {label}
        </Button>
        {/* `asChild` so the trigger IS the chevron half rather than a button
          * wrapping one. aria-haspopup and aria-expanded come from Radix. */}
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            type="button"
            className={
              "vod-save vod-save__more rounded-l-none -ml-px" +
              (saved ? " border-primary" : "")
            }
            aria-label="Choose lists"
          >
            <ChevronIcon size={14} />
          </Button>
        </DropdownMenuTrigger>
      </div>

      <DropdownMenuContent
        align="start"
        className="max-h-80 w-64 overflow-y-auto"
      >
        {/* `inset` on the label and the New-list row is shadcn's own answer to
          * a menu that mixes checkbox rows with plain ones. CheckboxItem is
          * `pl-8` to leave a gutter for the tick; Item and Label are `px-2`.
          * Without it the two kinds of row start at different x and the menu
          * reads as two lists that happen to share a box. */}
        <DropdownMenuLabel inset>Save to</DropdownMenuLabel>
        {lists.map((l) => (
          <DropdownMenuCheckboxItem
            key={l.id}
            checked={inIds.includes(l.id)}
            // Stay open. Radix closes on select by default, which is right
            // for a menu of commands and wrong for a set of checkboxes:
            // picking two lists would otherwise mean opening the menu twice.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggleIn(l.id)}
          >
            <span className="list-picker__name">{l.name}</span>
            <span className="list-picker__count">{l.entries.length}</span>
          </DropdownMenuCheckboxItem>
        ))}
        {creating ? (
          // NOT a menu item, and the keydown fence is the reason. Radix's
          // typeahead lives on the content and swallows printable keys to
          // jump between rows, so without stopPropagation every letter typed
          // here would also be hunting for a list whose name starts with it.
          // Escape is fenced too: it belongs to the field first (cancel the
          // name), and only closes the menu once the field is gone.
          <div
            className="px-1 py-1"
            onKeyDown={(e) => e.stopPropagation()}
          >
            <NameField
              initial=""
              placeholder="List name"
              ariaLabel="New list name"
              className="list-picker__input"
              onCommit={commitNew}
              onCancel={() => setCreating(false)}
            />
          </div>
        ) : (
          <DropdownMenuItem
            inset
            onSelect={(e) => {
              e.preventDefault();
              setCreating(true);
            }}
          >
            <span aria-hidden>+</span>
            <span className="list-picker__name">New list</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

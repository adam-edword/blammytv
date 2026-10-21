import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
  type ScreenReaderInstructions,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, type SortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { REDUCED_MOTION } from "../lib/reducedMotion";

/**
 * A list you reorder by dragging (plan 028), on dnd-kit's sortable: the pointer
 * drags a row by its handle, and the keyboard does too (Space or Enter picks it
 * up, the arrows move it, Space or Enter drops it, Escape puts it back). Its
 * announcements are the screen reader's: where the row was picked up, where it
 * is as it moves, where it landed.
 *
 * The pointer needs to travel a few pixels before a drag starts, so a click on
 * the handle (or on a button beside it) is still a click.
 *
 * Reduced motion: the rows that make room jump to their places rather than
 * glide there.
 *
 * Escape and a dialog. Escape cancels a lifted row, and a dialog around the
 * list (the Rows drawer, Settings) closes on Escape. `liftedRow()`
 * (lib/liftedRow.ts) is how those dialogs tell the two apart.
 */

/** One row: what it is called to a screen reader, and its id. */
interface SortItem {
  id: string;
  label: string;
}

/** Only up and down: a list in a column. */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

const INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    "Press Space or Enter to pick up a row. Move it with the arrow keys, then press Space or Enter to drop it. Press Escape to cancel.",
};

function announcements(items: readonly SortItem[]): Announcements {
  const name = (id: string | number) => items.find((i) => i.id === id)?.label ?? "Row";
  const place = (id: string | number) => `row ${items.findIndex((i) => i.id === id) + 1} of ${items.length}`;
  return {
    onDragStart: ({ active }) => `Picked up ${name(active.id)}. It is ${place(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${name(active.id)} moved to ${place(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) => `Dropped ${name(active.id)} at ${place(over ? over.id : active.id)}.`,
    onDragCancel: ({ active }) => `Cancelled. ${name(active.id)} is back at ${place(active.id)}.`,
  };
}

export function SortableList({
  items,
  strategy,
  vertical = false,
  onReorder,
  className,
  label,
  children,
}: {
  items: readonly SortItem[];
  strategy: SortingStrategy;
  /** Keep the dragged row in its column (a list, not a grid). */
  vertical?: boolean;
  /** The ids in their new order, after a drop that moved a row. */
  onReorder: (ids: string[]) => void;
  className?: string;
  /** The list's name, for a screen reader. */
  label: string;
  /** The rows, as `SortableRow`s, in the order of `items`. */
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = items.map((i) => i.id);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onReorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={vertical ? [verticalOnly] : undefined}
      onDragEnd={onDragEnd}
      accessibility={{ announcements: announcements(items), screenReaderInstructions: INSTRUCTIONS }}
    >
      <SortableContext items={ids} strategy={strategy}>
        <ul className={className} aria-label={label}>
          {children}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

/** What a row spreads on the button it is dragged by: dnd-kit's attributes (the
 * role, the announcement it is described by) and its pointer and key handlers. */
type Grip = ButtonHTMLAttributes<HTMLButtonElement> & { ref: (el: HTMLElement | null) => void };

export function SortableRow({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  /** The row's contents; `grip` goes on the handle, and `dragging` is true for
   * the row that is lifted. */
  children: (grip: Grip, dragging: boolean) => ReactNode;
}) {
  const s = useSortable({ id, transition: REDUCED_MOTION ? null : { duration: 200, easing: "ease" } });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(s.transform),
    transition: s.transition,
    // Over its neighbours while it travels.
    zIndex: s.isDragging ? 2 : undefined,
  };
  return (
    <li ref={s.setNodeRef} style={style} className={className} data-dragging={s.isDragging || undefined}>
      {children({ ...s.attributes, ...(s.listeners as ButtonHTMLAttributes<HTMLButtonElement>), ref: s.setActivatorNodeRef }, s.isDragging)}
    </li>
  );
}

import { memo, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { useConnections } from "../../live/connections";
import { splitTitleEmoji } from "../../live/emoji";
/** The Guide's list modes, as LiveScreen names them (a screen may not import another screen's file: verify-kit M2). */
type Mode = "playlist" | "favorites" | "recents" | "recordings";
import type { LiveData } from "../../live/model";

/** The Live TV tab's folders as a Classic tree: Windows 2000 Explorer's
 * folders pane, with +/- boxes and dotted lines. It is the sidebar's modes
 * and every source's folders in one list, and picking one does what picking
 * it did there (LiveScreen owns the state; this only asks).
 *
 * Flat treeitems with aria-level rather than nested groups: one roving tab
 * stop, and the dotted lines are drawn per row from what its ancestors still
 * have below them. */

const MODE_ROWS: { key: Mode; label: string }[] = [
  { key: "playlist", label: "All Channels" },
  { key: "favorites", label: "Favorites" },
  { key: "recents", label: "Recents" },
  { key: "recordings", label: "Recordings" },
];

interface TNode {
  id: string;
  label: string;
  /** Text for the row's tooltip, when the label is not all of it. */
  title?: string;
  open?: boolean;
  kids?: TNode[];
  /** What picking the row does. */
  mode?: Mode;
  folder?: { groupId: string; folderId: string; name: string };
  group?: string;
}

/** A dotted-line cell: a line down through it, a tee (down and right), an
 * elbow (down to the middle, then right), or nothing. */
type Guide = "line" | "none" | "tee" | "ell";

interface Row {
  node: TNode;
  level: number;
  guides: Guide[];
  parent: string | null;
  pos: number;
  size: number;
}

function flatten(root: TNode): Row[] {
  const out: Row[] = [];
  const walk = (node: TNode, level: number, lasts: boolean[], parent: string | null, pos: number, size: number) => {
    const last = pos === size;
    const guides: Guide[] = [];
    if (level > 0) {
      for (let c = 0; c < level - 1; c++) guides.push(lasts[c] ? "none" : "line");
      guides.push(last ? "ell" : "tee");
    }
    out.push({ node, level, guides, parent, pos, size });
    if (node.kids?.length && node.open)
      node.kids.forEach((k, i) =>
        walk(k, level + 1, level > 0 ? [...lasts, last] : lasts, node.id, i + 1, node.kids!.length),
      );
  };
  walk(root, 0, [], null, 1, 1);
  return out;
}

export const ClassicFolders = memo(function ClassicFolders({
  groups,
  conns,
  closedGroups,
  mode,
  folder,
  onToggleGroup,
  onPickMode,
  onPickFolder,
  onFolderMenu,
}: {
  groups: LiveData["groups"];
  conns: ReturnType<typeof useConnections>;
  closedGroups: Set<string>;
  mode: Mode;
  folder: string | null;
  onToggleGroup: (id: string) => void;
  onPickMode: (m: Mode) => void;
  onPickFolder: (id: string) => void;
  onFolderMenu: (m: { x: number; y: number; groupId: string; folderId: string; name: string }) => void;
}) {
  const [rootOpen, setRootOpen] = useState(true);
  const [focusId, setFocusId] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const root: TNode = {
      id: "root",
      label: "Live TV",
      open: rootOpen,
      kids: [
        ...MODE_ROWS.map<TNode>((m) => ({ id: `m:${m.key}`, label: m.label, mode: m.key })),
        ...groups.map<TNode>((g) => {
          const c = conns.get(g.id);
          return {
            id: `g:${g.id}`,
            label: c ? `${g.name} (${c.active} of ${c.max})` : g.name,
            title: c ? `${c.active} of ${c.max} streams in use` : undefined,
            group: g.id,
            open: !closedGroups.has(g.id),
            kids: g.folders.map<TNode>((f) => {
              const name = splitTitleEmoji(f.name).label;
              return { id: `f:${f.id}`, label: name, folder: { groupId: g.id, folderId: f.id, name } };
            }),
          };
        }),
      ],
    };
    return flatten(root);
  }, [groups, conns, closedGroups, rootOpen]);

  const selectedId = mode !== "playlist" ? `m:${mode}` : folder ? `f:${folder}` : "m:playlist";
  const tabId = rows.some((r) => r.node.id === focusId)
    ? focusId
    : rows.some((r) => r.node.id === selectedId)
      ? selectedId
      : rows[0].node.id;

  const toggle = (n: TNode) => {
    if (n.id === "root") setRootOpen((o) => !o);
    else if (n.group) onToggleGroup(n.group);
  };
  const activate = (n: TNode) => {
    if (n.mode) onPickMode(n.mode);
    else if (n.folder) onPickFolder(n.folder.folderId);
    else toggle(n);
  };
  const focusRow = (id: string | undefined) => {
    if (id) treeRef.current?.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-node]");
    const i = rows.findIndex((r) => r.node.id === el?.dataset.node);
    if (i < 0) return;
    const { node, parent } = rows[i];
    const expandable = !!node.kids?.length;
    let handled = true;
    if (e.key === "ArrowDown") focusRow(rows[i + 1]?.node.id);
    else if (e.key === "ArrowUp") focusRow(rows[i - 1]?.node.id);
    else if (e.key === "Home") focusRow(rows[0].node.id);
    else if (e.key === "End") focusRow(rows[rows.length - 1].node.id);
    else if (e.key === "ArrowRight") {
      if (expandable && !node.open) toggle(node);
      else if (expandable) focusRow(rows[i + 1]?.node.id);
    } else if (e.key === "ArrowLeft") {
      if (expandable && node.open) toggle(node);
      else focusRow(parent ?? undefined);
    } else if (e.key === "Enter" || e.key === " ") activate(node);
    else handled = false;
    if (handled) e.preventDefault();
  };

  const errors = groups.filter((g) => g.error);

  return (
    <aside className="cl-folders" aria-label="Folders">
      <div className="cl-folders__title" aria-hidden>
        Folders
      </div>
      <div className="cl-folders__box">
        <div className="cl-tv" role="tree" aria-label="Folders" ref={treeRef} onKeyDown={onKeyDown}>
          {rows.map(({ node, level, guides, pos, size }) => {
            const expandable = !!node.kids?.length;
            const selected = node.id === selectedId;
            return (
              <div
                key={node.id}
                className="cl-tv__row"
                role="treeitem"
                data-node={node.id}
                aria-level={level + 1}
                aria-posinset={pos}
                aria-setsize={size}
                aria-expanded={expandable ? !!node.open : undefined}
                aria-selected={selected}
                title={node.title}
                tabIndex={node.id === tabId ? 0 : -1}
                onFocus={() => setFocusId(node.id)}
                // Explorer's rule: a click on a label selects it, and only the box
                // or a double-click opens a folder. A source and the root hold
                // nothing to pick, so a single click leaves them as they are.
                onClick={() => {
                  if (node.mode || node.folder) activate(node);
                }}
                onDoubleClick={() => {
                  if (expandable) toggle(node);
                }}
                onContextMenu={(e) => {
                  if (!node.folder) return;
                  e.preventDefault();
                  // The keyboard's menu key sends 0,0: anchor on the row.
                  const r = e.currentTarget.getBoundingClientRect();
                  onFolderMenu({
                    x: e.clientX || r.right - 8,
                    y: e.clientY || r.top + r.height / 2,
                    ...node.folder,
                  });
                }}
              >
                {guides.map((g, c) => (
                  <i key={c} className={`cl-tv__g cl-tv__g--${g}`} aria-hidden />
                ))}
                <i
                  className={
                    "cl-tv__box" + (level === 0 ? "" : expandable ? " cl-tv__box--exp" : " cl-tv__box--leaf")
                  }
                  aria-hidden
                >
                  {expandable && (
                    <b
                      className={"cl-tv__bx" + (node.open ? "" : " cl-tv__bx--plus")}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(node);
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                    />
                  )}
                </i>
                <i className={"cl-tv__fd" + (node.open || selected ? " cl-tv__fd--open" : "")} aria-hidden />
                <span className="cl-tv__lb">{node.label}</span>
              </div>
            );
          })}
        </div>
        {errors.map((g) => (
          <p className="cl-folders__error" role="alert" key={g.id}>
            Couldn&rsquo;t Load {g.name}: {g.error}
          </p>
        ))}
      </div>
    </aside>
  );
});

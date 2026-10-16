import { useEffect, useState } from "react";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "../../components/ui/combobox";
import { aioCatalogDefs } from "../../data/aio";
import type { AioCatalog } from "../../data/aiostreams";
import { loadAioConn } from "../aiojf/conn";
import {
  AIO_CONN_CHANGED,
  isValidManifestUrl,
  loadHeroSources,
  saveHeroSources,
} from "./aiostreams";

/**
 * Which catalogs feed the Stream tab's hero carousel.
 *
 * Lives on the Appearance page, not with the manifest: picking what the hero
 * shows is a decision about how the home screen LOOKS, not about the
 * connection that makes it possible. It reads the saved connection (the
 * manifest, or the sign-in) to list the catalogs on offer, which is the
 * only thing it needs from Media.
 */

type Catalogs =
  | { status: "idle" | "loading" }
  | { status: "ready"; items: AioCatalog[] }
  | { status: "error" };

function typeLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function HeroSourcesSection() {
  // This panel is not where the connection is edited, but it can end under us
  // (a 401 signs the device out), so it reads again when it changes.
  const [conn, setConn] = useState(loadAioConn);
  useEffect(() => {
    const again = () => setConn(loadAioConn());
    window.addEventListener(AIO_CONN_CHANGED, again);
    return () => window.removeEventListener(AIO_CONN_CHANGED, again);
  }, []);
  const [catalogs, setCatalogs] = useState<Catalogs>({ status: "idle" });
  const [selected, setSelected] = useState<string[]>(loadHeroSources);

  useEffect(() => {
    if (!conn || (conn.kind === "manifest" && !isValidManifestUrl(conn.url))) {
      setCatalogs({ status: "idle" });
      return;
    }
    let alive = true;
    setCatalogs({ status: "loading" });
    aioCatalogDefs(conn)
      .then((items) => {
        if (!alive) return;
        setCatalogs({ status: "ready", items });
        // Prune any saved selection the (possibly changed) manifest no
        // longer offers, so stale keys don't linger as raw-string chips or
        // in storage.
        const valid = new Set(items.map((c) => c.key));
        setSelected((sel) => {
          const pruned = sel.filter((k) => valid.has(k));
          if (pruned.length === sel.length) return sel;
          saveHeroSources(pruned);
          return pruned;
        });
      })
      .catch(() => {
        if (alive) setCatalogs({ status: "error" });
      });
    return () => {
      alive = false;
    };
  }, [conn]);

  const update = (keys: string[]) => {
    setSelected(keys);
    saveHeroSources(keys);
  };

  /**
   * The popup anchors to the WHOLE chips field, not to the input inside it.
   *
   * This is what `useComboboxAnchor` is for, and skipping it is what Adam
   * saw: "there is a LOT of moving around… the dropdown shifts after a
   * selection is picked." With no anchor the positioner tracks the
   * ComboboxChipsInput, which is a shrinking box that slides along the row
   * and drops to a new line as chips fill the field, so the popup chased it
   * on every pick. The field itself only ever grows downward.
   *
   * It also switches the popup's width rule: ComboboxContent stamps
   * `data-chips` when an anchor is given, which trades `w-(--anchor-width)`
   * for `min-w-(--anchor-width)` — the popup sizes to its content instead of
   * to the field.
   */
  const anchor = useComboboxAnchor();

  const items = catalogs.status === "ready" ? catalogs.items : [];
  const byKey = new Map(items.map((c) => [c.key, c]));
  const chosen = selected
    .map((k) => byKey.get(k))
    .filter((c): c is AioCatalog => !!c);

  // Renders as a stack, not a section: it is one control among several in
  // Appearance's Stream panel, and its own rule and 21px heading made a
  // list of settings read as a list of pages.
  return (
    <div className="customize-stack" data-setting="hero-sources">
      <div>
        <h4 className="customize-row__title">Carousel Catalogs</h4>
        <p className="settings__section-note settings__section-note--dim">
          The carousel draws from these catalogs. With none picked, it uses
          all of them.
        </p>
      </div>
      {catalogs.status === "loading" && (
        <p className="settings__section-note settings__section-note--dim">
          Loading catalogs…
        </p>
      )}
      {catalogs.status === "error" && (
        <p className="settings__section-note settings__section-note--dim">
          Couldn&rsquo;t load the catalogs. Check your AIOStreams sign-in or
          manifest URL.
        </p>
      )}
      {/*
       * shadcn's Combobox in its `#multiple` composition: a chips field you
       * type into, with the selection living inside the control as removable
       * chips. Three things went away with it, and none of them were doing a
       * job this component does not do better.
       *
       * The hand-rolled portal menu went: sixty lines of anchoring, flip-up
       * logic, scroll and resize listeners, an Escape handler and an
       * outside-click handler, all of which the positioner already does. It
       * was also BROKEN — v0.9.54 converted its anchor to a shadcn <Button>,
       * which on React 18 dropped the ref (see button.tsx), so it measured a
       * null rect and never opened at all.
       *
       * The `.source-chip` spans went, and the separate "add sources" button
       * with them. A chips combobox is one control: the chips ARE the field,
       * so there is no button standing beside a list of what it did.
       *
       * MULTIPLE-SELECT, so `value` is the array and `onValueChange` hands
       * back the whole next array. Removing a chip and picking an item come
       * through the same seam, which is why there is no remove handler here.
       */}
      {catalogs.status === "ready" && (
        <Combobox
          items={items}
          multiple
          value={chosen}
          onValueChange={(next: AioCatalog[]) =>
            update(next.map((c) => c.key))
          }
          itemToStringValue={(c: AioCatalog) => `${c.name} ${typeLabel(c.type)}`}
          itemToStringLabel={(c: AioCatalog) => c.name}
        >
          {/* The stack's width, to 520px. The demo's `max-w-xs` (320px) was
            * cramped: two chips filled it, and a long one ran out past its
            * border (Adam, v0.11.37). Uncapped it ran the full 738px of the
            * settings panel, and since the popup takes its width from the
            * field, so did that. A chips field is a place to put chips, not a
            * text column.
            *
            * A chip is never wider than the field: it stops at the field's
            * edge with an ellipsis, and the name in full is its hint. */}
          <ComboboxChips ref={anchor} className="w-full max-w-[520px]">
            <ComboboxValue>
              {(picked: AioCatalog[]) =>
                picked.map((c) => (
                  <ComboboxChip
                    key={c.key}
                    aria-label={c.name}
                    className="max-w-full min-w-0"
                    data-hint={`${c.name} · ${typeLabel(c.type)}`}
                  >
                    <span className="min-w-0 truncate">
                      {c.name} · {typeLabel(c.type)}
                    </span>
                  </ComboboxChip>
                ))
              }
            </ComboboxValue>
            <ComboboxChipsInput placeholder="Add catalogs…" />
          </ComboboxChips>
          <ComboboxContent anchor={anchor}>
            <ComboboxEmpty>No catalog found.</ComboboxEmpty>
            <ComboboxList>
              {(c: AioCatalog) => (
                <ComboboxItem key={c.key} value={c}>
                  {c.name}
                  <span className="source-row__type">{typeLabel(c.type)}</span>
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      )}
    </div>
  );
}

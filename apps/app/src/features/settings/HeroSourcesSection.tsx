import { useEffect, useRef, useState } from "react";
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
} from "../../components/ui/combobox";
import { fetchAioCatalogs, type AioCatalog } from "../../data/aiostreams";
import {
  isValidManifestUrl,
  loadAioUrl,
  loadHeroSources,
  saveHeroSources,
} from "./aiostreams";

/**
 * Which catalogs feed the Stream tab's hero carousel.
 *
 * Lives under Customize, not with the manifest: picking what the hero
 * shows is a decision about how the home screen LOOKS, not about the
 * connection that makes it possible. It reads the saved manifest to list
 * the catalogs on offer, which is the only thing it needs from Media.
 */

type Catalogs =
  | { status: "idle" | "loading" }
  | { status: "ready"; items: AioCatalog[] }
  | { status: "error" };

function typeLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function HeroSourcesSection() {
  // Read once per mount: this panel is not where the manifest is edited, so
  // there is nothing here that can change it under us.
  const savedUrl = useRef(loadAioUrl()).current;
  const [catalogs, setCatalogs] = useState<Catalogs>({ status: "idle" });
  const [selected, setSelected] = useState<string[]>(loadHeroSources);

  useEffect(() => {
    if (!isValidManifestUrl(savedUrl)) {
      setCatalogs({ status: "idle" });
      return;
    }
    let alive = true;
    setCatalogs({ status: "loading" });
    fetchAioCatalogs(savedUrl)
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
  }, [savedUrl]);

  const update = (keys: string[]) => {
    setSelected(keys);
    saveHeroSources(keys);
  };

  const items = catalogs.status === "ready" ? catalogs.items : [];
  const byKey = new Map(items.map((c) => [c.key, c]));
  const chosen = selected
    .map((k) => byKey.get(k))
    .filter((c): c is AioCatalog => !!c);

  // Renders as a stack, not a section: it is one control among several in
  // Customize's Stream panel, and its own rule and 21px heading made a
  // list of settings read as a list of pages.
  return (
    <div className="customize-stack">
      <div>
        <h4 className="customize-row__title">Hero Slider Sources</h4>
        <p className="settings__section-note settings__section-note--dim">
          The catalogs the hero pulls from, shuffled each load. Empty uses a
          mix of everything.
        </p>
      </div>
      {catalogs.status === "loading" && (
        <p className="settings__section-note settings__section-note--dim">
          Loading catalogs…
        </p>
      )}
      {catalogs.status === "error" && (
        <p className="settings__section-note settings__section-note--dim">
          Couldn&rsquo;t reach the manifest. Check the URL, and note the browser
          dev build can be blocked by CORS where the desktop app isn&rsquo;t.
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
          <ComboboxChips className="w-full">
            <ComboboxValue>
              {(picked: AioCatalog[]) =>
                picked.map((c) => (
                  <ComboboxChip key={c.key} aria-label={c.name}>
                    {c.name} · {typeLabel(c.type)}
                  </ComboboxChip>
                ))
              }
            </ComboboxValue>
            <ComboboxChipsInput placeholder="Add sources…" />
          </ComboboxChips>
          <ComboboxContent>
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

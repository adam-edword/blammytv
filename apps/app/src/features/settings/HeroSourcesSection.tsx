import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { ChevronIcon, CloseIcon } from "../../ui/icons";
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

  /**
   * The "add sources" picker: shadcn's Combobox pattern, multi-select.
   *
   * WHAT THIS REPLACED, AND WHY. It was a hand-rolled portal: a fixed-
   * position menu anchored off the button's rect, with its own flip-up
   * logic, its own scroll and resize listeners, its own Escape handler and
   * its own outside-click handler. Roughly sixty lines to reimplement a
   * Popover, and it was BROKEN — v0.9.54 converted the anchor to a shadcn
   * <Button>, which on React 18 silently dropped the ref (see button.tsx),
   * so `place()` measured a null rect, `menuPos` stayed null and the menu
   * never rendered at all. Clicking "add sources" did nothing for twelve
   * versions.
   *
   * Radix's Popover already does the anchoring, the flip, the dismissal and
   * the focus return, and it does them against a portal it owns, so none of
   * that state lives here any more. Command supplies the filter, which the
   * old list did not have.
   *
   * It stays MULTI-select: the chips above are the selection, and picking
   * from the list adds to it rather than replacing it, so the popover
   * stays open. That is why this is the pattern spelled out here rather
   * than the single-value <Combobox> in ui/.
   */
  const [addOpen, setAddOpen] = useState(false);

  const items = catalogs.status === "ready" ? catalogs.items : [];
  const byKey = new Map(items.map((c) => [c.key, c]));

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
      {catalogs.status === "ready" && (
        <div className="chip-select">
          {selected.map((key) => {
            const c = byKey.get(key);
            return (
              <span key={key} className="source-chip">
                {c ? `${c.name} · ${typeLabel(c.type)}` : key}
                <button
                  type="button"
                  className="source-chip__x"
                  aria-label={`Remove ${c?.name ?? key}`}
                  onClick={() => update(selected.filter((k) => k !== key))}
                >
                  <CloseIcon />
                </button>
              </span>
            );
          })}
          {items.length > 0 && (
            <Popover open={addOpen} onOpenChange={setAddOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  type="button"
                  role="combobox"
                  className="chip-select__add"
                  aria-expanded={addOpen}
                >
                  add sources
                  <ChevronIcon />
                </Button>
              </PopoverTrigger>
              {/* z-[70] because the Settings sheet is z 60 and Popover's own
                * z-50 would paint this behind it — the note settings.css
                * carried for the old portal, which is still true. */}
              <PopoverContent className="z-[70] w-80 p-0" align="start">
                <Command>
                  <CommandInput
                    placeholder="Search catalogs…"
                    className="h-9"
                  />
                  <CommandList>
                    <CommandEmpty>No catalog found.</CommandEmpty>
                    <CommandGroup>
                      {items.map((c) => (
                        <CommandItem
                          key={c.key}
                          value={`${c.name} ${typeLabel(c.type)}`}
                          onSelect={() =>
                            update(
                              selected.includes(c.key)
                                ? selected.filter((k) => k !== c.key)
                                : [...selected, c.key],
                            )
                          }
                        >
                          {c.name}
                          <span className="source-row__type">
                            {typeLabel(c.type)}
                          </span>
                          <Check
                            className={
                              "ml-auto" +
                              (selected.includes(c.key)
                                ? " opacity-100"
                                : " opacity-0")
                            }
                          />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}
    </div>
  );
}

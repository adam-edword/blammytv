import index from "./circuits/index.json";

/**
 * Track layouts, for the racing card (plan 010).
 *
 * Vendored from julesr0y/f1-circuits-svg (CC-BY-4.0) by
 * scripts/harvest-circuits.mjs, which also builds the map below: our
 * schedule names a circuit ("Hungaroring", id 613) and the art is keyed by
 * the library's own layout id ("hungaroring-3"), so something has to join
 * them and it should not be done at runtime.
 *
 * F1 ONLY, and that is a fact about the data rather than a shortcut.
 * Measured over a full season of all six racing leagues: F1 puts a
 * `circuit` on every event; IndyCar, all three NASCAR series and NHRA put
 * nothing at all — no circuit, no venue, only an event name. There is
 * therefore no track to look art up BY for those, which is why a generic
 * oval would be decoration rather than information. Their cards go
 * without, and `art()` answering undefined is the normal case, not an
 * error.
 */

/** Every layout file, inlined at build time. They are one stroked path on
 * a 500x500 canvas with no fill, so inlining is what lets the card colour
 * them with CSS instead of shipping a picture per theme. */
const FILES = import.meta.glob<string>("./circuits/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});

interface Circuit {
  /** The art's own id: "hungaroring-3". */
  layout: string;
  /** As our schedule names it: "Hungaroring". */
  name: string;
  country?: string;
}

const CIRCUITS: Record<string, Circuit> = index.circuits;

/** The season the vendored layouts were chosen for. */
export const CIRCUIT_YEAR: number = index.year;

/** What our schedule knows about a circuit, by its id. */
export function circuit(id: string): Circuit | undefined {
  return CIRCUITS[id];
}

/**
 * The track's outline as inline SVG, or undefined.
 *
 * Undefined is ordinary: every racing league except F1 reaches this with
 * nothing to ask about, and an F1 circuit new enough that the art has not
 * caught up would too. The card has to read without one.
 */
export function art(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const found = CIRCUITS[id];
  return found ? FILES[`./circuits/${found.layout}.svg`] : undefined;
}

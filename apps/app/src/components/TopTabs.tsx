/**
 * Top-nav model.
 *
 * Two sections: a "Live TV" section and a "Streaming" section (Stream +
 * Discover). The search affordance belongs to whichever section is active and
 * sits on that section's outer edge — to the left of Live TV, or to the right
 * of the streaming tabs (see AppHeader).
 */

export type TabKey = "live" | "stream" | "discover";
export type SectionKey = "live" | "stream";

export interface TabDef {
  key: TabKey;
  label: string;
  section: SectionKey;
}

export const TABS: TabDef[] = [
  { key: "live", label: "Live TV", section: "live" },
  { key: "stream", label: "Stream", section: "stream" },
  { key: "discover", label: "Discover", section: "stream" },
];

/** Which section a tab belongs to (drives the search-icon placement). */
export function sectionOf(key: TabKey): SectionKey {
  return TABS.find((t) => t.key === key)?.section ?? "live";
}

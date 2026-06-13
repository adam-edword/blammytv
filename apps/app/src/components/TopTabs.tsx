/** Top tab design from the spec: live | series | movies. */

export type TabKey = "live" | "series" | "movies";

export const TABS: { key: TabKey; label: string }[] = [
  { key: "live", label: "Live TV" },
  { key: "series", label: "Series" },
  { key: "movies", label: "Movies" },
];

export function TopTabs({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (key: TabKey) => void;
}) {
  return (
    <nav className="top-tabs" role="tablist" aria-label="Sections">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={active === tab.key}
          className={"top-tab" + (active === tab.key ? " top-tab--active" : "")}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

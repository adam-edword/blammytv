/** The redesign's square-ish toggle: 46×24 track, sliding 21×20 thumb.
 * On = red track / light thumb right; off = near-black track / dim red
 * thumb left. */
export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={"toggle" + (on ? " toggle--on" : "")}
      onClick={() => onChange(!on)}
    >
      <span className="toggle__thumb" />
    </button>
  );
}

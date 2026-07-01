/** A text-less chip rail: gray track, white squircle thumb, accent flood
 * when on. `small` is the dense-list variant (source/category rows). */
export function Toggle({
  on,
  onChange,
  label,
  small = false,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={
        "toggle" + (on ? " toggle--on" : "") + (small ? " toggle--sm" : "")
      }
      onClick={() => onChange(!on)}
    >
      <span className="toggle__thumb" />
    </button>
  );
}

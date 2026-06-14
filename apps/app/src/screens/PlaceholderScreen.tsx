/** A tasteful stand-in for a section that hasn't been built yet. */
export function PlaceholderScreen({
  title,
  note,
}: {
  title: string;
  note: string;
}) {
  return (
    <div className="placeholder">
      <h2 className="placeholder__title">{title}</h2>
      <p className="placeholder__note">{note}</p>
    </div>
  );
}

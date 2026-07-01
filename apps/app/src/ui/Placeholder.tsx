/** Empty screen used while a tab's real feature hasn't landed yet. */
export function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="placeholder">
      <h2 className="placeholder__title">{title}</h2>
      <p className="placeholder__note">{note}</p>
    </div>
  );
}

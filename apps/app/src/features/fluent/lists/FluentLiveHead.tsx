/** Fluent's Live TV page header: the title, what is listed, and Now, which
 * jumps the Guide back to the current time (the Guide's own jump). */
export function FluentLiveHead({
  subtitle,
  onNow,
}: {
  subtitle: string;
  onNow: () => void;
}) {
  return (
    <header className="fl-head">
      <div className="fl-head__text">
        <h1 className="fl-head__title">Live TV</h1>
        <p className="fl-head__sub">{subtitle}</p>
      </div>
      <button type="button" className="fl-btn" aria-label="Back to now" data-hint="Back to now" onClick={onNow}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
          <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
          <path d="M8 1.5v2.2M8 12.3v2.2M1.5 8h2.2M12.3 8h2.2" strokeLinecap="round" />
        </svg>
      </button>
    </header>
  );
}

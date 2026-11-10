/** Fluent's Live TV page header: the title, what is listed, and Now, which
 * jumps the Guide back to the current time (the Guide's own jump). Under
 * ~1200px the folders column is folded away (fluent-lists.css), and Folders
 * opens it over the grid. */
export function FluentLiveHead({
  subtitle,
  onNow,
  foldersOpen,
  onFolders,
}: {
  subtitle: string;
  onNow: () => void;
  foldersOpen: boolean;
  onFolders: () => void;
}) {
  return (
    <header className="fl-head">
      <div className="fl-head__text">
        <h1 className="fl-head__title">Live TV</h1>
        <p className="fl-head__sub">{subtitle}</p>
      </div>
      <button
        type="button"
        className="fl-btn fl-head__folders"
        aria-expanded={foldersOpen}
        aria-controls="fl-folders-pane"
        onClick={onFolders}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden>
          <path d="M1.75 4.25c0-.55.45-1 1-1h3.1l1.4 1.5h5c.55 0 1 .45 1 1v6c0 .55-.45 1-1 1h-9.5c-.55 0-1-.45-1-1z" />
        </svg>
        Folders
      </button>
      <button type="button" className="fl-btn" aria-label="Back to now" data-hint="Back to now" onClick={onNow}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
          <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
          <path d="M8 1.5v2.2M8 12.3v2.2M1.5 8h2.2M12.3 8h2.2" strokeLinecap="round" />
        </svg>
      </button>
    </header>
  );
}

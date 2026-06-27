/** Inline error shown on a single tab when its source (AIOStreams or IPTV)
 * fails to load — the other tab keeps working, so this stays scoped to its
 * screen rather than taking over the whole app. */
export function SourceError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="source-error">
      <h2 className="source-error__title">Couldn't load this tab</h2>
      <p className="source-error__msg">{message}</p>
      <button className="btn btn--primary" type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

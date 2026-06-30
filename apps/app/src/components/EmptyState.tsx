import { FocusButton } from "./FocusButton";

/** A friendly full-screen stand-in for a tab with nothing to show yet — chiefly
 * the fresh-install case where no source is configured. Optionally offers a
 * focusable action (e.g. open Settings to add one). */
export function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state__card">
        <h2 className="empty-state__title">{title}</h2>
        <p className="empty-state__message">{message}</p>
        {actionLabel && onAction && (
          <FocusButton
            className="btn btn--primary empty-state__action"
            focusKey="empty-action"
            autoFocus
            onPress={onAction}
          >
            {actionLabel}
          </FocusButton>
        )}
      </div>
    </div>
  );
}

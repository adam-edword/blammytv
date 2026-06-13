import { useEffect } from "react";
import { CloseIcon } from "./icons";

/**
 * Settings panel.
 *
 * A dim backdrop over the whole window with a large panel anchored top-right
 * (per the Figma mock). Content is intentionally empty for now — this is the
 * shell and its placement. Dismissable via backdrop click, Escape, or the
 * close button so a user is never trapped.
 *
 * Note: per the project's backend-config rule, real configuration lives in the
 * web UI, not on-device. Whatever lands in here should respect that.
 */
export function SettingsPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="icon-btn settings-panel__close"
          type="button"
          aria-label="Close settings"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
        {/* Settings content goes here. */}
      </div>
    </div>
  );
}

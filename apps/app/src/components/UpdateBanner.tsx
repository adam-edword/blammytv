import { useUpdater } from "../state/updater";

/** A slim banner that appears when a self-update is available. Installing
 * downloads the new build and relaunches. Hidden otherwise. */
export function UpdateBanner() {
  const { status, version, error, install } = useUpdater();

  const installing = status === "installing";
  if (status !== "available" && !installing && status !== "error") return null;
  // Only show the error variant if it happened during an install attempt.
  if (status === "error" && !version) return null;

  return (
    <div className="update-banner">
      <span className="update-banner__text">
        {installing
          ? "Downloading update…"
          : status === "error"
            ? `Update failed: ${error ?? "unknown error"}`
            : `BlammyTV ${version} is available.`}
      </span>
      <button
        className="btn btn--primary update-banner__btn"
        type="button"
        disabled={installing}
        onClick={() => void install()}
      >
        {installing ? "Installing…" : "Install & restart"}
      </button>
    </div>
  );
}

import { useState } from "react";
import {
  ShareCodeSchema,
  normalizeShareCodeInput,
  isCompleteShareCode,
  SHARE_CODE_LENGTH,
  type ShareCode,
} from "@blammytv/shared";

/**
 * First-launch pairing.
 *
 * The discipline rule: this is the ONE text field the app is ever allowed to
 * show. One input box, nothing else. Everything else lives in the web UI.
 */
export function PairingScreen({
  onPaired,
}: {
  onPaired: (code: ShareCode) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const complete = isCompleteShareCode(value);

  function submit() {
    const parsed = ShareCodeSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid code");
      return;
    }
    setError(null);
    onPaired(parsed.data);
  }

  return (
    <div className="pairing">
      <div className="pairing__card">
        <h1 className="pairing__brand">BlammyTV</h1>
        <p className="pairing__lead">
          Enter the code from your setup page to connect this device.
        </p>

        <input
          className="pairing__input"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          aria-label="Share code"
          placeholder={"–".repeat(SHARE_CODE_LENGTH)}
          maxLength={SHARE_CODE_LENGTH}
          value={value}
          onChange={(e) => {
            setError(null);
            setValue(normalizeShareCodeInput(e.target.value));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && complete) submit();
          }}
        />

        {error && <p className="pairing__error">{error}</p>}

        <button
          className="btn btn--primary pairing__submit"
          type="button"
          disabled={!complete}
          onClick={submit}
        >
          Connect
        </button>
      </div>
    </div>
  );
}

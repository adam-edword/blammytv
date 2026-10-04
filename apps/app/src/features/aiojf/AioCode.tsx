import { Button } from "../../components/ui/button";
import { CheckIcon, CopyIcon } from "../../ui/icons";
import { Hint } from "../../ui/Hint";

/**
 * The Quick Connect code and its copy button (useSignIn.ts), for the two
 * places that show one. Settings wears Trakt's code line (settings.css, which
 * AIOStreams borrowed in plan 023); onboarding is its own dark world, so its
 * code is white on black and its button has no tooltip (a tooltip would
 * portal under the overlay).
 */
export function AioCode({
  code,
  copied,
  onCopy,
  variant = "settings",
}: {
  code: string;
  copied: boolean;
  onCopy: () => void;
  variant?: "settings" | "onboarding";
}) {
  const button = (
    <Button
      variant="ghost"
      size="icon-sm"
      type="button"
      aria-label="Copy code"
      onClick={onCopy}
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </Button>
  );
  const onboarding = variant === "onboarding";
  return (
    <div className={onboarding ? "onb-codeline" : "trakt-row__codeline"}>
      <p className={onboarding ? "onb-code" : "trakt-row__code"} aria-label={`Code ${code}`}>
        {code}
      </p>
      {onboarding ? button : <Hint label={copied ? "Copied!" : "Copy code"}>{button}</Hint>}
    </div>
  );
}

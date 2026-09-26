import { forwardRef } from "react";
import { Button } from "../components/ui/button";
import { Hint } from "./Hint";
import { BackArrowIcon } from "./icons";

/**
 * Back, drawn one way everywhere (plan 019, K3; plan 016 3.3 asked for a
 * BackButton): multi-view's round glass icon with the arrow in it. It was
 * "← Back" as a ghost with a black hover on Stream and Library, an outline
 * square on the draw and a ghost pill that turned into a bare arrow in the
 * Sports theater. The word is still its name, for a screen reader and as
 * its tooltip.
 *
 * forwardRef because the draw focuses it on open.
 */
export const BackButton = forwardRef<
  HTMLButtonElement,
  {
    onClick: () => void;
    /** Its name. "Back" unless where it goes back to is worth saying. */
    label?: string;
    className?: string;
  }
>(function BackButton({ onClick, label = "Back", className }, ref) {
  return (
    <Hint label={label}>
      <Button
        ref={ref}
        variant="secondary"
        size="icon"
        type="button"
        aria-label={label}
        className={className}
        onClick={onClick}
      >
        <BackArrowIcon size={18} />
      </Button>
    </Hint>
  );
});

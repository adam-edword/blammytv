import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";

/**
 * A destructive button that takes two presses: arm, then confirm within a
 * few seconds. Clear All Login Info (App) and Reset Appearance (Appearance)
 * are the same button, so they are one component; Reset had no confirm at
 * all until the pages (the 0.9.79 audit's LB2).
 *
 * The label carries the state in words ("Click again to confirm"), and the
 * armed state is a RING, not a deeper fill. The old `.btn-danger--armed`
 * mixed 45% danger into the face, which only read as a state because the
 * unarmed face was a 16% tint; `destructive` is a solid red, so there is no
 * "more red" left to go to. A ring is shadcn's own emphasis primitive and it
 * is the same halo the focus treatment uses. (It also could not have stayed
 * in CSS: the variant paints the fill with a utility, and utilities outrank
 * the app layer.)
 */
export function ConfirmButton({
  label,
  confirmLabel = "Click again to confirm",
  onConfirm,
}: {
  /** The resting word: "Clear…", "Reset". */
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef(0);
  // Closing Settings while armed would otherwise fire setState on an
  // unmounted component when the 4s timer elapses.
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const press = () => {
    if (!armed) {
      setArmed(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setArmed(false), 4000);
      return;
    }
    window.clearTimeout(timer.current);
    setArmed(false);
    onConfirm();
  };
  return (
    <Button
      variant="destructive"
      type="button"
      className={armed ? "ring-[3px] ring-destructive/50" : undefined}
      onClick={press}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}

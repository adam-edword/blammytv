import { useSyncExternalStore } from "react";
import { aeroShowing, subscribeShowing } from "../features/settings/themePack";

/**
 * Frutiger Aero's bubbles (plan 035, round 3): one layer of bubbles drifting
 * up behind everything, drawn in CSS (packs.css .aero-bubbles).
 *
 * MOUNT IT INSIDE `.app-shell`, and nowhere else, for PrismGlow's reason: the
 * inverted player cuts a clip-path hole through the shell and shows native
 * video beneath the page, and a layer outside the shell would paint over it.
 * Inside, behind the shell's content, the hole cuts it with everything else;
 * packs.css hides it while a hole is cut.
 *
 * Two nodes, not one per bubble: a clipping frame and a tall tile of
 * gradients that packs.css moves with a transform. Drawn in both faces, and
 * still under reduced motion (it just doesn't move).
 */
export function AeroBubbles() {
  const showing = useSyncExternalStore(subscribeShowing, aeroShowing);
  return showing ? (
    <div className="aero-bubbles" aria-hidden>
      <div className="aero-bubbles__tile" />
    </div>
  ) : null;
}

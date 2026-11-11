import { useSyncExternalStore } from "react";
import { aeroShowing, subscribeShowing } from "../features/settings/themePack";

/**
 * Frutiger Aero's bubbles (plan 035, round 3): bubbles drifting up behind
 * everything, in three depths, drawn in CSS (packs.css .aero-bubbles).
 *
 * MOUNT IT INSIDE `.app-shell`, and nowhere else, for PrismGlow's reason: the
 * inverted player cuts a clip-path hole through the shell and shows native
 * video beneath the page, and a layer outside the shell would paint over it.
 * Inside, behind the shell's content, the hole cuts it with everything else;
 * packs.css hides it while a hole is cut.
 *
 * Four nodes, not one per bubble: a clipping frame and three tiles of
 * gradients (far, mid, near) that packs.css moves with a transform, each at
 * its own rate and as soft as its distance. Drawn in both faces, and still
 * under reduced motion (they just don't move).
 */
export function AeroBubbles() {
  const showing = useSyncExternalStore(subscribeShowing, aeroShowing);
  return showing ? (
    <div className="aero-bubbles" aria-hidden>
      <div className="aero-bubbles__tile aero-bubbles__tile--far" />
      <div className="aero-bubbles__tile aero-bubbles__tile--mid" />
      <div className="aero-bubbles__tile aero-bubbles__tile--near" />
    </div>
  ) : null;
}

import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { StatsIcon, TvIcon, VolumeIcon, WarnIcon } from "../../ui/icons";
import { capLine } from "./multiview";
import { markMultiviewNoticeSeen } from "./multiviewAck";
import type { XtreamConnections } from "../../data/xtream";

/**
 * The one-time notice before the first multi-view (plan 013).
 *
 * Adam asked for this after seeing Telly's, and for the same reason they
 * ship one: multi-view is the one part of this app that does NOT use mpv,
 * and the three ways it differs are all things you would otherwise discover
 * by watching a tile fail.
 *
 * ACKNOWLEDGED, NOT DISMISSED. No backdrop click, no Escape, no close X:
 * the button is the only way out. That is deliberate and it is the whole
 * point of the notice — Adam's words were "acknowledge and accept". Every
 * other overlay in this app closes on Escape, so this one breaking the
 * pattern is a decision rather than an oversight.
 *
 * ON THE SHARED DIALOG (plan 017, P6): focus trapped inside it, the page
 * behind inert, centred over a backdrop. It used to be a hand-rolled
 * `aria-modal` card with no trap (a11y MV1) that floated top-right, because
 * `.modal-backdrop--center` was never defined anywhere.
 *
 * Shown once, ever. See multiviewAck.
 */
export function MultiviewNotice({
  conns,
  onAccept,
}: {
  /** This playlist's connection limit, for the cap line. Null when the
   * source does not publish one (Stalker, M3U). */
  conns: XtreamConnections | null;
  onAccept: () => void;
}) {
  const accept = () => {
    markMultiviewNoticeSeen();
    onAccept();
  };

  // The Dialog portals out of .app-shell itself, which matters for the
  // reason SettingsModal gives: the shell carries the player's clip-path
  // hole, and a card inside it would have that hole cut through it.
  // Open, and nothing listening for it to close: Escape and a click outside
  // both ask the Dialog to close, and nothing answers. Only Got it does.
  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        className="mvnotice flex flex-col items-center gap-0 rounded-[22px] border-(--border-strong) bg-(--card-glass) p-[30px_28px_22px] text-center shadow-[0_-13px_72.6px_rgba(0,0,0,0.73)] backdrop-blur-[10px] sm:max-w-[436px]"
      >
        <div className="mvnotice__badge" aria-hidden>
          <WarnIcon size={26} />
        </div>
        {/* The shared title and description bring their own sizes, from a
          * later cascade layer than player.css, so the notice's own are
          * restated here. */}
        <DialogTitle className="mvnotice__title text-[21px] leading-normal font-bold tracking-[-0.01em]">
          Multi-view
        </DialogTitle>
        <DialogDescription className="mvnotice__sub text-[13px] text-(--text-muted)">
          Plays in your browser, not mpv
        </DialogDescription>

        <ul className="mvnotice__list">
          <Point icon={<TvIcon size={18} />} title="Some streams play differently">
            HEVC channels are converted first, so they take a moment longer to
            start, and some audio formats can come up silent. Normal playback
            is unaffected.
          </Point>
          <Point icon={<StatsIcon size={18} />} title="Every tile is a connection">
            {capLine(conns)}
          </Point>
          <Point icon={<VolumeIcon size={18} />} title="One tile has sound">
            Click any tile to move the audio to it.
          </Point>
        </ul>

        <button type="button" className="mvnotice__accept" onClick={accept} autoFocus>
          Got it
        </button>
        <p className="mvnotice__once">Shown once.</p>
      </DialogContent>
    </Dialog>
  );
}

function Point({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="mvnotice__point">
      <span className="mvnotice__icon" aria-hidden>
        {icon}
      </span>
      <span>
        <strong className="mvnotice__pointtitle">{title}</strong>
        <span className="mvnotice__pointbody">{children}</span>
      </span>
    </li>
  );
}

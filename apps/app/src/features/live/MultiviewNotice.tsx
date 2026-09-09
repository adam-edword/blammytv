import type { ReactNode } from "react";
import { createPortal } from "react-dom";
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

  // Portaled out of .app-shell for the reason SettingsModal gives: the shell
  // carries the player's clip-path hole, and a card rendered inside it would
  // have that hole cut through its middle.
  return createPortal(
    <div className="modal-backdrop modal-backdrop--center">
      <section className="mvnotice" role="dialog" aria-modal="true" aria-labelledby="mvnotice-title">
        <div className="mvnotice__badge" aria-hidden>
          <WarnIcon size={26} />
        </div>
        <h2 className="mvnotice__title" id="mvnotice-title">
          Multi-view
        </h2>
        <p className="mvnotice__sub">Plays in your browser, not mpv</p>

        <ul className="mvnotice__list">
          <Point icon={<TvIcon size={18} />} title="Some streams won’t play">
            Multi-view decodes in the browser instead of mpv, so HEVC video and
            AC-3 audio can come up blank. Normal playback is unaffected.
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
      </section>
    </div>,
    document.body,
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

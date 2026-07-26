import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "../../ui/icons";
import { useClosingExit } from "./useClosingExit";
import { ChipTabs } from "../../ui/ChipTabs";
import { CustomizeTab } from "./CustomizeTab";
import { GeneralTab } from "./GeneralTab";

/**
 * Two questions, one tab each: what the app DOES (General) and how it LOOKS
 * (Customize). Everything is filed by that question, never by which screen
 * it happens to affect.
 *
 * The rail was Playlists / AIOStreams / Customize once, which asked the
 * user to know that "the place your app updates live" was under Customize,
 * next to accent colours. Then Media / General / Customize, which still
 * spent a third of the rail on a screen most people touch once. Sources is
 * a section inside General now.
 *
 * Both tabs carry the same Live TV / Stream pill for the parts that differ
 * per world (General: where content comes from; Customize: how that content
 * looks). One mental model, said twice, rather than two filing systems.
 */
type SettingsTab = "general" | "customize";

const TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: "general", label: "General" },
  { key: "customize", label: "Customize" },
];

/** The floating settings card from the redesign: title left, chip-tab rail
 * center, close right. Themes are no longer a tab here — Customize carries a
 * launcher that pops the standalone Themes panel out (onOpenThemes), and the
 * theme preview/commit/revert boundary lives in that panel now. */
export function SettingsModal({
  onClose,
  onOpenThemes,
}: {
  onClose: () => void;
  onOpenThemes: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>("general");
  const { closing, requestClose } = useClosingExit(onClose);

  // Top-fade flag, written straight to the DOM: this fires on every scroll
  // frame, and routing it through state would re-render the whole settings
  // tree for a value only CSS reads.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const markScrolled = (el: HTMLDivElement) => {
    if (el.scrollTop > 4) el.dataset.scrolled = "1";
    else delete el.dataset.scrolled;
  };
  // A new tab starts at the top, and its flag starts clear: shrinking
  // content can leave scrollTop clamped without firing a scroll event, and
  // a stale flag fades the first row of a page nobody scrolled.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = 0;
    delete el.dataset.scrolled;
  }, [tab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // requestClose is stable-enough (state guard inside); re-binding per
    // closing flip is harmless.
  });

  // Portaled OUT of .app-shell: with the inverted player, the shell carries
  // a clip-path hole where the video shows — a modal rendered inside it
  // would have that hole cut through its middle. On body, the modal paints
  // above everything and the video keeps playing behind the backdrop.
  return createPortal(
    <div className="modal-backdrop" onClick={requestClose}>
      <section
        className={"settings" + (closing ? " settings--closing" : "")}
        role="dialog"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="settings__header">
          <h2 className="settings__title">Settings</h2>
          <ChipTabs tabs={TABS} active={tab} onChange={setTab} />
          <button
            type="button"
            className="settings__close"
            aria-label="Close settings"
            onClick={requestClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div
          className="settings__body"
          ref={bodyRef}
          onScroll={(e) => markScrolled(e.currentTarget)}
        >
          {tab === "general" && <GeneralTab />}
          {tab === "customize" && <CustomizeTab onOpenThemes={onOpenThemes} />}
        </div>
      </section>
    </div>,
    document.body,
  );
}

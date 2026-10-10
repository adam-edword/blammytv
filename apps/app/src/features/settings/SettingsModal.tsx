import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Button } from "../../components/ui/button";
import {
  SETTINGS_PAGES,
  loadSettingsTab,
  saveSettingsTab,
  type SettingsTab,
} from "./settingsTab";
import {
  CloseIcon,
  EyeDropperIcon,
  PlayIcon,
  SettingsIcon,
  TvIcon,
  UserIcon,
} from "../../ui/icons";
import { useClosingExit } from "./useClosingExit";
import { Rail } from "../../ui/Rail";
import { Segmented } from "../../ui/Segmented";
import { SourcesPage } from "./SourcesPage";
import { PlaybackPage } from "./PlaybackPage";
import { AppearancePage } from "./AppearancePage";
import { AccountsPage } from "./AccountsPage";
import { AppPage } from "./AppPage";
import { returnFocus } from "../../lib/returnFocus";

/**
 * Five questions, one page each: what you WATCH (Sources), how it PLAYS
 * (Playback), how it LOOKS (Appearance), WHO you are (Accounts), and the APP
 * itself (App). Everything is filed by that question, never by which screen
 * it happens to affect. The words are in settingsTab.ts.
 *
 * The rule is 0.8.0's, and it has held through three shapes. The rail was
 * Playlists / AIOStreams / Customize once, which asked the user to know that
 * "the place your app updates live" was under Customize, next to accent
 * colours. Then Media / General / Customize, which still spent a third of the
 * rail on a screen most people touch once. Then two tabs, General and
 * Customize, which filed four playback rows under "how it looks" and had
 * nowhere to put anything new about playback or the app (plan 025). Five
 * questions fixes that without stretching the rule.
 *
 * The pages that differ per world carry the same Live TV / Stream pill
 * (Sources: where content comes from; Appearance: how that content looks).
 * One mental model, said twice, rather than two filing systems.
 */

/** What each page wears in the rail. The set had no person, so Accounts' is
 * drawn beside the others (ui/icons). */
const ICONS: Record<SettingsTab, ReactNode> = {
  sources: <TvIcon size={18} />,
  playback: <PlayIcon size={18} />,
  appearance: <EyeDropperIcon size={18} />,
  accounts: <UserIcon size={18} />,
  app: <SettingsIcon size={18} />,
};
const RAIL = SETTINGS_PAGES.map((p) => ({ ...p, icon: ICONS[p.key] }));

/** Under this card width the rail would leave the page too little, and it
 * becomes the segmented row the tabs were before the rail. Measured on the
 * card, not the window: the card is `min(786px, 100%)` of a window less its
 * margins, and it is the card the page has to fit in. */
const NARROW = 640;

/**
 * The floating settings card from the redesign: title left, close right, and
 * under them the rail of pages with the page beside it.
 *
 * ON RADIX'S DIALOG since v0.10.33 (plan 014 phase 1, ROADMAP M2), behind
 * the markup it always had: the same `.modal-backdrop` and `section.settings`,
 * so its look, place and motion are the CSS's as before. What Radix brings
 * is a real modal: focus goes in and stays in, the rest of the app is hidden
 * from a screen reader, and Escape is a layer. A popover or tooltip inside
 * takes its own Escape first, and the one Settings takes is marked, so the
 * screen under it and the app's fullscreen exit both leave it alone.
 *
 * Three things the stock Dialog would have got wrong here, each handled
 * below: the Combobox's list (Base UI, portalled to <body>), focus coming
 * back without a tooltip, and focus coming back at all when the palette
 * opened this.
 */
export function SettingsModal({
  onClose,
  returnTo,
}: {
  onClose: () => void;
  /** Where focus goes on close, when whatever opened Settings is about to
   * go itself: the palette hands over the element it was opened from. */
  returnTo?: HTMLElement | null;
}) {
  // Where you left off. The modal unmounts on close, so without this
  // every visit started at the first page.
  const [tab, setTab] = useState<SettingsTab>(loadSettingsTab);
  const pick = (t: SettingsTab) => {
    saveSettingsTab(t);
    setTab(t);
  };
  // The exit beat: Radix's `open` stays true until the card has faded, and
  // App unmounts it after (useClosingExit).
  const { closing, requestClose } = useClosingExit(onClose);

  // Whether the card is narrow enough for the pages to be a row. The card
  // lives in a portal that mounts a beat after this component does, so it is
  // taken by a callback ref into state rather than read from a ref in an
  // effect, which would find nothing. The first read is in a layout effect:
  // the narrow card never paints as a wide one.
  const [card, setCard] = useState<HTMLElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    if (!card) return;
    // offsetWidth, not the bounding box: the entrance scales the card, and
    // the layout width is the one the page has to fit.
    const read = () => setNarrow(card.offsetWidth < NARROW);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(card);
    return () => ro.disconnect();
  }, [card]);

  // Top-fade flag, written straight to the DOM: this fires on every scroll
  // frame, and routing it through state would re-render the whole settings
  // tree for a value only CSS reads.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const markScrolled = (el: HTMLDivElement) => {
    if (el.scrollTop > 4) el.dataset.scrolled = "1";
    else delete el.dataset.scrolled;
  };
  // A new page starts at the top, and its flag starts clear: shrinking
  // content can leave scrollTop clamped without firing a scroll event, and
  // a stale flag fades the first row of a page nobody scrolled.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = 0;
    delete el.dataset.scrolled;
  }, [tab]);

  // Where focus was when Settings opened (the gear, usually), to hand it
  // back on close. Taken in a layout effect, ahead of the focus scope
  // moving focus in. There is no Radix trigger to return it to: the gear
  // lives in the header, and the palette opens this too.
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const a = document.activeElement;
    opener.current = a instanceof HTMLElement && a !== document.body ? a : null;
  }, []);

  const label = SETTINGS_PAGES.find((p) => p.key === tab)?.label;

  // Portalled OUT of .app-shell, as before: with the inverted player the
  // shell carries a clip-path hole where the video shows, and a modal
  // inside it would have that hole cut through its middle. On body, the
  // modal paints above everything and the video keeps playing behind.
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogPrimitive.Portal>
        {/* No dim: the design floats the card straight over the content.
          * The backdrop is the overlay, and a click on it (not on the card)
          * closes, as it did. The card sits INSIDE it, the way it always
          * has, so settings.css's flex placement still puts it top right. */}
        <DialogPrimitive.Overlay className="modal-backdrop">
          <DialogPrimitive.Content
            asChild
            aria-describedby={undefined}
            // The card itself takes focus, not its first control. Radix's
            // default lit the first tab with a ring whenever Settings was
            // opened from the keyboard; the card has no ring of its own
            // (settings.css), so nothing on screen changes, and Tab goes
            // in from here.
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
            }}
            // A Combobox keeps Escape for itself. Its list, open, closes on
            // it; its field, with the list shut, has always swallowed it
            // (Base UI marks every Escape there), so Settings stayed up.
            // Radix hears Escape on the document in the capture phase,
            // before either, and would close the whole sheet.
            onEscapeKeyDown={(e) => {
              const t = e.target instanceof Element ? e.target : null;
              if (
                document.querySelector("[data-slot=combobox-content][data-open]") ||
                t?.closest("[role=combobox]")
              )
                e.preventDefault();
            }}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              const back = returnTo?.isConnected ? returnTo : opener.current;
              returnFocus(back);
            }}
          >
            <section
              ref={setCard}
              className={"settings" + (closing ? " settings--closing" : "")}
              aria-label="Settings"
              // The kit's name for an open dialog: Multi-view's keys stand
              // down while one is up (mvKeys.forMultiview). Before this, A,
              // M or S pressed on a button in Settings reached the grid
              // underneath.
              data-slot="dialog-content"
            >
              <header className="settings__header">
                <DialogPrimitive.Title className="settings__title">
                  Settings
                </DialogPrimitive.Title>
                <Button variant="ghost" size="icon"
                  type="button"
                  className="settings__close"
                  aria-label="Close settings"
                  onClick={requestClose}
                >
                  <CloseIcon className="size-5" />
                </Button>
              </header>

              <div className={"settings__layout" + (narrow ? " settings__layout--narrow" : "")}>
                {narrow ? (
                  // Names only, the row the tabs were before the rail.
                  <Segmented
                    role="tabs"
                    label="Settings"
                    className="settings__pages"
                    options={SETTINGS_PAGES}
                    value={tab}
                    onChange={pick}
                  />
                ) : (
                  <Rail className="settings__rail" label="Settings" items={RAIL} value={tab} onChange={pick} />
                )}
                <div
                  className="settings__body"
                  role="tabpanel"
                  aria-label={label}
                  ref={bodyRef}
                  onScroll={(e) => markScrolled(e.currentTarget)}
                >
                  {tab === "sources" && <SourcesPage />}
                  {tab === "playback" && <PlaybackPage />}
                  {tab === "appearance" && <AppearancePage />}
                  {tab === "accounts" && <AccountsPage />}
                  {tab === "app" && <AppPage />}
                </div>
              </div>
            </section>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

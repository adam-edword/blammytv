import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../components/ui/button";
import { REDUCED_MOTION } from "../lib/reducedMotion";
import { useCursorGlow } from "../ui/useCursorGlow";
import { NEWEST, RELEASES, type AlsoItem, type Headliner, type Rich } from "../features/whatsnew/releases";
import { markWhatsNewSeen } from "../features/whatsnew/whatsNewGate";
import { BootScene, type BootSceneHandle } from "./BootScene";
import { bootVars, markWelcomePlayed } from "./welcome";

/**
 * What's New: the screen a launch shows once after an update, and Settings →
 * App → What's New shows again on demand. Full screen in onboarding's world
 * (onboarding.css: true black, the dither, the trailing light, its title,
 * line and button), dark whatever the theme. A second view lists every
 * release.
 *
 * THE LAUNCH PLAYS THE BOOT. `boot` is the cold-boot sequence (BootScene, the
 * scene WelcomeAnimation plays, at the same pace): the frame sharpens, shrinks
 * to the tile and springs left, the wordmark arrives. After a beat the lockup
 * rises to the top and shrinks, and the page fills in below it. Any input
 * skips to the finished page, and a build that plays no boot (reduced motion,
 * a reload in one session, the page opened from Settings) lands there too.
 * The finished page is the same scene mounted `settled`, so a skip and a
 * played boot end on the same pixels.
 *
 * It is portalled to <body>, as Settings is: the inverted player cuts a clip
 * hole through .app-shell, and an overlay inside the shell would have it cut
 * through its middle. The shell is `inert` under it, as under onboarding, and
 * App keeps the screens beneath quiet (modalOpen), so nothing can start
 * playing while it is up.
 */

/** WelcomeAnimation's entrance and drift: the boot begins here. */
const BEGIN_MS = 900;
/** The spring settles 2686ms into the timeline (boot.css); the lockup waits
 * ~600ms on the finished tile before it rises. */
const RISE_MS = BEGIN_MS + 2686 + 600;
/** onboarding.css's overlay fade, the same as the way out of onboarding. */
const LEAVE_MS = 400;

function Line({ parts }: { parts: Rich }) {
  return (
    <>
      {parts.map((p, i) => (typeof p === "string" ? p : <b key={i}>{p.b}</b>))}
    </>
  );
}

/** The two headliners' small flat drawings. Decorative: the cards say it. */
function Art({ kind }: { kind: Headliner["art"] }) {
  return kind === "home" ? (
    <svg viewBox="0 0 320 132" preserveAspectRatio="xMidYMid slice">
      <rect x="16" y="14" width="150" height="58" rx="9" fill="var(--wn-strong)" />
      <rect x="172" y="20" width="40" height="46" rx="7" fill="var(--wn-soft)" />
      <rect x="218" y="20" width="40" height="46" rx="7" fill="var(--wn-soft)" />
      <rect x="264" y="20" width="40" height="46" rx="7" fill="var(--wn-soft)" />
      <rect x="28" y="52" width="58" height="6" rx="3" fill="var(--wn-line)" />
      <g transform="translate(16 84)">
        <rect width="74" height="40" rx="7" fill="var(--wn-strong)" />
        <rect y="44" width="74" height="4" rx="2" fill="var(--wn-soft)" />
        <rect y="44" width="50" height="4" rx="2" fill="var(--wn-line)" />
        <rect x="80" width="74" height="40" rx="7" fill="var(--wn-strong)" />
        <rect x="80" y="44" width="74" height="4" rx="2" fill="var(--wn-soft)" />
        <rect x="80" y="44" width="24" height="4" rx="2" fill="var(--wn-line)" />
        <rect x="160" width="74" height="40" rx="7" fill="var(--wn-strong)" />
        <circle cx="197" cy="20" r="8" fill="var(--wn-line)" />
        <rect x="240" width="74" height="40" rx="7" fill="var(--wn-strong)" />
        <circle cx="277" cy="20" r="8" fill="var(--wn-line)" />
      </g>
    </svg>
  ) : (
    <svg viewBox="0 0 320 132" preserveAspectRatio="xMidYMid slice">
      <rect x="16" y="14" width="288" height="78" rx="10" fill="var(--wn-strong)" />
      <circle cx="36" cy="32" r="6" fill="#ff6b6b" />
      <rect x="48" y="28" width="36" height="8" rx="4" fill="var(--wn-line)" />
      <rect x="16" y="108" width="288" height="6" rx="3" fill="var(--wn-soft)" />
      <rect x="16" y="108" width="210" height="6" rx="3" fill="var(--wn-line)" />
      <circle cx="226" cy="111" r="8" fill="#fff" />
      <rect x="250" y="102" width="54" height="18" rx="9" fill="var(--wn-soft)" />
      <rect x="262" y="109" width="30" height="4" rx="2" fill="var(--wn-line)" />
      <path d="M150 42l22 11-22 11z" fill="var(--wn-line)" />
    </svg>
  );
}

/** Also New's small glyphs. */
function Glyph({ kind }: { kind: AlsoItem["icon"] }) {
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.6 } as const;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      {kind === "vlc" ? (
        <>
          <rect x="2" y="3.5" width="14" height="11" rx="2.5" {...stroke} />
          <path d="M7.5 7l4 2-4 2z" fill="currentColor" />
        </>
      ) : kind === "themes" ? (
        <>
          <circle cx="9" cy="9" r="6.5" {...stroke} />
          <path d="M9 2.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" />
        </>
      ) : kind === "genres" ? (
        <>
          <rect x="2.5" y="3" width="13" height="3" rx="1.5" fill="currentColor" />
          <rect x="2.5" y="7.5" width="13" height="3" rx="1.5" fill="currentColor" opacity=".6" />
          <rect x="2.5" y="12" width="13" height="3" rx="1.5" fill="currentColor" opacity=".35" />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="5" {...stroke} />
          <path d="M12 12l3.5 3.5" {...stroke} strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export function WhatsNew({ boot, onClose }: { boot: boolean; onClose: () => void }) {
  const [view, setView] = useState<"new" | "log">("new");
  /** The lockup is at the top and the page is showing. */
  const [risen, setRisen] = useState(!boot);
  /** Mounted finished, no motion: a skipped boot, or no boot at all. */
  const [settled, setSettled] = useState(!boot);
  /** A new key remounts the scene finished, which is how a skip lands. */
  const [sceneKey, setSceneKey] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [vars, setVars] = useState(bootVars);
  const rootRef = useRef<HTMLDivElement>(null);
  const bootRef = useRef<BootSceneHandle>(null);
  const goRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const leaveTimer = useRef(0);

  useEffect(() => {
    const onResize = () => setVars(bootVars());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // The shell under the overlay is unreachable, as under onboarding: without
  // `inert`, Tab walks into the hidden header.
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".app-shell > .header, .app-shell > .app-main");
    els.forEach((el) => el.setAttribute("inert", ""));
    return () => els.forEach((el) => el.removeAttribute("inert"));
  }, []);

  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  // The boot: begin the finale, then lift the lockup. This launch's boot is
  // the one the cold start would have played, so it counts as played.
  useEffect(() => {
    if (!boot) return;
    markWelcomePlayed();
    rootRef.current?.focus({ preventScroll: true });
    const begin = window.setTimeout(() => bootRef.current?.beginFinale(), BEGIN_MS);
    const rise = window.setTimeout(() => setRisen(true), RISE_MS);
    return () => {
      window.clearTimeout(begin);
      window.clearTimeout(rise);
    };
  }, [boot]);

  const skip = () => {
    if (risen) return;
    setSettled(true);
    setSceneKey((k) => k + 1);
    setRisen(true);
  };

  const close = () => {
    if (leaving) return;
    markWhatsNewSeen();
    setLeaving(true);
    leaveTimer.current = window.setTimeout(onClose, LEAVE_MS);
  };

  // Any input skips the boot (WelcomeAnimation's rule); once the page is up,
  // Escape closes it. Separate listeners, each attached for its own state, so
  // the key that skips is never also the key that closes.
  useEffect(() => {
    if (risen) {
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        close();
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
    const onInput = (e: Event) => {
      // A key acts on the focused control and a press focuses what it lands
      // on: one that skipped must not also press a button or take focus from
      // Continue, which the page puts it on.
      e.preventDefault();
      skip();
    };
    const inputs = ["pointerdown", "mousedown", "keydown"];
    for (const t of inputs) window.addEventListener(t, onInput);
    return () => {
      for (const t of inputs) window.removeEventListener(t, onInput);
    };
    // close and skip read only state and refs this effect already tracks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [risen, leaving]);

  // Focus: Continue when the page is up, Back on the changelog.
  useEffect(() => {
    if (!risen) return;
    rootRef.current?.scrollTo(0, 0);
    (view === "log" ? backRef : goRef).current?.focus({ preventScroll: true });
  }, [risen, view]);

  // The trailing light (onboarding's lerp), on a clock of its own that runs
  // only while the light is on its way. None under reduced motion.
  const glowRef = useRef<HTMLDivElement>(null);
  const tick = useCursorGlow(glowRef, true);
  useEffect(() => {
    if (REDUCED_MOTION) return;
    let raf = 0;
    let last = 0;
    const frame = (now: number) => {
      const moving = tick(now, Math.min(0.1, (now - last) / 1000));
      last = now;
      raf = moving ? requestAnimationFrame(frame) : 0;
    };
    const wake = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    window.addEventListener("pointermove", wake);
    return () => {
      window.removeEventListener("pointermove", wake);
      cancelAnimationFrame(raf);
    };
  }, [tick]);

  const spot = NEWEST.spotlight;
  const stage = "wn-stage " + (risen ? "is-in" : "is-booting");

  return createPortal(
    <div
      ref={rootRef}
      className={"onb wn" + (leaving ? " is-leaving" : "") + (risen ? "" : " is-booting")}
      style={vars}
      role="dialog"
      aria-modal="true"
      aria-labelledby={view === "new" ? "wn-title" : "wn-log-title"}
      tabIndex={-1}
    >
      <div className="onb-dither" aria-hidden />
      {!REDUCED_MOTION && <div ref={glowRef} className="onb-cursor-glow" aria-hidden />}
      <div className={"wn-lockup" + (risen ? " is-risen" : "") + (settled ? " is-settled" : "")} aria-hidden>
        <BootScene key={sceneKey} ref={bootRef} settled={settled} />
      </div>

      {view === "new" ? (
        <div className={stage} key="new">
          <p className="wn-eyebrow">Version {NEWEST.version}</p>
          <h1 id="wn-title" className="onb-title">
            What’s New
          </h1>
          {spot && <p className="onb-sub">{spot.sub}</p>}
          {spot && (
            <div className="wn-heads">
              {spot.headliners.map((h) => (
                <article className="wn-head" key={h.title}>
                  <div className="wn-pic" aria-hidden>
                    <Art kind={h.art} />
                  </div>
                  <div>
                    <h2>{h.title}</h2>
                    <p>{h.text}</p>
                  </div>
                </article>
              ))}
            </div>
          )}
          {spot && (
            <section className="wn-also" aria-labelledby="wn-also-title">
              <h2 id="wn-also-title">Also New</h2>
              <ul>
                {spot.also.map((a) => (
                  <li key={a.title}>
                    <span className="wn-ic" aria-hidden>
                      <Glyph kind={a.icon} />
                    </span>
                    <span>
                      <b>{a.title}</b>
                      <span className="wn-line">{a.text}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="onb-row">
            <Button
              ref={goRef}
              variant="default"
              size="lg"
              type="button"
              className="onb-btn bg-white text-black hover:bg-white/90"
              onClick={close}
            >
              Continue
            </Button>
            <Button
              variant="ghost"
              type="button"
              className="onb-ghost text-white/60 hover:bg-white/6 hover:text-white"
              onClick={() => setView("log")}
            >
              See Full Changelog
            </Button>
          </div>
        </div>
      ) : (
        <div className={stage} key="log">
          <Button
            ref={backRef}
            variant="ghost"
            type="button"
            className="onb-ghost wn-back gap-1.5 text-white/60 hover:bg-white/6 hover:text-white"
            onClick={() => setView("new")}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path
                d="M8.5 3L4.5 7l4 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Back
          </Button>
          <h1 id="wn-log-title" className="onb-title">
            Changelog
          </h1>
          <div className="wn-log">
            {RELEASES.map((r, i) => (
              <section key={r.version} aria-labelledby={`wn-rel-${r.version}`}>
                <h2 id={`wn-rel-${r.version}`}>
                  {r.version}
                  {i === 0 && <span className="wn-tag">New</span>}
                  {r.date && <small>{r.date}</small>}
                </h2>
                {r.sections.map((s) => (
                  <div key={s.title}>
                    <h3>{s.title}</h3>
                    <ul>
                      {s.bullets.map((b, j) => (
                        <li key={j}>
                          <Line parts={b} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      )}

      {!risen && (
        <Button variant="ghost" size="sm" type="button" className="wn-skip text-white/80 hover:text-white" onClick={skip}>
          Skip
        </Button>
      )}
    </div>,
    document.body,
  );
}

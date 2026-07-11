import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  isValidManifestUrl,
  loadAioUrl,
  saveAioUrl,
} from "../features/settings/aiostreams";
import {
  ACCENT_PRESETS,
  applyAccent,
  loadAccent,
  saveAccent,
  saveAccentStyle,
} from "../features/settings/accent";
import {
  STARTUP_TABS,
  loadStartupTab,
  saveStartupTab,
  type StartupTab,
} from "../features/settings/startupTab";
import { ChipTabs } from "../ui/ChipTabs";
import { markOnboarded } from "./onboardingGate";

/**
 * First-run onboarding (Adam's mockup, 2026-07-11): the boot animation's
 * opening frame — full-viewport gradient with the black screen inset —
 * lives BEHIND the whole flow, blurred into a soft aurora glow around
 * the edges, over a Bayer-style dither field. Each advance gives the
 * glow a quick "thinking" spin; the finale animates the blur down to 0
 * so the glow resolves into the boot frame, and App swaps in
 * WelcomeAnimation in the same render — the boot animation IS the
 * onboarding's last scene.
 *
 * The glow reuses welcome.css's gradient classes (geometry + brand
 * paint, verbatim); onboarding.css only overrides its fixed-speed spin,
 * because the rotation here is velocity-driven from a rAF loop: base
 * speed is a slow drift, each advance sets a burst target and the
 * velocity eases toward it and back — no snapping between two
 * animation speeds.
 */

const BASE_DEG_S = 16;
const BURST_DEG_S = 320;
const BURST_MS = 700;
/** Content out-transition before the step swaps: onb-out is 300ms and
 * the last staggered child starts at +90ms — swap after the full tail. */
const SWAP_MS = 400;

/** --s carries the boot mock's 1920×1080 cover factor so the finale's
 * sharp frame lands EXACTLY on WelcomeAnimation's first frame. */
function coverVars(): CSSProperties {
  const s = Math.max(window.innerWidth / 1920, window.innerHeight / 1080);
  return { "--s": String(s) } as CSSProperties;
}

const idx = (i: number) => ({ "--i": String(i) }) as CSSProperties;

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<"in" | "out">("in");
  const [finale, setFinale] = useState(false);
  const [vars, setVars] = useState(coverVars);

  const gradRef = useRef<HTMLDivElement>(null);
  const burstUntil = useRef(0);
  const swapTimer = useRef(0);

  useEffect(() => {
    const onResize = () => setVars(coverVars());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Hand off exactly once. transitionend is the intended trigger, but
  // Chromium can swallow it (hidden/occluded window) — the timer makes
  // sure nobody is ever stranded on a finished onboarding.
  const doneRef = useRef(false);
  const handoff = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  };
  const handoffRef = useRef(handoff);
  handoffRef.current = handoff;
  useEffect(() => {
    if (!finale) return;
    // Reduced motion runs 1ms transitions, which Chromium sometimes
    // coalesces into no transition at all (no transitionend) — the
    // watchdog must then fire fast, not after a 1.9s dead stare.
    const grace = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? 350
      : 1900;
    const t = window.setTimeout(() => handoffRef.current(), grace);
    return () => window.clearTimeout(t);
  }, [finale]);

  useEffect(() => () => window.clearTimeout(swapTimer.current), []);

  // The app shell behind the overlay must be unreachable: without
  // `inert`, Tab walks into the invisible header and Enter activates
  // hidden controls (review finding — opening Settings UNDER the
  // overlay). Chromium/WebView2 support inert natively.
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(
      ".app-shell > .header, .app-shell > .app-main",
    );
    els.forEach((el) => el.setAttribute("inert", ""));
    return () => els.forEach((el) => el.removeAttribute("inert"));
  }, []);

  // The glow's heartbeat: angle integrates a velocity that eases toward
  // either the drift speed or, right after an advance, the burst speed.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let last = performance.now();
    let angle = 0;
    let vel = BASE_DEG_S;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const target = now < burstUntil.current ? BURST_DEG_S : BASE_DEG_S;
      vel += (target - vel) * Math.min(1, dt * 7);
      angle = (angle + vel * dt) % 360;
      gradRef.current?.style.setProperty(
        "--welcome-grad-angle",
        `${90 + angle}deg`,
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const think = () => {
    burstUntil.current = performance.now() + BURST_MS;
  };

  // Enter advances every step — via a ref so one listener always sees
  // the current step's action. Repeat is ignored (holding Enter must
  // not blow through the whole flow), and INPUT/BUTTON targets handle
  // Enter natively (a focused swatch must pick, not pick-and-advance).
  const primaryRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.repeat) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "BUTTON") return;
      primaryRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const advance = () => {
    if (phase === "out" || finale) return;
    think();
    setPhase("out");
    window.clearTimeout(swapTimer.current);
    swapTimer.current = window.setTimeout(() => {
      setStep((s) => s + 1);
      setPhase("in");
    }, SWAP_MS);
  };

  const finish = () => {
    // Same in-flight guard as advance: Skip during a swap must not arm
    // a second timer over the first (step-flash + orphaned timeout).
    if (phase === "out" || finale) return;
    markOnboarded();
    think();
    setPhase("out");
    window.clearTimeout(swapTimer.current);
    swapTimer.current = window.setTimeout(() => setFinale(true), SWAP_MS);
  };

  // --- Streams step state ---------------------------------------------
  const [manifest, setManifest] = useState(loadAioUrl);
  // The invalid hint waits for a submit attempt or blur — flashing an
  // error while someone is mid-typing a URL is noise, not help.
  const [manifestTouched, setManifestTouched] = useState(false);
  const manifestTrimmed = manifest.trim();
  const manifestOk =
    manifestTrimmed === "" || isValidManifestUrl(manifestTrimmed);
  const showManifestHint = manifestTouched && !manifestOk;
  const continueStreams = () => {
    if (!manifestOk) {
      setManifestTouched(true);
      return;
    }
    if (manifestTrimmed) saveAioUrl(manifestTrimmed);
    advance();
  };
  const onManifestKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.repeat) continueStreams();
  };

  // --- Accent step state ----------------------------------------------
  const [accent, setAccent] = useState(loadAccent);
  const pickAccent = (hex: string) => {
    setAccent(hex);
    saveAccent(hex);
    // Persist the style too, like CustomizeTab: applyAccent stands
    // aurora down in the DOM, and storage must agree or the next
    // launch silently re-applies aurora (forced-replay edge).
    saveAccentStyle("flat");
    applyAccent(hex);
  };

  // --- Startup tab step state ------------------------------------------
  const [startup, setStartup] = useState<StartupTab>(loadStartupTab);
  const pickStartup = (tab: StartupTab) => {
    setStartup(tab);
    saveStartupTab(tab);
  };

  primaryRef.current =
    step === 0 ? advance
    : step === 1 ? continueStreams
    : step === 2 ? advance
    : step === 3 ? advance
    : finish;

  const content =
    step === 0 ? (
      <>
        <div className="onb-lockup" style={idx(0)}>
          <span className="onb-mark">
            <span className="onb-mark__hole" />
          </span>
          <span className="onb-word">BlammyTV</span>
        </div>
        <button
          type="button"
          className="onb-btn onb-btn--hero"
          style={idx(1)}
          onClick={advance}
        >
          Get Started
        </button>
      </>
    ) : step === 1 ? (
      <>
        <h1 className="onb-title" style={idx(0)}>
          Bring your streams
        </h1>
        <p className="onb-sub" style={idx(1)}>
          Paste your AIOStreams manifest URL to power movies and series.
          You can always set this up later in Settings.
        </p>
        <input
          className={"onb-input" + (showManifestHint ? " is-invalid" : "")}
          style={idx(2)}
          type="text"
          value={manifest}
          onChange={(e) => setManifest(e.target.value)}
          onKeyDown={onManifestKey}
          onBlur={() => setManifestTouched(true)}
          placeholder="https://aiostreams.example.com/…/manifest.json"
          aria-invalid={showManifestHint || undefined}
          spellCheck={false}
          autoComplete="off"
          autoFocus
        />
        {showManifestHint && (
          <p className="onb-hint" role="alert">
            That doesn&rsquo;t look like a manifest URL — it should start
            with http(s) and end in /manifest.json.
          </p>
        )}
        <div className="onb-row" style={idx(3)}>
          <button
            type="button"
            className="onb-btn"
            disabled={!manifestOk}
            onClick={continueStreams}
          >
            Continue
          </button>
          <button type="button" className="onb-ghost" onClick={advance}>
            I&rsquo;ll do this later
          </button>
        </div>
      </>
    ) : step === 2 ? (
      <>
        <h1 className="onb-title" style={idx(0)}>
          Make it yours
        </h1>
        <p className="onb-sub" style={idx(1)}>
          Pick an accent. There&rsquo;s plenty more to customize in
          Settings — including something hidden.
        </p>
        <div
          className="onb-swatches"
          style={idx(2)}
          role="radiogroup"
          aria-label="Accent color"
        >
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.hex}
              type="button"
              role="radio"
              aria-checked={accent === p.hex}
              className={
                "onb-swatch" + (accent === p.hex ? " is-on" : "")
              }
              style={{ background: p.hex }}
              aria-label={p.name}
              title={p.name}
              onClick={() => pickAccent(p.hex)}
            />
          ))}
        </div>
        <button
          type="button"
          className="onb-btn"
          style={idx(3)}
          onClick={advance}
        >
          Continue
        </button>
      </>
    ) : step === 3 ? (
      <>
        <h1 className="onb-title" style={idx(0)}>
          Where should we start?
        </h1>
        <p className="onb-sub" style={idx(1)}>
          The screen BlammyTV opens on. You can change it anytime in
          Settings.
        </p>
        <div className="onb-chips" style={idx(2)}>
          <ChipTabs
            tabs={STARTUP_TABS}
            active={startup}
            onChange={pickStartup}
          />
        </div>
        <button
          type="button"
          className="onb-btn"
          style={idx(3)}
          onClick={advance}
        >
          Continue
        </button>
      </>
    ) : (
      <>
        <h1 className="onb-title" style={idx(0)}>
          You&rsquo;re all set
        </h1>
        <p className="onb-sub" style={idx(1)}>
          Enjoy the show.
        </p>
        <button
          type="button"
          className="onb-btn"
          style={idx(2)}
          onClick={finish}
        >
          Enter BlammyTV
        </button>
      </>
    );

  return (
    <div className={"onb" + (finale ? " is-finale" : "")} style={vars}>
      <div
        className="onb-backdrop"
        onTransitionEnd={(e) => {
          if (finale && e.propertyName === "filter") handoff();
        }}
      >
        <div className="welcome-gradient-fit">
          <div className="welcome-gradient" ref={gradRef} />
        </div>
        <div className="onb-screen" />
      </div>
      <div className="onb-dither" />
      {!finale && (
        <div
          key={step}
          className={"onb-stage " + (phase === "in" ? "is-in" : "is-out")}
        >
          {content}
        </div>
      )}
      {!finale && step < 4 && (
        <button type="button" className="onb-skip" onClick={finish}>
          Skip setup
        </button>
      )}
    </div>
  );
}

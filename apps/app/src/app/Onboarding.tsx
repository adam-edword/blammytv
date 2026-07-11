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
  CLOCK_TABS,
  loadClockFormat,
  saveClockFormat,
  type ClockFormat,
} from "../features/settings/clockFormat";
import {
  STARTUP_TABS,
  loadStartupTab,
  saveStartupTab,
  type StartupTab,
} from "../features/settings/startupTab";
import {
  addPlaylist,
  isHttpUrl,
  loadPlaylists,
  savePlaylists,
} from "../features/settings/playlists";
import {
  probeAioStreams,
  probeVerdict,
  type ProbeStep,
} from "../features/settings/aioProbe";
import { authenticate } from "../data/xtream";
import { scrubbedMessage } from "../lib/errors";
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
 * The source steps VERIFY, not just collect (v0.4.21): Continue runs
 * the real connection machinery (probeAioStreams for AIOStreams — the
 * same path as Settings' Connection Test, Cloudflare verdicts and all;
 * authenticate() for Xtream) while the glow spins "thinking". Success
 * saves and auto-advances; failure shows the verdict and offers
 * "Continue anyway" — verification must never hard-wall onboarding.
 *
 * Steps: 0 logo · 1 streams · 2 live tv · 3 accent+clock · 4 startup
 * tab · 5 done (mini nav map + go-explore-Settings nudge).
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
/** How long a verification may hold the step before it reads as hung. */
const VERIFY_TIMEOUT_MS = 12_000;
/** Success message dwell before the step auto-advances. */
const VERIFIED_DWELL_MS = 750;

const LAST_STEP = 5;

/** --s carries the boot mock's 1920×1080 cover factor so the finale's
 * sharp frame lands EXACTLY on WelcomeAnimation's first frame. */
function coverVars(): CSSProperties {
  const s = Math.max(window.innerWidth / 1920, window.innerHeight / 1080);
  return { "--s": String(s) } as CSSProperties;
}

const idx = (i: number) => ({ "--i": String(i) }) as CSSProperties;

function raceTimeout<T>(p: Promise<T>, msg: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error(msg)), VERIFY_TIMEOUT_MS),
    ),
  ]);
}

type VerifyMsg = { ok: boolean; text: string } | null;

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<"in" | "out">("in");
  const [finale, setFinale] = useState(false);
  const [vars, setVars] = useState(coverVars);

  const gradRef = useRef<HTMLDivElement>(null);
  const burstUntil = useRef(0);
  const swapTimer = useRef(0);
  const autoTimer = useRef(0);

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

  useEffect(
    () => () => {
      window.clearTimeout(swapTimer.current);
      window.clearTimeout(autoTimer.current);
    },
    [],
  );

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
  // The same loop lerps the cursor glow toward the pointer — one rAF,
  // and reduced-motion drops ALL of it (decorative only; the glow must
  // not appear stuck at 0,0 for those users).
  const cursorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let last = performance.now();
    let angle = 0;
    let vel = BASE_DEG_S;
    let target: { x: number; y: number } | null = null;
    let pos: { x: number; y: number } | null = null;
    const onMove = (e: PointerEvent) => {
      target = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", onMove);
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const speed = now < burstUntil.current ? BURST_DEG_S : BASE_DEG_S;
      vel += (speed - vel) * Math.min(1, dt * 7);
      angle = (angle + vel * dt) % 360;
      gradRef.current?.style.setProperty(
        "--welcome-grad-angle",
        `${90 + angle}deg`,
      );
      if (target) {
        // First sighting jumps straight to the pointer — no sweep in
        // from the corner.
        if (!pos) {
          pos = { ...target };
          cursorRef.current?.classList.add("is-live");
        } else {
          pos.x += (target.x - pos.x) * Math.min(1, dt * 9);
          pos.y += (target.y - pos.y) * Math.min(1, dt * 9);
        }
        if (cursorRef.current) {
          cursorRef.current.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  const think = () => {
    burstUntil.current = performance.now() + BURST_MS;
  };
  /** Verifications hold the spin the whole time they run. */
  const thinkHard = () => {
    burstUntil.current = performance.now() + 60_000;
  };
  const thinkDone = () => {
    burstUntil.current = performance.now() + 400;
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

  // --- Streams step: input + REAL verification --------------------------
  const [manifest, setManifest] = useState(loadAioUrl);
  // The invalid hint waits for a submit attempt or blur — flashing an
  // error while someone is mid-typing a URL is noise, not help.
  const [manifestTouched, setManifestTouched] = useState(false);
  const [streamsChecking, setStreamsChecking] = useState(false);
  const [streamsMsg, setStreamsMsg] = useState<VerifyMsg>(null);
  const [streamsFailed, setStreamsFailed] = useState(false);
  const manifestTrimmed = manifest.trim();
  const manifestOk =
    manifestTrimmed === "" || isValidManifestUrl(manifestTrimmed);
  const showManifestHint =
    manifestTouched && !manifestOk && streamsMsg === null;

  const continueStreams = () => {
    if (streamsChecking || phase === "out" || finale) return;
    if (!manifestOk) {
      setManifestTouched(true);
      return;
    }
    if (!manifestTrimmed) {
      advance();
      return;
    }
    setStreamsChecking(true);
    setStreamsMsg(null);
    thinkHard();
    raceTimeout(
      probeAioStreams(manifestTrimmed),
      "Couldn't reach the instance — it didn't answer in time.",
    )
      .then((steps: ProbeStep[]) => {
        if (steps[0]?.ok) {
          saveAioUrl(manifestTrimmed);
          const n = /(\d+) catalog/.exec(steps[0].detail)?.[1];
          setStreamsMsg({
            ok: true,
            text: `Connected${n ? ` — ${n} catalogs found` : ""}. Nice.`,
          });
          window.clearTimeout(autoTimer.current);
          autoTimer.current = window.setTimeout(advance, VERIFIED_DWELL_MS);
        } else {
          setStreamsFailed(true);
          setStreamsMsg({
            ok: false,
            text:
              probeVerdict(steps) ??
              steps[0]?.detail ??
              "The instance rejected the connection.",
          });
        }
      })
      .catch((e: unknown) => {
        setStreamsFailed(true);
        setStreamsMsg({ ok: false, text: scrubbedMessage(e) });
      })
      .finally(() => {
        setStreamsChecking(false);
        thinkDone();
      });
  };
  const ghostStreams = () => {
    if (streamsChecking) return;
    // After a failed check, the ghost saves what they typed anyway —
    // verification must never hard-wall onboarding.
    if (streamsFailed && manifestTrimmed && manifestOk) {
      saveAioUrl(manifestTrimmed);
    }
    advance();
  };
  const onManifestKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.repeat) continueStreams();
  };

  // --- Live TV step: Xtream creds + REAL verification -------------------
  const [tvServer, setTvServer] = useState("");
  const [tvUser, setTvUser] = useState("");
  const [tvPass, setTvPass] = useState("");
  const [tvTouched, setTvTouched] = useState(false);
  const [tvChecking, setTvChecking] = useState(false);
  const [tvMsg, setTvMsg] = useState<VerifyMsg>(null);
  const [tvFailed, setTvFailed] = useState(false);
  const tvEmpty = !tvServer.trim() && !tvUser.trim() && !tvPass.trim();
  const tvComplete =
    isHttpUrl(tvServer) && tvUser.trim() !== "" && tvPass.trim() !== "";
  const showTvHint = tvTouched && !tvEmpty && !tvComplete && tvMsg === null;

  const saveTvPlaylist = () => {
    savePlaylists(
      addPlaylist(loadPlaylists(), {
        kind: "xtream",
        name: "",
        server: tvServer.trim().replace(/\/+$/, ""),
        username: tvUser.trim(),
        password: tvPass.trim(),
      }),
    );
  };
  const continueTv = () => {
    if (tvChecking || phase === "out" || finale) return;
    if (tvEmpty) {
      advance();
      return;
    }
    if (!tvComplete) {
      setTvTouched(true);
      return;
    }
    setTvChecking(true);
    setTvMsg(null);
    thinkHard();
    raceTimeout(
      authenticate({
        kind: "xtream",
        id: "onboarding-probe",
        name: "probe",
        enabled: true,
        server: tvServer.trim().replace(/\/+$/, ""),
        username: tvUser.trim(),
        password: tvPass.trim(),
      }),
      "Couldn't reach the panel — it didn't answer in time.",
    )
      .then(() => {
        saveTvPlaylist();
        setTvMsg({ ok: true, text: "Connected — your channels are in." });
        window.clearTimeout(autoTimer.current);
        autoTimer.current = window.setTimeout(advance, VERIFIED_DWELL_MS);
      })
      .catch((e: unknown) => {
        setTvFailed(true);
        setTvMsg({ ok: false, text: scrubbedMessage(e) });
      })
      .finally(() => {
        setTvChecking(false);
        thinkDone();
      });
  };
  const ghostTv = () => {
    if (tvChecking) return;
    if (tvFailed && tvComplete) saveTvPlaylist();
    advance();
  };
  const onTvKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.repeat) continueTv();
  };

  // --- Accent + clock step ----------------------------------------------
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
  const [clock, setClock] = useState<ClockFormat>(loadClockFormat);
  const pickClock = (next: ClockFormat) => {
    setClock(next);
    saveClockFormat(next);
  };

  // --- Startup tab step ---------------------------------------------------
  const [startup, setStartup] = useState<StartupTab>(loadStartupTab);
  const pickStartup = (tab: StartupTab) => {
    setStartup(tab);
    saveStartupTab(tab);
  };

  primaryRef.current =
    step === 0 ? advance
    : step === 1 ? continueStreams
    : step === 2 ? continueTv
    : step === 3 ? advance
    : step === 4 ? advance
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
          Paste your AIOStreams manifest URL to power movies and series —
          we&rsquo;ll check the connection for real before moving on.
        </p>
        <input
          className={"onb-input" + (showManifestHint ? " is-invalid" : "")}
          style={idx(2)}
          type="text"
          value={manifest}
          onChange={(e) => {
            setManifest(e.target.value);
            setStreamsMsg(null);
            setStreamsFailed(false);
          }}
          onKeyDown={onManifestKey}
          onBlur={() => setManifestTouched(true)}
          placeholder="https://aiostreams.example.com/…/manifest.json"
          aria-invalid={showManifestHint || undefined}
          spellCheck={false}
          autoComplete="off"
          disabled={streamsChecking}
          autoFocus
        />
        {showManifestHint && (
          <p className="onb-hint" role="alert">
            That doesn&rsquo;t look like a manifest URL — it should start
            with http(s) and end in /manifest.json.
          </p>
        )}
        {streamsMsg && (
          <p
            className={"onb-hint" + (streamsMsg.ok ? " onb-hint--ok" : "")}
            role={streamsMsg.ok ? "status" : "alert"}
          >
            {streamsMsg.text}
          </p>
        )}
        <div className="onb-row" style={idx(3)}>
          <button
            type="button"
            className="onb-btn"
            disabled={!manifestOk || streamsChecking}
            onClick={continueStreams}
          >
            {streamsChecking ? "Connecting…" : "Continue"}
          </button>
          <button
            type="button"
            className="onb-ghost"
            disabled={streamsChecking}
            onClick={ghostStreams}
          >
            {streamsFailed ? "Continue anyway" : "I’ll do this later"}
          </button>
        </div>
      </>
    ) : step === 2 ? (
      <>
        <h1 className="onb-title" style={idx(0)}>
          Connect Live TV
        </h1>
        <p className="onb-sub" style={idx(1)}>
          Add your Xtream playlist to light up channels and the guide.
          Other formats (M3U, Stalker) live in Settings &rarr; Playlists.
        </p>
        <div className="onb-fields" style={idx(2)}>
          <input
            className="onb-input"
            type="text"
            value={tvServer}
            onChange={(e) => {
              setTvServer(e.target.value);
              setTvMsg(null);
              setTvFailed(false);
            }}
            onKeyDown={onTvKey}
            onBlur={() => setTvTouched(true)}
            placeholder="http://panel.example.com:8080"
            spellCheck={false}
            autoComplete="off"
            disabled={tvChecking}
            autoFocus
          />
          <div className="onb-fields__row">
            <input
              className="onb-input"
              type="text"
              value={tvUser}
              onChange={(e) => {
                setTvUser(e.target.value);
                setTvMsg(null);
                setTvFailed(false);
              }}
              onKeyDown={onTvKey}
              onBlur={() => setTvTouched(true)}
              placeholder="Username"
              spellCheck={false}
              autoComplete="off"
              disabled={tvChecking}
            />
            <input
              className="onb-input"
              type="password"
              value={tvPass}
              onChange={(e) => {
                setTvPass(e.target.value);
                setTvMsg(null);
                setTvFailed(false);
              }}
              onKeyDown={onTvKey}
              onBlur={() => setTvTouched(true)}
              placeholder="Password"
              autoComplete="off"
              disabled={tvChecking}
            />
          </div>
        </div>
        {showTvHint && (
          <p className="onb-hint" role="alert">
            Fill in all three — server URL (with http), username, and
            password — or leave them all empty to skip.
          </p>
        )}
        {tvMsg && (
          <p
            className={"onb-hint" + (tvMsg.ok ? " onb-hint--ok" : "")}
            role={tvMsg.ok ? "status" : "alert"}
          >
            {tvMsg.text}
          </p>
        )}
        <div className="onb-row" style={idx(3)}>
          <button
            type="button"
            className="onb-btn"
            disabled={(!tvEmpty && !tvComplete) || tvChecking}
            onClick={continueTv}
          >
            {tvChecking ? "Connecting…" : "Continue"}
          </button>
          <button
            type="button"
            className="onb-ghost"
            disabled={tvChecking}
            onClick={ghostTv}
          >
            {tvFailed ? "Add anyway" : "I’ll do this later"}
          </button>
        </div>
      </>
    ) : step === 3 ? (
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
        <div className="onb-chips onb-chips--labeled" style={idx(3)}>
          <span className="onb-chips__label">Clock</span>
          <ChipTabs tabs={CLOCK_TABS} active={clock} onChange={pickClock} />
        </div>
        <button
          type="button"
          className="onb-btn"
          style={idx(4)}
          onClick={advance}
        >
          Continue
        </button>
      </>
    ) : step === 4 ? (
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
        <div className="onb-map" style={idx(1)}>
          <div className="onb-map__col">
            <span className="onb-map__pill onb-map__pill--solid">
              Live TV
            </span>
            <p className="onb-map__caption">Channels &amp; guide</p>
          </div>
          <div className="onb-map__col">
            <span className="onb-map__pill">Stream</span>
            <p className="onb-map__caption">
              Home &middot; Discover &middot; My List
            </p>
          </div>
        </div>
        <p className="onb-sub" style={idx(2)}>
          Tip: Settings holds a lot more to make BlammyTV yours — sources,
          themes, playback, and a few surprises.
        </p>
        <button
          type="button"
          className="onb-btn"
          style={idx(3)}
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
      <div ref={cursorRef} className="onb-cursor-glow" aria-hidden />
      {!finale && (
        <div
          key={step}
          className={"onb-stage " + (phase === "in" ? "is-in" : "is-out")}
        >
          {content}
        </div>
      )}
      {!finale && step < LAST_STEP && (
        <button type="button" className="onb-skip" onClick={finish}>
          Skip setup
        </button>
      )}
    </div>
  );
}

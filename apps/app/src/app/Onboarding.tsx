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
  EMPTY_PLAYLIST_FORM,
  KIND_TABS,
  addPlaylist,
  draftFrom,
  isFormComplete,
  loadPlaylists,
  savePlaylists,
  type PlaylistDraft,
  type PlaylistFormState,
  type PlaylistKind,
} from "../features/settings/playlists";
import {
  probeAioStreams,
  probeVerdict,
  type ProbeStep,
} from "../features/settings/aioProbe";
import { authenticate } from "../data/xtream";
import { discoverEndpoint } from "../data/stalker";
import { httpGetText } from "../lib/http";
import { scrubbedMessage } from "../lib/errors";
import { ChipTabs } from "../ui/ChipTabs";
import { markOnboarded } from "./onboardingGate";
import { lockupVars, markWelcomePlayed } from "./welcome";

/**
 * First-run onboarding (Adam's mockup, 2026-07-11; backdrop rebuilt
 * ground-up in v0.4.31): a living aurora — the brand's color sweep
 * drifting around the viewport edges over a Bayer-style dither field.
 * Each advance gives it a quick "thinking" spin; the finale condenses
 * the glow into the boot animation's opening frame and plays an
 * onboarding-owned MIMIC of the whole boot timeline, then fades to the
 * app — the boot animation IS the onboarding's last scene, and no
 * separate component ever mounts for it.
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
 * The aurora's rotation is velocity-driven from a rAF loop: base speed
 * is a slow drift, each advance sets a burst target and the velocity
 * eases toward it and back — no snapping between two animation speeds.
 */

const BASE_DEG_S = 16;
const BURST_DEG_S = 320;
const BURST_MS = 700;
/** Glow architecture (v0.4.31 rebuild, geometry fixed in v0.4.32): NO
 * FILTERS, ANYWHERE on the backdrop. Five versions of flicker fixes
 * (v0.4.26→30) all fought the same sin — animating giant blur() layers
 * on Chromium — so the rebuild removes the primitive itself. The aurora
 * is ONE unfiltered conic disc (oklab sweep, unmasked — it paints the
 * whole viewport like the old blurred disc did), spun transform-only
 * from the rAF loop; a static veil in the old cover's exact rounded-
 * rect geometry darkens the center, its softness box-shadow math
 * instead of blur. With no filter there is nothing to re-rasterize,
 * smear, or raster-storm; once the finale condenses, the backdrop
 * layers unmount outright and the rAF loop stops.
 *
 * The finale no longer hands off to WelcomeAnimation: it plays an
 * onboarding-owned MIMIC copy of the boot timeline (onb-boot-* in
 * onboarding.css — TWIN of welcome.css, update both) inside this same
 * overlay, then fades to the app. One component owns first frame to
 * reveal; the double-buffer/watchdog machinery is gone. Unlike a cold
 * boot, the mimic is NOT input-skippable (Adam's call: it's the earned
 * finale, not a wait).
 *
 * v0.4.33 — the condense is a seamless MORPH (Adam: "there shouldn't
 * ever be a transition"): the aurora carries the boot's own gradient
 * (spin frozen; the rAF spin-down eases the disc onto rotation 0 mod
 * 360 = the boot's native angle) while it brightens to full and the
 * veil's mask un-feathers into the screen rect. By CONDENSE_MS the
 * scene IS the boot's first frame; the mimic then mounts over
 * identical pixels and the spent backdrop is torn down 100ms later,
 * hidden beneath it. */
const BOOT_START_HOLD_MS = 700; // twins welcome.css's timeline delay
const BOOT_TIMELINE_MS = 2000;
const BOOT_END_HOLD_MS = 1000;
const RELEASE_FADE_MS = 450;
/** The morph track: veil un-feather + screen-seat slide, driven per
 * frame from the rAF loop (one clock, one easing — see morphStartRef).
 * The veil's residue fade (CSS, plain opacity) waits for it at 540ms. */
const MORPH_MS = 550;
/** The morph's length: geometry lands at 550ms, residue fade done by
 * ~640ms; the spin-down lands by ~600ms. The mimic mounts here. */
const CONDENSE_MS = 650;
/** Backdrop teardown, hidden under the opaque mimic (v0.4.29's
 * double-buffer lesson: never tear down what is visible). */
const BACKDROP_RELEASE_MS = 750;
/** Content out-transition before the step swaps: onb-out is 300ms and
 * the last staggered child starts at +90ms — swap after the full tail. */
const SWAP_MS = 400;
/** How long a verification may hold the step before it reads as hung. */
const VERIFY_TIMEOUT_MS = 12_000;
/** Success message dwell before the step auto-advances. */
const VERIFIED_DWELL_MS = 750;

const LAST_STEP = 5;

const idx = (i: number) => ({ "--i": String(i) }) as CSSProperties;

/** Ask password managers to leave these fields alone — provider URLs
 * and panel logins aren't web accounts, and the injected autofill
 * chrome was visually disruptive mid-flow (each vendor reads its own
 * attribute; autocomplete="off" alone is widely ignored). */
const PM_IGNORE = {
  "data-1p-ignore": "",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-protonpass-ignore": "true",
  "data-form-type": "other",
} as const;

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
  /** The morph has landed on the boot's first frame: mount the mimic
   * (over pixel-identical content — invisible by construction). */
  const [mimicUp, setMimicUp] = useState(false);
  /** 100ms later: the spent backdrop layers UNMOUNT (hidden beneath
   * the opaque mimic) and the rAF loop stops. Invisible zombie layers
   * (a 150vmax pinned texture still receiving transform writes) are
   * exactly the compositor-churn class Adam's machine punishes. */
  const [condensed, setCondensed] = useState(false);
  /** The overlay's exit fade — set once the mimic's lockup has settled. */
  const [leaving, setLeaving] = useState(false);
  const [vars, setVars] = useState(lockupVars);
  // Once a step's entrance has played, the animations are REMOVED
  // (is-settled): password-manager extensions inject DOM when a field
  // focuses, and that style invalidation replayed the filled entrance
  // animations (Adam's repro). Settled elements have nothing to replay.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (phase !== "in") return;
    setSettled(false);
    // Past the longest entrance tail: step 0's button lands at ~2.7s,
    // every other step by ~1.4s.
    const t = window.setTimeout(() => setSettled(true), step === 0 ? 2900 : 1600);
    return () => window.clearTimeout(t);
  }, [step, phase]);

  const discRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  /** Finale morph clock — set when the finale starts; the rAF loop
   * drives ALL the morph geometry (veil mask vars + screen-seat inset)
   * from this one clock with one easing. CSS transitions were tried
   * first (v0.4.33-34) and desynced on Adam's WebView2: registered-
   * custom-property transitions ran on a different effective curve
   * than the seat's standard inset transition, so the seat's hard edge
   * poked through the still-soft veil mid-morph. One clock, one curve,
   * inline writes — the containment invariant can't desync. */
  const morphStartRef = useRef<number | null>(null);
  const burstUntil = useRef(0);
  const swapTimer = useRef(0);
  const autoTimer = useRef(0);
  const angleRef = useRef(0);
  const velRef = useRef(BASE_DEG_S);
  /** Finale: the disc spins down to rest while it crossfades away. */
  const spinDownRef = useRef(false);

  useEffect(() => {
    const onResize = () => setVars(lockupVars());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /** Fixed at mount, like the rAF gate below: reduced-motion users get a
   * quick fade to the app instead of the boot mimic. */
  const reducedMotion = useRef(
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  ).current;

  // Finish exactly once, on plain timers — nothing here waits on
  // transitionend anymore (the blur transition it guarded is gone), so
  // nothing can be swallowed. onDone rides a ref so a parent re-render
  // mid-finale can't restart the timers.
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    if (!finale) return;
    // The aurora eases onto the boot's gradient angle while the veil
    // un-feathers into the screen — and this launch's boot is the
    // mimic, so the real one must not replay.
    spinDownRef.current = true;
    morphStartRef.current = performance.now();
    markWelcomePlayed();
    // The boot timeline runs from the mimic's mount at CONDENSE_MS.
    const settleMs = reducedMotion
      ? 100
      : CONDENSE_MS + BOOT_START_HOLD_MS + BOOT_TIMELINE_MS + BOOT_END_HOLD_MS;
    const mimic = window.setTimeout(() => setMimicUp(true), CONDENSE_MS);
    const sweep = window.setTimeout(
      () => setCondensed(true),
      BACKDROP_RELEASE_MS,
    );
    const leave = window.setTimeout(() => setLeaving(true), settleMs);
    const done = window.setTimeout(() => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDoneRef.current();
    }, settleMs + RELEASE_FADE_MS);
    return () => {
      window.clearTimeout(mimic);
      window.clearTimeout(sweep);
      window.clearTimeout(leave);
      window.clearTimeout(done);
    };
  }, [finale, reducedMotion]);

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
    // Once the condense retires the backdrop layers there is nothing
    // left to animate — the loop must not tick under the boot mimic.
    if (condensed) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let last = performance.now();
    let lastAngleWrite = "";
    /** Spin-down landing angle — the nearest full turn, chosen once. */
    let landTarget: number | null = null;
    let target: { x: number; y: number } | null = null;
    let pos: { x: number; y: number } | null = null;
    const onMove = (e: PointerEvent) => {
      target = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", onMove);
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (spinDownRef.current) {
        // Finale spin-down: don't just brake — LAND. A critically
        // damped spring takes the disc (velocity-continuous, from
        // drift or mid-burst alike) to the NEAREST full turn, where
        // its frozen boot paint sits at the boot's native angle — so
        // the mimic's first frame matches pixel-for-pixel. ω=12 puts
        // the residual under a couple hundredths of a degree by the
        // mimic's mount at CONDENSE_MS.
        if (landTarget === null) {
          landTarget = Math.round(angleRef.current / 360) * 360;
        }
        const W = 12;
        velRef.current +=
          (W * W * (landTarget - angleRef.current) - 2 * W * velRef.current) *
          dt;
        angleRef.current += velRef.current * dt;
        if (
          Math.abs(landTarget - angleRef.current) < 0.05 &&
          Math.abs(velRef.current) < 0.5
        ) {
          angleRef.current = landTarget;
          velRef.current = 0;
        }
      } else {
        // Velocity model: drift, burst on advances.
        const speed = now < burstUntil.current ? BURST_DEG_S : BASE_DEG_S;
        velRef.current += (speed - velRef.current) * Math.min(1, dt * 7);
        angleRef.current = angleRef.current + velRef.current * dt;
      }
      // Transform-only rotation: the compositor spins the disc's cached
      // (unfiltered, painted-once) texture on the GPU with zero
      // repaints. Write only on visible change.
      const next = `rotate(${(angleRef.current % 360).toFixed(2)}deg)`;
      if (next !== lastAngleWrite) {
        lastAngleWrite = next;
        if (discRef.current) discRef.current.style.transform = next;
      }
      // The finale morph: veil mask geometry + screen-seat inset, all
      // from ONE eased progress so the seat provably never leaves the
      // veil's opaque interior (gap = 40px × (1 - e), 0 only at e = 1).
      if (morphStartRef.current !== null) {
        const p = Math.min(1, (now - morphStartRef.current) / MORPH_MS);
        // easeInOutCubic — any single monotone curve preserves the
        // invariant; what broke v0.4.33-34 was TWO curves.
        const e =
          p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        const s = Math.max(
          window.innerWidth / 1920,
          window.innerHeight / 1080,
        );
        const lerp = (a: number, b: number) => a + (b - a) * e;
        if (veilRef.current) {
          const st = veilRef.current.style;
          st.setProperty("--onb-veil-inset-x", `${lerp(0, 35 * s - 12)}px`);
          st.setProperty("--onb-veil-inset-y", `${lerp(0, 36.5 * s - 12)}px`);
          st.setProperty("--onb-veil-feather", `${lerp(260, 12)}px`);
          st.setProperty("--onb-veil-lift", String(lerp(0.4, 0)));
        }
        if (screenRef.current) {
          screenRef.current.style.inset = `${lerp(300, 36.5 * s)}px ${lerp(300, 35 * s)}px`;
        }
        if (p >= 1) morphStartRef.current = null;
      }
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
  }, [condensed]);

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
      if (e.repeat) return;
      if (e.key === "Escape") {
        retreatRef.current();
        return;
      }
      if (e.key !== "Enter") return;
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

  /** One step back — no "thinking" burst; that's forward energy. */
  const retreat = () => {
    if (phase === "out" || finale || step === 0) return;
    setPhase("out");
    window.clearTimeout(swapTimer.current);
    swapTimer.current = window.setTimeout(() => {
      setStep((s) => s - 1);
      setPhase("in");
    }, SWAP_MS);
  };
  const retreatRef = useRef(retreat);
  retreatRef.current = retreat;

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

  // --- Live TV step: kind rail + per-kind REAL verification -------------
  const [tvKind, setTvKind] = useState<PlaylistKind>("xtream");
  const [tvForm, setTvForm] = useState<PlaylistFormState>(EMPTY_PLAYLIST_FORM);
  // Replay/showcase runs (existing users): their playlists are intact —
  // say so, so nobody re-enters credentials and duplicates a source.
  const [existingTvCount] = useState(() => loadPlaylists().length);
  const [tvTouched, setTvTouched] = useState(false);
  const [tvChecking, setTvChecking] = useState(false);
  const [tvMsg, setTvMsg] = useState<VerifyMsg>(null);
  const [tvFailed, setTvFailed] = useState(false);
  const setTv = (field: keyof PlaylistFormState) => (value: string) => {
    setTvForm((f) => ({ ...f, [field]: value }));
    setTvMsg(null);
    setTvFailed(false);
  };
  const switchTvKind = (k: PlaylistKind) => {
    if (tvChecking) return;
    setTvKind(k);
    setTvTouched(false);
    setTvMsg(null);
    setTvFailed(false);
  };
  const tvEmpty =
    tvKind === "xtream"
      ? !tvForm.server.trim() && !tvForm.username.trim() && !tvForm.password
      : tvKind === "m3u"
        ? !tvForm.url.trim()
        : !tvForm.portal.trim() && !tvForm.mac.trim();
  const tvComplete = isFormComplete(tvKind, tvForm);
  const showTvHint = tvTouched && !tvEmpty && !tvComplete && tvMsg === null;
  const TV_HINTS: Record<PlaylistKind, string> = {
    xtream:
      "Fill in all three — server URL (with http), username, and password — or leave them all empty to skip.",
    m3u: "That needs a full playlist URL, starting with http(s).",
    stalker:
      "Fill in both — portal URL (with http) and the MAC address — or leave them empty to skip.",
  };

  /** Verify with the kind's REAL client, resolving to the draft to save
   * (stalker keeps the discovered endpoint so first load skips the
   * probe, same as the Settings add-form). */
  const verifyTv = (): Promise<PlaylistDraft> => {
    const draft = draftFrom(tvKind, tvForm);
    switch (draft.kind) {
      case "xtream":
        return raceTimeout(
          authenticate({
            ...draft,
            id: "onboarding-probe",
            name: "probe",
            enabled: true,
          }),
          "Couldn't reach the panel — it didn't answer in time.",
        ).then(() => draft);
      case "m3u":
        return raceTimeout(
          httpGetText(draft.url),
          "Couldn't reach the playlist — it didn't answer in time.",
        ).then((text) => {
          if (!text.trimStart().startsWith("#EXTM3U")) {
            throw new Error("That URL didn't return an M3U playlist.");
          }
          return draft;
        });
      case "stalker":
        return raceTimeout(
          discoverEndpoint({
            ...draft,
            id: "onboarding-probe",
            name: "probe",
            enabled: true,
          }),
          "Couldn't reach the portal — it didn't answer in time.",
        ).then((endpoint) => ({ ...draft, endpoint }));
    }
  };
  const saveTvDraft = (draft: PlaylistDraft) => {
    savePlaylists(addPlaylist(loadPlaylists(), draft));
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
    verifyTv()
      .then((draft) => {
        saveTvDraft(draft);
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
    if (tvFailed && tvComplete) saveTvDraft(draftFrom(tvKind, tvForm));
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
          {...PM_IGNORE}
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
          Light up channels and the guide — pick the format your provider
          gave you.
        </p>
        {existingTvCount > 0 && (
          <p className="onb-hint onb-hint--ok" style={idx(2)}>
            {existingTvCount === 1
              ? "1 playlist is"
              : `${existingTvCount} playlists are`}{" "}
            already connected — adding another is optional.
          </p>
        )}
        <div className="onb-chips" style={idx(2)}>
          <ChipTabs tabs={KIND_TABS} active={tvKind} onChange={switchTvKind} />
        </div>
        <div className="onb-fields" style={idx(3)}>
          {tvKind === "xtream" ? (
            <>
              <input
                className="onb-input"
                type="text"
                value={tvForm.server}
                onChange={(e) => setTv("server")(e.target.value)}
                onKeyDown={onTvKey}
                onBlur={() => setTvTouched(true)}
                placeholder="http://panel.example.com:8080"
                spellCheck={false}
                autoComplete="off"
          {...PM_IGNORE}
                disabled={tvChecking}
                autoFocus
              />
              <div className="onb-fields__row">
                <input
                  className="onb-input"
                  type="text"
                  value={tvForm.username}
                  onChange={(e) => setTv("username")(e.target.value)}
                  onKeyDown={onTvKey}
                  onBlur={() => setTvTouched(true)}
                  placeholder="Username"
                  spellCheck={false}
                  autoComplete="off"
          {...PM_IGNORE}
                  disabled={tvChecking}
                />
                <input
                  className="onb-input"
                  type="password"
                  value={tvForm.password}
                  onChange={(e) => setTv("password")(e.target.value)}
                  onKeyDown={onTvKey}
                  onBlur={() => setTvTouched(true)}
                  placeholder="Password"
                  autoComplete="off"
          {...PM_IGNORE}
                  disabled={tvChecking}
                />
              </div>
            </>
          ) : tvKind === "m3u" ? (
            <input
              className="onb-input"
              type="text"
              value={tvForm.url}
              onChange={(e) => setTv("url")(e.target.value)}
              onKeyDown={onTvKey}
              onBlur={() => setTvTouched(true)}
              placeholder="https://example.com/playlist.m3u8"
              spellCheck={false}
              autoComplete="off"
          {...PM_IGNORE}
              disabled={tvChecking}
              autoFocus
            />
          ) : (
            <div className="onb-fields__row">
              <input
                className="onb-input"
                type="text"
                value={tvForm.portal}
                onChange={(e) => setTv("portal")(e.target.value)}
                onKeyDown={onTvKey}
                onBlur={() => setTvTouched(true)}
                placeholder="http://portal.example.com/c/"
                spellCheck={false}
                autoComplete="off"
          {...PM_IGNORE}
                disabled={tvChecking}
                autoFocus
              />
              <input
                className="onb-input"
                type="text"
                value={tvForm.mac}
                onChange={(e) => setTv("mac")(e.target.value)}
                onKeyDown={onTvKey}
                onBlur={() => setTvTouched(true)}
                placeholder="00:1A:79:12:34:56"
                spellCheck={false}
                autoComplete="off"
          {...PM_IGNORE}
                disabled={tvChecking}
              />
            </div>
          )}
        </div>
        {showTvHint && (
          <p className="onb-hint" role="alert">
            {TV_HINTS[tvKind]}
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
        <div className="onb-row" style={idx(4)}>
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
    <div
      className={
        "onb" +
        (finale ? " is-finale" : "") +
        (leaving ? " is-leaving" : "")
      }
      style={vars}
    >
      {/* Backdrop layers unmount 100ms after the mimic mounts — the
       * teardown happens beneath its opaque, pixel-identical frame. */}
      {!condensed && (
        <>
          <div className="onb-aurora" ref={discRef} aria-hidden>
            {/* The boot's own paint, spin-frozen — rotation comes from
             * the rAF transform on the wrapper. */}
            <div className="welcome-gradient-fit">
              <div className="welcome-gradient" />
            </div>
          </div>
          {/* The screen's seat: always mounted, parked deep inside the
           * veil's opaque interior; the rAF morph slides it out to the
           * boot screen's geometry under the receding contour. */}
          <div ref={screenRef} className="onb-screen" aria-hidden />
          <div ref={veilRef} className="onb-veil" aria-hidden />
          <div className="onb-dither" />
          <div ref={cursorRef} className="onb-cursor-glow" aria-hidden />
        </>
      )}
      {finale && mimicUp && !reducedMotion && (
        <div className="onb-boot" aria-hidden>
          <div className="onb-boot__frame">
            <div className="welcome-gradient-fit">
              <div className="welcome-gradient" />
            </div>
          </div>
          <div className="onb-boot__screen" />
          <p className="onb-boot__wordmark">BlammyTV</p>
        </div>
      )}
      {!finale && (
        <div
          key={step}
          className={
            "onb-stage " +
            (phase === "in" ? "is-in" : "is-out") +
            (settled && phase === "in" ? " is-settled" : "")
          }
        >
          {content}
        </div>
      )}
      {!finale && step > 0 && (
        <button type="button" className="onb-back" onClick={retreat}>
          &larr; Back
        </button>
      )}
      {!finale && step < LAST_STEP && (
        <button type="button" className="onb-skip" onClick={finish}>
          Skip setup
        </button>
      )}
    </div>
  );
}

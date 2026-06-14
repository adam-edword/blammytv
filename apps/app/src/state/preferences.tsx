import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * Device-local display preferences.
 *
 * These are per-device *display* settings (accent colour, UI scale, theme) —
 * not the channel/source "config" that the architecture keeps server-side — so
 * they live in localStorage on the device, like the share code.
 */
export interface Preferences {
  /** Accent colour as a hex string, e.g. "#c22727". */
  accent: string;
  /** Whole-UI zoom multiplier. */
  uiScale: number;
  /** Light theme on/off (applied via data-theme on the document root). */
  lightMode: boolean;
}

export const DEFAULT_ACCENT = "#c22727";
export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.3;

/** Discrete UI-scale notches shown on the slider. Normal == 1 (the default). */
export interface UiScaleOption {
  label: string;
  value: number;
}
export const UI_SCALE_OPTIONS: UiScaleOption[] = [
  { label: "80%", value: 0.8 },
  { label: "90%", value: 0.9 },
  { label: "100%", value: 1 },
  { label: "110%", value: 1.1 },
  { label: "120%", value: 1.2 },
];

/** Index of the notch closest to a stored scale value. */
export function nearestScaleIndex(value: number): number {
  let best = 0;
  let bestDist = Infinity;
  UI_SCALE_OPTIONS.forEach((o, i) => {
    const d = Math.abs(o.value - value);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

export const DEFAULT_PREFERENCES: Preferences = {
  accent: DEFAULT_ACCENT,
  uiScale: 1,
  lightMode: false,
};

const STORAGE_KEY = "blammytv.preferences";

export function clampScale(v: number): number {
  if (Number.isNaN(v)) return 1;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, v));
}

function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const p = JSON.parse(raw);
    return {
      accent:
        typeof p.accent === "string" && /^#[0-9a-f]{6}$/i.test(p.accent)
          ? p.accent
          : DEFAULT_ACCENT,
      uiScale: typeof p.uiScale === "number" ? clampScale(p.uiScale) : 1,
      lightMode: !!p.lightMode,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function savePreferences(p: Preferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable — preferences just won't persist */
  }
}

/** "#c22727" -> "194 39 39" for use in rgb(var(--accent-rgb) / a). */
export function hexToRgbTriplet(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "194 39 39";
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

function applyPreferences(p: Preferences): void {
  const root = document.documentElement;
  root.style.setProperty("--accent-rgb", hexToRgbTriplet(p.accent));
  root.style.setProperty("--ui-scale", String(p.uiScale));
  root.dataset.theme = p.lightMode ? "light" : "dark";
}

/** Apply stored preferences to the DOM immediately (call before first render
 * so returning users never see a flash of the default accent/scale). */
export function initPreferences(): void {
  applyPreferences(loadPreferences());
}

interface PreferencesContextValue {
  prefs: Preferences;
  setAccent: (hex: string) => void;
  setUiScale: (v: number) => void;
  setLightMode: (v: boolean) => void;
  reset: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(loadPreferences);

  // Apply before paint so returning users don't see a flash of defaults.
  useEffect(() => {
    applyPreferences(prefs);
    savePreferences(prefs);
  }, [prefs]);

  const value: PreferencesContextValue = {
    prefs,
    setAccent: (accent) => setPrefs((p) => ({ ...p, accent })),
    setUiScale: (uiScale) => setPrefs((p) => ({ ...p, uiScale: clampScale(uiScale) })),
    setLightMode: (lightMode) => setPrefs((p) => ({ ...p, lightMode })),
    reset: () => setPrefs(DEFAULT_PREFERENCES),
  };

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx)
    throw new Error("usePreferences must be used within PreferencesProvider");
  return ctx;
}

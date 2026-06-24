import { useEffect, useState, type ReactNode } from "react";
import {
  type Preferences,
  type PreferencesContextValue,
  PreferencesContext,
  DEFAULT_PREFERENCES,
  applyPreferences,
  savePreferences,
  loadPreferences,
  clampScale,
} from "./preferences";

/** Holds the live preferences and keeps the DOM + localStorage in sync. */
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
    setUiScale: (uiScale) =>
      setPrefs((p) => ({ ...p, uiScale: clampScale(uiScale) })),
    setLightMode: (lightMode) => setPrefs((p) => ({ ...p, lightMode })),
    setCarouselSources: (carouselSources) =>
      setPrefs((p) => ({ ...p, carouselSources })),
    reset: () => setPrefs(DEFAULT_PREFERENCES),
  };

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

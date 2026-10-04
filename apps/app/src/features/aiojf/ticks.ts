import { useEffect, useState } from "react";
import { AIOJF_SYNCED } from "./store";

/**
 * A number that moves after each AIOStreams sync (and sign-out), for a page
 * that reads its ticks (`loadWatched`) to read them again. A series page can
 * be open when a sync lands: launch, coming back to the window, Sync now.
 */
export function useAioTicks(): number {
  const [version, bump] = useState(0);
  useEffect(() => {
    const onSynced = () => bump((n) => n + 1);
    window.addEventListener(AIOJF_SYNCED, onSynced);
    return () => window.removeEventListener(AIOJF_SYNCED, onSynced);
  }, []);
  return version;
}

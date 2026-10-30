import { useSyncExternalStore } from "react";
import { useAiojfReport } from "../aiojf/report";
import { useJfReport } from "../jellyfin/report";
import { useTraktScrobble } from "../trakt/scrobble";
import { currentVlc, onVlcSession } from "./vlcSession";

/**
 * What plays in VLC is reported as what plays in the app is (plan 032): the
 * same three hooks StreamScreen runs on its player, handed the title
 * vlcSession follows. Mounted in App, because the screen that started the
 * play is gone by the time VLC is half way through.
 *
 * The positions VLC sends are written to Continue Watching (vlcSession.ts), so
 * AIOStreams' and Jellyfin's reports take them from there as they do for the
 * pop-out (`popped`), and Trakt's look is told to (`followed`). The session
 * ends when VLC does, and each report sends its stop then.
 */
export function useVlcFollow(): void {
  const t = useSyncExternalStore(onVlcSession, currentVlc);
  useTraktScrobble(
    t ? { itemId: t.itemId, kind: t.kind, title: t.title, year: t.year, episodeId: t.episodeId, followed: true } : null,
  );
  // As StreamScreen: the addon's own plays go to AIOStreams, a Jellyfin's to
  // that Jellyfin, and a playlist's to neither.
  useAiojfReport(
    t && !t.from ? { itemId: t.itemId, kind: t.kind, episodeId: t.episodeId, season: t.season, popped: true } : null,
  );
  useJfReport(
    t && t.from === "jf"
      ? { itemId: t.itemId, kind: t.kind, episodeId: t.episodeId, streamUrl: t.streamUrl, popped: true }
      : null,
  );
}

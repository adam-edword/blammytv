import { loadDiscover } from "./data";
import { loadTmdbKey, probeTmdb, saveTmdbKey } from "./tmdb";

/**
 * Console probes for the recommender, for the two questions this container
 * cannot answer.
 *
 * Always compiled in, for the reason playerPerf gives: a probe that only
 * exists in a special build is a probe you cannot ask someone to run when
 * the problem is in front of them.
 *
 *   await btvDiscover()        // what your addons actually advertise
 *   await btvTmdb("<key>")     // store a key and check TMDB end to end
 *   await btvTmdb()            // re-check with the stored key
 *
 * NEVER PRINTS THE MANIFEST URL. It embeds the user's whole addon config,
 * which is a credential; the existing [discover] line carries the same
 * warning and this holds to it. Ids, names and genre values only.
 */

interface Probes {
  btvDiscover?: () => Promise<void>;
  btvTmdb?: (key?: string) => Promise<void>;
}

export function installDiscoverProbe(): void {
  const w = window as unknown as Probes;

  /**
   * What the configured addons advertise, in full.
   *
   * THE QUESTION THIS EXISTS FOR: an AIOStreams with TMDB behind it still
   * speaks the Stremio catalog protocol, and that protocol carries only
   * `search`, `genre` and `skip`. So a TMDB-backed catalog does not
   * necessarily expose TMDB's KEYWORDS — it may only expose genres, which
   * is the vocabulary the app already had. The genre values are the tell:
   * a couple of dozen familiar names means genres, and hundreds of oddly
   * specific ones ("time travel", "post-apocalyptic") means the addon is
   * surfacing keywords through the genre extra, and the recommender could
   * ask your own addon instead of TMDB directly.
   */
  w.btvDiscover = async () => {
    try {
      const cfg = await loadDiscover();
      console.info(
        `[probe] ${cfg.catalogs.length} browseable, ${cfg.searchCatalogs.length} searchable`,
      );
      for (const c of cfg.catalogs)
        console.info(
          `[probe] ${c.id} (${c.type}) — ${
            c.genreCapable
              ? `${c.genres.length} genre options`
              : "no genre extra"
          }`,
          c.genres,
        );
      console.info(`[probe] union of all genres (${cfg.genres.length}):`, cfg.genres);
    } catch (e) {
      console.error("[probe] discover failed:", e);
    }
  };

  /** Store a key if one is passed, then ask TMDB whether this app's idea of
   * its API is still true. See tmdb.ts: none of those shapes has ever been
   * run against the real service from the repo. */
  w.btvTmdb = async (key?: string) => {
    if (key) {
      saveTmdbKey(key);
      console.info("[probe] TMDB key stored");
    }
    if (!loadTmdbKey()) {
      console.warn('[probe] no TMDB key. Pass one: btvTmdb("your-key")');
      return;
    }
    console.info("[probe]", await probeTmdb());
  };
}

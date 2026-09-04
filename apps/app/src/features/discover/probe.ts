import { clearSearchCache, loadDiscover, searchDiscover } from "./data";
import { broaden, score } from "./match";
import { resolveVodItem } from "../stream/source";
import {
  findByWords,
  imdbIdFor,
  loadTmdbKey,
  probeTmdb,
  saveTmdbKey,
} from "./tmdb";

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

  /**
   * What a search ACTUALLY returns, and why.
   *
   *   await btvSearch("ironman")
   *
   * THE QUESTION IT SETTLES. v0.9.29 taught search to ask wider and rank
   * locally, and "ironman" still finds nothing. There are two completely
   * different causes and they need opposite fixes: either the ranking is
   * not firing, or the catalogs simply do not contain the film. This
   * prints the raw count from the query as typed, whether the broadened
   * ask fired and what it asked, and the score every result got — so the
   * answer is visible rather than inferred.
   *
   * The corpus is the thing to look at. Ranking cannot conjure a title
   * that no catalog returned.
   */
  (w as unknown as { btvSearch?: (q: string) => Promise<void> }).btvSearch =
    async (q: string) => {
      try {
        const cfg = await loadDiscover();
        // The keystroke cache would answer instantly and hide the requests
        // this exists to show.
        clearSearchCache();
        const out = await searchDiscover(cfg, "all", q);
        const wider = broaden(q);
        console.info(
          `[probe] "${q}" -> ${out.length} results; broaden() would ask ` +
            `"${wider ?? "(nothing: too short or multi-word)"}"` +
            // Whether it FIRED is the useful half, and the count alone
            // does not say: the wider ask only runs when the first came
            // back thin, so a fat result means it never happened.
            (out.length >= 5
              ? " (did not fire, the first ask was not thin)"
              : " (fired)"),
        );
        console.info(
          "[probe] scored:",
          out.slice(0, 25).map((i) => `${score(i.title, q)} ${i.title}`),
        );
        const exact = out.find((i) => score(i.title, q) >= 80);
        console.info(
          exact
            ? `[probe] top match: "${exact.title}"`
            : "[probe] NOTHING scored as a real match — the catalogs did not return it, which ranking cannot fix",
        );
      } catch (e) {
        console.error("[probe] search failed:", e);
      }
    };

  /**
   * THE WHOLE CHAIN, end to end, on a machine that can reach both sides.
   *
   *   btvFind("space", "horror")
   *
   * words -> TMDB keyword ids -> candidates -> one picked -> its IMDb id ->
   * a real VodItem from your own addons. Every step prints, so a break
   * names itself instead of showing an empty screen. This is the shape the
   * recommender will use; running it is how we know the shape works before
   * a screen is built on it.
   */
  (w as unknown as { btvFind?: (...words: string[]) => Promise<void> }).btvFind =
    async (...words: string[]) => {
      try {
        const found = await findByWords(words, "movie");
        console.info(
          `[probe] keywords: ${found.keywords.map((k) => `${k.name}=${k.id}`).join(", ") || "none"}` +
            (found.unknown.length ? ` | no tag for: ${found.unknown.join(", ")}` : "") +
            (found.relaxed ? " | RELAXED to any" : ""),
        );
        console.info(
          `[probe] ${found.candidates.length} candidates:`,
          found.candidates.map((c) => `${c.title}${c.year ? ` (${c.year})` : ""}`),
        );
        const one = found.candidates[0];
        if (!one) return;
        const imdb = await imdbIdFor(one);
        console.info(`[probe] "${one.title}" -> ${imdb ?? "NO IMDB ID"}`);
        if (!imdb) return;
        const item = await resolveVodItem("movie", imdb);
        console.info(
          item
            ? `[probe] resolved: "${item.title}" (${item.year ?? "?"}), ${item.genres.length} genres, poster ${item.poster ? "yes" : "no"}`
            : "[probe] the addon could not resolve that id — the chain breaks here",
        );
      } catch (e) {
        console.error("[probe] find failed:", e);
      }
    };
}

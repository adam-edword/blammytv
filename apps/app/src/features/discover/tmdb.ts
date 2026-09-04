import { httpGetText } from "../../lib/http";
import { load, save } from "../../lib/storage";

/**
 * TMDB, used ONLY as an oracle for "which titles match these words".
 *
 * WHY IT IS HERE AT ALL. Our catalogs can filter by genre and search by
 * title, and that is the whole vocabulary. "space horror", "heist", "time
 * loop", "found footage" are not genres and not titles, so nothing in the
 * app could answer them. TMDB carries a crowd-sourced keyword tag per
 * title, which is exactly that missing vocabulary, and it is somebody
 * else's job to maintain.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It never becomes the thing you play.
 * TMDB hands back NAMES; the name is then resolved against the user's own
 * addons, which is where a playable item comes from. Two reasons, and the
 * second is the load-bearing one:
 *
 *   - A TMDB id is not an addon id. Turning one into the other needs
 *     /movie/{id}/external_ids per title, so a board of twenty candidates
 *     would be twenty-one requests instead of one.
 *   - Nothing from TMDB is stored, indexed or redistributed. It picks
 *     names and is then out of the loop.
 *
 * ALL OF IT LIVES IN THIS FILE, on purpose. Whether we are licensed for
 * this is an open question with TMDB at the time of writing (the app sells
 * cosmetic themes, and §2.A of their API terms reads on that). If the
 * answer is no, `enabled` goes false and this file is deleted, and nothing
 * else in the app has to change.
 *
 * ENDPOINT SHAPES ARE UNVERIFIED FROM THIS REPO. api.themoviedb.org is
 * unreachable from the dev container (the egress proxy answers 403 to
 * CONNECT), so every shape below is written from documentation rather than
 * from a response anyone here has seen. scripts/fake-tmdb.mjs serves what
 * this file expects, which makes the harness a test of OUR parsing and not
 * of their API. The first real call has to happen on a machine that can
 * reach them; `probeTmdb` exists to make that one command.
 */

const KEY = "tmdbKey";
const VERSION = 1;
const BASE = "https://api.themoviedb.org/3";

/** Overridable so the harness can point at a fake on localhost. */
let base = BASE;
export function setTmdbBase(url: string): void {
  base = url.replace(/\/+$/, "");
}

export function loadTmdbKey(): string {
  return load<string>(KEY, VERSION, "");
}

export function saveTmdbKey(k: string): void {
  save(KEY, VERSION, k.trim());
}

/** The whole feature's on switch. No key, no keyword search. */
export function tmdbEnabled(): boolean {
  return loadTmdbKey().length > 0;
}

/** One of TMDB's keyword tags. */
export interface TmdbKeyword {
  id: number;
  name: string;
}

/**
 * A title TMDB thinks matches, before we know whether we can play it.
 *
 * `id` is TMDB's and exists only so `pick` can avoid repeating itself;
 * `title` is what gets resolved against the user's addons.
 */
export interface TmdbCandidate {
  id: string;
  title: string;
  year?: number;
  kind: "movie" | "series";
}

async function ask(path: string, params: Record<string, string>): Promise<unknown> {
  const key = loadTmdbKey();
  if (!key) throw new Error("no TMDB key");
  const q = new URLSearchParams({ ...params, api_key: key });
  // The key rides the query string (their v3 scheme, which is what an API
  // key from the account page is). A v4 bearer token would go in an
  // Authorization header instead; we do not issue those.
  const body = await httpGetText(`${base}${path}?${q}`);
  return JSON.parse(body);
}

/** Year out of "1979-05-25", and undefined out of "" or a malformed date. */
function yearOf(date: unknown): number | undefined {
  const y = Number(String(date ?? "").slice(0, 4));
  return Number.isFinite(y) && y > 1800 ? y : undefined;
}

/**
 * Typed words to TMDB keyword ids.
 *
 * ONE REQUEST PER WORD, and that is the shape of their API rather than a
 * choice: /search/keyword takes a single query. Callers ask for a handful
 * of words at most, so this stays a handful of parallel requests.
 *
 * Takes only the FIRST match per word. Their search is a substring match,
 * so "space" also returns "space marine", "space opera", "outer space" —
 * and folding all of those in turns a specific ask into a vague one. The
 * first result is their relevance ranking's own answer.
 */
export async function keywordIds(words: readonly string[]): Promise<TmdbKeyword[]> {
  const out = await Promise.all(
    words
      .map((w) => w.trim())
      .filter(Boolean)
      .map(async (w) => {
        const json = (await ask("/search/keyword", { query: w })) as {
          results?: { id?: number; name?: string }[];
        };
        const hit = json.results?.[0];
        return hit?.id != null ? { id: hit.id, name: hit.name ?? w } : null;
      }),
  );
  return out.filter((k): k is TmdbKeyword => k !== null);
}

/**
 * Titles carrying ALL of these keywords, or ANY of them if all is empty.
 *
 * Their `with_keywords` joins ids with "," for AND and "|" for OR, so the
 * same all-then-any rule `shortlist` uses for genres falls straight out of
 * the query. Strict first: "space" AND "horror" is a much better answer
 * than either alone, and only worth relaxing when it returns nothing.
 */
export async function discoverByKeywords(
  ids: readonly number[],
  kind: "movie" | "series",
  mode: "all" | "any" = "all",
): Promise<TmdbCandidate[]> {
  if (ids.length === 0) return [];
  const path = kind === "movie" ? "/discover/movie" : "/discover/tv";
  const json = (await ask(path, {
    with_keywords: ids.join(mode === "all" ? "," : "|"),
    sort_by: "popularity.desc",
    include_adult: "false",
    page: "1",
  })) as {
    results?: {
      id?: number;
      title?: string;
      name?: string;
      release_date?: string;
      first_air_date?: string;
    }[];
  };
  return (json.results ?? [])
    .map((r) => {
      // Movies carry title/release_date, TV carries name/first_air_date.
      // Reading both means one mapper for both endpoints.
      const title = (r.title ?? r.name ?? "").trim();
      if (!title || r.id == null) return null;
      const year = yearOf(r.release_date ?? r.first_air_date);
      // Spread rather than `year: undefined`: the field is optional, and an
      // explicit undefined is a different type from an absent one.
      const c: TmdbCandidate = {
        id: `tmdb:${kind}:${r.id}`,
        title,
        kind,
        ...(year != null ? { year } : {}),
      };
      return c;
    })
    .filter((c): c is TmdbCandidate => c !== null);
}

/**
 * The IMDb id for one TMDB title, or null.
 *
 * WHY THIS EXISTS after the file header says it does not convert ids. The
 * header's objection was the COST: doing it for a whole board is one
 * request per candidate. Doing it for the ONE candidate that got picked is
 * a single request, and it buys an exact match instead of a fuzzy one.
 *
 * Adam's `btvDiscover()` output is what settled this. Every one of his
 * catalogs is an mdblist list with the same 42 plain genres, so searching
 * them by title only finds titles that happen to be ON those lists — most
 * of what TMDB suggests would simply not resolve. An IMDb id skips the
 * catalogs entirely: resolveVodItem falls back to Cinemeta, which has meta
 * for any id.
 */
export async function imdbIdFor(candidate: TmdbCandidate): Promise<string | null> {
  const tmdbId = candidate.id.split(":")[2];
  if (!tmdbId) return null;
  const path = candidate.kind === "movie" ? "/movie" : "/tv";
  const json = (await ask(`${path}/${tmdbId}/external_ids`, {})) as {
    imdb_id?: string | null;
  };
  const id = json.imdb_id ?? "";
  // Their field is null for anything unmatched, and a "tt" prefix is what
  // makes it an addon id rather than some other database's number.
  return id.startsWith("tt") ? id : null;
}

/**
 * Everything above in one call: words in, candidates out, strict then wide.
 *
 * `relaxed` is reported rather than hidden for the same reason `shortlist`
 * reports it: a picker that silently widens what you asked for starts
 * feeling broken, and the screen has to be able to say "nothing had all of
 * those, so here is anything with one of them".
 */
export interface TmdbFind {
  candidates: TmdbCandidate[];
  keywords: TmdbKeyword[];
  /** Words TMDB has no tag for at all. The screen should say which. */
  unknown: string[];
  relaxed: boolean;
}

export async function findByWords(
  words: readonly string[],
  kind: "movie" | "series",
): Promise<TmdbFind> {
  const keywords = await keywordIds(words);
  const known = new Set(keywords.map((k) => k.name.toLowerCase()));
  const unknown = words.filter(
    (w) => w.trim() && !known.has(w.trim().toLowerCase()),
  );
  if (keywords.length === 0)
    return { candidates: [], keywords, unknown, relaxed: false };
  const ids = keywords.map((k) => k.id);
  const all = await discoverByKeywords(ids, kind, "all");
  if (all.length > 0)
    return { candidates: all, keywords, unknown, relaxed: false };
  // One word cannot be relaxed: "all of [x]" and "any of [x]" are the same
  // query, so re-asking would spend a request to get the same empty answer.
  if (ids.length < 2)
    return { candidates: [], keywords, unknown, relaxed: false };
  const any = await discoverByKeywords(ids, kind, "any");
  return { candidates: any, keywords, unknown, relaxed: any.length > 0 };
}

/**
 * Does the key work, and does their API still look the way this file
 * thinks it does?
 *
 * Exists because of the caveat at the top: nothing here has been run
 * against the real service. This turns "find out" into one call whose
 * answer is a sentence, so the first person on a machine that can reach
 * TMDB can confirm the shapes rather than discovering a parse bug through
 * an empty board.
 */
export async function probeTmdb(): Promise<string> {
  try {
    const kw = await keywordIds(["space"]);
    if (kw.length === 0) return "reached TMDB, but /search/keyword returned no results for 'space' — the response shape has probably changed";
    const found = await discoverByKeywords([kw[0].id], "movie", "all");
    return found.length > 0
      ? `ok: "space" is keyword ${kw[0].id}, ${found.length} titles, first "${found[0].title}"`
      : `reached TMDB and resolved keyword ${kw[0].id}, but /discover returned nothing usable — check the results shape`;
  } catch (e) {
    return `failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

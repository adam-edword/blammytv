import { loadLive, peekLive } from "../live/source";
import { fetchGames } from "./espn";
import { fetchList, loadFollows } from "./follows";
import { isFixture } from "./model";
import {
  CARD_CONFIDENCE,
  indexChannels,
  matchEvent,
  matchGame,
  matchNetwork,
  normalize,
  type Catalog,
  type Tunable,
} from "./matcher";

/**
 * Console probes for the sports channel matcher.
 *
 *   await btvSports()               // today's board against your catalog
 *   btvChannels("abc")              // how your provider spells a name
 *
 * WHY THIS EXISTS, and it is the same reason as the discover probes: the
 * container this is written in cannot see the catalog the matcher fails on.
 *
 * matcher.ts is measured against two corpora checked in beside it, and one
 * of them is the problem. `fixtures/channels.json` is 1,875 channels drawn
 * from the SPORTS FOLDERS ALONE: 22 folders, every one of them a league
 * shelf, a 4K shelf or an event shelf. It contains no ABC, no NBC affiliate,
 * no USA Network. So of the 92 broadcast names in the other corpus, 33 miss
 * because the channel is genuinely not in the dump, and the hit rate that
 * file reports says nothing about a real 20,000 channel catalog where those
 * channels do exist and are named some way nobody here has ever read.
 *
 * "Fails to list common channels" has two completely different causes with
 * opposite fixes, and only this can tell them apart:
 *
 *   - the name reaches NOTHING, which is a normalizer or alias problem
 *   - the name reaches the right channel at a score under the card's bar,
 *     which is a threshold problem and needs no matcher change at all
 *
 * The second is the one to watch for. A bare "NBC" against "NBC Sports Bay
 * Area" scores 40, and the card only counts 70 and up, so a game whose
 * channel WAS found still reads "Couldn't link". That failure looks
 * identical to the first from the outside.
 *
 * PRINTS NAMES ONLY. No stream URLs, no playlist host, no credentials: a
 * channel name is not a secret and everything else here is.
 */

interface Probes {
  btvSports?: (...paths: string[]) => Promise<void>;
  btvChannels?: (query: string) => void;
}

/** The catalog as the Sports tab builds it, or null if no playlist loaded. */
function tunables(): Tunable[] | null {
  const live = peekLive();
  if (!live) return null;
  return [
    ...live.channels.map((c) => ({ id: c.id, name: c.name, quality: c.quality })),
    ...(live.hidden ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      quality: c.quality,
      hidden: true,
    })),
  ];
}

/**
 * Channels that share a word with a name that matched nothing.
 *
 * The diagnostic half. A miss on its own only says the matcher found
 * nothing; what is needed is the shape of the names it walked past, because
 * that is what an alias or a rule has to be written against. Substring
 * rather than token, so it can see the joins the tokenizer itself is
 * getting wrong.
 */
function nearby(all: Tunable[], name: string, cap = 6): string[] {
  const words = normalize(name).split(" ").filter((w) => w.length > 1);
  if (words.length === 0) return [];
  const out: string[] = [];
  for (const c of all) {
    const flat = normalize(c.name);
    if (words.some((w) => flat.includes(w))) out.push(c.name);
    if (out.length >= cap) break;
  }
  return out;
}

export function installSportsProbe(): void {
  const w = window as unknown as Probes;

  /**
   * Today's board, every broadcaster on it, and what each one reached.
   *
   * Takes league paths ("baseball/mlb") and falls back to what is followed,
   * which is the same list the board itself fetches.
   */
  w.btvSports = async (...paths: string[]) => {
    try {
      if (!peekLive()) {
        console.info("[sports] loading your playlist...");
        await loadLive(new Date());
      }
      const all = tunables();
      if (!all) {
        console.warn("[sports] no playlist loaded, so there is nothing to match against");
        return;
      }
      const catalog: Catalog = indexChannels(all);
      const hidden = all.filter((c) => c.hidden).length;
      console.info(
        `[sports] ${all.length} channels (${all.length - hidden} visible, ${hidden} hidden)`,
      );

      const want = paths.length > 0 ? paths : fetchList(loadFollows());
      const games = await fetchGames(want);
      console.info(`[sports] ${games.length} games over ${want.length} leagues`);

      // Per NAME rather than per game: the same broadcaster carries a dozen
      // fixtures and its answer is the same every time, so a per-game list
      // buries one fact under twelve copies of it.
      const byName = new Map<string, number>();
      for (const g of games)
        for (const n of g.broadcasts) byName.set(n, (byName.get(n) ?? 0) + 1);

      const miss: string[] = [];
      const weak: string[] = [];
      const lines: string[] = [];
      for (const [name, count] of [...byName].sort((a, b) => b[1] - a[1])) {
        const got = matchNetwork(name, catalog);
        const top = got[0];
        if (!top) {
          miss.push(name);
          lines.push(`  MISS  ${name} (${count} games)`);
          continue;
        }
        if (top.confidence < CARD_CONFIDENCE) weak.push(name);
        lines.push(
          `  ${top.confidence >= CARD_CONFIDENCE ? "OK  " : "WEAK"}  ${name} (${count}) -> ` +
            got.slice(0, 3).map((c) => `${c.confidence} ${c.name}`).join(" | "),
        );
      }
      console.info(`[sports] ${byName.size} distinct broadcasters named:\n${lines.join("\n")}`);

      // THE PART THAT IS WORTH PASTING BACK. A miss is only actionable
      // alongside the names it walked past.
      if (miss.length) {
        console.info("[sports] misses, with what your catalog does have:");
        for (const name of miss) {
          const near = nearby(all, name);
          console.info(
            `  ${name} -> ${near.length ? near.join(" | ") : "(nothing sharing a word)"}`,
          );
        }
      }

      // The board's own outcome, which is what the cards actually show.
      let carded = 0;
      let railOnly = 0;
      let nothing = 0;
      for (const g of games) {
        const named = isFixture(g)
          ? matchEvent([g.home.name, g.away.name], g.start, catalog)
          : [];
        const seen = new Set(named.map((c) => c.id));
        const found = [
          ...named,
          ...matchGame(g.broadcasts, catalog).filter((c) => !seen.has(c.id)),
        ];
        if (found.some((c) => c.confidence >= CARD_CONFIDENCE)) carded++;
        else if (found.length > 0) railOnly++;
        else nothing++;
      }
      console.info(
        `[sports] ${carded} games get a channel on the card, ${railOnly} found one but ` +
          `scored under ${CARD_CONFIDENCE} so the card says "couldn't link", ` +
          `${nothing} reached nothing at all`,
      );
      if (weak.length)
        console.info(`[sports] under the card's bar: ${weak.join(", ")}`);
    } catch (e) {
      console.error("[sports] probe failed:", e);
    }
  };

  /**
   * How your provider spells a broadcaster.
   *
   *   btvChannels("abc")
   *
   * The one question the checked-in corpus cannot answer. Whether a bare
   * national network is reachable at all depends entirely on whether it is
   * carried as "US: ABC", "US: ABC East" or "ABC 7 New York WABC", and each
   * of those needs a different rule.
   */
  w.btvChannels = (query: string) => {
    const all = tunables();
    if (!all) {
      console.warn("[sports] no playlist loaded");
      return;
    }
    const q = normalize(query);
    const got = all.filter((c) => normalize(c.name).includes(q));
    console.info(`[sports] ${got.length} channels containing "${q}":`);
    console.info(got.slice(0, 60).map((c) => `  ${c.hidden ? "(hidden) " : ""}${c.name}`).join("\n"));
    if (got.length > 60) console.info(`  ...and ${got.length - 60} more`);
  };
}

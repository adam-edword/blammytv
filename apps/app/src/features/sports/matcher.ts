/**
 * Turn a schedule's network name into channels of yours (plan 010, phase 2).
 *
 * This is the feature. Everything else in the hub is a way of looking at
 * games; this is the part that makes a game something you can watch. It is
 * pure, it takes its channel list as an argument, and it is written against
 * two real corpora rather than invented names: ESPN's 92 broadcast names and
 * a 1,875-channel dump, both checked in beside this file.
 *
 * WHAT IT DOES NOT DO. It does not try to tell a streaming service from a
 * cable channel. An earlier draft carried a denylist of "Peacock, Netflix,
 * MLB.TV..." to skip, built from eleven days of scoreboards, and that list
 * would have been wrong the moment a service was renamed or a new one
 * appeared. It is also unnecessary: a name nobody carries simply matches
 * nothing, which is the right answer for Peacock anyway. The card already
 * says "On Peacock" from the schedule's own words.
 */

/** The little a channel has to be for this to work on it. */
export interface Tunable {
  id: string;
  name: string;
  /** "4K" | "HDR" | "FHD" | "HD" | null, as extractQuality reports it. */
  quality: string | null;
  /**
   * In a folder the user has hidden from the guide.
   *
   * Hiding a folder is about what the guide is cluttered with, and a game is
   * a different question from a channel list, so these still count. They
   * just count LAST: see `matchGame`.
   */
  hidden?: boolean;
  /** Provider artwork, for the rail. */
  logo?: string;
}

/** A channel that carries a game, and how sure we are of it. */
export interface Match extends Tunable {
  /** 0-100. See SCORE for where each number comes from. */
  confidence: number;
}

/**
 * Provider prefixes. Playlists lead with the country and the schedule never
 * does, so this is noise on one side only. Anchored and punctuation-bound so
 * it cannot eat a real word: "US: ESPN" loses its prefix, "USA Network"
 * keeps every letter.
 */
const COUNTRY =
  /^(us|usa|uk|ca|au|nz|ie|fr|de|es|it|nl|pt|pl|se|no|dk|fi|be|at|ch|cz|sk|hu|ro|bg|gr|tr|ru|ua|il|cy|za|in|pk|hk|sg|my|th|vn|ph|id|kr|jp|cn|tw|br|mx|ar|cl|co|pe)\s*[:|]\s*/i;

/** Resolution badges. The same channel is sold to us five ways and the
 * schedule has never heard of any of them. */
const QUALITY =
  /\b(4k|uhd|fhd|hd|hdr|hdr10|sd|1080p?|720p?|2160p?|ultra\s*hd|full\s*hd|dolby\s*vision)\b/gi;

/**
 * Words the schedule shortens and a playlist spells out.
 *
 * Measured: without these the matcher reached 27% of the broadcasters that
 * could be reached at all, and with them 42%. They are the difference
 * between "NFL Net" and "NFL Network", and there is no cleverness available
 * that substitutes for knowing them.
 *
 * `sportsnet` is here for a different reason: it is one word on one side and
 * two on the other ("SportsNet PIT" against "AT&T SportsNet Pittsburgh"),
 * and expanding both to the same pair of tokens is what makes them meet.
 */
const WORDS: Record<string, string> = {
  net: "network",
  sportsnet: "sports network",
  sn: "sports network",
  ba: "bay area",
  bo: "boston",
  ca: "california",
  phil: "philadelphia",
  pit: "pittsburgh",
  nw: "northwest",
};

/**
 * Broadcasters the schedule writes as an acronym that appears nowhere in the
 * channel's name. Deliberately short: every entry is a claim that two
 * different strings are the same channel, and a wrong one tunes the wrong
 * game. Only added where both sides were checked against the corpora.
 */
const BRANDS: Record<string, string> = {
  mlbn: "mlb network",
  mnmt: "monumental sports network",
};

/** Everything both sides get put through before they are compared. */
export function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(COUNTRY, "")
    .replace(QUALITY, " ")
    // `+` survives: ESPN+ is a different thing from ESPN, and losing the
    // plus is exactly the ESPN/ESPNU class of wrong match this has to avoid.
    .replace(/[^a-z0-9+]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** The normalized name as a set of words, with the shortenings expanded. */
export function tokens(name: string): Set<string> {
  const flat = normalize(name);
  const expanded = (BRANDS[flat] ?? flat)
    .split(" ")
    .map((w) => WORDS[w] ?? w)
    .join(" ");
  return new Set(expanded.split(" ").filter(Boolean));
}

/**
 * The only words a channel may have that the schedule does not.
 *
 * This is deliberately tiny, and the reason is the whole design. An earlier
 * rule allowed ANY extra word, so that "CHSN" could find "Chicago Sports
 * Network CHSN". Measured against the dump, that also made "NBC" match NBC
 * Sports Bay Area, NBC Sports Boston and eight more, and made "Sportsnet"
 * match eighteen channels. A bare network name swallowing a more specific
 * brand is the same failure as ESPN swallowing ESPN U, just with a word
 * instead of a numeral.
 *
 * So extras are the exception now: corporate prefixes and shelf labels that
 * never pick out one broadcaster from another. Everything else, including
 * every numeral and every "Plus", "U", "Xtra" and "Alternate", makes it a
 * different channel and blocks the match.
 *
 * Plan 010's own rule: a wrong channel is worse than no channel.
 */
const NOISE = new Set(["at", "t", "the", "network", "event", "only"]);

/**
 * Words that make a channel DIFFERENT rather than merely uncertain.
 *
 * The line this file draws: reject what we know is another channel, score
 * what we are only unsure about. ESPN 2, ESPN U, NESN Plus, Bein Sports
 * Xtra and Big Ten Network Overflow 2 are not doubtful matches for their
 * bare names, they are definitively other channels, and no confidence
 * number makes showing them useful. Every one of these came off the dump.
 */
const QUALIFIERS = new Set([
  "u",
  "news",
  "plus",
  "+",
  "alt",
  "alternate",
  "overflow",
  "backup",
  "xtra",
  "extra",
  "espanol",
  "deportes",
  "multiview",
  "hq",
  "insider",
  "now",
]);

const isQualifier = (w: string) => /^\d+$/.test(w) || QUALIFIERS.has(w);

/**
 * How sure we are, 0 to 100, and where each number comes from.
 *
 * Derived from HOW the match was made rather than invented, so every score
 * is a fact about the two names rather than a feeling. A viewer reading
 * "40%" is being told the truth: this shares the broadcaster's name but
 * carries words that could mean a different feed of it.
 */
const SCORE = {
  /** The names agree once the country prefix and quality badge come off. */
  exact: 100,
  /** Agreed on the acronym a provider appends after spelling the brand out. */
  acronym: 90,
  /** Agreed, and the channel only carried shelf words extra ("AT&T", "The"). */
  shelf: 85,
  /**
   * Shares the name but carries words that distinguish nothing we know of:
   * "NBC" against "NBC Sports Bay Area". Probably a different feed, possibly
   * the same one. Shown, ranked last, and never counted on a card.
   */
  loose: 40,
  /** Deduction when one of OUR expansions was needed to make them meet. */
  aliased: -15,
};

/** Below this, a match is not worth a viewer's attention. */
export const MIN_CONFIDENCE = 40;

/**
 * A card may only claim a game is "on" a channel it is this sure about.
 * Loose matches still appear in the rail, where the score is visible.
 */
export const CARD_CONFIDENCE = 70;

/**
 * A channel's names, plural.
 *
 * Providers write a broadcaster out and then append its acronym: "Chicago
 * Sports Network CHSN", "SportsNet New York SNY". The schedule only ever
 * says the acronym. So a channel also answers to a trailing all-caps run,
 * which is what lets those two meet without opening the door to every
 * longer name that happens to contain a short one.
 */
function identities(name: string): Set<string>[] {
  const full = tokens(name);
  // Past the country prefix, a separator means this is not a channel brand
  // at all but an event listing, and its trailing name is an attribution:
  // "NBA 02: NBA Las Vegas Summer League 2026 - ESPN" is not ESPN. Caught
  // by running the matcher over the whole dump rather than over examples.
  const bare = name.replace(COUNTRY, "").trim();
  if (/[-:|]/.test(bare)) return [full];
  const acronym = /(?:^|\s)([A-Z][A-Z0-9]{2,})\s*$/.exec(bare.replace(QUALITY, " ").trim());
  if (!acronym) return [full];
  const short = new Set([acronym[1].toLowerCase()]);
  return same(short, full) ? [full] : [full, short];
}

const same = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

/**
 * Does this channel carry that network?
 *
 * A channel name may say MORE than the schedule does, and usually must:
 * "CHSN" has to find "Chicago Sports Network CHSN". So extra words are
 * allowed in general.
 *
 * What is NOT allowed is an extra QUALIFIER, because that is not a longer
 * name for the same channel, it is a different channel. "ESPN" must not
 * swallow ESPN 2, ESPN U or ESPN News, and this is the mistake plan 010 has
 * warned about since before any of it was written. The rule is symmetric
 * and one line: whatever distinguishes siblings must be identical on both
 * sides, so a bare name only ever finds a bare channel.
 */
function carries(
  want: Set<string>,
  channel: Set<string>,
  viaAcronym: boolean,
): number {
  if (![...want].every((w) => channel.has(w))) return 0;
  const extras = [...channel].filter((w) => !want.has(w));
  // A qualifier is not doubt, it is a different channel. Rejected outright,
  // whatever else agrees.
  if (extras.some(isQualifier)) return 0;
  if (extras.length === 0) return viaAcronym ? SCORE.acronym : SCORE.exact;
  if (extras.every((w) => NOISE.has(w))) return SCORE.shelf;
  return SCORE.loose;
}

/**
 * A channel and every name it answers to, worked out once.
 *
 * The naive shape of this is a nested loop, and on a real catalog that is
 * roughly forty games times three networks times twenty thousand channels.
 * Tokenizing inside that loop is the whole cost, so it happens here instead
 * and the loop only compares sets.
 */
interface Entry {
  channel: Tunable;
  ids: Set<string>[];
}

/**
 * The catalog, arranged so a network name does not have to look at all of
 * it.
 *
 * A match needs EVERY word of the network's name present in the channel, so
 * any one of those words is enough to rule out almost everything: "ESPN"
 * asks for the handful of channels containing "espn" rather than reading
 * twenty thousand names. Built once per catalog, reused for every game.
 */
export interface Catalog {
  byToken: Map<string, Entry[]>;
  size: number;
}

export function indexChannels(channels: Tunable[]): Catalog {
  const byToken = new Map<string, Entry[]>();
  for (const channel of channels) {
    const ids = identities(channel.name);
    const entry: Entry = { channel, ids };
    // Union across identities, so a channel is filed once per distinct word
    // however many names it answers to.
    const words = new Set<string>();
    for (const id of ids) for (const w of id) words.add(w);
    for (const w of words) {
      const list = byToken.get(w);
      if (list) list.push(entry);
      else byToken.set(w, [entry]);
    }
  }
  return { byToken, size: channels.length };
}

/** Accepts a plain list too, which is what every test and small caller has. */
function asCatalog(source: Tunable[] | Catalog): Catalog {
  return Array.isArray(source) ? indexChannels(source) : source;
}

/** 4K beats HDR beats FHD beats HD, as the Live pipeline already ranks it. */
const QUALITY_RANK: Record<string, number> = { "4K": 0, HDR: 1, FHD: 2, HD: 3 };
const rank = (q: string | null) => (q ? (QUALITY_RANK[q] ?? 4) : 5);

/**
 * The channels carrying ONE network name, best first.
 *
 * Channels whose name says exactly what the schedule said come before ones
 * that merely contain it, because "MSG" should offer you MSG before it
 * offers you MSG Western New York. Within each of those, better picture
 * first. Several answers is a success and not an ambiguity: a game on three
 * of your channels is three chances at one that is not buffering.
 */
export function matchNetwork(
  network: string,
  source: Tunable[] | Catalog,
): Match[] {
  const want = tokens(network);
  if (want.size === 0) return [];
  // Whether our own alias table was needed to get here. That is a claim we
  // made rather than something either side said, so it costs confidence.
  const aliased = normalize(network).split(" ").filter(Boolean).join(" ") !==
    [...want].join(" ");
  const catalog = asCatalog(source);
  // Every word must be present, so start from whichever is rarest and the
  // rest of the catalog is never touched.
  let candidates: Entry[] | undefined;
  for (const w of want) {
    const list = catalog.byToken.get(w);
    if (!list) return [];
    if (!candidates || list.length < candidates.length) candidates = list;
  }
  if (!candidates) return [];

  const out: Match[] = [];
  for (const { channel, ids } of candidates) {
    let best = 0;
    ids.forEach((id, i) => {
      best = Math.max(best, carries(want, id, i > 0));
    });
    if (best === 0) continue;
    const confidence = Math.max(0, best + (aliased ? SCORE.aliased : 0));
    if (confidence < MIN_CONFIDENCE) continue;
    out.push({ ...channel, confidence });
  }
  // Surest first; a better picture breaks the tie.
  return out.sort(
    (a, b) => b.confidence - a.confidence || rank(a.quality) - rank(b.quality),
  );
}

/**
 * Every channel of yours carrying a game, given the networks the schedule
 * named for it.
 *
 * De-duplicated by channel id, keeping the order the networks came in, so a
 * game's national feed is offered before a regional one.
 *
 * HIDDEN FOLDERS ARE A FALLBACK, NOT A TIER. If anything in a visible folder
 * carries this game, that is the whole answer and the hidden ones are never
 * mentioned; only when nothing visible carries it do they appear. Adam's
 * call, and it is the right one for a reason worth writing down: the common
 * case is that the user hid a folder precisely so they would stop seeing it,
 * and the rare case is a Sunday where the only copy of the game is in there.
 * Mixing the two would serve the rare case by spoiling the common one.
 *
 * Note this is decided per GAME and not per network. A game on FOX and MASN
 * with only MASN visible offers MASN alone: something visible carries it, so
 * the question of hidden folders never arises.
 */
export function matchGame(
  networks: string[],
  source: Tunable[] | Catalog,
): Match[] {
  const catalog = asCatalog(source);
  const seen = new Set<string>();
  const visible: Match[] = [];
  const hidden: Match[] = [];
  for (const network of networks) {
    for (const c of matchNetwork(network, catalog)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      (c.hidden ? hidden : visible).push(c);
    }
  }
  const out = visible.length > 0 ? visible : hidden;
  // NOT sorted by confidence outright. The order the networks arrived in is
  // the schedule's own priority, national feed before regional, and that is
  // better information about what someone wants to watch than a naming
  // detail is. Sorting purely by score put an exactly-named regional above
  // an alias-matched national one, which is the wrong answer.
  //
  // So confidence only decides the BAND: everything we are sure of, in the
  // schedule's order, then everything doubtful, in the schedule's order.
  return [
    ...out.filter((c) => c.confidence >= CARD_CONFIDENCE),
    ...out.filter((c) => c.confidence < CARD_CONFIDENCE),
  ];
}

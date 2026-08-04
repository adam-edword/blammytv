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
  // ESPN writes the Golf Channel as "Golf Chnl", which reaches nothing.
  // Both sides checked against real data, which is the bar this table sets:
  // the name is what a finished PGA event carries, and `US: Golf Channel`
  // is in the dump. Golf is one of the few sports the source populates
  // broadcasts for at all, so this is its main carrier.
  chnl: "channel",
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
  /**
   * Only the BRAND of a product name matched: "MLB.TV" reaching "MLB
   * Network" through "MLB".
   *
   * Low on purpose, because it is usually the wrong channel and we know
   * why. MLB.TV is the out-of-market package and MLB Network is a national
   * cable channel; a schedule naming the former is telling you the game is
   * NOT on the latter. But when the right feed dies mid-innings, the same
   * league's channel is the best of the remaining guesses, and a rail is
   * the place to offer a guess with its odds written on it.
   */
  stem: 30,
};

/**
 * Below this, a match is not worth a viewer's attention.
 *
 * Set under the stem tier deliberately. Adam's rule, and it is an
 * operational one rather than an aesthetic one: IPTV streams die mid-game,
 * so a rail with five imperfect options beats a rail with two perfect ones
 * that have both gone dark. Being wrong is recoverable when the score says
 * so; having nothing to try is not.
 */
export const MIN_CONFIDENCE = 25;

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

/**
 * The smallest bucket that could contain a match, or nothing when one of
 * the words appears in no channel at all.
 */
function narrow(catalog: Catalog, want: Set<string>): Entry[] | undefined {
  let best: Entry[] | undefined;
  for (const w of want) {
    const list = catalog.byToken.get(w);
    if (!list) return undefined;
    if (!best || list.length < best.length) best = list;
  }
  return best;
}

/**
 * The brand inside a product name: MLB.TV is MLB, Mavs.com is Mavs.
 *
 * Only for names shaped like a service, so this cannot quietly shorten an
 * ordinary broadcaster. Returns nothing when there is no brand left over.
 */
function stem(want: Set<string>): Set<string> | null {
  if (want.size < 2) return null;
  const words = [...want];
  const last = words[words.length - 1];
  if (last !== "tv" && last !== "com") return null;
  const rest = new Set(words.slice(0, -1));
  return rest.size > 0 ? rest : null;
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
  // rest of the catalog is never touched. A word that appears in NO channel
  // means nothing can match the full name; it does NOT mean we are done,
  // because the brand pass below may still find something. "MLB.TV" fails
  // here on "tv" and succeeds there on "mlb".
  const candidates = narrow(catalog, want);

  const out: Match[] = [];
  const seen = new Set<string>();
  for (const { channel, ids } of candidates ?? []) {
    let best = 0;
    ids.forEach((id, i) => {
      best = Math.max(best, carries(want, id, i > 0));
    });
    if (best === 0) continue;
    const confidence = Math.max(0, best + (aliased ? SCORE.aliased : 0));
    if (confidence < MIN_CONFIDENCE) continue;
    seen.add(channel.id);
    out.push({ ...channel, confidence });
  }

  // Second pass on the brand alone, for the games whose only listed
  // broadcaster is a streaming product. Capped at the stem score however
  // cleanly the shortened name happens to fit: the doubt is in having
  // dropped a word, not in what is left.
  const brand = stem(want);
  if (brand) {
    for (const { channel, ids } of narrow(catalog, brand) ?? []) {
      if (seen.has(channel.id)) continue;
      if (!ids.some((id, i) => carries(brand, id, i > 0) > 0)) continue;
      seen.add(channel.id);
      out.push({ ...channel, confidence: SCORE.stem });
    }
  }
  // Surest first; a better picture breaks the tie.
  return out.sort(
    (a, b) => b.confidence - a.confidence || rank(a.quality) - rank(b.quality),
  );
}

/**
 * Channels that name THIS FIXTURE, rather than the network showing it.
 *
 * A different join, and on some providers a far better one. Adam's carries
 * a per-game channel for every out-of-market game:
 *
 *   MLB 05 | Arizona Diamondbacks at Pittsburgh Pirates HOME 27 Jul 06:40 PM ET
 *
 * There is no broadcaster in that string at all, so the network matcher is
 * structurally blind to it however clever it gets. Matching the TEAMS finds
 * it, and finds the right one: ESPN said this game was on MLB.TV, which is
 * the out-of-market package, and this channel IS that package's feed of
 * this game. Measured against a real slate, 12 of 12 games had one.
 *
 * The rule is deliberately different from the network matcher's. There,
 * extra words are suspicious because they distinguish sibling channels;
 * here they are the date, the feed number and which booth it is, so they
 * are expected and ignored. What matters is that BOTH clubs are named,
 * which no other fixture can accidentally satisfy.
 */
export function matchEvent(
  teams: string[],
  start: Date,
  source: Tunable[] | Catalog,
): Match[] {
  const want = new Set<string>();
  for (const team of teams) for (const w of tokens(team)) want.add(w);
  // One club's name alone is every game they play this month.
  if (teams.length < 2 || want.size < 2) return [];
  const catalog = asCatalog(source);
  let candidates: Entry[] | undefined;
  for (const w of want) {
    const list = catalog.byToken.get(w);
    if (!list) return [];
    if (!candidates || list.length < candidates.length) candidates = list;
  }
  if (!candidates) return [];

  const out: Match[] = [];
  for (const { channel, ids } of candidates) {
    const all = ids[0];
    if (![...want].every((w) => all.has(w))) continue;
    if (!sameSlot(channel.name, start)) continue;
    out.push({ ...channel, confidence: SCORE.exact });
  }
  return out.sort((a, b) => rank(a.quality) - rank(b.quality));
}

/**
 * Does a dated channel name refer to this kick-off?
 *
 * These channels are rotated and re-used, so without this a Tuesday card
 * would happily offer Monday's feed. Read in US Eastern because that is the
 * clock the provider stamps them with ("26 Jul 06:40 PM ET"), not the
 * viewer's.
 *
 * THE TIME MATTERS AS WELL AS THE DAY, and leaving it out was a real bug
 * rather than a simplification. A doubleheader is two fixtures between the
 * same two clubs on the same date, so the day check alone cannot tell them
 * apart: traced against the real channel naming, ARI at PIT on 26 Jul
 * returned BOTH feeds for BOTH legs, each at SCORE.exact. That is a wrong
 * channel presented as a right one, which is the failure this whole file is
 * organised around.
 *
 * A WINDOW rather than an equality, because the two clocks are not the same
 * clock: the provider stamps its own listing time and the schedule carries
 * the fixture's, and they drift by a few minutes. 90 minutes is wide enough
 * to survive that and far narrower than any doubleheader gap — the legs are
 * separated by a completed game, so hours.
 *
 * A name with no date, or no time, still passes on that part. The check is
 * here to rule out what is definitely WRONG, not to require that every
 * provider stamps everything.
 */
const SLOT_WINDOW_MIN = 90;

function sameSlot(name: string, start: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(start);
  const part = (t: string) => parts.find((p) => p.type === t)?.value;

  const onDate = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.exec(name);
  if (onDate) {
    const day = part("day");
    const month = part("month")?.toLowerCase();
    if (Number(onDate[1]) !== Number(day) || onDate[2].toLowerCase() !== month)
      return false;
  }

  const atTime = /\b(\d{1,2}):(\d{2})\s*([ap])m?\b/i.exec(name);
  if (!atTime) return true;
  let hour = Number(atTime[1]) % 12;
  if (atTime[3].toLowerCase() === "p") hour += 12;
  const wanted = hour * 60 + Number(atTime[2]);
  // hour12:false answers 24 for midnight on some ICU builds.
  const actual = (Number(part("hour")) % 24) * 60 + Number(part("minute"));
  return Math.abs(wanted - actual) <= SLOT_WINDOW_MIN;
}

/**
 * The hidden-folder fallback, as ONE rule both halves of the join can share.
 *
 * Adam's rule is that if anything in a visible folder carries the game, that
 * is the whole answer and the hidden ones are never mentioned; only when
 * nothing visible carries it do they appear. The subtlety, and the bug this
 * was extracted to fix: "carries it" has to mean CARD-WORTHY.
 *
 * It used to be decided at MIN_CONFIDENCE, so a 40% visible guess counted as
 * carrying the game — and then the card, which only counts 70 and above,
 * threw that guess away too. Traced: with `US: NBC` hidden at 100 and `NBC
 * Sports Bay Area` visible at 40, the card came back with NO channel and the
 * "couldn't link" pill, while the viewer owned an exact NBC feed. Worst of
 * both bars.
 *
 * So the fallback asks the CARD's question, and the rail keeps everything
 * either way: when only the hidden folder really carries it, the doubtful
 * visible rows still come along behind it rather than being dropped.
 */
export function preferVisible(matches: Match[]): Match[] {
  const visible = matches.filter((c) => !c.hidden);
  const hidden = matches.filter((c) => c.hidden);
  if (hidden.length === 0 || visible.length === 0) return matches;
  const carries = (list: Match[]) =>
    list.some((c) => c.confidence >= CARD_CONFIDENCE);
  if (carries(visible)) return visible;
  if (carries(hidden)) return [...hidden, ...visible];
  return visible;
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
  const out = preferVisible([...visible, ...hidden]);
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
    // Below the card's bar the schedule's ordering has stopped meaning
    // much: these are all guesses, so the best guess goes first.
    ...out
      .filter((c) => c.confidence < CARD_CONFIDENCE)
      .sort((a, b) => b.confidence - a.confidence || rank(a.quality) - rank(b.quality)),
  ];
}

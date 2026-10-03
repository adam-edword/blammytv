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

/**
 * What a match rests on, strongest first: the order ties break in (byOdds).
 *
 * - `own`: the channel names this fixture (matchEvent).
 * - `team`: a club's own station on the listed network, like "NFL Teams:
 *   CBS Patriots (WBZ) Boston MA".
 * - `network`: the listed network's channel, like "CBS 4K UHD (Event Only)".
 * - `loose`: shares the network's name with words that may make it another
 *   feed ("NBC Sports Bay Area" for NBC).
 * - `stem`: the league's channel for a game on its service (MLB Network for
 *   MLB.TV).
 */
export type MatchKind = "own" | "team" | "network" | "loose" | "stem";

/** A channel that carries a game, and the odds that it is showing it. */
export interface Match extends Tunable {
  /** 0-100: the odds this channel is showing this game at kick-off. See
   * ODDS for where each number comes from. */
  confidence: number;
  kind: MatchKind;
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
  // One feed, two spellings of the same word. ESPN writes "Space City Home
  // (Alt.)" and the dump carries "US: Space City Home Network Alternate",
  // and because "alt" is a QUALIFIER neither side could reach the other:
  // the shortened side asked for a word the channel does not have. Both
  // sides expand, so the qualifier still does its job and now does it on
  // one spelling.
  alt: "alternate",
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

/**
 * A second spelling to try BESIDE the schedule's own, where a provider sells
 * the channel under both. Unlike BRANDS, the name as written still matches:
 * Adam's catalog (2026-10-02) has "FS1 4K (Event Only)" AND "US: FOX Sports
 * 1 FHD", and ESPN's "FS1" reached only the first. "CBSSN" reached nothing
 * at all, the one game of 37 that day with no channel, while the catalog
 * had "US: CBS Sports Network". Keys are normalized ("fs 1": see normalize).
 */
const ALSO: Record<string, string> = {
  "fs 1": "fox sports 1",
  "fs 2": "fox sports 2",
  cbssn: "cbs sports network",
};

/** Everything both sides get put through before they are compared. */
export function normalize(name: string): string {
  return name
    .toLowerCase()
    // Accents come OFF, not out. The `[^a-z0-9+]` pass below treats an
    // accented letter as punctuation, so "TUDN México" became "tudn m xico"
    // and could never meet a playlist's "TUDN Mexico" (v0.9.86). NFD splits
    // é into e plus a combining mark, and the mark is what goes.
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(COUNTRY, "")
    .replace(QUALITY, " ")
    // `+` survives: ESPN+ is a different thing from ESPN, and losing the
    // plus is exactly the ESPN/ESPNU class of wrong match this has to avoid.
    .replace(/[^a-z0-9+]+/g, " ")
    // A numbered sibling is written both ways and they have to meet. ESPN
    // writes "MSG2" and the dump carries "US: MSG 2"; measured, that pair
    // reached nothing, and so did MSGSN2. Splitting the boundary makes one
    // spelling of them, and it CANNOT loosen the sibling rule that guards
    // this file: the numeral survives as its own word either way, so a bare
    // "ESPN" still meets "ESPN 2" with an extra numeral and is still
    // rejected outright by `carries`.
    //
    // After the quality strip on purpose. "4K" and "1080p" are badges
    // rather than siblings and are already gone by here; splitting first
    // would turn them into a stray "4" and "1080" that nothing removes.
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
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
 * Timezone feeds of one national network, which are the SAME channel.
 *
 * Measured on Adam's 26,621-channel catalog, 2026-09-13: a board with four
 * games on ABC found `US: ABC East` and scored it 40, under the card's bar,
 * so four cards read "Couldn't link" while the viewer owned the national
 * feed. "East" is not a sibling the way "2" or "U" is; it is what hour the
 * same network airs on.
 *
 * ONLY AS A LONE EXTRA, which is the whole safety of it. `Fox Sports West`
 * against "FOX" leaves two extras (`sports`, `west`) and stays loose, which
 * is right because that is a different network rather than a later feed of
 * this one. One extra means the brand matched and a feed suffix is all that
 * is left over.
 */
const FEEDS = new Set(["east", "west", "central", "mountain", "pacific"]);

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
  // Not a stream of anything. Adam's catalog carries `Apple TV+ Series info`,
  // `Netflix Premiere info` and `Disney+ Series info`, which are listing
  // placeholders, plus `Radio: Netflix Is A Joke Radio`, which is audio. All
  // four were reaching the rail on a real board (2026-09-13) as 30-40%
  // guesses against games that were genuinely on those services. A guess is
  // worth offering when it might be the game; these cannot be.
  "info",
  "radio",
]);

const isQualifier = (w: string) => /^\d+$/.test(w) || QUALIFIERS.has(w);

/**
 * Words that say what KIND of channel something is and nothing about which.
 *
 * A network named with nothing else is too loose to match loosely. ESPN
 * writes the Canadian network as bare "Sportsnet", which expands (WORDS) to
 * "sports network", and every channel with those two words then reached the
 * rail as a guess: measured against the dump, 17 of them, among them CBS
 * Sports Network, CBS Sports Golazo Network and Chicago Sports Network. So
 * a name made only of these has to meet the channel in its own spelling
 * (`raw` in matchNetwork): "Sportsnet" finds Sportsnet One and SportsNet
 * Pittsburgh, and no longer finds every sports network there is.
 */
const GENERIC = new Set(["sports", "network", "channel", "tv", "television"]);

/**
 * The odds a channel is showing this game at kick-off, 0 to 100, by what
 * the match rests on (Adam's ask, 2026-10-02: "the odds that channel is
 * showing that game", where it had been how well two names agree).
 *
 * Estimates, to be tuned on the pairing log (pairingLog.ts). The names
 * still decide WHICH kind a match is (carries); this decides what that kind
 * is worth.
 *
 * Our own spellings (WORDS, BRANDS, ALSO) cost nothing here. Each was
 * checked against both corpora, so "MLBN" reaching MLB Network is MLB
 * Network. The old score docked them 15 for being our claim, and under odds
 * that made an exactly-named regional outrank a national feed listed first.
 */
const ODDS: Record<MatchKind, number> = {
  /** Named after this fixture, and the time fits (matchEvent). */
  own: 97,
  /**
   * A club's own station on the listed network: "Texas Rangers Sports
   * Network" for a Rangers game listed on "Rangers Sports Network", "NFL
   * Teams: CBS Patriots (WBZ)" for a Patriots game on CBS. It shows its
   * club's game, so it never splits.
   */
  team: 90,
  /**
   * The listed network's channel. Split by the games that network has at
   * this kick-off (matchGame): "CBS 4K UHD (Event Only)" carries one of the
   * four CBS games at noon on a Sunday, not all four (Adam's board,
   * 2026-10-02).
   */
  network: 90,
  /**
   * Shares the name but carries words that distinguish nothing we know of:
   * "NBC" against "NBC Sports Bay Area". Probably a different feed, possibly
   * the same one.
   */
  loose: 15,
  /**
   * Only the BRAND of a product name matched: "MLB.TV" reaching "MLB
   * Network" through "MLB".
   *
   * Low on purpose, because it is usually the wrong channel and we know
   * why. MLB.TV is the out-of-market package and MLB Network is a national
   * cable channel; a schedule naming the former is telling you the game is
   * NOT on the latter. So it is offered only when NOTHING else carries the
   * game (railFor): beside the game's own feeds Adam marked it wrong three
   * times in two games (2026-09-25), and with nothing else it is still the
   * one thing to try.
   */
  stem: 5,
};

/** Ties break on what the match rests on, in MatchKind's order. */
const KIND_RANK: Record<MatchKind, number> = { own: 0, team: 1, network: 2, loose: 3, stem: 4 };

/**
 * The rail's floor: under this, a match is not worth a viewer's attention.
 *
 * At the stem tier, deliberately. Adam's rule, and it is an operational one
 * rather than an aesthetic one: IPTV streams die mid-game, so a rail with
 * five imperfect options beats a rail with two perfect ones that have both
 * gone dark. Being wrong is recoverable when the number says so; having
 * nothing to try is not. What it drops is a network split so many ways that
 * it is showing somebody else's game.
 */
export const MIN_CONFIDENCE = 5;

/**
 * A card may only claim a game is "on" a channel at these odds or better.
 * The rest still reach the rail, folded under "Less likely" with their
 * number (SportsTheater).
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
function carries(want: Set<string>, channel: Set<string>, clubs?: Clubs): MatchKind | null {
  if (![...want].every((w) => channel.has(w))) return null;
  const extras = [...channel].filter((w) => !want.has(w));
  // A qualifier is not doubt, it is a different channel. Rejected outright,
  // whatever else agrees.
  if (extras.some(isQualifier)) return null;
  // The same name, its acronym, or the name with shelf words ("AT&T",
  // "The", "Event Only").
  if (extras.every((w) => NOISE.has(w))) return "network";
  // A lone timezone suffix is the same network an hour later, not a sibling.
  // See FEEDS: one extra only, so a two-word regional brand stays loose.
  if (extras.length === 1 && FEEDS.has(extras[0])) return "network";
  // This game's own club. Either everything extra is its name ("Texas"
  // for the Texas Rangers), or the channel carries its nickname among
  // other words ("Spectrum ... Dodgers": the owner's brand rides along).
  // Both pairs came off the dump, where they read as loose: the right
  // channel, under the card's bar.
  if (
    clubs &&
    (extras.every((w) => NOISE.has(w) || clubs.words.has(w)) ||
      clubs.nicknames.some((n) => n.every((w) => extras.includes(w))))
  )
    return "team";
  return "loose";
}

/**
 * The clubs in a game, as the words a channel might name them by.
 *
 * `words` is everything in both full names ("texas", "rangers"); an extra
 * made only of these is the club. `nicknames` are the clubs' own names
 * ("dodgers", "crimson tide"), each counted only whole, which are specific
 * enough to count among other words; a city is not ("los angeles" is two
 * clubs in every league).
 */
export interface Clubs {
  words: Set<string>;
  nicknames: string[][];
}

export function clubsOf(teams: { name: string; shortName?: string }[]): Clubs {
  const words = new Set<string>();
  const nicknames: string[][] = [];
  for (const t of teams) {
    for (const w of tokens(t.name)) words.add(w);
    const own = nicknameOf(t.name, t.shortName);
    if (own.length > 0) nicknames.push(own);
  }
  return { words, nicknames };
}

/**
 * A club's own name, never its place.
 *
 * ESPN's short name is the nickname for a pro club ("Seattle Seahawks",
 * "Seahawks") and the PLACE for a college one ("Washington Huskies",
 * "Washington"; "Mississippi State Bulldogs", "Mississippi St"). Taken as
 * a nickname, the place made other channels sure: on Adam's board
 * (2026-10-02) "US: NBC Sports Washington" scored 85 for USC at Washington
 * on NBC, and "MO | St. Joseph | ABC KQTV" 85 for Alabama at Mississippi St
 * on ABC, through "st". So the nickname is the short name only when it
 * ENDS the full one, and the rest of the full name when the short one
 * STARTS it. Neither (a country, "Man City"): no nickname.
 */
export function nicknameOf(name: string, short?: string): string[] {
  if (!short) return [];
  // "St" and "State" are one word here: ESPN shortens the one to the other.
  const words = (s: string) => [...tokens(s)].map((w) => (w === "st" ? "state" : w));
  const full = words(name);
  const own = words(short);
  if (own.length === 0 || own.length >= full.length) return [];
  if (own.every((w, i) => full[full.length - own.length + i] === w)) return own;
  if (own.every((w, i) => full[i] === w)) return full.slice(own.length);
  return [];
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
  /** The name's own words, before any expansion (GENERIC's rule). */
  raw: Set<string>;
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
    const entry: Entry = { channel, ids, raw: new Set(normalize(channel.name).split(" ")) };
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
 * Best odds first. At the same odds, what the match rests on (an own feed,
 * then a club's station, then the bare network), then a visible channel
 * before a hidden one. Stops there for a whole game's list (settle), where
 * the order it was built in comes next.
 */
const bySure = (a: Match, b: Match) =>
  b.confidence - a.confidence ||
  KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
  Number(!!a.hidden) - Number(!!b.hidden);

/** The same, then the better picture: one network's channels. */
const byOdds = (a: Match, b: Match) => bySure(a, b) || rank(a.quality) - rank(b.quality);

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
  /** The game's clubs, when there is a game: see ODDS.team. */
  clubs?: Clubs,
  /** Whether a service's brand may stand in for it (ODDS.stem). */
  stems = true,
): Match[] {
  const also = ALSO[normalize(network)];
  const found = matchOne(network, source, clubs, stems);
  if (!also) return found;
  const best = new Map(found.map((c) => [c.id, c]));
  for (const c of matchOne(also, source, clubs, stems)) {
    const had = best.get(c.id);
    if (!had || had.confidence < c.confidence) best.set(c.id, c);
  }
  return [...best.values()].sort(byOdds);
}

function matchOne(
  network: string,
  source: Tunable[] | Catalog,
  clubs: Clubs | undefined,
  stems: boolean,
): Match[] {
  const want = tokens(network);
  if (want.size === 0) return [];
  // A name that says only what kind of channel it is must meet the channel
  // in its own spelling, not in our expansion of it. See GENERIC.
  const raw = normalize(network).split(" ").filter(Boolean);
  const generic = [...want].every((w) => GENERIC.has(w));
  const catalog = asCatalog(source);
  // Every word must be present, so start from whichever is rarest and the
  // rest of the catalog is never touched. A word that appears in NO channel
  // means nothing can match the full name; it does NOT mean we are done,
  // because the brand pass below may still find something. "MLB.TV" fails
  // here on "tv" and succeeds there on "mlb".
  const candidates = narrow(catalog, want);

  const out: Match[] = [];
  const seen = new Set<string>();
  for (const { channel, ids, raw: own } of candidates ?? []) {
    if (generic && !raw.every((w) => own.has(w))) continue;
    // The strongest of the names it answers to (identities).
    let kind: MatchKind | null = null;
    for (const id of ids) {
      const k = carries(want, id, clubs);
      if (k && (!kind || KIND_RANK[k] < KIND_RANK[kind])) kind = k;
    }
    if (!kind) continue;
    seen.add(channel.id);
    out.push({ ...channel, confidence: ODDS[kind], kind });
  }

  // Second pass on the brand alone, for the games whose only listed
  // broadcaster is a streaming product. Capped at the stem score however
  // cleanly the shortened name happens to fit: the doubt is in having
  // dropped a word, not in what is left.
  const brand = stems ? stem(want) : null;
  if (brand) {
    for (const { channel, ids } of narrow(catalog, brand) ?? []) {
      if (seen.has(channel.id)) continue;
      if (!ids.some((id) => carries(brand, id) !== null)) continue;
      seen.add(channel.id);
      out.push({ ...channel, confidence: ODDS.stem, kind: "stem" });
    }
  }
  return out.sort(byOdds);
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
    out.push({ ...channel, confidence: ODDS.own, kind: "own" });
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
 * returned BOTH feeds for BOTH legs, each at full odds. That is a wrong
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
 * The rail's floor, the hidden-folder rule and the order, over one list.
 *
 * HIDDEN FOLDERS ARE A FALLBACK. Adam's rule: if anything visible carries
 * the game at the card's bar, that is the whole answer. Only when nothing
 * does, a hidden channel comes through, and only if its odds beat every
 * visible one's. `US: NBC` hidden and `NBC Sports Bay Area` visible at 15:
 * the hidden NBC leads, and the visible guess stays behind it. A hidden
 * channel naming the fixture stays hidden beside a visible network at 90;
 * it used to lead the card and autoplay from a folder the viewer muted.
 *
 * THE ONE EXCEPTION (Adam, 2026-10-02): a club's own station at the card's
 * bar comes through, hidden folder or not. His "NFL Teams" folder is 39
 * market stations, all hidden, and a channel naming the game's own team is
 * no clutter. Beside a visible own feed too, as a second way in.
 *
 * ORDER: bySure, which the theater's fold, the card and autoplay all read.
 * The sort is stable, so at equal odds and kind the order the list was
 * built in survives: the game's own feeds best picture first, then the
 * schedule's networks in its order (national feed before regional), each
 * network's best picture first.
 */
function settle(all: Match[]): Match[] {
  const kept = all.filter((c) => c.confidence >= MIN_CONFIDENCE);
  let top = 0;
  for (const c of kept) if (!c.hidden && c.confidence > top) top = c.confidence;
  const fallback = top < CARD_CONFIDENCE;
  const shown = (c: Match) =>
    !c.hidden ||
    (c.kind === "team" && c.confidence >= CARD_CONFIDENCE) ||
    (fallback && c.confidence > top);
  return kept.filter(shown).sort(bySure);
}

/**
 * Every channel of yours for one game, in the order the theater's rail
 * draws it and autoplay takes its top.
 *
 * Channels that name this fixture, then the networks the schedule listed
 * (matchGame), settled as one list: the card counts the part at its bar,
 * the rail shows all of it and the pairing probe reports it. One function,
 * so the three cannot disagree about which channels a game has.
 */
export function railFor(
  broadcasts: string[],
  source: Tunable[] | Catalog,
  /** The two clubs and the kick-off, for a game that has them. A race or a
   * tournament resolves off its broadcasts alone. */
  fixture?: {
    home: { name: string; shortName?: string };
    away: { name: string; shortName?: string };
    start: Date;
  },
  /** The other games on each network at this kick-off (sharing.ts). */
  shared?: Shared,
): Match[] {
  const catalog = asCatalog(source);
  const named = fixture
    ? matchEvent([fixture.home.name, fixture.away.name], fixture.start, catalog)
    : [];
  const seen = new Set(named.map((c) => c.id));
  const clubs = fixture ? clubsOf([fixture.home, fixture.away]) : undefined;
  const rail = (stems: boolean) =>
    settle([
      ...named,
      ...matchGame(broadcasts, catalog, clubs, stems, shared).filter((c) => !seen.has(c.id)),
    ]);
  // A league's channel for a game listed on its service (ODDS.stem) only
  // when nothing else carries the game. Adam marked "US: MLB Network" and
  // "US: The MLB Channel" wrong three times in two games (2026-09-25), each
  // time beside the game's own MLB feeds; where nothing else carries a game
  // it is still the one thing to try.
  const sure = rail(false);
  return sure.length > 0 ? sure : rail(true);
}

/**
 * How many games each network has at one kick-off, keyed by its normalized
 * name. A network missing has just this one.
 */
export type Shared = Readonly<Record<string, number>>;

/**
 * Every channel of yours carrying a game, given the networks the schedule
 * named for it.
 *
 * THE SPLIT. A network's own channel shows one game at a time, so with N
 * games on that network at this kick-off its odds are ODDS.network over N.
 * A club's station and a game's own feed point at one game and never
 * split. Adam's board, 2026-10-02: four CBS games at noon, and "CBS 4K UHD
 * (Event Only)" matched all four at full marks.
 *
 * De-duplicated by channel id at its best odds, so a channel two of the
 * listed networks reach counts once.
 */
export function matchGame(
  networks: string[],
  source: Tunable[] | Catalog,
  /** The game's clubs, so a club's own channel counts as theirs. */
  clubs?: Clubs,
  /** Whether a service's brand may stand in for it (ODDS.stem). */
  stems = true,
  shared?: Shared,
): Match[] {
  const catalog = asCatalog(source);
  const at = new Map<string, number>();
  const all: Match[] = [];
  for (const network of networks) {
    const n = shared?.[normalize(network)] ?? 1;
    for (const found of matchNetwork(network, catalog, clubs, stems)) {
      const c =
        found.kind === "network" && n > 1
          ? { ...found, confidence: Math.round(found.confidence / n) }
          : found;
      const i = at.get(c.id);
      if (i === undefined) {
        at.set(c.id, all.length);
        all.push(c);
      } else if (all[i].confidence < c.confidence) all[i] = c;
    }
  }
  return settle(all);
}

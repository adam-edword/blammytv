import { COUNTRY, tokens } from "../sports/matcher";
import type { GuideChannel } from "./model";
import { loose } from "./xmltv";

/**
 * What the Fix guide dialog lists, and in what order (guideFix.ts is what it
 * saves).
 *
 * A guide holds thousands of channels and the one you want is usually named
 * almost like yours, so the list opens on the closest names rather than the
 * first alphabetical ones. "Closest" is the sports matcher's own word set
 * (`tokens`), which already drops the country prefix and the quality badge
 * a playlist adds to a name and the guide never has: "US: ESPN 2 FHD" and
 * "ESPN 2" are the same two words.
 *
 * EVENT CHANNELS are named for what is on them: "NFHS Network 01:
 * Portsmouth Abbey School Girls Ice Hockey @ 11 Oct 08:00 AM ET". Counting
 * every shared word offered "Sportsnet+ 01: Sportsnet Central: Oct. 11 @ 12
 * Oct 05:00 AM ET" first, because the words they share are 01, 11, Oct, AM
 * and ET (Adam, v0.11.37). So a name is read in two parts, the STATION (what
 * comes before its first ":" or " @ ") and the rest, the station's words
 * count first, and date and time words count for nothing in either.
 */

/** How many rows the dialog draws. A bare letter matches thousands. */
export const FIX_LIST_CAP = 50;

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** A guide channel, with what ranking it needs worked out once. */
export interface Candidate {
  channel: GuideChannel;
  /** Lower-cased name and id, what a search looks in. */
  hay: string;
  low: string;
  /** Its words, read the first time a ranking asks. */
  parts?: NameParts;
}

/** A name's words, in the two parts the ranking weighs. */
export interface NameParts {
  /** The words before the first ":" or " @ ", or all of them. */
  station: Set<string>;
  /** The words after it, which is the event on an event channel. */
  rest: Set<string>;
  /** How many words in all, for "fewest left over". */
  size: number;
}

/**
 * Where a name's station ends: its first ":" (not one inside a clock time
 * like 08:00) or its first " @ ", whichever comes first. A name with neither
 * is all station. The provider's country prefix is not the station: "US:
 * ESPN" is the station ESPN, which is why it goes before the cut is looked
 * for.
 */
export function splitStation(name: string): { station: string; rest: string } {
  const bare = name.replace(COUNTRY, "");
  const colon = bare.search(/(?<!\d):|:(?!\d)/);
  const at = bare.indexOf(" @ ");
  const cut = [colon, at].filter((i) => i > 0);
  if (cut.length === 0) return { station: bare, rest: "" };
  const first = Math.min(...cut);
  return { station: bare.slice(0, first), rest: bare.slice(first + (first === at ? 3 : 1)) };
}

const MONTH =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const WEEKDAY =
  "(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";
/** ET, PT, CT, MT and their standard and daylight forms, and the few
 * European ones a schedule names. */
const ZONE = "(?:[ecmp][sd]?t|gmt|utc|bst|cet|cest|eet)";
const DATE_AND_TIME = [
  // A clock time: 08:00, 8:30 PM, 8PM.
  /\b\d{1,2}(?::\d{2}){1,2}(?:\s*[ap]\.?m\b)?|\b\d{1,2}\s*[ap]\.?m\b/gi,
  // A day of the month beside its month: "Oct. 11", "11 Oct", "12th October".
  new RegExp(`\\b${MONTH}\\b\\.?\\s*\\d{1,2}(?:st|nd|rd|th)?\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s*${MONTH}\\b\\.?`, "gi"),
  // The names that are left: months, weekdays, am and pm, time zones.
  new RegExp(`\\b(?:${MONTH}|${WEEKDAY}|${ZONE}|[ap]\\.?m)\\b\\.?`, "gi"),
];

/**
 * A name's words as `tokens` reads them, less what says WHEN and not WHAT:
 * months and weekdays (short forms too, with or without the dot), am and
 * pm, time zones, clock times, and a number of one or two digits beside a
 * month. Every event channel carries them, so they say nothing about which
 * channel it is.
 */
export function nameWords(text: string): Set<string> {
  let clean = text;
  for (const re of DATE_AND_TIME) clean = clean.replace(re, " ");
  return tokens(clean);
}

function partsOf(name: string): NameParts {
  const { station, rest } = splitStation(name);
  const s = nameWords(station);
  const r = nameWords(rest);
  return { station: s, rest: r, size: new Set([...s, ...r]).size };
}

export function candidates(list: readonly GuideChannel[]): Candidate[] {
  return list.map((channel) => {
    const low = channel.name.toLowerCase();
    return { channel, low, hay: `${low} ${channel.id.toLowerCase()}` };
  });
}

/**
 * The rows to show for `query`, and how many more there would be.
 *
 * With nothing typed, every channel, the closest names to `ownName` first:
 * most words of the station in common, then most words of the rest, then
 * fewest words that are not in common ("ESPN" before "ESPN 2" for a channel
 * called ESPN), then by name. A name with no ":" or " @ " is all station,
 * so an ordinary name ranks on its words as it always did. Channels with no
 * word in common follow, by name.
 *
 * With a query, only the channels whose name or id holds every word of it,
 * the ones whose name starts with it first, then a word of the name, then
 * anywhere, and the same closeness inside each.
 */
export function rankGuideChannels(
  all: readonly Candidate[],
  ownName: string,
  query: string,
  cap = FIX_LIST_CAP,
): { rows: GuideChannel[]; more: number } {
  const own = partsOf(ownName);
  const q = query.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  const scored: { c: Candidate; tier: number; station: number; rest: number; extras: number }[] = [];
  for (const c of all) {
    if (terms.some((t) => !c.hay.includes(t))) continue;
    const parts = (c.parts ??= partsOf(c.channel.name));
    let station = 0;
    for (const w of parts.station) if (own.station.has(w)) station++;
    let rest = 0;
    for (const w of parts.rest) if (own.rest.has(w)) rest++;
    scored.push({
      c,
      tier: !q || c.low.startsWith(q) ? 0 : c.low.includes(` ${q}`) ? 1 : 2,
      station,
      rest,
      extras: station + rest ? parts.size - station - rest : 0,
    });
  }
  scored.sort(
    (a, b) =>
      a.tier - b.tier ||
      b.station - a.station ||
      b.rest - a.rest ||
      a.extras - b.extras ||
      collator.compare(a.c.channel.name, b.c.channel.name),
  );
  return {
    rows: scored.slice(0, cap).map((s) => s.c.channel),
    more: Math.max(0, scored.length - cap),
  };
}

/** Where a channel stands with its guide, for the line under the dialog's
 * title. A fix wins over what the provider gave. */
export type Standing =
  | { kind: "fixed"; id: string; name: string }
  | { kind: "matched"; id: string; name: string }
  | { kind: "none" };

/**
 * `fixedId` is the guide channel the user chose, `epgId` the one the
 * provider gave. The provider's counts as matched when the guide declares
 * it, to the letter or as the parse reads it (case and spacing folded,
 * xmltv.ts#loose): that is the rule the programmes were matched by.
 */
export function guideStanding(
  list: readonly GuideChannel[],
  epgId: string | undefined,
  fixedId: string | undefined,
): Standing {
  if (fixedId) {
    const hit = list.find((g) => g.id === fixedId);
    return { kind: "fixed", id: fixedId, name: hit?.name ?? fixedId };
  }
  if (epgId) {
    const key = loose(epgId);
    const hit = list.find((g) => g.id === epgId) ?? list.find((g) => loose(g.id) === key);
    if (hit) return { kind: "matched", id: hit.id, name: hit.name };
  }
  return { kind: "none" };
}

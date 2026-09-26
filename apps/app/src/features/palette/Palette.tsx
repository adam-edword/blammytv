import { useMemo, useState, type ReactNode } from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { Dialog, DialogContent, DialogTitle } from "../../components/ui/dialog";
import { ChannelLogo } from "../../ui/ChannelLogo";
import { EYEBROW } from "../../ui/eyebrow";
import { Kbd } from "../../ui/Kbd";
import { QualityBadge } from "../../ui/QualityBadge";
import {
  DiscoverIcon,
  GuideIcon,
  LibraryIcon,
  MultiviewIcon,
  RecentsIcon,
  SearchIcon,
  SettingsIcon,
  SportsIcon,
  StreamIcon,
} from "../../ui/icons";
import { formatClock } from "../../lib/time";
import { loadClockFormat } from "../settings/clockFormat";
import { peekLive } from "../live/source";
import { channelIndex, searchChannels } from "../live/mvGrid";
import { airing } from "../live/mvTile";
import { loadRecents } from "../live/recents";
import type { Channel, LiveData, Programme } from "../live/model";
import { peekVod } from "../stream/source";
import { loadLists } from "../stream/lists";
import type { VodItem } from "../stream/model";
import type { LiveTab, StreamTab } from "../../app/AppHeader";
import { lastInputWasKey } from "../live/mvMotion";

/**
 * The app's palette (plan 019, K11): multi-view's channel picker, grown to
 * the whole app, which is what ROADMAP has asked for since plan 017 ("its
 * first shape"), and the Ctrl+K channel search the Live slate ranked first.
 *
 * Channels, what is on later, films and series, and places to go, from one
 * field. Ctrl+K anywhere, or the round search button beside Settings.
 *
 * Built exactly as the picker is: Base UI's Autocomplete rendered `inline
 * open` inside the app's Radix Dialog, so the list, its keyboard (arrows
 * move, Enter takes, Escape closes) and its screen-reader wiring are the
 * library's. It wears the picker's own classes, so it is the same object.
 *
 * It reads what the app already has in hand (the last live load, the last
 * catalog, your lists) and fetches nothing: a palette that waits on the
 * network is a search page.
 */

export type GoTarget =
  | { kind: "live"; tab: LiveTab }
  | { kind: "stream"; tab: StreamTab }
  | { kind: "settings"; tab: "general" | "customize" };

type Row =
  | { key: string; kind: "channel"; label: string; channel: Channel }
  | { key: string; kind: "later"; label: string; channel: Channel; prog: Programme }
  | { key: string; kind: "title"; label: string; item: VodItem; saved: boolean }
  | { key: string; kind: "go"; label: string; sub: string; icon: ReactNode; to: GoTarget };

interface Section {
  value: string;
  items: Row[];
}

const CHANNELS = 6;
const LATER = 4;
const TITLES = 6;
/** What "On later" looks ahead over. */
const LATER_H = 24;

export function Palette({
  open,
  onOpenChange,
  hasLive,
  hasStream,
  onChannel,
  onTitle,
  onGo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether there is a playlist, so the Live places and channels exist. */
  hasLive: boolean;
  /** Whether there is a manifest, so Stream's places and titles exist. */
  hasStream: boolean;
  onChannel: (channelId: string) => void;
  onTitle: (item: VodItem) => void;
  onGo: (to: GoTarget) => void;
}) {
  const [query, setQuery] = useState("");
  const [clock] = useState(loadClockFormat);
  // Every opening starts from an empty field, as the picker's does. And,
  // as the picker's does, opened or closed from the keyboard it comes and
  // goes at once: its closing layer would otherwise hold the next Escape
  // for its 150ms fade, and after Enter on Settings that Escape is meant
  // for Settings.
  const [wasOpen, setWasOpen] = useState(open);
  const [instant, setInstant] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    setInstant(lastInputWasKey());
    if (open) setQuery("");
  }

  const places = useMemo((): Row[] => {
    const go = (label: string, sub: string, icon: ReactNode, to: GoTarget): Row => ({
      key: `go:${label}`,
      kind: "go",
      label,
      sub,
      icon,
      to,
    });
    return [
      ...(hasLive
        ? [
            go("Guide", "Live TV", <GuideIcon size={16} />, { kind: "live", tab: "guide" }),
            go("Multi-view", "Live TV", <MultiviewIcon size={16} />, { kind: "live", tab: "multiview" }),
            go("Sports", "Live TV", <SportsIcon size={16} />, { kind: "live", tab: "sports" }),
          ]
        : []),
      ...(hasStream
        ? [
            go("Stream", "Movies and shows", <StreamIcon size={16} />, { kind: "stream", tab: "home" }),
            go("Discover", "Movies and shows", <DiscoverIcon size={16} />, { kind: "stream", tab: "discover" }),
            go("Library", "Movies and shows", <LibraryIcon size={16} />, { kind: "stream", tab: "mylist" }),
          ]
        : []),
      go("Settings", "General", <SettingsIcon size={16} />, { kind: "settings", tab: "general" }),
      go("Sources", "Settings · General", <SettingsIcon size={16} />, { kind: "settings", tab: "general" }),
      go("Customize", "Settings", <SettingsIcon size={16} />, { kind: "settings", tab: "customize" }),
    ];
  }, [hasLive, hasStream]);

  const sections = useMemo((): Section[] => {
    if (!open) return [];
    const live: LiveData | null = hasLive ? peekLive() : null;
    const q = query.trim().toLowerCase();
    const out: Section[] = [];
    if (!q) {
      // Before typing: where you were, and where you can go.
      if (live) {
        const byId = channelIndex(live, false);
        const recent = loadRecents()
          .map((id) => byId.get(id))
          .filter((c): c is Channel => !!c)
          .slice(0, 5)
          .map((c): Row => ({ key: `c:${c.id}`, kind: "channel", label: c.name, channel: c }));
        if (recent.length) out.push({ value: "Recent", items: recent });
      }
      out.push({ value: "Go to", items: places });
      return out;
    }

    if (live) {
      const found = searchChannels(live, q, CHANNELS).map(
        (c): Row => ({ key: `c:${c.id}`, kind: "channel", label: c.name, channel: c }),
      );
      if (found.length) out.push({ value: "Channels", items: found });

      // On later: programmes by that name, starting in the next day, the
      // soonest first.
      const now = Date.now();
      const until = now + LATER_H * 3600_000;
      const later: Row[] = [];
      const byId = channelIndex(live, false);
      for (const [id, progs] of live.programmes) {
        const channel = byId.get(id);
        if (!channel) continue;
        for (const p of progs) {
          const t = p.start.getTime();
          if (t <= now || t > until) continue;
          if (p.title.toLowerCase().includes(q))
            later.push({ key: `p:${id}:${t}`, kind: "later", label: p.title, channel, prog: p });
        }
      }
      later.sort((a, b) =>
        a.kind === "later" && b.kind === "later" ? a.prog.start.getTime() - b.prog.start.getTime() : 0,
      );
      if (later.length) out.push({ value: "On later", items: later.slice(0, LATER) });
    }

    if (hasStream) {
      // The catalog you have loaded, then anything in your lists it lacks.
      // Titles that start with what you typed come first.
      const seen = new Set<string>();
      const saved = new Set<string>();
      const pool: VodItem[] = [];
      for (const l of loadLists())
        for (const e of l.entries) {
          saved.add(e.id);
        }
      for (const it of peekVod()?.items.values() ?? []) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        pool.push(it);
      }
      for (const l of loadLists())
        for (const e of l.entries) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          pool.push({
            id: e.id,
            title: e.title,
            kind: e.kind,
            year: e.year,
            poster: e.poster,
            backdrop: e.backdrop,
            logo: e.logo,
            rating: e.rating,
            runtimeMin: e.runtimeMin,
            genres: [],
            cast: [],
            seasons: [],
          });
        }
      const hits = pool
        .filter((it) => it.title.toLowerCase().includes(q))
        .sort((a, b) => {
          const pa = a.title.toLowerCase().startsWith(q) ? 0 : 1;
          const pb = b.title.toLowerCase().startsWith(q) ? 0 : 1;
          return pa - pb;
        })
        .slice(0, TITLES)
        .map((it): Row => ({ key: `t:${it.id}`, kind: "title", label: it.title, item: it, saved: saved.has(it.id) }));
      if (hits.length) out.push({ value: "Films and series", items: hits });
    }

    const go = places.filter(
      (r) => r.label.toLowerCase().includes(q) || (r.kind === "go" && r.sub.toLowerCase().includes(q)),
    );
    if (go.length) out.push({ value: "Go to", items: go });
    return out;
  }, [open, query, hasLive, hasStream, places]);

  const choose = (row: Row) => {
    onOpenChange(false);
    if (row.kind === "channel" || row.kind === "later") onChannel(row.channel.id);
    else if (row.kind === "title") onTitle(row.item);
    else onGo(row.to);
  };

  const now = new Date();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="mvpick palette top-[96px] translate-y-0 gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[640px]"
        style={instant ? { animation: "none" } : undefined}
      >
        <DialogTitle className="sr-only">Search BlammyTV</DialogTitle>
        <Autocomplete.Root
          open
          inline
          mode="none"
          items={sections}
          value={query}
          onValueChange={setQuery}
          itemToStringValue={(r: Row) => r.label}
          autoHighlight="always"
          keepHighlight
        >
          <div className="mvpick__head">
            <SearchIcon size={19} aria-hidden />
            <Autocomplete.Input
              className="mvpick__input"
              placeholder="Channels, films and series, places"
              aria-label="Search BlammyTV"
            />
            <span className="mvpick__target">Everything</span>
          </div>

          <div className="mvpick__body">
            <Autocomplete.Empty>
              <p className="mvpick__empty">Nothing matches that.</p>
            </Autocomplete.Empty>
            <Autocomplete.List>
              {(section: Section) => (
                <Autocomplete.Group key={section.value} items={section.items} className="mvpick__group">
                  <Autocomplete.GroupLabel className={`mvpick__sec ${EYEBROW}`}>{section.value}</Autocomplete.GroupLabel>
                  <Autocomplete.Collection>
                    {(row: Row) => (
                      <Autocomplete.Item
                        key={row.key}
                        value={row}
                        onClick={() => choose(row)}
                        className="mvpick__row"
                        data-kind={row.kind}
                      >
                        <PaletteRow row={row} now={now} clock={clock} />
                      </Autocomplete.Item>
                    )}
                  </Autocomplete.Collection>
                </Autocomplete.Group>
              )}
            </Autocomplete.List>
          </div>

          <div className="mvpick__foot">
            <span>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              move
            </span>
            <span>
              <Kbd>↵</Kbd>
              open
            </span>
            <span>
              <Kbd>esc</Kbd>
              close
            </span>
            <span className="mvpick__left">
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
              anywhere
            </span>
          </div>
        </Autocomplete.Root>
      </DialogContent>
    </Dialog>
  );
}

function PaletteRow({
  row,
  now,
  clock,
}: {
  row: Row;
  now: Date;
  clock: ReturnType<typeof loadClockFormat>;
}) {
  if (row.kind === "channel") {
    const c = row.channel;
    const on = airing(peekLive()?.programmes.get(c.id), now).now;
    const sub = [
      c.number != null ? String(c.number) : null,
      on?.title ?? null,
      on ? `until ${formatClock(on.end, clock)}` : null,
    ].filter(Boolean);
    return (
      <>
        <ChannelLogo name={c.name} logo={c.logo} size={34} />
        <span className="mvpick__meta">
          <span className="mvpick__name">
            <span className="mvpick__nametext">{c.name}</span>
            {c.quality && <QualityBadge quality={c.quality} />}
          </span>
          {sub.length > 0 && <span className="mvpick__sub">{sub.join(" · ")}</span>}
        </span>
      </>
    );
  }
  if (row.kind === "later") {
    return (
      <>
        <span className="mvpick__fillicon" aria-hidden>
          <RecentsIcon size={16} />
        </span>
        <span className="mvpick__meta">
          <span className="mvpick__name">
            <span className="mvpick__nametext">{row.prog.title}</span>
          </span>
          <span className="mvpick__sub">
            {row.channel.name} · {formatClock(row.prog.start, clock)} – {formatClock(row.prog.end, clock)}
          </span>
        </span>
      </>
    );
  }
  if (row.kind === "title") {
    const it = row.item;
    const sub = [
      it.kind === "series" ? "Series" : "Movie",
      it.year ? String(it.year) : null,
      it.runtimeMin ? `${it.runtimeMin} min` : null,
      row.saved ? "in your Library" : null,
    ].filter(Boolean);
    return (
      <>
        <span className="palette__poster" aria-hidden>
          {it.poster ? <img src={it.poster} alt="" loading="lazy" /> : it.title.slice(0, 1)}
        </span>
        <span className="mvpick__meta">
          <span className="mvpick__name">
            <span className="mvpick__nametext">{it.title}</span>
          </span>
          <span className="mvpick__sub">{sub.join(" · ")}</span>
        </span>
      </>
    );
  }
  return (
    <>
      <span className="mvpick__fillicon" aria-hidden>
        {row.icon}
      </span>
      <span className="mvpick__meta">
        <span className="mvpick__name">
          <span className="mvpick__nametext">{row.label}</span>
        </span>
        <span className="mvpick__sub">{row.sub}</span>
      </span>
    </>
  );
}

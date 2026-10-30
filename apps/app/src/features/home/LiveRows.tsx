import { useCallback } from "react";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { formatClock, formatWhen } from "../../lib/time";
import { ChannelLogo } from "../../ui/ChannelLogo";
import { ChevronIcon } from "../../ui/icons";
import { QualityBadge } from "../../ui/QualityBadge";
import { RowScroller } from "../../ui/RowScroller";
import { requestWatchInPlayer } from "../live/multiviewEntry";
import { formatDuration, formatSize } from "../recordings/format";
import { requestPlayRecording } from "../recordings/playRequest";
import type { Recording } from "../recordings/store";
import type { ClockFormat } from "../settings/clockFormat";
import { GameCard } from "../sports/GameCard";
import { requestOpenGame } from "../sports/gameRequest";
import { isFixture, type Fixture, type Game } from "../sports/model";
import { gamesOfSport, sportsToday, type ChannelCard } from "./liveData";

/**
 * Home's live rows (plan 033, phase 2): On Now, Recent Channels, Today's
 * Games and Recordings, drawn from useLiveRows.ts. A row with nothing in it
 * draws nothing.
 *
 * The cards are the app's own. A channel is the Guide's identity (its logo on
 * the plate, its quality badge) on the Continue Watching tile (ui.css `.tile`:
 * a 16:9 picture, progress under it, the caption under that), because no
 * existing channel card is a tile: the Guide's sits in a 220px column and
 * Multi-view's picker row is a line in a list. Its caption borrows the
 * picker's words ("Until 9:30 PM"). A game is the Sports board's own wide
 * card (GameCard), and a recording the recordings list's own row.
 */

/** On Now and Recent Channels: the same tile, a channel and what is on it. */
export function ChannelRow({ title, cards, clock }: { title: string; cards: readonly ChannelCard[]; clock: ClockFormat }) {
  if (cards.length === 0) return null;
  return (
    <section className="media-row" data-row="channels">
      <h3 className="media-row__title">{title}</h3>
      <RowScroller>
        {cards.map((c) => (
          <ChannelTile key={c.channel.id} card={c} clock={clock} />
        ))}
      </RowScroller>
    </section>
  );
}

function ChannelTile({ card, clock }: { card: ChannelCard; clock: ClockFormat }) {
  const { channel, now: on, next, pct } = card;
  const line = on ? `${on.title} · Until ${formatClock(on.end, clock)}` : next ? `Starts ${formatClock(next.start, clock)}` : "";
  return (
    <button
      type="button"
      className="tile chan-tile"
      data-channel={channel.id}
      aria-label={[channel.name, on?.title].filter(Boolean).join(", ")}
      onClick={() => requestWatchInPlayer(channel.id)}
    >
      <span className="tile__pic chan-tile__pic">
        <ChannelLogo name={channel.name} logo={channel.logo} size={72} lazy />
        {channel.quality && (
          <span className="chan-tile__quality">
            <QualityBadge quality={channel.quality} />
          </span>
        )}
        <span className="tile__scrim" aria-hidden />
      </span>
      {pct !== null && (
        <span className="tile__track chan-tile__track" aria-hidden>
          <i style={{ width: `${Math.round(pct * 100)}%` }} />
        </span>
      )}
      <span className="chan-tile__text">
        <span className="stream-card__name">{channel.name}</span>
        {line && <span className="stream-card__meta">{line}</span>}
        {on && next && <span className="stream-card__meta">Next: {next.title}</span>}
      </span>
    </button>
  );
}

/** The menu's value for every sport (a sport's own value is its catalog key). */
const ALL = "all";

/** Today's Games: the Sports board's own wide cards, opened the way it opens
 * them. A game too far out to open is disabled by the card itself.
 *
 * A menu beside the title picks the sport (All Sports, or one that has games
 * today, with its count). `sport` is the one saved on the row; one with no
 * games today shows all of them and reads All Sports, without being unsaved. */
export function GamesRow({
  title,
  games,
  sport,
  onSport,
}: {
  title: string;
  games: readonly Fixture[];
  sport?: string;
  onSport: (sport?: string) => void;
}) {
  const open = useCallback((g: Game) => {
    if (isFixture(g)) requestOpenGame(g);
  }, []);
  if (games.length === 0) return null;
  const sports = sportsToday(games);
  const shown = sports.find((s) => s.key === sport);
  const label = shown?.name ?? "All Sports";
  return (
    <section className="media-row homegames" data-row="games" data-sport={shown?.key}>
      <div className="homegames__head">
        <h3 className="media-row__title">{title}</h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" type="button" className="homegames__sport" aria-label={`Sport, ${label}`}>
              {label}
              <ChevronIcon size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup value={shown?.key ?? ALL} onValueChange={(v) => onSport(v === ALL ? undefined : v)}>
              <DropdownMenuRadioItem value={ALL}>All Sports</DropdownMenuRadioItem>
              {sports.map((s) => (
                <DropdownMenuRadioItem key={s.key} value={s.key}>
                  {s.name} ({s.count})
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <RowScroller>
        {gamesOfSport(games, shown?.key).map((g) => (
          <GameCard key={g.id} game={g} onOpen={open} />
        ))}
      </RowScroller>
    </section>
  );
}

/** Recordings, newest first: the recordings list's row (title, channel and
 * when, length and size) with its Play, which is Library's Play. */
export function RecordingsRow({
  title,
  recordings,
  now,
  clock,
}: {
  title: string;
  recordings: readonly Recording[];
  now: Date;
  clock: ClockFormat;
}) {
  if (recordings.length === 0) return null;
  return (
    <section className="media-row" data-row="recordings">
      <h3 className="media-row__title">{title}</h3>
      <RowScroller>
        {recordings.map((r) => (
          <div key={r.id} className="rec-row home-rec" data-id={r.id}>
            <div className="rec-row__main">
              <span className="rec-row__title">{r.programme ?? r.channel}</span>
              <span className="rec-row__sub">
                {r.programme ? `${r.channel} · ` : ""}
                {formatWhen(new Date(r.startedAt), now, clock)}
              </span>
              <span className="rec-row__meta">
                {formatDuration((r.endedAt ?? now.getTime()) - r.startedAt)} · {formatSize(r.bytes)}
              </span>
            </div>
            <Button variant="outline" size="sm" type="button" onClick={() => requestPlayRecording(r.id)}>
              Play
            </Button>
          </div>
        ))}
      </RowScroller>
    </section>
  );
}

import { memo } from "react";
import Tilt from "react-parallax-tilt";
import { REDUCED_MOTION } from "../../lib/reducedMotion";
import type { Field } from "./model";
import { dateRange } from "./golf";
import { league } from "./leagues";

/**
 * A golf leaderboard, as one card (plan 010 #10).
 *
 * Adam's layout, and the shape is the race card's with the numbers golf
 * actually has: an ordered list of people, a flag each, and the figure that
 * decides the order down the right. Five rows, because a golf field is 57
 * to 147 deep and the cut makes the top few less decisive than a podium —
 * five is enough to see who is in it without pretending the card is the
 * leaderboard.
 *
 * WHAT THE HEADER SAYS, and both halves are answers to questions asked of
 * the data rather than choices:
 *
 * - LEFT is the league, because there is nothing else. A golf event carries
 *   no course, no venue and no art of its own; four image URLs exist in the
 *   entire payload and two of them are betting logos.
 * - RIGHT is THRU, not PAR. Par is the obvious thing to put there and the
 *   source does not have it — no course object at all, anywhere. Thru is
 *   derived (see golf.ts) and is the one number that moves while you watch,
 *   which makes it the better use of the corner anyway.
 *
 * THE SCORE IS A STRING and stays one. "-25", "E", "+3" is golf's own unit;
 * formatting it ourselves would mean parsing a number out of a notation
 * that already reads correctly.
 */
export const GolfCard = memo(function GolfCard({ round }: { round: Field }) {
  const upcoming = round.state === "pre";
  // The tour's mark, from the CATALOG rather than the response: a league
  // asked about an off-season answers 200 with no `leagues` block at all,
  // and the mark is the whole of this card's face.
  const mark = league(round.leagueKey)?.logo;
  return (
    /* A DIV, not a button, for the reason the race card next to it is one:
     * nothing opens a leaderboard yet. A <button> with no onClick looks
     * exactly as clickable as the game cards beside it, takes focus and
     * swallows Enter. */
    <div
      className={
        "golfcard" + (round.state === "final" ? " golfcard--final" : "")
      }
      title={`${round.place}${round.session ? ` · ${round.session}` : ""}`}
    >
      <Tilt
        className="golfcard__tilt"
        tiltEnable={!REDUCED_MOTION}
        glareEnable={!REDUCED_MOTION}
        tiltMaxAngleX={2}
        tiltMaxAngleY={2}
        glareMaxOpacity={0.12}
        glareBorderRadius="42.6px"
        scale={1}
      >
        <div className="golfcard__body">
          {!upcoming && (
            <header className="golfcard__top">
            <span className="golfcard__league">{round.league}</span>
            {/* Only while it means something. A finished round is 18 of 18,
              * and "THRU 18" is a fact about the past dressed as news. */}
            {round.thru != null && (
              <span className="golfcard__thru">Thru {round.thru}</span>
            )}
            {round.thru == null && round.state !== "live" && (
              <span className="golfcard__thru golfcard__thru--quiet">
                {round.state === "final" ? "Final" : round.status}
              </span>
            )}
            </header>
          )}

          {upcoming ? (
            /* NOBODY HAS TEED OFF, which is a real state and not an empty
             * one. Three of the five golf leagues return no competitors at
             * all before a tournament starts, and the other two return the
             * whole field tied on "E" — so there is no leaderboard to draw.
             *
             * Adam's face for it: the tour's mark, the dates, the name. The
             * mark is the ONE piece of art golf has — four image URLs exist
             * in the whole payload and two are betting logos — so this is
             * the only card in the feature that can lead with one. */
            <div className="golfcard__ahead">
              {mark && (
                <img
                  className="golfcard__tourmark"
                  src={mark}
                  alt=""
                  loading="lazy"
                />
              )}
              <div className="golfcard__ahead-text">
                <span className="golfcard__ahead-when">
                  {dateRange(round.start, round.end)}
                </span>
                <span className="golfcard__ahead-name">{round.place}</span>
              </div>
            </div>
          ) : (
            <ol className="golfcard__board">
              {round.entrants.slice(0, 5).map((e) => (
                <li className="golfcard__row" key={`${e.place}-${e.name}`}>
                  <span className="golfcard__place">{e.place}</span>
                  {e.mark ? (
                    <img
                      className="golfcard__flag"
                      src={e.mark}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <span className="golfcard__flag" aria-hidden />
                  )}
                  <span className="golfcard__name">{e.name}</span>
                  <span className="golfcard__score">{e.score}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Tilt>
    </div>
  );
});

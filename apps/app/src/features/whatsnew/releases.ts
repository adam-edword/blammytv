/**
 * What's New: the releases the app tells you about, newest first. The words
 * live here, in the app, so a launch after an update shows them with nothing
 * fetched and nothing to fail.
 *
 * Add a release at the TOP when its version ships. The first entry is the one
 * the launch screen shows (whatsNewGate.ts), and the only one that carries the
 * headliners and Also New cards. Every entry is in the Changelog.
 *
 * Copy follows CLAUDE.md: Title Case for names, plain sentences, no em dashes.
 */

/** Text with bold lead-ins, as parts so no HTML string is ever built. */
export type Rich = ReadonlyArray<string | { b: string }>;

export interface ReleaseSection {
  title: string;
  bullets: ReadonlyArray<Rich>;
}

/** The two big cards. `art` names the small drawing WhatsNew.tsx has for each. */
export interface Headliner {
  art: "home" | "record";
  title: string;
  text: string;
}

/** One line of Also New. `icon` names the small glyph WhatsNew.tsx has for each. */
export interface AlsoItem {
  icon: "vlc" | "themes" | "genres" | "search";
  title: string;
  text: string;
}

export interface Release {
  /** major.minor, as in "1.2". Patch releases are not announced. */
  version: string;
  /** Shown beside the version in the Changelog. */
  date?: string;
  sections: ReadonlyArray<ReleaseSection>;
  /** The launch screen's own copy: only the release it announces has it. */
  spotlight?: {
    sub: string;
    headliners: ReadonlyArray<Headliner>;
    also: ReadonlyArray<AlsoItem>;
  };
}

export const RELEASES: readonly Release[] = [
  {
    version: "1.2",
    // TODO(release day): set the date, as 1.0's below ("October 21, 2026").
    sections: [
      {
        title: "Home",
        bullets: [
          [
            { b: "Click the logo for Home" },
            ": Continue Watching, Up Next, your catalogs, On Now, Recent Channels, Today’s Games (pick a sport right on the row), Recordings, Saved lists and Trakt’s Trending and Popular.",
          ],
          [
            { b: "Settings → Home" },
            " puts them in your order, renames them and switches them off. Import Layout takes a layout from Strand.",
          ],
          [{ b: "Startup Tab" }, " can open the app on Home."],
        ],
      },
      {
        title: "Record Live TV",
        bullets: [
          [
            { b: "Record what you’re watching" },
            " or right-click a programme in the Guide to record it later.",
          ],
          [{ b: "Pause and rewind live TV" }, " for hours. LIVE jumps back to now."],
          ["Finished recordings play from Library and can be saved smaller."],
        ],
      },
      {
        title: "Also New",
        bullets: [
          [{ b: "Pop out films and shows in VLC" }, " from Settings → Playback."],
          [{ b: "Themes" }, ": Prism, Velvet and Lagoon."],
          [{ b: "Genres in Discover" }, " open as rows."],
          [{ b: "Ctrl+K finds titles" }, " and can send a search to Discover."],
        ],
      },
    ],
    spotlight: {
      sub: "A Home of your own and live TV you can record, pause and rewind.",
      headliners: [
        {
          art: "home",
          title: "Home",
          text: "Click the logo for one page of everything in the order you set in Settings → Home: Continue Watching, your catalogs, starred channels, today’s games and recordings.",
        },
        {
          art: "record",
          title: "Record Live TV",
          text: "Record what’s on or right-click a programme in the Guide to record it later. Pause live TV and rewind it for hours.",
        },
      ],
      also: [
        { icon: "vlc", title: "Pop Out in VLC", text: "Films and shows can open in VLC and your place still syncs." },
        { icon: "themes", title: "Themes", text: "Prism, Velvet and Lagoon in Settings → Appearance." },
        {
          icon: "genres",
          title: "Genres as Rows",
          text: "Pick a genre in Discover to see what’s popular in it, then mixes like Romantic Comedy.",
        },
        { icon: "search", title: "Find Titles With Ctrl+K", text: "Type a film or show’s name and open it right from there." },
      ],
    },
  },
  {
    version: "1.0",
    date: "October 21, 2026",
    sections: [
      {
        title: "Your Provider’s Movies and Shows",
        bullets: [
          [
            { b: "An Xtream playlist’s movies and shows can be rows in Stream." },
            " Pick the folders you want and change them later in Settings → Sources.",
          ],
          [
            { b: "Discover" },
            " gets each playlist’s movies and shows and its search looks through every folder.",
          ],
        ],
      },
      {
        title: "Sports and Multi-View",
        bullets: [[{ b: "Watch RedZone" }, " when two or more NFL games are on at once."]],
      },
      {
        title: "Signed",
        bullets: [
          [{ b: "The installer and the app are code-signed" }, " so Windows names the publisher."],
        ],
      },
    ],
  },
];

/** The release the launch screen announces. */
export const NEWEST = RELEASES[0];

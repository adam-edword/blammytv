/**
 * Every key the app answers to, for Settings → App → Keyboard Shortcuts (plan
 * 025, P4a). A list now; remapping is for later (D8).
 *
 * WRITTEN FROM THE HANDLERS, not from memory, and each entry says which one
 * (`file:line`, as of v0.11.36; the lines drift, the file and the key do
 * not). Only a key that does something today, in the place its group names.
 * Left out on purpose: arrows in a menu or on a tab strip, Enter and Space on a
 * button, Tab, the arrows that move a column's resize handle, and the fields'
 * own Enter and Escape. Those are how a control works, not shortcuts a person
 * looks up.
 *
 * A LIST WRITTEN DOWN CAN DRIFT from the handlers, so verify-settings-app
 * holds the two together: it presses every key of the player group in a real
 * theater and expects what the entry says to happen.
 *
 * `keys` is a list of ways to do it. Each way is a chord: the keys held
 * together, drawn joined with "+". Two ways are drawn with "or" between. A key
 * is what its chip says ("Space", "Esc", "↑"), not a KeyboardEvent.key.
 */
export interface Shortcut {
  keys: readonly (readonly string[])[];
  what: string;
}

export interface ShortcutGroup {
  /** Where the keys work. */
  title: string;
  /** One line under the title, where the keys need a word of explaining. */
  note?: string;
  shortcuts: readonly Shortcut[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: "Anywhere",
    shortcuts: [
      // App.tsx:190-200. Not while Settings or onboarding is up. ⌘K on a Mac
      // keyboard is the same key, and is not drawn.
      { keys: [["Ctrl", "K"]], what: "Open the palette: go anywhere, find a title or a setting" },
      // AppHeader.tsx:203-231. Takes you to Discover's search box. Not while
      // you are typing in a field, nor while a player is up.
      { keys: [["/"], ["Ctrl", "F"]], what: "Search titles" },
      // App.tsx:355-372 leaves full screen; a dialog, the palette and Settings
      // close on their own Escape (Radix) and keep it from reaching this.
      { keys: [["Esc"]], what: "Close what's open, or leave full screen" },
    ],
  },
  {
    title: "Every player",
    note: "Live TV, Stream and Sports. Not while you are typing in a field.",
    shortcuts: [
      // TheaterOverlay.tsx:1471-1538, the switch in `handleKey`. The document
      // listener over it (1549-1588) stands down for a modal, a field, a
      // modifier, and a button that owns the key.
      { keys: [["Space"], ["K"]], what: "Play or pause" }, // :1472
      { keys: [["M"]], what: "Mute" }, // :1476
      { keys: [["↑"]], what: "Volume up" }, // :1479, 5% and unmutes
      { keys: [["↓"]], what: "Volume down" }, // :1483
      { keys: [["←"]], what: "Back 5 seconds" }, // :1486
      { keys: [["→"]], what: "Forward 5 seconds" }, // :1489
      { keys: [["J"]], what: "Back 10 seconds" }, // :1492
      { keys: [["L"]], what: "Forward 10 seconds" }, // :1495
      { keys: [["F"]], what: "Full screen" }, // :1498
      // :1501, mpv's own keys. Only with a subtitle track on.
      { keys: [["Z"]], what: "Subtitles 0.1s earlier" },
      { keys: [["X"]], what: "Subtitles 0.1s later" },
      // :1523, theater and full screen only.
      { keys: [["I"]], what: "Stats for nerds" },
    ],
  },
  {
    // T and Esc are the player's, and where they take you is the host's:
    // LiveScreen.tsx:751-756 (onExpand, onCollapse). TheaterOverlay.tsx:1511
    // and :1529 are the same for all three, and call what the host gave them.
    title: "Live TV player",
    shortcuts: [
      { keys: [["T"]], what: "Switch between the mini player and theater" },
      { keys: [["Esc"]], what: "Close a menu, leave full screen, then drop to the mini player" },
    ],
  },
  {
    // StreamScreen.tsx:1224-1225 (collapse is stop, back to the catalog),
    // :368 (Esc while a title loads), and TheaterOverlay.tsx:1529, where a
    // title's Esc swaps theater and full screen and never leaves.
    title: "Stream player",
    shortcuts: [
      { keys: [["T"]], what: "Step back: out of full screen, then out of the player" },
      { keys: [["Esc"]], what: "Close a menu, or swap theater and full screen. Cancels a title that is loading" },
    ],
  },
  {
    // SportsTheater.tsx:464 and :477 (collapse is onClose), and :620-645 (Esc
    // leaves full screen first and the theater second).
    title: "Sports player",
    shortcuts: [
      { keys: [["T"]], what: "Step back: out of full screen, then out of the player" },
      { keys: [["Esc"]], what: "Close a menu, leave full screen, then leave the game" },
    ],
  },
  {
    // MultiviewTab.tsx:813-847 is the bar's (the first six) and
    // MultiviewGrid.tsx:326-385 is the tiles'. mvKeys.ts `forMultiview` keeps
    // all of them out of a field, a dialog, and any chord with Ctrl, Alt or ⌘.
    title: "Multi-view",
    shortcuts: [
      { keys: [["A"]], what: "Add a channel" },
      { keys: [["M"]], what: "Mute" },
      { keys: [["↑"]], what: "Volume up" },
      { keys: [["↓"]], what: "Volume down" },
      // Only with two or more streams: one has just Grid (mvLayout kindsFor).
      { keys: [["G"]], what: "Switch between Grid and Focus" },
      { keys: [["F"]], what: "Full screen" },
      { keys: [["S"]], what: "Show or hide Live Scores" },
      // MultiviewGrid.tsx:326-348. "Current" is the tile with the sound, and
      // in Focus the big one.
      { keys: [["1–4"]], what: "Put the sound on that tile (in Focus, it takes the big spot)" },
      { keys: [["←"]], what: "Sound on the previous tile" },
      { keys: [["→"]], what: "Sound on the next tile" },
      { keys: [["R"]], what: "Replace the tile with the sound" }, // :349
      { keys: [["Delete"]], what: "Close the tile with the sound" }, // :353
      // :359, Focus only, and only where the big tile has room to move.
      { keys: [["["]], what: "Focus: make the big tile smaller" },
      { keys: [["]"]], what: "Focus: make the big tile bigger" },
      { keys: [["\\"]], what: "Focus: put the big tile back" },
      // :369, the tile that has the keyboard, else the one with the sound.
      { keys: [["Enter"]], what: "Fill the window with that tile" },
      // :400-407, ahead of the app's own Escape so it doesn't also leave full
      // screen.
      { keys: [["Esc"]], what: "Put a filled tile back" },
    ],
  },
];

/** One way of pressing it, as a string to compare: "Ctrl+K". */
export function chordText(chord: readonly string[]): string {
  return chord.join("+");
}

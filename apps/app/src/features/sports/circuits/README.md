# Track layouts

Vendored from **[julesr0y/f1-circuits-svg](https://github.com/julesr0y/f1-circuits-svg)**
by ROY Jules, used under **CC-BY-4.0**.

Regenerate with `node scripts/harvest-circuits.mjs`, which re-reads the
season from ESPN, picks the layout raced this year, and writes `index.json`
alongside the files.

Each file keeps its `<desc>` crediting the author. That is deliberate: the
card inlines these, so the attribution travels with the thing it attributes
rather than living only here.

F1 only. The other five racing leagues carry no circuit or venue at all in
our schedule source, so there is nothing to look a layout up by; see
`../circuits.ts`.

## Flags

`flags/` is vendored from **[lipis/flag-icons](https://github.com/lipis/flag-icons)**
by Panayiotis Lipiridis, used under **MIT**, filed by ISO 3166-1 alpha-2.

Ours rather than ESPN's on purpose. ESPN letterboxes every country inside a
500x500 transparent canvas (measured: ink 460x310 at 20,93, the same box for
every country), so a flag can only reach the edge of anything by being
scaled until the empty margin overflows it. These files are the flag, edge
to edge, at about half a kilobyte each.

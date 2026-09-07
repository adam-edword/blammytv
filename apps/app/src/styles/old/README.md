# old/

The BlammyTV design, kept rather than deleted.

v0.9.54 through v0.9.57 replaced the app's own visual language with shadcn's,
on Adam's call: *"i want this app to be completely taken over by shadcn's
base. we can build up the branding after."* This folder is the "after" half.

**Nothing here is imported.** `index.css` does not reference it and neither
does anything else. It is inert until someone wires it up, which is the
point: it is a record, not a second stylesheet quietly competing with the
first.

## What is in here

| File | What it holds | Where it came from |
|---|---|---|
| `tokens-blammytv.css` | The whole palette: surfaces, borders, text tiers, the red accent family, the glass recipes, the radii, the Stack Sans families. Both themes. | The `:root` and `:root[data-theme="light"]` blocks of `tokens.css`, copied verbatim immediately before v0.9.57 overwrote them. |
| `buttons-blammytv.css` | Every declaration of button and control paint that came out over v0.9.54-56: the glass pills, the accent-tinted faces, the press transforms, the headline-font labels. 202 rules across 11 sheets. | Reconstructed by diffing each stylesheet's rules at `729c17b` (v0.9.53) against the post-sweep versions and emitting what went. It is valid CSS, not a diff fragment. |

## Putting it back

**Wholesale**, to see the old look again:

```css
/* index.css, AFTER the ./tokens.css import */
@import "./old/tokens-blammytv.css" layer(app);
@import "./old/buttons-blammytv.css" layer(app);
```

Same layer, later import, so these win on the cascade's later-rule rule.

The buttons sheet has one caveat the tokens sheet does not: those rules were
written for `<button>` elements, and the controls are `<Button>` components
now. `utilities` outranks `app`, so anything the component paints with a
utility (fill, text colour, radius, height, padding) will beat this file.
Expect it to restore roughly, not exactly. `scripts/verify-tailwind.mjs`
names every declaration in that category if you need the list.

## The intended path

Don't wire either file up permanently. Take values from them **one at a
time** into `tokens.css`, so the app keeps one palette. A standing second set
of surfaces and text tiers is the exact thing `tokens.css` exists to prevent,
and it is what the header of that file has said since it was written.

## What was never taken away

The logo mark and its conic gradient (`--logo-path`, `--logo-stops`,
`--logo-conic` in `tokens.css`), the Themes feature and its accent picker,
and the paid theme packs (Terminal, Kawaii, Dither, Streamy) are all still
live. Those are product, not design language. Only the app's *default*
appearance became shadcn's.

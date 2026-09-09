/**
 * Self-hosted fonts.
 *
 * Bundled via Fontsource so they ship inside the app — no runtime CDN, works
 * offline, which matters for a sideload-only client. Vite fingerprints and
 * bundles the woff2 files referenced by these stylesheets.
 *
 * GEIST, since v0.9.59, and it is the last piece of "look like shadcn".
 * shadcn/ui ships no font of its own, but every screenshot anyone compares
 * against is its docs site, and that site is Geist. Before this the app
 * declared Tailwind's default sans stack, which on Windows/WebView2 falls
 * through to Segoe UI: correct, neutral, and not the thing the eye was
 * missing.
 *
 * VARIABLE, not the static cuts. The app asks for 200, 300, 400, 600 and 700
 * across its rules; static Fontsource would be five files per family, where
 * one variable file carries the whole 100-900 axis. The CSS family name is
 * `Geist Variable` (and `Geist Mono Variable`) — Fontsource's convention, not
 * a typo, and tokens.css has to name it exactly.
 *
 * ------------------------------------------------- WHAT IS DELIBERATELY OUT
 *
 * Six families used to be imported here and every build shipped all of them:
 * Stack Sans Headline (5 weights) + Text (2), VT323, Syne, Fredoka and Plus
 * Jakarta Sans. 468K across 35 woff2 files, and by v0.9.58 not one of them
 * was referenced by anything — Stack Sans stopped being the app's face in
 * v0.9.57, and the other four belonged to the intense theme packs, which are
 * parked in old/themes/.
 *
 * Their packages are STILL IN package.json, unimported. Adam: "would be nice
 * to keep that on deck." Re-adding any of them is one line here plus one
 * value in tokens.css; deleting the dependency would make it a reinstall and
 * a lockfile change. The cost of keeping them is a few KB in node_modules
 * and nothing at all in the bundle.
 *
 *   Stack Sans:  @fontsource/stack-sans-headline/{200,300,400,600,700}.css
 *                @fontsource/stack-sans-text/{200,400}.css
 *   Terminal:    @fontsource/vt323/400.css
 *   Dither:      @fontsource/syne/700.css
 *   Kawaii:      @fontsource/fredoka/{400,600,700}.css
 *   Streamy:     @fontsource/plus-jakarta-sans/{400,600,700}.css
 *
 * Unbounded is also still in package.json and has never been imported —
 * Adam likes it; it is waiting for its theme.
 */
import "@fontsource-variable/geist";
/* Geist Mono, imported as of v0.9.65 and not before. It sat installed and
 * unreferenced from v0.9.59, because `--font-mono` was used by exactly zero
 * rules and bundling a face nothing paints is the thing this file had just
 * deleted 468K of. Three places now set it — the licence key field, the
 * stats overlay and the recommender's code spans — all of which had been
 * hand-rolling `ui-monospace, "SFMono-Regular", "Consolas", "Menlo"` on
 * their own instead. */
import "@fontsource-variable/geist-mono";

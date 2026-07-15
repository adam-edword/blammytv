/**
 * Self-hosted fonts.
 *
 * Stack Sans (Koto Studio, free for personal + commercial use) is bundled via
 * Fontsource so it ships inside the app — no runtime CDN, works offline, which
 * matters for a sideload-only client. Vite fingerprints and bundles the woff2
 * files referenced by these stylesheets.
 *
 * Only the weights the redesign actually uses are imported, to keep the bundle
 * lean: Headline 200 (ExtraLight), 300 (Light), 400 (Regular),
 * 600 (SemiBold), 700 (Bold), Text 200/400.
 *
 * Theme-pack display faces are bundled here too (same offline/CSP-safe
 * Fontsource mechanism) so an intense theme can re-point --font-* to one
 * without a runtime fetch. They cost their woff2 in the bundle whether or
 * not a theme using them is active — acceptable, since any theme is
 * previewable, so no bundled face is ever truly dead weight. VT323 is the
 * Terminal pack's CRT face (single 400 weight — a bitmap font has no real
 * weight axis).
 */
import "@fontsource/stack-sans-headline/200.css";
import "@fontsource/stack-sans-headline/300.css";
import "@fontsource/stack-sans-headline/400.css";
import "@fontsource/stack-sans-headline/600.css";
import "@fontsource/stack-sans-headline/700.css";
import "@fontsource/stack-sans-text/200.css";
import "@fontsource/stack-sans-text/400.css";
import "@fontsource/vt323/400.css";
// Dither's editorial face — bold, high-contrast serif for headlines only
// (body text stays Stack Sans; all-serif body read like a novel).
import "@fontsource/playfair-display/500.css";
import "@fontsource/playfair-display/600.css";
import "@fontsource/playfair-display/700.css";
// Kawaii's rounded, chubby face.
import "@fontsource/fredoka/400.css";
import "@fontsource/fredoka/600.css";
import "@fontsource/fredoka/700.css";

/**
 * Self-hosted fonts.
 *
 * Stack Sans (Koto Studio, free for personal + commercial use) is bundled via
 * Fontsource so it ships inside the app — no runtime CDN, works offline, which
 * matters for a sideload-only client. Vite fingerprints and bundles the woff2
 * files referenced by these stylesheets.
 *
 * Only the weights the redesign actually uses are imported, to keep the bundle
 * lean: Headline 200 (ExtraLight), 300 (Light), 600 (SemiBold), 700 (Bold),
 * Text 200/400.
 */
import "@fontsource/stack-sans-headline/200.css";
import "@fontsource/stack-sans-headline/300.css";
import "@fontsource/stack-sans-headline/600.css";
import "@fontsource/stack-sans-headline/700.css";
import "@fontsource/stack-sans-text/200.css";
import "@fontsource/stack-sans-text/400.css";

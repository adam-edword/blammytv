// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

/**
 * docs.eddtv.org, built to static HTML and served by the nginx container in
 * this folder. No runtime: `astro build` emits `dist/` and nginx serves it,
 * exactly like services/site serves its hand-written index.html.
 *
 * `site` is not decoration. Starlight uses it for canonical URLs, og:url
 * and the sitemap. A wrong value here silently publishes wrong metadata.
 */
export default defineConfig({
  site: "https://docs.eddtv.org",
  integrations: [
    starlight({
      title: "BlammyTV",
      description:
        "Documentation for BlammyTV, a free and elegant IPTV and Stremio player for Windows.",
      logo: {
        src: "./public/logo.svg",
        alt: "BlammyTV",
        // NOT replacesTitle: logo.svg is the mark alone with no wordmark in
        // it, so suppressing the title left the header as a bare square.
      },
      favicon: "/logo.svg",
      // Brand tokens + Stack Sans, loaded after Starlight's own sheet so the
      // custom properties win. See src/styles/blammytv.css.
      customCss: ["./src/styles/blammytv.css"],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/adam-edword/blammytv",
        },
      ],
      editLink: {
        baseUrl:
          "https://github.com/adam-edword/blammytv/edit/main/services/docs/",
      },
      // Starlight bundles Pagefind for static builds. This is the ⌘K
      // overlay, indexed at build time, with no third-party search service.
      pagefind: true,
      sidebar: [
        {
          label: "Get started",
          items: [
            { label: "Install", slug: "start/install" },
            { label: "First launch", slug: "start/first-launch" },
          ],
        },
        {
          label: "Sources",
          items: [
            { label: "Overview", slug: "sources" },
            { label: "Xtream Codes", slug: "sources/xtream" },
            { label: "M3U playlists", slug: "sources/m3u" },
            { label: "Stalker portals", slug: "sources/stalker" },
            { label: "AIOStreams", slug: "sources/aiostreams" },
          ],
        },
        {
          label: "Using BlammyTV",
          items: [
            { label: "Live TV", slug: "using/live-tv" },
            { label: "Stream & VOD", slug: "using/stream" },
            { label: "Library", slug: "using/library" },
            { label: "Themes", slug: "using/themes" },
          ],
        },
        {
          label: "How it works",
          items: [
            { label: "Where your data goes", slug: "how-it-works" },
            { label: "Why Windows flagged it", slug: "how-it-works/defender" },
            { label: "Updates", slug: "how-it-works/updates" },
          ],
        },
        {
          label: "Troubleshooting",
          items: [
            { label: "Playback", slug: "troubleshooting/playback" },
            { label: "Connection limits", slug: "troubleshooting/connections" },
          ],
        },
        {
          label: "Contributing",
          items: [
            { label: "Architecture", slug: "contributing/architecture" },
            { label: "Building from source", slug: "contributing/building" },
          ],
        },
      ],
    }),
  ],
});

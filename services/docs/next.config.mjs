import { createMDX } from "fumadocs-mdx/next"

/** @type {import('next').NextConfig} */
const nextConfig = {
  // A static export: `next build` writes the whole site to out/ and nginx
  // serves it, the same way services/site serves its hand-written page.
  output: "export",
  // /sources/ is out/sources/index.html. Without this Next writes
  // out/sources.html, and every URL the app and the site already link to
  // would lose its trailing slash.
  trailingSlash: true,
  // The optimizer needs a server. There is none.
  images: { unoptimized: true },
  devIndicators: false,
  // `next dev` otherwise writes AGENTS.md and CLAUDE.md into this folder.
  agentRules: false,
  turbopack: {
    // The repo root has a pnpm lockfile above this folder. Pin the root so
    // Next doesn't guess and warn.
    root: import.meta.dirname,
  },
}

const withMDX = createMDX({})

export default withMDX(nextConfig)

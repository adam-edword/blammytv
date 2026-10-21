import type { MetadataRoute } from "next"

import { siteConfig } from "@/lib/config"
import { source } from "@/lib/source"

export const dynamic = "force-static"

export default function sitemap(): MetadataRoute.Sitemap {
  // Fumadocs gives urls without the trailing slash. Every page lives at
  // /path/ (see the canonical links), so list it that way.
  return source.getPages().map((page) => ({
    url: new URL(page.url, siteConfig.url).toString().replace(/([^/])$/, "$1/"),
  }))
}

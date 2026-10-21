import { createFromSource } from "fumadocs-core/search/server"

import { source } from "@/lib/source"

// Static export: this writes out/search.json once at build time. The command
// menu downloads it and searches page bodies in the browser.
export const revalidate = false
export const dynamic = "force-static"

export const { staticGET: GET } = createFromSource(source)

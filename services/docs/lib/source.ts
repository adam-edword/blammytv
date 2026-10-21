import { docs } from "@/.source/server"
import { loader } from "fumadocs-core/source"

export const source = loader({
  baseUrl: "/",
  source: docs.toFumadocsSource(),
  pageTree: {
    transformers: [
      {
        // The Sources page is titled "Sources", which would repeat its own
        // group's label in the sidebar, so the sidebar calls it Overview.
        file(node, filePath) {
          if (filePath === "sources/index.mdx") node.name = "Overview"
          return node
        },
      },
    ],
  },
})

import { defineConfig, defineDocs } from "fumadocs-mdx/config"
import rehypePrettyCode from "rehype-pretty-code"

import { transformers } from "@/lib/highlight-code"

export default defineConfig({
  mdxOptions: {
    // The search index stores each paragraph as markdown by default, so a
    // result would read "**Settings**" and "`Bearfoos`". Index plain text.
    remarkStructureOptions: {
      stringify: {
        handlers: {
          inlineCode: (node) => node.value,
          strong: (node, _, state, info) => state.containerPhrasing(node, info),
          emphasis: (node, _, state, info) =>
            state.containerPhrasing(node, info),
        },
      },
    },
    rehypePlugins: (plugins) => {
      plugins.shift()
      plugins.push([
        rehypePrettyCode,
        {
          theme: {
            dark: "vesper",
            light: "github-light-default",
          },
          // Fences with no language (the diagrams and folder trees) get the
          // same block as any other code. Without this they render bare.
          defaultLang: { block: "plaintext" },
          transformers,
        },
      ])

      return plugins
    },
  },
})

export const docs = defineDocs({
  dir: "content/docs",
})

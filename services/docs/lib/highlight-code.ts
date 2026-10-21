import type { ShikiTransformer } from "shiki"

// Hands the source text of each code block to the copy button.
export const transformers = [
  {
    code(node) {
      if (node.tagName === "code") {
        node.properties["__raw__"] = this.source
      }
    },
  },
] as ShikiTransformer[]

import type { source } from "@/lib/source"

export type PageTreeNode = (typeof source.pageTree)["children"][number]
export type PageTreeFolder = Extract<PageTreeNode, { type: "folder" }>
export type PageTreePage = Extract<PageTreeNode, { type: "page" }>

// The pages directly inside a folder.
export function getPagesFromFolder(folder: PageTreeFolder): PageTreePage[] {
  return folder.children.filter(
    (child): child is PageTreePage => child.type === "page"
  )
}

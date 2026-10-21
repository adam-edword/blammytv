import Link from "next/link"

import { siteConfig } from "@/lib/config"
import { Icons } from "@/components/icons"
import { Button } from "@/registry/new-york-v4/ui/button"

export function GitHubLink() {
  return (
    <Button asChild size="icon" variant="ghost" className="size-8 shadow-none">
      <Link href={siteConfig.links.github} target="_blank" rel="noreferrer">
        <Icons.gitHub />
        <span className="sr-only">GitHub</span>
      </Link>
    </Button>
  )
}

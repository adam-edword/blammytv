import type { Metadata } from "next"
import Link from "next/link"

import { Button } from "@/registry/new-york-v4/ui/button"

export const metadata: Metadata = {
  title: "Page Not Found",
}

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-160 flex-1 flex-col items-start gap-4 px-4 py-16 md:px-0 lg:py-24">
      <h1 className="text-3xl font-semibold tracking-tight">Page Not Found</h1>
      <p className="text-muted-foreground">
        This page doesn&apos;t exist, or it has moved.
      </p>
      <Button asChild variant="secondary" size="sm" className="shadow-none">
        <Link href="/">Go to Docs</Link>
      </Button>
    </div>
  )
}

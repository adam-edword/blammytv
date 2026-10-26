"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconArrowRight } from "@tabler/icons-react"
import { cn } from "cn"
import { useDocsSearch } from "fumadocs-core/search/client"
import { CornerDownLeftIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { getPagesFromFolder } from "@/lib/page-tree"
import { type source } from "@/lib/source"
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/registry/new-york-v4/ui/command"
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "@/registry/new-york-v4/ui/dialog"
import { Spinner } from "@/registry/new-york-v4/ui/spinner"

export function CommandMenu({
  tree,
  navItems,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  tree: typeof source.pageTree
  navItems?: { href: string; label: string }[]
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [renderDelayedGroups, setRenderDelayedGroups] = React.useState(false)

  // Full-text search. The site is a static export, so there is no search
  // server: app/search.json/route.ts writes the index at build time and the
  // browser downloads it the first time someone types.
  const { search, setSearch, query } = useDocsSearch({
    type: "static",
    from: "/search.json",
  })

  const searchTimeoutRef = React.useRef<NodeJS.Timeout | undefined>(undefined)

  const handleSearchChange = React.useCallback(
    (value: string) => {
      // Clear existing timeout.
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }

      // Debounce the search.
      searchTimeoutRef.current = setTimeout(() => {
        React.startTransition(() => {
          setSearch(value)
        })
      }, 500)
    },
    [setSearch]
  )

  // Mount the page lists a frame after opening, so the dialog opens at once.
  React.useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => {
        setRenderDelayedGroups(true)
      })

      return () => {
        cancelAnimationFrame(frame)
      }
    }

    setRenderDelayedGroups(false)
  }, [open])

  // Cleanup timeout on unmount.
  React.useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [])

  const commandFilter = React.useCallback(
    (value: string, searchValue: string, keywords?: string[]) => {
      const extendValue = value + " " + (keywords?.join(" ") || "")
      if (extendValue.toLowerCase().includes(searchValue.toLowerCase())) {
        return 1
      }
      return 0
    },
    []
  )

  const runCommand = React.useCallback(
    (command: () => unknown) => {
      setOpen(false)
      command()
    },
    [setOpen]
  )

  const navItemsSection = React.useMemo(() => {
    if (!navItems || navItems.length === 0) {
      return null
    }

    return (
      <CommandGroup
        heading="Pages"
        className="p-0! **:[[cmdk-group-heading]]:scroll-mt-16 **:[[cmdk-group-heading]]:p-3! **:[[cmdk-group-heading]]:pb-1!"
      >
        {navItems.map((item) => (
          <CommandMenuItem
            key={item.href}
            value={`Navigation ${item.label}`}
            keywords={["nav", "navigation", item.label.toLowerCase()]}
            onSelect={() => {
              runCommand(() =>
                // Website and Download leave the site.
                item.href.startsWith("http")
                  ? window.open(item.href, "_blank", "noopener")
                  : router.push(item.href)
              )
            }}
          >
            <IconArrowRight />
            {item.label}
          </CommandMenuItem>
        ))}
      </CommandGroup>
    )
  }, [navItems, runCommand, router])

  const pageGroupsSection = React.useMemo(() => {
    return tree.children.map((group) => {
      if (group.type !== "folder") {
        return null
      }

      const pages = getPagesFromFolder(group)

      if (pages.length === 0) {
        return null
      }

      return (
        <CommandGroup
          key={group.$id}
          heading={group.name}
          className="p-0! **:[[cmdk-group-heading]]:scroll-mt-16 **:[[cmdk-group-heading]]:p-3! **:[[cmdk-group-heading]]:pb-1!"
        >
          {pages.map((item) => (
            <CommandMenuItem
              key={item.url}
              value={item.name?.toString() ? `${group.name} ${item.name}` : ""}
              onSelect={() => {
                runCommand(() => router.push(item.url))
              }}
            >
              <IconArrowRight />
              {item.name}
            </CommandMenuItem>
          ))}
        </CommandGroup>
      )
    })
  }, [tree.children, runCommand, router])

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || e.key === "/") {
        if (
          (e.target instanceof HTMLElement && e.target.isContentEditable) ||
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          e.target instanceof HTMLSelectElement
        ) {
          return
        }

        e.preventDefault()
        setOpen((open) => !open)
      }
    }

    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "relative h-8 w-full justify-start rounded-lg border-none bg-muted pl-3 text-foreground shadow-none transition-colors hover:bg-muted/50 md:w-48 lg:w-40 xl:w-64 dark:bg-card"
          )}
          onClick={() => setOpen(true)}
          {...props}
        >
          <span className="hidden xl:inline-flex">Search Documentation...</span>
          <span className="inline-flex xl:hidden">Search...</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-xl border-none bg-clip-padding p-2 pb-11 shadow-2xl ring-4 ring-neutral-200/80 dark:bg-neutral-900 dark:ring-neutral-800">
        <DialogHeader className="sr-only">
          <DialogTitle>Search Documentation...</DialogTitle>
          <DialogDescription>Search for a page to open...</DialogDescription>
        </DialogHeader>
        <Command
          className="rounded-none bg-transparent **:data-[slot=command-input]:h-9! **:data-[slot=command-input]:py-0 **:data-[slot=command-input-wrapper]:mb-0 **:data-[slot=command-input-wrapper]:h-9! **:data-[slot=command-input-wrapper]:rounded-md **:data-[slot=command-input-wrapper]:border **:data-[slot=command-input-wrapper]:border-input **:data-[slot=command-input-wrapper]:bg-input/50"
          filter={commandFilter}
        >
          <div className="relative">
            <CommandInput
              placeholder="Search Documentation..."
              onValueChange={handleSearchChange}
            />
            {query.isLoading && (
              <div className="pointer-events-none absolute top-1/2 right-3 z-10 flex -translate-y-1/2 items-center justify-center">
                <Spinner className="size-4 text-muted-foreground" />
              </div>
            )}
          </div>
          <CommandList className="no-scrollbar min-h-80 scroll-pt-2 scroll-pb-1.5">
            <CommandEmpty className="py-12 text-center text-sm text-muted-foreground">
              {query.isLoading ? "Searching..." : "No results found."}
            </CommandEmpty>
            {navItemsSection}
            {renderDelayedGroups ? (
              <>
                {pageGroupsSection}
                <SearchResults
                  setOpen={setOpen}
                  query={query}
                  search={search}
                />
              </>
            ) : null}
          </CommandList>
        </Command>
        <div className="absolute inset-x-0 bottom-0 z-20 flex h-10 items-center gap-2 rounded-b-xl border-t border-t-neutral-100 bg-neutral-50 px-4 text-xs font-medium text-muted-foreground dark:border-t-neutral-700 dark:bg-neutral-800">
          <div className="flex items-center gap-2">
            <CommandMenuKbd>
              <CornerDownLeftIcon />
            </CommandMenuKbd>{" "}
            Go to Page
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CommandMenuItem({
  children,
  className,
  ...props
}: React.ComponentProps<typeof CommandItem>) {
  return (
    <CommandItem
      className={cn(
        "h-9 rounded-md border border-transparent px-3! font-medium data-[selected=true]:border-input data-[selected=true]:bg-input/50",
        className
      )}
      {...props}
    >
      {children}
    </CommandItem>
  )
}

function CommandMenuKbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "pointer-events-none flex h-5 items-center justify-center gap-1 rounded border bg-background px-1 font-sans text-[0.7rem] font-medium text-muted-foreground select-none [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  )
}

type Query = Awaited<ReturnType<typeof useDocsSearch>>["query"]

function SearchResults({
  setOpen,
  query,
  search,
}: {
  setOpen: (open: boolean) => void
  query: Query
  search: string
}) {
  const router = useRouter()

  const uniqueResults = React.useMemo(() => {
    if (!query.data || !Array.isArray(query.data)) {
      return []
    }

    return query.data.filter(
      (item, index, self) =>
        !(
          item.type === "text" && item.content.trim().split(/\s+/).length <= 1
        ) && index === self.findIndex((t) => t.content === item.content)
    )
  }, [query.data])

  if (!search.trim()) {
    return null
  }

  if (!query.data || query.data === "empty") {
    return null
  }

  if (query.data && uniqueResults.length === 0) {
    return null
  }

  return (
    <CommandGroup
      className="px-0! **:[[cmdk-group-heading]]:scroll-mt-16 **:[[cmdk-group-heading]]:p-3! **:[[cmdk-group-heading]]:pb-1!"
      heading="Search Results"
    >
      {uniqueResults.map((item) => {
        return (
          <CommandItem
            key={item.id}
            data-type={item.type}
            onSelect={() => {
              router.push(item.url)
              setOpen(false)
            }}
            className="h-9 rounded-md border border-transparent px-3! font-normal data-[selected=true]:border-input data-[selected=true]:bg-input/50"
            // The index already matched these, but cmdk filters every item by
            // the typed text. The matched content now carries <mark> tags, so
            // "windows defender" would no longer appear in it. Hand cmdk the
            // searched text itself to match against.
            keywords={[search]}
            value={item.id}
          >
            <div className="line-clamp-1 text-sm">
              <Highlighted content={item.content} />
            </div>
          </CommandItem>
        )
      })}
    </CommandGroup>
  )
}

// The index wraps each matched word in <mark>. Show those words in bold.
function Highlighted({ content }: { content: string }) {
  return content.split(/<\/?mark>/).map((part, i) =>
    i % 2 ? (
      <span key={i} className="font-semibold">
        {part}
      </span>
    ) : (
      part
    )
  )
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      {/* <DialogOverlay /> */}
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-[15%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 outline-none sm:max-w-lg",
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

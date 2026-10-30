import { cn } from "cn"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/registry/new-york-v4/ui/alert"

export function Callout({
  title,
  children,
  icon,
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof Alert> & {
  icon?: React.ReactNode
  variant?: "default" | "info" | "warning"
}) {
  return (
    <Alert
      data-variant={variant}
      className={cn(
        "not-typeset mt-6 w-auto rounded-2xl border-surface bg-surface text-surface-foreground md:-mx-1 **:[a]:font-medium **:[a]:underline **:[a]:decoration-current/30 **:[a]:hover:decoration-current **:[code]:border",
        // A warning gets a quiet amber tint. Nothing else changes, so it
        // still reads as the same callout.
        "data-[variant=warning]:border-amber-200 data-[variant=warning]:bg-amber-50 dark:data-[variant=warning]:border-amber-500/25 dark:data-[variant=warning]:bg-amber-500/10",
        className
      )}
      {...props}
    >
      {icon}
      {/* Alert's title takes the muted card colour, which in dark mode sits
          dimmer than the text under it. */}
      {title && <AlertTitle className="text-foreground">{title}</AlertTitle>}
      <AlertDescription className="text-card-foreground/80">
        {children}
      </AlertDescription>
    </Alert>
  )
}

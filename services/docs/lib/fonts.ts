import { GeistMono } from "geist/font/mono"
import { GeistSans } from "geist/font/sans"
import { cn } from "cn"

// shadcn's docs load Geist and Geist Mono through next/font/google. The
// `geist` package ships the same two fonts as local files, so the build
// never needs to reach Google. globals.css maps these variables onto
// font-sans, font-heading and font-mono.
export const fontVariables = cn(GeistSans.variable, GeistMono.variable)

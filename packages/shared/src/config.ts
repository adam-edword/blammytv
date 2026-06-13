import { z } from "zod";

/**
 * The config blob.
 *
 * Per the project's committed decision, the backend is the single source of
 * truth and the apps are dumb terminals: they pull this blob on load and just
 * render it. Nothing here is writable on-device.
 *
 * Note what is deliberately ABSENT: debrid API keys, xtream credentials, and
 * raw aiostreams config never reach the client. The backend resolves those and
 * only ever hands the device playable stream URLs. If a secret would show up in
 * this schema, it belongs server-side instead.
 */

export const ChannelGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Group hiding is decided in the web UI; hidden groups simply aren't sent,
   * but we keep the flag so ordering/visibility can be previewed if ever needed. */
  hidden: z.boolean().default(false),
  order: z.number().int().default(0),
});
export type ChannelGroup = z.infer<typeof ChannelGroupSchema>;

export const LiveChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
  logo: z.string().url().optional(),
  groupId: z.string(),
  /** Already-resolved, directly playable URL. No credentials embedded by us. */
  streamUrl: z.string().url(),
  /** EPG / tv-guide identifier, resolved server-side. */
  epgId: z.string().optional(),
});
export type LiveChannel = z.infer<typeof LiveChannelSchema>;

export const EpgProgramSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  title: z.string(),
  /** ISO timestamps; the client lays these out on the guide's time axis. */
  start: z.string(),
  stop: z.string(),
  description: z.string().optional(),
});
export type EpgProgram = z.infer<typeof EpgProgramSchema>;

export const VodItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  year: z.number().int().optional(),
  poster: z.string().url().optional(),
  kind: z.enum(["movie", "series"]),
});
export type VodItem = z.infer<typeof VodItemSchema>;

export const ConfigBlobSchema = z.object({
  /** Bumped by the backend whenever the rendered shape changes. */
  version: z.number().int(),
  /** Friendly name for the paired device, set in the web UI. */
  deviceName: z.string().optional(),
  /** ISO timestamp of when this blob was generated. */
  updatedAt: z.string(),
  live: z.object({
    /** Categories shown in the guide's left rail (Sports, Movies, …). */
    groups: z.array(ChannelGroupSchema),
    channels: z.array(LiveChannelSchema),
    /** EPG entries across all channels; the guide windows these by time. */
    programs: z.array(EpgProgramSchema),
    /** Channel the "Now Playing" hero focuses on first launch. */
    featuredChannelId: z.string().optional(),
  }),
  movies: z.array(VodItemSchema),
  series: z.array(VodItemSchema),
  /** Favorite item/channel ids, managed in the web UI. */
  favorites: z.array(z.string()),
});
export type ConfigBlob = z.infer<typeof ConfigBlobSchema>;

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

/** A playable source/release for a title, as resolved + ranked by the backend
 * (debrid cache, quality, languages, …). The device is a dumb terminal: it
 * renders these in the given order and never re-sorts or re-filters them.
 * `quality` and `lines` are already display-formatted server-side. */
export const StreamSourceSchema = z.object({
  id: z.string(),
  /** Prominent left label, e.g. "1080p" / "2160p". */
  quality: z.string(),
  /** Instant-play (cached on debrid) — shown as the ⚡ marker. */
  cached: z.boolean().default(false),
  /** Pre-formatted meta lines (provider, languages, size, rating, …). */
  lines: z.array(z.string()).default([]),
  /** Already-resolved, directly playable URL. */
  streamUrl: z.string().url(),
});
export type StreamSource = z.infer<typeof StreamSourceSchema>;

/** One episode of a series. Has its own ranked source list, just like a movie. */
export const EpisodeSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  title: z.string(),
  /** Display-formatted air date (e.g. "Apr 30, 2026"). */
  airDate: z.string().optional(),
  /** Episode still / thumbnail. */
  still: z.string().url().optional(),
  sources: z.array(StreamSourceSchema).default([]),
});
export type Episode = z.infer<typeof EpisodeSchema>;

export const SeasonSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  name: z.string().optional(),
  episodes: z.array(EpisodeSchema),
});
export type Season = z.infer<typeof SeasonSchema>;

export const VodItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  year: z.number().int().optional(),
  poster: z.string().url().optional(),
  /** Wide artwork used by the Stream hero / landscape cards. */
  backdrop: z.string().url().optional(),
  kind: z.enum(["movie", "series"]),
  /** Out-of-10 rating, runtime, and a short synopsis — shown on the Stream
   * page's hero and card meta line. All resolved server-side. */
  rating: z.number().optional(),
  runtimeMin: z.number().int().optional(),
  synopsis: z.string().optional(),
  /** Detail-page metadata. */
  genres: z.array(z.string()).default([]),
  cast: z.array(z.string()).default([]),
  /** Playable sources for this title (movies), pre-ranked by the backend. */
  sources: z.array(StreamSourceSchema).default([]),
  /** Seasons + episodes (series). Each episode carries its own sources. */
  seasons: z.array(SeasonSchema).default([]),
});
export type VodItem = z.infer<typeof VodItemSchema>;

/** A horizontally-scrolling row on the Stream page. The backend decides the
 * grouping (e.g. "Action – Movie", "Continue Watching") and the order, exactly
 * like the live guide's channel groups; the device just renders it. */
export const StreamRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Card shape: tall posters (2:3) or wide stills (16:9, e.g. resume row). */
  layout: z.enum(["poster", "landscape"]).default("poster"),
  /** Ids into the movies/series catalog, in display order. */
  itemIds: z.array(z.string()),
});
export type StreamRow = z.infer<typeof StreamRowSchema>;

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
  /** The Stream tab: a featured hero carousel plus backend-defined rows that
   * reference items from the movies/series catalog above. */
  stream: z.object({
    /** Item ids spotlighted in the auto-advancing hero carousel. */
    featured: z.array(z.string()),
    rows: z.array(StreamRowSchema),
  }),
  /** Favorite item/channel ids, managed in the web UI. */
  favorites: z.array(z.string()),
});
export type ConfigBlob = z.infer<typeof ConfigBlobSchema>;

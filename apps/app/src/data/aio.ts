import {
  fetchCatalog,
  fetchManifest,
  fetchMeta,
  fetchStreams,
  type AddonManifest,
  type CatalogResponse,
  type MetaResponse,
  type StreamResponse,
} from "./stremio";
import { catalogsFromManifest, fetchAioCatalogs, type AioCatalog } from "./aiostreams";
import type { AioConn } from "../features/aiojf/conn";
import { remoteCatalog, remoteManifest, remoteMeta, remoteStreams } from "../features/aiojf/remote";

/**
 * The one door to the user's AIOStreams (plan 024). Stream, Discover and the
 * hero picker ask here, with the connection (`loadAioConn`), and get the
 * Stremio addon's answers either way: from the manifest URL as before
 * (stremio.ts, aiostreams.ts), or, signed in, from AIOStreams' Jellyfin side
 * (features/aiojf/remote.ts). The ids in the answers are Stremio ids on both,
 * so nothing past this file knows which side it asked.
 *
 * Cinemeta and the other public addons are not the user's AIOStreams, and
 * are still asked through stremio.ts directly.
 */

export function aioManifest(conn: AioConn): Promise<AddonManifest> {
  return conn.kind === "signin" ? remoteManifest(conn) : fetchManifest(conn.url);
}

/** A catalog page. `extra` is the Stremio extra segment (`genre=Action&skip=40`).
 * `limit` is how many titles to ask for, which only the sign-in takes: the
 * manifest's addon sends the page it sends. */
export function aioCatalog(
  conn: AioConn,
  type: string,
  id: string,
  extra?: string,
  limit?: number,
): Promise<CatalogResponse> {
  return conn.kind === "signin"
    ? remoteCatalog(conn, type, id, extra, limit)
    : fetchCatalog(conn.url, type, id, extra);
}

/** A title's detail. `episodes: false` skips a show's episode list on the
 * sign-in, for a caller that only reads the art. */
export function aioMeta(
  conn: AioConn,
  type: string,
  id: string,
  opts: { episodes?: boolean } = {},
): Promise<MetaResponse> {
  return conn.kind === "signin" ? remoteMeta(conn, type, id, opts) : fetchMeta(conn.url, type, id);
}

/** A title's or episode's sources. `refresh` searches the addons again; the
 * manifest's addon does that on every ask, so it ignores the flag. */
export function aioStreams(
  conn: AioConn,
  type: string,
  id: string,
  opts: { refresh?: boolean } = {},
): Promise<StreamResponse> {
  return conn.kind === "signin" ? remoteStreams(conn, type, id, opts) : fetchStreams(conn.url, type, id);
}

/** The catalogs the hero picker offers. */
export async function aioCatalogDefs(conn: AioConn): Promise<AioCatalog[]> {
  return conn.kind === "signin"
    ? catalogsFromManifest(await remoteManifest(conn))
    : fetchAioCatalogs(conn.url);
}

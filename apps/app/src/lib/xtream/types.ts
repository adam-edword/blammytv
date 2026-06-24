/**
 * Minimal shapes for the Xtream Codes `player_api.php` responses we use, plus
 * the account config. Panels are loosely typed (numbers as strings, etc.), so
 * everything is permissive — the mapper normalizes.
 */

export interface XtreamConfig {
  /** e.g. http://line.example.com:8080 (no trailing slash). */
  baseUrl: string;
  username: string;
  password: string;
  /** Live container extension for the playable URL (ts | m3u8). */
  liveExt: string;
}

export interface XtreamAuth {
  user_info?: {
    auth?: number;
    status?: string;
    message?: string;
  };
  server_info?: Record<string, unknown>;
}

export interface XtreamCategory {
  category_id: string;
  category_name: string;
  parent_id?: number | string;
}

export interface XtreamLiveStream {
  num?: number;
  name: string;
  stream_type?: string;
  stream_id: number | string;
  stream_icon?: string;
  epg_channel_id?: string | null;
  category_id?: string | number;
  added?: string;
  tv_archive?: number;
  direct_source?: string;
}

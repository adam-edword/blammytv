/**
 * Minimal shapes for the Xtream Codes `player_api.php` responses we use.
 * Panels are loosely typed and inconsistent (numbers as strings, etc.), so
 * everything here is permissive — the mapper normalizes.
 */

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

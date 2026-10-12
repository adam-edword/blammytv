/**
 * What About lists below the app's own version (plan 025, P4a): the rows of
 * what native said. `about_versions` answers with every field optional, and a
 * field it could not tell is left out. An older native has no such command at
 * all. Either way the row is not drawn, so there is nothing here to explain
 * and no error to show.
 *
 * Only a plain string is a row. The page asks for a version, so it takes a
 * short one, and anything else (a number, an object, "") is as if it had not
 * been sent. So is a string with a path separator in it: native sends none, and
 * a page that is told "never a path" does not draw one it was handed anyway.
 */

export interface AboutRow {
  key: string;
  label: string;
  value: string;
}

/** The fields native may send, in the order the rows are drawn. */
export const ABOUT_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "native", label: "Native build" },
  { key: "mpv", label: "mpv" },
  { key: "ffmpeg", label: "FFmpeg in the player" },
  { key: "bundledFfmpeg", label: "FFmpeg for multi-view" },
  { key: "vulkan", label: "Vulkan loader" },
];

/** The longest value shown. Native cuts at 64; this is the page's own limit. */
const MAX = 80;

export function aboutRows(answer: unknown): AboutRow[] {
  if (!answer || typeof answer !== "object") return [];
  const from = answer as Record<string, unknown>;
  const rows: AboutRow[] = [];
  for (const { key, label } of ABOUT_FIELDS) {
    const v = from[key];
    if (typeof v !== "string") continue;
    const value = v.trim();
    if (value && value.length <= MAX && !/[\\/]/.test(value)) rows.push({ key, label, value });
  }
  return rows;
}

import { ShareCodeSchema, type ShareCode } from "@blammytv/shared";

/**
 * On-device share-code state.
 *
 * Holds only the share code — a demo/dev concept. In the browser it scopes the
 * bundled demo (and keys a dev backend via VITE_API_URL, if one is configured).
 * The self-contained desktop app hardcodes it to "BLAMMY" and builds its config
 * on-device, so nothing here gates the real product. No config, keys, or settings
 * are ever persisted through this surface.
 */

const STORAGE_KEY = "blammytv.shareCode";

export function loadShareCode(): ShareCode | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = ShareCodeSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveShareCode(code: ShareCode): void {
  localStorage.setItem(STORAGE_KEY, code);
}

export function clearShareCode(): void {
  localStorage.removeItem(STORAGE_KEY);
}

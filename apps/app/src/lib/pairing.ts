import { ShareCodeSchema, type ShareCode } from "@blammytv/shared";

/**
 * On-device pairing state.
 *
 * The device stores only its share code — the handle it uses to pull config
 * from the backend. No config, keys, or settings are ever persisted on-device.
 * (When the real backend lands this becomes a device token swapped for the
 * share code; the surface here stays the same.)
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

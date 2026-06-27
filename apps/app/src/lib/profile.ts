/**
 * Device-local "account" — purely cosmetic personalization (a name and an
 * avatar), stored in localStorage like the other on-device prefs. The avatar is
 * a downscaled data URL so it stays small enough for localStorage.
 */
export interface Profile {
  name: string;
  /** Data URL of the avatar, or null for the default account icon. */
  avatar: string | null;
}

const KEY = "blammytv.profile";
const EMPTY: Profile = { name: "", avatar: null };

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const p = JSON.parse(raw);
    return {
      name: typeof p.name === "string" ? p.name : "",
      avatar: typeof p.avatar === "string" ? p.avatar : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage full/unavailable — profile just won't persist */
  }
}

/** Downscale a picked image to a square-ish thumbnail and return a JPEG data
 * URL. Keeps the avatar tiny so it fits comfortably in localStorage. */
export function fileToAvatar(file: File, max = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no canvas context"));
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("couldn't read that image"));
    };
    img.src = url;
  });
}

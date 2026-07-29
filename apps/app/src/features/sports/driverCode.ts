/**
 * "Norris" to "NOR".
 *
 * The source gives a name and no code. F1's own three-letter codes are the
 * first three of the surname often enough to derive ("Norris" NOR,
 * "Verstappen" VER, "Piastri" PIA, "Hülkenberg" HUL), and the exceptions
 * are few enough to name when one bites. Accents come off first, or
 * "Hülkenberg" reads HÜL.
 */
export function driverCode(name: string): string {
  const surname = name.trim().split(/\s+/).pop() ?? name;
  return surname
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .slice(0, 3)
    .toUpperCase();
}

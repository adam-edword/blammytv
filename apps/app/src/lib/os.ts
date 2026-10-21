/** Set once at startup by main.tsx, from the user agent. */
export const isMac = (): boolean => document.documentElement.dataset.os === "mac";

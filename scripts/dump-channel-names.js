/**
 * Dump your channel NAMES for the sports matcher (plan 010, phase 2).
 *
 * The matcher has to turn a schedule's "FOX" into your "US| FOX HD", and it
 * cannot be written honestly against invented channel names: the whole
 * difficulty is the shapes real providers actually use. So it gets built
 * tests-first against a real dump, the same way the ESPN side was.
 *
 * HOW TO RUN IT
 *   1. Start the app in dev:  pnpm tauri dev
 *   2. Open Live TV and let the channel list finish loading at least once.
 *   3. Right-click in the app, Inspect, and go to the Console tab.
 *   4. Paste this whole file in and press Enter.
 *   5. The JSON is now on your clipboard. Paste it into a file and say so.
 *
 * It reads the disk cache the app already keeps, so it needs no credentials
 * and makes no network calls.
 *
 * WHAT IT TAKES: the channel name, its folder name, and the quality badge.
 * That is everything the matcher can use.
 *
 * WHAT IT DELIBERATELY LEAVES BEHIND: stream urls, logo urls, channel ids,
 * and the group/source names. For an M3U playlist the stream url CONTAINS
 * YOUR CREDENTIALS, so it must never reach a file we commit. Read the dump
 * before it goes anywhere.
 */
(async () => {
  const get = (store, key) =>
    new Promise((res, rej) => {
      const q = store.get(key);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });

  const db = await new Promise((res, rej) => {
    const r = indexedDB.open("blammytv", 1);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

  const record = await get(
    db.transaction("liveCache", "readonly").objectStore("liveCache"),
    "live",
  );
  const data = record && record.data;
  if (!data || !data.channels) {
    console.error(
      "No cached catalog found. Open Live TV, let the channels finish loading, then run this again.",
    );
    return;
  }

  // folderId -> folder name, so each channel carries the category it sits
  // in. Sports categories are the ones that matter most here.
  const folders = new Map();
  for (const group of data.groups || [])
    for (const folder of group.folders || []) folders.set(folder.id, folder.name);

  const out = data.channels.map((c) => ({
    name: c.name,
    folder: folders.get(c.folderId) || "",
    quality: c.quality || null,
  }));

  const json = JSON.stringify(out, null, 1);
  const sports = out.filter((c) => /sport|espn|sky|bt |dazn|nfl|nba|mlb|nhl|fox|tnt|usa/i.test(c.folder + " " + c.name));
  console.log(`${out.length} channels, ${sports.length} look sports-ish.`);
  console.log("Folders:", [...new Set(out.map((c) => c.folder))].sort());

  try {
    // DevTools' own helper: puts the whole dump on the clipboard.
    copy(json);
    console.log("Copied to clipboard. Paste it into a file.");
  } catch {
    console.log("copy() unavailable, falling back to a download.");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = "channels.json";
    a.click();
  }
})();

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

  // Per folder, which is the more useful shape: it says at a glance where
  // the sport lives and how big each category is.
  const perFolder = {};
  for (const c of out) perFolder[c.folder] = (perFolder[c.folder] || 0) + 1;
  console.log(`${out.length} channels in ${Object.keys(perFolder).length} folders`);
  console.table(
    Object.entries(perFolder)
      .sort((a, b) => b[1] - a[1])
      .map(([folder, channels]) => ({ folder, channels })),
  );

  // ALWAYS park it on window first. Everything below can fail for reasons
  // that have nothing to do with the dump: DevTools' copy() is not reliably
  // in scope inside an async function, and navigator.clipboard refuses when
  // the console has focus rather than the page. If both miss, the global is
  // still there and `copy(__channels)` typed at the prompt always works.
  window.__channels = json;

  try {
    await navigator.clipboard.writeText(json);
    console.log("On your clipboard. Paste it into a file.");
    return;
  } catch {
    /* Focus is on DevTools, not the page. Fall through. */
  }
  try {
    copy(json);
    console.log("On your clipboard. Paste it into a file.");
    return;
  } catch {
    /* Command-line API out of scope here. Fall through. */
  }
  console.log(
    "Could not reach the clipboard from in here. Two ways out:\n" +
      "  1. Type this at the console prompt:   copy(__channels)\n" +
      "  2. Or check your Downloads folder for channels.json",
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  a.download = "channels.json";
  a.click();
})();

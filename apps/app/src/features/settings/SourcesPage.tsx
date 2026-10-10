import { useState } from "react";
import { Segmented } from "../../ui/Segmented";
import { EYEBROW } from "../../ui/eyebrow";
import { PlaylistsTab } from "./PlaylistsTab";
import { AioStreamsTab } from "./AioStreamsTab";

/**
 * Sources: what you watch. Where content comes from, a playlist for Live TV
 * and an AIOStreams for Stream, behind the same Live TV / Stream pill the
 * Appearance page uses for what each world looks like. One mental model, said
 * on each page that differs per world.
 *
 * It was General's first group until the five pages (v0.11.26), and before
 * that its own Media tab. Connecting a playlist or an AIOStreams is a
 * one-time setup, but it is also the two biggest forms in the app, which is
 * why it has a page of its own now rather than a third of a tab.
 */
const SOURCE_TABS = [
  { key: "live", label: "Live TV" },
  { key: "stream", label: "Stream" },
] as const;

export function SourcesPage() {
  // Ephemeral: Sources always opens on Live TV rather than remembering
  // where you were, the same rule the old Media rail followed.
  const [source, setSource] = useState<"live" | "stream">("live");

  return (
    <>
      {/* The two source screens are unchanged; they sit behind a pill here
        * instead of behind a tab. A page is mounted only while it is the one
        * showing, so they read their lists afresh each time you arrive, and
        * a clear made on the App page can never meet a pane still holding
        * the old list. */}
      <h3 className={`settings__group ${EYEBROW}`}>Sources</h3>
      <div className="customize-rail">
        <Segmented role="tabs" label="Sources" options={SOURCE_TABS} value={source} onChange={setSource} />
      </div>
      {source === "live" ? <PlaylistsTab /> : <AioStreamsTab />}
    </>
  );
}

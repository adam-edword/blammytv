import { useState } from "react";
import { AppHeader, type TabKey } from "./AppHeader";
import { LiveScreen } from "../features/live/LiveScreen";
import { StreamScreen } from "../features/stream/StreamScreen";
import { DiscoverScreen } from "../features/discover/DiscoverScreen";
import { SettingsModal } from "../features/settings/SettingsModal";

export function App() {
  const [tab, setTab] = useState<TabKey>("live");
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="app-shell">
      <AppHeader
        active={tab}
        onChange={setTab}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="app-main">
        {tab === "live" ? (
          <LiveScreen />
        ) : tab === "stream" ? (
          <StreamScreen />
        ) : (
          <DiscoverScreen />
        )}
      </main>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

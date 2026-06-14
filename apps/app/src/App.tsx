import { useCallback, useEffect, useState } from "react";
import type { ConfigBlob, ShareCode } from "@blammytv/shared";
import { AppHeader } from "./components/AppHeader";
import { type TabKey } from "./components/TopTabs";
import { PairingScreen } from "./screens/PairingScreen";
import { LiveScreen } from "./screens/LiveScreen";
import { StreamScreen } from "./screens/StreamScreen";
import { PlaceholderScreen } from "./screens/PlaceholderScreen";
import { SettingsPanel } from "./components/SettingsPanel";
import { LiveScreenSkeleton } from "./components/LoadingSkeletons";
import { fetchConfig } from "./lib/config";
import { loadShareCode, saveShareCode, clearShareCode } from "./lib/pairing";

type Load =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; config: ConfigBlob }
  | { status: "error"; message: string };

export function App() {
  const [shareCode, setShareCode] = useState<ShareCode | null>(() =>
    loadShareCode(),
  );
  const [tab, setTab] = useState<TabKey>("live");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ status: "idle" });

  const pull = useCallback((code: ShareCode) => {
    setLoad({ status: "loading" });
    fetchConfig(code)
      .then((config) => setLoad({ status: "ready", config }))
      .catch((err) =>
        setLoad({
          status: "error",
          message: err instanceof Error ? err.message : "Couldn't load",
        }),
      );
  }, []);

  // The dumb-terminal lifecycle: as soon as we have a share code, phone home
  // for the config blob and render whatever comes back.
  useEffect(() => {
    if (shareCode) pull(shareCode);
  }, [shareCode, pull]);

  if (!shareCode) {
    return (
      <PairingScreen
        onPaired={(code) => {
          saveShareCode(code);
          setShareCode(code);
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <AppHeader
        active={tab}
        onChange={setTab}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="app-main">
        {load.status === "loading" || load.status === "idle" ? (
          <LiveScreenSkeleton />
        ) : load.status === "error" ? (
          <ErrorState
            message={load.message}
            onRetry={() => pull(shareCode)}
            onUnpair={() => {
              clearShareCode();
              setShareCode(null);
            }}
          />
        ) : (
          <Content tab={tab} config={load.config} />
        )}
      </main>
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

function Content({ tab, config }: { tab: TabKey; config: ConfigBlob }) {
  switch (tab) {
    case "live":
      return <LiveScreen config={config} />;
    case "stream":
      return <StreamScreen config={config} />;
    case "discover":
      return (
        <PlaceholderScreen
          title="Discover"
          note="A place to browse and find something new to watch. Coming next."
        />
      );
  }
}

function ErrorState({
  message,
  onRetry,
  onUnpair,
}: {
  message: string;
  onRetry: () => void;
  onUnpair: () => void;
}) {
  return (
    <div className="error-state">
      <h2>Can't reach your setup</h2>
      <p>{message}</p>
      <div className="error-state__actions">
        <button className="btn btn--primary" type="button" onClick={onRetry}>
          Try again
        </button>
        <button className="btn" type="button" onClick={onUnpair}>
          Use a different code
        </button>
      </div>
    </div>
  );
}

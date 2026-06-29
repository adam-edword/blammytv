import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  onConfigReceived,
  startConfigServer,
  stopConfigServer,
} from "../lib/tauri";
import { setAioUrl } from "../lib/settings";
import { addM3uPlaylist, addPlaylist } from "../lib/playlists";
import { FocusButton } from "./FocusButton";

type ServerInfo = { ip: string; port: number; token: string };

/** Configure the app from a phone or laptop on the same WiFi instead of typing
 * on the remote. The TV runs a tiny LAN server (Rust); this shows its URL + QR
 * and applies whatever the browser form submits. Credentials only ever travel
 * over the local network.
 *
 * The submitted shape today is `{ aioUrl, xtream? }`; future source types
 * (M3U, Stalker/MAG) extend the form and are handled here by key. */
export function SetupHandoff({
  onDone,
  onManual,
}: {
  onDone: () => void;
  /** Optional fallback to a typed form (e.g. if the LAN handoff can't reach). */
  onManual?: () => void;
}) {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [received, setReceived] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    let alive = true;
    startConfigServer()
      .then((i) => alive && setInfo(i))
      .catch((e) => alive && setError(String(e)));

    const off = onConfigReceived((json) => {
      try {
        const cfg = JSON.parse(json) as {
          aioUrl?: string;
          xtream?: { url?: string; username?: string; password?: string };
          m3u?: { url?: string; epgUrl?: string };
        };
        if (cfg.aioUrl?.trim()) setAioUrl(cfg.aioUrl.trim());
        if (cfg.xtream?.url?.trim()) {
          addPlaylist({
            baseUrl: cfg.xtream.url.trim(),
            username: cfg.xtream.username ?? "",
            password: cfg.xtream.password ?? "",
          });
        }
        if (cfg.m3u?.url?.trim()) {
          addM3uPlaylist({
            url: cfg.m3u.url.trim(),
            epgUrl: cfg.m3u.epgUrl?.trim() || undefined,
          });
        }
        setReceived(true);
        setTimeout(() => onDoneRef.current(), 1000);
      } catch {
        setError("Received a malformed payload — try again.");
      }
    });

    return () => {
      alive = false;
      off();
      void stopConfigServer();
    };
    // Mount once: the server lives for the life of this screen.
  }, []);

  const url = info ? `http://${info.ip}:${info.port}/?t=${info.token}` : "";

  return (
    <div className="setup">
      <div className="setup__card">
        <img className="setup__logo" src="/logo.png" alt="" />
        <h1 className="setup__title">Set up from your phone</h1>

        {received ? (
          <p className="setup__lede setup__lede--ok">Got it ✓ Loading your library…</p>
        ) : error ? (
          <p className="setup__lede setup__lede--err">{error}</p>
        ) : (
          <>
            <p className="setup__lede">
              On a phone or laptop on the same WiFi, open this address and paste
              your provider details. They never leave your network.
            </p>
            {info ? (
              <div className="setup__handoff">
                <div className="setup__qr">
                  <QRCodeSVG value={url} size={188} />
                </div>
                <div className="setup__addr">
                  <span className="setup__url">
                    {info.ip}:{info.port}
                  </span>
                  <span className="setup__code">code {info.token}</span>
                </div>
              </div>
            ) : (
              <p className="setup__lede">Starting…</p>
            )}
          </>
        )}

        {onManual && !received && (
          <FocusButton
            className="btn setup__manual"
            focusKey="setup-manual"
            autoFocus
            onPress={onManual}
          >
            Enter manually instead
          </FocusButton>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState, type RefObject } from "react";
import type Hls from "hls.js";
import type { SourceStats } from "../lib/desktop";
import { CloseIcon } from "./icons";

/**
 * "Stats for Nerds" — a glanceable diagnostics panel for the theater player.
 *
 * Source video details come from ffprobe (passed in as `source`); the live
 * playback numbers (dropped frames, buffer, bandwidth) are read off the
 * <video> element and the hls.js instance on a 1s poll. Audio reflects what we
 * actually deliver (AAC stereo), not the source.
 */
export function StatsOverlay({
  onClose,
  source,
  videoRef,
  hlsRef,
  channelName,
  streamId,
  epgId,
}: {
  onClose: () => void;
  source: SourceStats | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  hlsRef: RefObject<Hls | null>;
  channelName?: string;
  streamId?: string;
  epgId?: string;
}) {
  const [live, setLive] = useState({
    width: 0,
    height: 0,
    dropped: 0,
    bufferSec: 0,
    bandwidthBps: 0,
  });

  useEffect(() => {
    const tick = () => {
      const v = videoRef.current;
      let dropped = 0;
      let bufferSec = 0;
      let width = 0;
      let height = 0;
      if (v) {
        width = v.videoWidth;
        height = v.videoHeight;
        try {
          dropped = v.getVideoPlaybackQuality().droppedVideoFrames;
        } catch {
          /* unsupported */
        }
        for (let i = 0; i < v.buffered.length; i++) {
          if (v.currentTime >= v.buffered.start(i) && v.currentTime <= v.buffered.end(i)) {
            bufferSec = v.buffered.end(i) - v.currentTime;
            break;
          }
        }
      }
      setLive({
        width,
        height,
        dropped,
        bufferSec,
        bandwidthBps: hlsRef.current?.bandwidthEstimate ?? 0,
      });
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [videoRef, hlsRef]);

  const w = source?.source?.width ?? (live.width || null);
  const h = source?.source?.height ?? (live.height || null);

  return (
    <div className="stats" role="dialog" aria-label="Stats for nerds">
      <div className="stats__head">
        <span className="stats__title">Stats for Nerds</span>
        <button className="stats__close" type="button" aria-label="Close" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </div>

      <Section title="Video">
        <Row label="Resolution" value={resolution(w, h)} />
        <Row label="Codec" value={codecName(source?.source?.codec)} />
        <Row label="Pixel Format" value={source?.source?.pixFmt ?? "—"} />
        <Row label="Frame Rate" value={fps(source?.source?.frameRate)} />
        <Row label="Bitrate" value={mbps(source?.source?.bitRate)} />
        <Row label="HDR" value={source ? (source.hdr ? "Yes → tone-mapped" : "No") : "—"} />
      </Section>

      <Section title="Audio (delivered)">
        <Row label="Codec" value={(source?.delivered.audioCodec ?? "aac").toUpperCase()} />
        <Row label="Sample Rate" value={source?.audioSampleRate ? `${source.audioSampleRate} Hz` : "—"} />
        <Row label="Channels" value={channels(source?.delivered.audioChannels ?? 2)} />
        <Row label="Bitrate" value={`${source?.delivered.audioBitrateKbps ?? 160} kbps`} />
      </Section>

      <Section title="Performance">
        <Row label="Dropped Frames" value={String(live.dropped)} dim={live.dropped === 0} />
      </Section>

      <Section title="Buffer">
        <Row label="Buffer Ahead" value={`${live.bufferSec.toFixed(1)} s`} />
        <Row label="Download Speed" value={speed(live.bandwidthBps)} />
      </Section>

      <Section title="Stream">
        <Row label="Channel" value={channelName ?? "—"} />
        <Row label="Stream ID" value={streamId ?? "—"} />
        <Row label="EPG ID" value={epgId ?? "—"} />
        <Row label="Pipeline" value={source ? (source.hdr ? "copy + HDR→SDR" : "copy") : "—"} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="stats__section">
      <div className="stats__heading">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className="stats__row">
      <span className="stats__label">{label}</span>
      <span className={"stats__value" + (dim ? " stats__value--dim" : "")}>{value}</span>
    </div>
  );
}

function resolution(w: number | null, h: number | null): string {
  if (!w || !h) return "—";
  const tag = h >= 2160 ? " (4K)" : h >= 1080 ? " (1080p)" : h >= 720 ? " (720p)" : ` (${h}p)`;
  return `${w} × ${h}${tag}`;
}

function codecName(c: string | null | undefined): string {
  if (!c) return "—";
  const map: Record<string, string> = {
    h264: "H.264 / AVC",
    hevc: "H.265 / HEVC",
    mpeg2video: "MPEG-2",
    vp9: "VP9",
    av1: "AV1",
  };
  return map[c] ?? c.toUpperCase();
}

function fps(s: string | null | undefined): string {
  if (!s) return "—";
  const [n, d] = s.split("/").map(Number);
  if (!d || Number.isNaN(n)) return "—";
  return `${(n / d).toFixed(2)} fps`;
}

function mbps(bps: number | null | undefined): string {
  if (!bps) return "—";
  return `${(bps / 1e6).toFixed(2)} Mbps`;
}

function channels(n: number): string {
  if (n === 2) return "2 (Stereo)";
  if (n === 1) return "1 (Mono)";
  return String(n);
}

function speed(bps: number): string {
  if (!bps) return "—";
  const bytes = bps / 8;
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB/s` : `${(bytes / 1e3).toFixed(0)} KB/s`;
}

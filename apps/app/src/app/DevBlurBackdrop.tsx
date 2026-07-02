import { useEffect, useState } from "react";

/**
 * TEMPORARY dev scaffolding for tuning the nav's progressive blur: a
 * deliberately sharp, scrollable "poster wall" that sits behind the nav
 * (z-index 10 < header's 20) the way Stream content will. Press B to
 * toggle. Delete this file (and its <DevBlurBackdrop /> in App) once the
 * blur is signed off.
 */

const COLORS = [
  "#e63946",
  "#f1fa8c",
  "#2a9d8f",
  "#e9c46a",
  "#f4a261",
  "#48cae4",
  "#b5179e",
  "#80ed99",
  "#ffd166",
  "#ef476f",
];

export function DevBlurBackdrop() {
  const [shown, setShown] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "b" && !e.repeat) setShown((s) => !s);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!shown) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10,
        overflow: "auto",
        background: "#101018",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, 150px)",
          gap: 14,
          padding: "10px 16px 60px",
        }}
      >
        {Array.from({ length: 64 }, (_, i) => (
          <div
            key={i}
            style={{
              height: 220,
              background: COLORS[i % COLORS.length],
              outline: "2px solid #fff",
              padding: 8,
            }}
          >
            <div
              style={{
                background: "#0b0b10",
                color: "#fff",
                font: "700 12px sans-serif",
                lineHeight: "18px",
                padding: 6,
                height: 62,
              }}
            >
              SHARP
              <br />
              POSTER TILE {i}
            </div>
            {Array.from({ length: 6 }, (_, j) => (
              <div
                key={j}
                style={{ height: 1, background: "#fff", marginTop: 17 }}
              />
            ))}
            <div
              style={{
                marginTop: 14,
                color: "#0b0b10",
                font: "700 11px sans-serif",
              }}
            >
              0123456789 ABCDEFG
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

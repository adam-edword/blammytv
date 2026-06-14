/**
 * Loading skeletons.
 *
 * "Other devs are too lazy to do them" — so we do. While config loads we show a
 * shaped placeholder of the Live screen, never a blank screen or a spinner.
 * The guide skeleton mirrors the real layout: a label column plus a lane of
 * program blocks laid out left-to-right across each row.
 */

// Per-row program block widths (% of the lane), varied so it reads naturally.
const ROW_SEGMENTS = [
  [28, 44, 26],
  [50, 30, 18],
  [70, 28],
  [22, 30, 26, 20],
  [60, 38],
  [34, 40, 24],
  [46, 30, 22],
  [26, 50, 22],
];

const CATEGORY_WIDTHS = [
  "55%",
  "70%",
  "60%",
  "85%",
  "50%",
  "66%",
  "48%",
  "72%",
  "58%",
];

export function LiveScreenSkeleton() {
  return (
    <div className="live-screen" aria-busy="true" aria-label="Loading">
      <section className="now-playing">
        <div className="now-playing__preview skeleton" />
        <div className="now-playing__details">
          <div className="skeleton sk-pill" style={{ width: 84 }} />
          <div className="skeleton sk-line" style={{ width: 150, height: 22 }} />
          <div className="skeleton sk-line" style={{ width: "70%", height: 44 }} />
          <div className="skeleton sk-line" style={{ width: "92%" }} />
          <div className="skeleton sk-line" style={{ width: "80%" }} />
          <div className="skeleton sk-line" style={{ width: 260, height: 14 }} />
        </div>
      </section>

      <div className="live-screen__body">
        <aside className="categories">
          {CATEGORY_WIDTHS.map((w, i) => (
            <div className="sk-category" key={i}>
              <div className="skeleton sk-line" style={{ width: w, height: 22 }} />
            </div>
          ))}
        </aside>

        <div className="guide">
          <div className="sk-guide">
            <div className="sk-guide__ruler">
              <div className="sk-guide__label-spacer" />
              <div className="sk-guide__ruler-track">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    className="skeleton sk-line"
                    key={i}
                    style={{ width: 60, height: 16 }}
                  />
                ))}
              </div>
            </div>

            {ROW_SEGMENTS.map((segs, row) => (
              <div className="sk-guide__row" key={row}>
                <div className="skeleton sk-guide__label" />
                <div className="sk-guide__lane">
                  {segs.map((w, i) => (
                    <div
                      className="skeleton sk-guide__block"
                      key={i}
                      style={{ flex: `0 0 ${w}%` }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

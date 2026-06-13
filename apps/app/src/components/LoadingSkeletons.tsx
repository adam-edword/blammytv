/**
 * Loading skeletons.
 *
 * "Other devs are too lazy to do them" — so we do. While config loads we show a
 * shaped placeholder of the Live screen, never a blank screen or a spinner.
 */

export function LiveScreenSkeleton() {
  return (
    <div className="live-screen" aria-busy="true" aria-label="Loading">
      <section className="now-playing">
        <div className="now-playing__preview skeleton" />
        <div className="now-playing__details">
          <div className="skeleton sk-pill" style={{ width: 84 }} />
          <div className="skeleton sk-line" style={{ width: 140, height: 22 }} />
          <div className="skeleton sk-line" style={{ width: "70%", height: 44 }} />
          <div className="skeleton sk-line" style={{ width: "90%" }} />
          <div className="skeleton sk-line" style={{ width: "80%" }} />
          <div className="skeleton sk-line" style={{ width: 260, height: 14 }} />
        </div>
      </section>

      <div className="live-screen__body">
        <aside className="categories">
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              className="skeleton sk-line"
              key={i}
              style={{ width: `${55 + ((i * 13) % 40)}%`, height: 26, margin: "13px 18px" }}
            />
          ))}
        </aside>

        <div className="guide">
          <div className="guide__inner">
            <div className="time-ruler">
              <div className="time-ruler__spacer" />
              <div className="time-ruler__track">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="skeleton sk-line"
                    style={{ width: 70, height: 18, marginRight: 215 }}
                  />
                ))}
              </div>
            </div>
            {Array.from({ length: 8 }).map((_, row) => (
              <div className="guide-row" key={row}>
                <div className="guide-row__label skeleton" />
                <div className="guide-row__lane">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="skeleton program-skeleton"
                      style={{ width: `${30 + ((row + i * 7) % 40)}%` }}
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

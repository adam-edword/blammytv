# BlammyTV — working agreements

## Confirm with data before significant changes

Before making a non-trivial code change to explain or fix a behavior, **confirm
the cause with real data first — don't guess.** Add a diagnostic (log the actual
state, read the real values, reproduce the signal) and let the data drive the
fix. The HDR brightness investigation is the model: instead of asserting "it's
HDR," we logged mpv's actual colour pipeline (`gamma=pq`, `primaries=bt.2020`,
`sig-peak=4.9`) and proved it.

Applies to: anything where the mechanism isn't obvious from the code — rendering/
colour/HDR, timing/races, native/OS behavior, performance. Small, obvious edits
don't need a ceremony; uncertain or significant ones do.

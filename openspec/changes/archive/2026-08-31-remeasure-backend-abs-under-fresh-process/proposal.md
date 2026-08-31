# Re-measure the two backend-plane A/Bs under the fresh-process regime

## Why

`strides-b0y` established that most of this repo's recorded run-to-run spread is a cold-vs-warm
Chromium-process split, and that a range column measured under `--reuse-browser` is a two-state
mixture whose composition depends on trial index and clip order. Two historical A/Bs leaned on
such a range hard enough to be worth re-measuring:

1. **Tracking crop** (2026-08-13). Its default-OFF decision turned on ONE cell — park cadence/VO
   confidence, off "0.63–0.69, tight" vs on "0.18–0.77, median 0.32" — where the on arm's range
   fully contains the off arm's, and whose park `detectedFrames` row read 62/75/76, the signature
   of a cold trial. Tracking crop adds real per-frame work, so the arm and the artifact are
   correlated rather than independent.
2. **Person-of-interest cost** (2026-08-15). The reported cost is pure throughput — track −16% of
   detected frames (−4% of samples), park −25% of both — and throughput is exactly what warmth
   moves hardest (+23% on multiperson with no code change at all).

Both live on `window.__STRIDES_POSE_BACKEND_OVERRIDE__`, which the A/B driver could not reach until
`strides-4oj`.

## What Changes

- Both A/Bs re-run at 3 fresh-process trials per arm on both demo clips, real GPU, via
  `scripts/ab-person-selection.mjs --backend-arm`, with the regime stamped in the report header.
- **No code change and no default change.** Tracking crop stays `enabled: false`; person-of-interest
  stays `enabled: true`.
- CLAUDE.md gains an addendum beside each existing table. Neither historical table is edited.
- Two follow-up beads for what the fresh numbers exposed and these tickets did not scope.

## Impact

- `CLAUDE.md` only.
- No `src/` change, no spec delta.

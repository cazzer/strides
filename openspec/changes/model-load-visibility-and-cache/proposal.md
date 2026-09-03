# Make model downloads visible, and keep the bytes across page loads

## Why

`strides-utn`. Two independent, differently-timed model downloads happen on every page load, and
neither is mentioned to the reader or kept afterwards.

Measured on this session's checkout, not re-derived here:

- **MoveNet SinglePose + MultiPose Lightning** are fetched at app mount, from tfhub, inside
  `createMoveNetDetector` (`src/pose/backends/movenet.ts:317-330`).
- **`pose_landmarker_full.task`** (9,398,198 bytes, self-hosted under `public/models/`) and the
  `@mediapipe/tasks-vision` WASM (jsdelivr) are fetched **lazily**, only once a first clip reaches
  `phase: 'ready'` — `useVideoAnalysis.ts:497-503` → `src/pose/scalePassDetector.ts`.
- **The load state already exists and is thrown away.** `PoseDetectorStatus`
  (`src/pose/usePoseDetector.ts:6`) is `'loading' | 'ready' | 'error'`; `src/App.tsx:17-19`
  destructures `.detector` and drops `status` on the floor. Nothing renders it. Creation failure is
  swallowed into that same unrendered status (`usePoseDetector.ts:37-43`).
- **A loaded clip therefore reads "Ready" while the app is blocked on an unmentioned network
  fetch.** The only model-loading string anywhere in the product appears as an *error*, after a
  click that already failed (`useVideoAnalysis.ts:189-201`).
- **No client-side caching exists at all**: no service worker, manifest, `vite-plugin-pwa`,
  `CacheStorage`, IndexedDB, `localStorage`, or `tf.io` model storage anywhere in `src/`.
- **Response headers are not ours to set.** The deploy is GitHub Pages. Measured live, the `.task`
  file comes back with `cache-control: max-age=600`. The comment at
  `src/pose/backends/mediapipePoseLandmarker.ts:17-23` — which justifies self-hosting partly on
  "same-origin hosting rides our own deploy's caching" — is wrong in practice: ten minutes is
  **6× worse** than the 3600 s the Google bucket it replaced was serving. Client-side storage is
  the only route to bytes that survive a page load.

## What Changes

- **Model load state becomes observable from both detector owners.** `usePoseDetector` widens its
  returned state to a load phase plus an **optional** determinate byte-progress channel, and the
  module-cached scale-pass detector gains a plain (non-React) publish/subscribe observation channel
  plus a hook that reads it. `App.tsx` stops dropping `status` and threads both states down to
  `MultiClipVideoSession`.
- **A shared model fetch/cache/progress utility.** One function fetches a model asset with byte
  progress against `Content-Length`, serving from Cache Storage on a hit and populating it on a
  miss, keyed by asset URL plus an explicit model-version token. Every read and write degrades
  gracefully — `caches` is absent in some contexts and throws in others.
- **The 9.4 MB MediaPipe `.task` routes through it**, via `BaseOptions.modelAssetBuffer` instead of
  `modelAssetPath`. The stale caching claim in that file's comment is corrected while there.
- **MoveNet's weights route through it too**, via a custom `io.IOHandler` passed as `modelUrl` —
  **gated on `strides-utn.2`'s browser measurement**, and withdrawn from this change if that spike
  returns no-go for the asset.
- **A model-download entry renders at the head of the header bar**, showing determinate progress
  where byte counts exist and indeterminate progress where they do not, never a fabricated
  percentage, and a real failure caption instead of sitting at "Loading…" forever.

## Impact

- `src/pose/usePoseDetector.ts`, `src/pose/scalePassDetector.ts`, `src/App.tsx`,
  `src/results/MultiClipVideoSession.tsx`, plus new `src/pose/modelLoadState.ts`,
  `src/pose/useScalePassDetectorLoad.ts`, a shared model-cache module, a header model-entry
  component, and their tests.
- `src/pose/backends/mediapipePoseLandmarker.ts` (asset load path and its stale caching comment),
  `src/pose/backends/movenet.ts` (weight load path).
- **Ships as ONE change, not four.** All four implementation tickets touch the `pose-detection`
  spec, and CLAUDE.md records that two in-flight changes each carrying a MODIFIED block for the
  same requirement clobber each other silently — last archive wins, and `openspec validate
  --strict` does not catch it. Serializing the spec edits inside a single change removes that
  failure mode entirely rather than relying on archive ordering.
- **`strides-utn.4` carries a correctness risk that the other tickets do not**: it changes how model
  WEIGHTS load. This repo has a documented history of clean, plausible, wrong numbers, so its
  acceptance gate is a before/after `scripts/ab-person-selection.mjs` run across all three clips
  showing no field moving except `elapsedMs` — not a smoke test.
- **Deliberately NOT in scope: an eager page-load prefetch of the MediaPipe model.** 9.4 MB fetched
  unconditionally for a visitor who may never analyse a clip is a cost this repo is not paying
  today, and this change does not start. Downloads are instrumented where they already happen.

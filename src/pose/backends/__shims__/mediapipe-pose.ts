/**
 * Build-time shim for `@mediapipe/pose`.
 *
 * `@tensorflow-models/pose-detection`'s single bundled ESM entry point
 * (`dist/pose-detection.esm.js`) has a top-level `import { Pose } from '@mediapipe/pose'` —
 * used only by that package's mediapipe-*runtime* BlazePose backend, which this app never
 * selects (we only use `SupportedModels.MoveNet` on the plain TFJS runtime, see
 * `../movenet.ts`). `@mediapipe/pose`'s actual build (`pose.js`) isn't real ESM/CJS — it's a
 * script meant for `<script>`-tag/global use, and exports nothing a bundler can statically
 * resolve, so Rollup fails with `MISSING_EXPORT` the moment anything reachable from the app's
 * entry point imports `@tensorflow-models/pose-detection` at all (previously irrelevant,
 * before this ticket wired pose-detection into `App.tsx`).
 *
 * This shim is aliased in `vite.config.ts` in place of the real package so that unconditional
 * import resolves. It is never actually exercised: nothing in this app's code path constructs
 * or reads `Pose`.
 */
export class Pose {}

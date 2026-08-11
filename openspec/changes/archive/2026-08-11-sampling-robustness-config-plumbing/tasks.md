## 1. Config type

- [x] 1.1 New `src/results/samplingRobustnessConfig.ts` (relocated from the originally-planned
      `src/pose/robustness/` — that would have made a lower-level module import upward from
      `src/results/sampleClip.ts`, inverting the existing dependency direction; `results/`
      already depends on `pose/robustness/`, not the reverse): `SamplingRobustnessConfig`
      (`{ robustness: RobustnessConfig, maxConsecutiveErrors: number, detectionTimeoutMs: number }`)
      and `DEFAULT_SAMPLING_ROBUSTNESS_CONFIG`, built from `DEFAULT_ROBUSTNESS_CONFIG` and
      `sampleClip.ts`'s existing `DEFAULT_MAX_CONSECUTIVE_ERRORS`/`DEFAULT_DETECTION_TIMEOUT_MS`
      constants (imported, not restated). Also includes `resolveSamplingRobustnessConfig()`
      (originally planned as inline logic in `useVideoAnalysis.ts` — encapsulated here instead
      for independent testability) and the `window` global's type declaration.
- [x] 1.2 `src/results/samplingRobustnessConfig.test.ts`: confirm the default equals the
      existing constants exactly, plus `resolveSamplingRobustnessConfig`'s merge/dev-only
      behavior (folds in tasks 3.2's coverage).

## 2. Thread through the analysis run

- [x] 2.1 `src/results/useVideoAnalysis.ts`: resolve one `SamplingRobustnessConfig` at the top
      of `start()` via `resolveSamplingRobustnessConfig()`, then pass `config.robustness` into
      `applyRobustness(sorted, config.robustness)` and
      `config.maxConsecutiveErrors`/`config.detectionTimeoutMs` into `sampleClip`'s options
      alongside the existing `onProgress`/`onPausedChange`.
- [x] 2.2 Update `useVideoAnalysis.test.ts`: confirm `applyRobustnessMock`/`sampleClipMock` are
      called with the expected default config when no override is present, and with the
      overridden values when `window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__` is set
      before `start()` is called. Also found and fixed: the module-level `vi.mock('./sampleClip',
      ...)` only re-exported `sampleClip`, not the two constants
      `samplingRobustnessConfig.ts` imports from that module — added them to the mock with their
      real values.

## 3. Development-only override

- [x] 3.1 Implemented as `resolveSamplingRobustnessConfig()` in `samplingRobustnessConfig.ts`
      (see task 1.1) rather than inline in `useVideoAnalysis.ts` — same merge logic as planned,
      just encapsulated for independent testability. Global type declared via module
      augmentation in `samplingRobustnessConfig.ts` itself.
- [x] 3.2 Test coverage: default behavior unchanged with no override; override values honored
      when present; a production-mode stub (`vi.stubEnv('DEV', false)`) confirms the override is
      ignored outside dev — covered in both `samplingRobustnessConfig.test.ts` (the resolver
      directly) and `useVideoAnalysis.test.ts` (the full wiring).

## 4. Verification

- [x] 4.1 `npx vitest run`, `npx tsc -b`, `npx eslint .` all clean (284/284 tests);
      `openspec validate --strict` passes for this change.
- [x] 4.2 Live-browser check via the existing Playwright harness: no-override baseline
      (`view: side, confidence: 0.761, 552 detected keypoints, trunkLean confidence: 1`) matches
      pre-change behavior. `page.addInitScript()` (not `page.evaluate()` — auto-analyze can start
      before an `evaluate()` call would land, `addInitScript` guarantees the global is set before
      any page script runs) set `{ robustness: { minKeypointConfidence: 0.9 } }` before load;
      resulting diagnostics collapsed to `view: ambiguous, confidence: 0, 3 detected keypoints,
      trunkLean confidence: 0` — the override visibly, dramatically changed pipeline behavior
      end-to-end, confirming the plumbing actually reaches both `applyRobustness` and
      `sampleClip`.

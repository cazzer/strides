## 1. Presence-window trim

- [x] 1.1 `src/heuristics/types.ts`: add `presenceMinConsecutiveFrames` to `HeuristicsConfig`
      and `DEFAULT_HEURISTICS_CONFIG` (a short run length, e.g. 3 — document the reasoning
      alongside this pipeline's other judgment-call thresholds).
- [x] 1.2 New `src/heuristics/presenceWindow.ts`: `trimToPresenceWindow(frames: RobustPoseFrame[],
      config: HeuristicsConfig): RobustPoseFrame[]`. A frame is "present" when
      `resolveMidpoint(frame, 'left_shoulder', 'right_shoulder')` and
      `resolveMidpoint(frame, 'left_hip', 'right_hip')` both resolve (the same check
      `estimateBodyScale` uses). Find the window from the first frame starting a run of at least
      `presenceMinConsecutiveFrames` consecutive present frames, to the last frame of the last
      such run. Return `frames` unchanged if the window spans the whole input; return `[]` if no
      qualifying run exists.
- [x] 1.3 `src/heuristics/presenceWindow.test.ts`: cover trimming leading/trailing absence,
      ignoring an isolated spurious detection below the consecutive-run threshold, a clip present
      throughout (no-op), and a clip with no trackable frames at all (empty result).
- [x] 1.4 `src/results/useVideoAnalysis.ts`: compute `const presentFrames =
      trimToPresenceWindow(robustFrames, config)` and call `computeFormHeuristics(presentFrames)`
      instead of `computeFormHeuristics(robustFrames)`. `state.robustFrames` and the diagnostics
      computation (`computeAnalysisDiagnostics(sorted, robustFrames, heuristics)`) keep using the
      untrimmed `robustFrames` — only the heuristics call itself uses the trimmed frames.
- [x] 1.5 Update `useVideoAnalysis.test.ts`/`index.test.ts` fixtures as needed if the trim
      changes any existing test's expected `frameCoverage`/confidence values for frames that
      include unresolvable leading/trailing padding. (Found and fixed a real gap:
      `trimToPresenceWindow` isn't mocked — it's cheap/pure — so it ran for real against
      `FAKE_ROBUST_FRAMES`, which had an empty `keypoints: []` array violating
      `RobustPoseFrame`'s documented 12-keypoint contract, throwing inside `resolveMidpoint`.
      Fixed the fixture to a full, valid 12-keypoint frame, repeated 3x to satisfy
      `presenceMinConsecutiveFrames` so trim-sensitive assertions stay exact-match.)

## 2. Cadence: median inter-footstrike-interval

- [x] 2.1 `src/heuristics/cadence.ts`: replace the `strikeCount / durationMinutes` computation
      with `60 / median(intervals)`, where `intervals` are the timestamp differences between
      consecutive `detectFootstrikes` candidates (already timestamp-sorted). Require at least 2
      candidates (not just non-zero) to compute an interval; fewer produces the existing
      too-few-footstrikes null result. Removed the now-unused duration-span calculation; split
      the zero/one-footstrike null cases into distinct, accurate caveat messages.
- [x] 2.2 `src/heuristics/cadence.test.ts`: update/add coverage for the new computation —
      matches a hand-computed median-interval cadence on a synthetic footstrike sequence;
      dead time before the first or after the last footstrike doesn't change the value (only
      the interval-bearing footstrikes matter); a single anomalously large mid-sequence interval
      (simulating a tracking dropout) doesn't pull the median as far as a mean would; exactly one
      footstrike (no interval possible) and zero footstrikes both produce the null result.

## 3. Verification

- [x] 3.1 `npx vitest run`, `npx tsc -b`, `npx eslint .` all clean (277/277 tests);
      `openspec validate --strict` passes for this change.
- [x] 3.2 Live-browser check via the existing Playwright harness (GPU flags —
      `--headless=new --enable-gpu --ignore-gpu-blocklist`): run the demo clip (out-of-frame at
      start and end) through `analysisDiagnostics`, confirm `bodyScale`-derived `frameCoverage`
      values across the affected metrics are noticeably higher than the pre-fix run captured
      earlier this session, and confirm cadence's reported value is plausible (not diluted
      toward zero by the dead time at the clip's edges). (Confirmed dramatically: view went from
      `ambiguous`/confidence 0 to `side`/confidence 0.755; verticalOscillation, trunkLean,
      overstriding, cadence, and footStrikePattern all went from null/confidence-0 to real
      values at confidence 1.0; kneeFlexion at confidence 0.98; cadence reports a plausible 125
      steps/min. armSwingSymmetry correctly stays low-confidence — front-view-primary, this is a
      side-view clip, that's `viewFit` gating working as intended, not a coverage problem. The
      untrimmed diagnostics sampling numbers are unchanged, confirming only the metrics
      computation — not the overlay/diagnostics view — is affected, as designed.)

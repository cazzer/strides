# Design — add-background-scale-pass

## D1 — Orchestration lives in `useVideoAnalysis`, as state + one effect

`VideoAnalysisState` gains:

```ts
scalePass: {
  status: 'idle' | 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  /** Set only when status is 'skipped'. */
  reason?: 'disabled' | 'primary-scale'
  /** Set only when status is 'failed'. */
  error?: string
  /** The scale pass's own diagnostics. Set only when status is 'done'. */
  diagnostics: AnalysisDiagnostics | null
}
```

(`reason`/`error` are a small widening of the originally-sketched `{ status, diagnostics }`
shape: the dev console emission needs both, and carrying them in state — rather than in refs the
emission effect would have to trust to be in sync — keeps the terminal transition and its payload
one atomic `setState`.)

**Decision points:**

- The primary run's ready-`setState` (inside `start()`'s async continuation) decides `'pending'`
  vs `'skipped'`, at the moment the primary result exists:
  - `'skipped'`/`'primary-scale'` when `heuristics.verticalOscillationCm.calibration !== null` —
    the primary backend already measured a real-world scale (today only possible via the
    dev-only mediapipe-primary backend override), so a second pass has nothing to add.
  - `'skipped'`/`'disabled'` when `resolveScalePassConfig().enabled` is false (kill switch).
  - `'pending'` otherwise.
- A dedicated effect fires on `phase === 'ready' && scalePass.status === 'pending'`, guarded by
  a `scalePassStartedForRunRef` (mirrors `autoStartedForRef`) against double-start from
  re-renders between the `'pending'` commit and the `'running'` commit. It captures the primary
  `runId` at start; **every** subsequent `setState` bails when `runIdRef.current !== runId`, the
  identical stale-discard rule the primary run uses — `reset()` / a new clip invalidates the
  scale pass exactly as it invalidates a primary run.
- The pass replays the SAME video element: `muted = true`, `loop = false`, `currentTime = 0`,
  `play()`, and the same `sampleClip` primitive with `maxConsecutiveErrors`/`detectionTimeoutMs`
  from `resolveSamplingRobustnessConfig()` (no `onProgress`/`onPausedChange` — the pass is
  background, nothing renders its progress). Its handle lives in a new `scaleHandleRef`;
  `abandonActiveRun` stops BOTH handles.
- Wall-clock watchdog: `max(30_000, 3 × durationSec × 1000)` ms. `SampleClipHandle.stop()`
  RESOLVES the promise with partial samples rather than rejecting, so the watchdog sets a local
  `timedOut` flag before stopping — the resolution path checks the flag and discards the partial
  samples instead of processing them.
- On samples: sort → `applyRobustness` → `trimToPresenceWindow` → `computeFormHeuristics` — the
  byte-identical pipeline the primary runs (same resolved robustness config). Graft rule: graft
  iff the scale result's `verticalOscillationCm.calibration !== null`; a pass that measured no
  scale at all is a `'failed'` pass (primary heuristics untouched), not a silent no-op graft.
- On success: `state.heuristics` is replaced by the grafted object; `state.diagnostics` is
  UNCHANGED (stays the primary's — the primary console line must stay byte-identical);
  `scalePass.status = 'done'` with `scalePass.diagnostics =
  computeAnalysisDiagnostics(scaleSorted, scaleRobustFrames, scaleHeuristics)`.
- **Loop-restart effect**: now returns unless `phase === 'ready'` AND `scalePass.status` is none
  of `'pending'`/`'running'`, with `state.scalePass.status` added to its deps. That one effect
  declaratively owns loop re-arming: fires immediately when the pass was skipped, fires again
  when the pass reaches `'done'`/`'failed'`. No imperative re-arm call anywhere in the pass.
- Failure isolation: detector `null`, `play()` rejection, `sampleClip` rejection, pipeline
  throw, watchdog expiry, and measured-no-scale all land on `'failed'` with an `error` string —
  and in every one of those cases the primary result (heuristics, diagnostics, phase) is
  untouched. The scale pass can only ever improve the displayed result, never degrade it.

## D2 — Dedicated, cached, override-exempt detector

`src/pose/scalePassDetector.ts`: module-level `getScalePassDetector(): Promise<PoseDetector |
null>` mirroring `usePoseDetector`'s `getDetector` shape — lazily
`createDetector({ backend: 'mediapipePoseLandmarker' })`, instance cached for the page lifetime
(no per-pass disposal — the whole point is amortizing the WASM/model load across runs), pending
promise reset on failure so the next run retries, `null` on failure (callers degrade, never
throw). It NEVER reads `resolvePoseDetectorConfig()`: `__STRIDES_POSE_BACKEND_OVERRIDE__`
selects the PRIMARY backend only. A mediapipe-primary override is instead handled by the
`'primary-scale'` skip (D1) — the pass doesn't run at all, rather than running redundantly.
`__disposeForTests()` resets module state for unit isolation.

## D3 — Graft is a pure function outside `src/heuristics/`

`graftScalePassResult(primary, scale)` returns
`{ ...primary, verticalOscillationCm: { ...scale.verticalOscillationCm, caveat: composed } }` —
`FormHeuristicsResult` in, `FormHeuristicsResult` out, no type changes. The provenance sentence
("Measured by a second, scale-aware detection pass (MediaPipe Pose Landmarker) over the same
clip; all other metrics come from the primary pass.") is appended after the scale result's own
caveat when one exists, space-joined — the same composition idiom the heuristics layer's own
multi-caveat paths use. A measured-but-unfittable scale result (null value, non-null
calibration, fit-failure caveat) grafts too: its named failure reason plus provenance replaces
the primary's generic "no scale was measured" availability caveat, which after a completed
MediaPipe pass would be false. All eight other metrics and `view` stay reference-identical to
`primary`'s; `calibration` carries by reference (so `scalePass.diagnostics.scaleCalibration ===
grafted.verticalOscillationCm.calibration`, the same identity invariant #36 established).

## D4 — Kill switch as a config pattern-clone

`scalePassConfig.ts` clones `samplingRobustnessConfig.ts`: typed default
(`{ enabled: true }`), dev-only window override (`__STRIDES_SCALE_PASS_CONFIG_OVERRIDE__`,
declared `declare global` in the config module like both existing override globals), resolved
once at primary-ready. Production builds never read the override (`import.meta.env.DEV` guard,
dead-code-eliminated).

## D5 — UI: one hint, no new card states

`MetricsPanel` gains optional `scalePassInProgress?: boolean` (default false — every existing
call site unchanged); `ResultsView` derives it from `analysis.scalePass.status` (`'pending'` or
`'running'`). While in progress AND `verticalOscillationCm` is excluded with a `null` value, its
excluded entry renders "Measuring real-world scale with a second detection pass…" instead of the
availability caveat. That's the entire UI delta: when the graft lands, the re-render routes the
metric through the existing `metricTier` rules — under exclude-only-unmeasurable-metrics, any
grafted non-null value renders as a caveated card carrying the provenance note (measured values
are never excluded for low confidence); only a measured-but-unfittable graft (`value: null`,
fit-failure caveat) stays in the excluded section, showing the grafted caveat as its reason. No
tier changes, no special-case card. (Measured live on this branch: track VO-cm ≈4.82-4.85 cm at
confidence 0.38-0.40, park ≈10.4-12.3 cm at 0.30-0.38 — all render as Low-confidence caveated
cards under the current rule. The original implementation ran against the pre-reversal tier rule
where sub-0.4 confidence was excluded; that observation is obsolete on this branch.)

## D6 — Diagnostics: two lines, first byte-identical

The existing `[analysis-diagnostics]` emission keeps its trigger, prefix, and payload —
primary-run data only, `scaleCalibration` key present iff the PRIMARY backend measured scale. A
second effect, keyed on the `scalePass` object identity, emits
`[analysis-diagnostics:scale-pass]` exactly once per terminal transition
(`done`/`failed`/`skipped`) with `{ status, reason?, error?, diagnostics? }` — `diagnostics`
only on `'done'`. Same `import.meta.env.DEV` gate. A harness therefore reads:
first line = primary (its `'scaleCalibration' in …` test now discriminates the PRIMARY backend
only); second line = the scale pass, including the full scale-pass diagnostics on success.

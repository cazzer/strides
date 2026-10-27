## Why

Cadence is the Rhythm stop's headline, but the model runner drew nothing for it: cadence moves no
geometry, so `PARAM_ANNOTATION_KIND.cadence` was null and the stop showed a figure with no mark
for its own number (trn2.3 UX review, bead strides-ps19.6). The same review asked for the
foot-strike label "Heel strike (proxy)" to say what the reader is looking at, and for the
foot-path guides to meet the feet in the `feetFront` framing: the step-width ankle drop was hidden
inside the foot, the other foot had no guide, and the midline was a stub standing on its own.

## What Changes

- Cadence gets an annotation kind, `'beat'`: its "N steps/min" label just above the head (the
  point its intro flash already used, now `headTopAnchor`), a short tick under each foot's contact
  point, and, while the figure plays with motion allowed, a small accent ring that pulses out from
  each foot as it lands. Two footfalls a cycle at cadence / 120 cycles a second make the rings beat
  at cadence × playback rate per minute; the label keeps the measured cadence. Paused or under
  reduced motion, no ring is drawn.
- The runner's foot-strike label names the first contact as an estimate: "Heel first (estimate)",
  "Midfoot first (estimate)", "Forefoot first (estimate)", from the same classification the cards
  use. The shared card wording in `src/results/formatGuidedValue.ts` is unchanged (a follow-up).
- Step-width guides: a midline plumb from hip-mid and a tick under each foot's planted position,
  replacing the ankle drop. The offset mark itself is unchanged.
- ModelRunner's API is additive only: no prop changes. New exports: `beatEnvelope`,
  `BEAT_DECAY_CYCLES`, `headTopAnchor`, `BeatPulse`; `AnnotationKind` gains `'beat'`;
  `RunnerAnnotation` gains an optional `pulses`; `RUNNER_PX` gains `beatRingMin`/`beatRingMax`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-runner`: the focus annotation requirement covers cadence, the foot-strike wording and the
  step-width guides; a new requirement states the footfall beat.

## Impact

- `src/runner/runnerAnnotations.ts`, `introFlash.ts`, `runnerScene.ts`, `ModelRunner.tsx` and their
  tests. `gaitModel.ts`, `runnerParams.ts` and `__fixtures__/measureModel.ts` are untouched, so
  every bound value is still drawn exactly.
- No change under `src/results`; the summary's and tour's Rhythm views pick the beat up through
  their existing cadence focus.

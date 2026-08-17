# Design — detect scale-pass subject divergence

## D1 — The signal: per-instant bbox agreement at matched timestamps

**Every aggregate candidate fails for one structural reason: the two winners are aggregates over
different sample sets, so any statistic over them confounds "different person" with "different
sample support."** Only a paired comparison at common instants controls for that.

The candidates, and how each fails:

- **Evidence span** (would need new diagnostics fields). Catches only the time-disjoint bystander
  and is vacuous for a co-temporal one. Carries no positional data, so the ticket's own objection
  to the partition span survives almost intact.
- **Median bbox centre** (would need new fields). **False-positive mechanism on Demo 1**: the
  runner traverses the frame, so the median centre is a function of which sub-span the winner
  covers. Same person, different detector recall → centre differs by a large fraction of the
  traverse.
- **`medianAreaPx` ratio** (exists today). **False-positive mechanism on Demo 2**: front-approach
  clip, apparent size grows monotonically, so median area is span-dependent for the same person.
  Also structurally blind to two people at the same distance.

These two are span-dependent **in opposite directions on the two clips we must not regress**. Any
threshold wide enough to survive both is too wide to catch real divergence.

At a common instant the same person has the same apparent size and image position regardless of
backend. Everything needed already exists:

- **The boxes.** `RobustPoseFrame.keypoints[i].status === 'detected'` iff that keypoint cleared
  robustness's floor *in a sample that survived person selection* — losing samples become
  `{timestamp, frame: null}` and `classifyFrame` marks every channel of a null frame missing. So
  filtering a robust frame to its `'detected'` keypoints and running `deriveBoundingBox` with the
  run's own `personSelection` confidence knobs reproduces exactly the box the selection stage
  scored. **No new plumbing, and no new diagnostics field.**
- **Cross-backend comparability.** `BBOX_EXCLUDED_KEYPOINT_NAMES` excludes head and foot points, so
  the box is the hull of the same 12 limb/torso landmarks on both backends. MediaPipe emits them in
  source-video pixels. Same anatomy, same coordinate space.
- **Clock.** `PoseFrame.timestamp` is seconds on the clip's own media clock. Both passes draw from
  the same discrete set of frame presentation times, and both resolve `usesSequentialDecode` from
  the same state — so they always use the **same sampler** and the two sequences are near-1:1 by
  timestamp. Measured Step 0: `totalSamples` is *identical* per clip across the two passes
  (228/228, 99/99, 233/233).
- **The predicate.** `isBoundingBoxContinuous(candidate, reference, elapsedSeconds, bounds)` is
  this codebase's single answer to "could these two boxes be the same person." At small Δt it needs
  **no new geometric constant**. It is handed the run's already-resolved
  `samplingRobustnessConfig.personSelection`, so a dev override loosening continuity loosens this
  identically. **Primary is the `reference`** — the relation is not symmetric; the speed bound
  normalises displacement by the reference's own side length.

**Decision statistic:** `agreeingInstants / comparedInstants`. Same person ≈ 1.0, different ≈ 0.0.

## D2 — Call site, and caveat rather than suppression

**Placement: the call site** (`useVideoAnalysis.ts`, alongside the existing calibration gate).
`graftScalePassResult`'s signature and body stay untouched, so its module contract ("its gate lives
at the call site") stays literally true. The comparison itself is a new pure module, not inline in
the effect, so its branches are unit-testable without rendering a hook.

**Remedy: caveat.** In order of weight:

1. **The false-positive rate is unmeasurable in the direction that matters.** We can verify the
   check does NOT fire on our three clips. We almost certainly CANNOT verify that it fires when it
   should, because MediaPipe runs `numPoses: 1` and picks the most prominent person — the same bias
   `integratedAreaPx` scoring has — so on `multiperson-track.mp4` both passes will likely agree.
   **Shipping suppression means shipping an unvalidated metric-removal path; shipping a caveat
   means shipping an unvalidated sentence.** That asymmetry decides it.
2. Honest suppression is not free. `failPass(...)` would lie — both `'failed'` strings assert the
   pass *couldn't measure scale*, and on divergence it measured scale fine, just the wrong person's.
   An honest form needs a new `ScalePassStatus`/`ScalePassSkipReason` member plus new copy at
   `MetricsPanel.tsx` and `ResultsView.tsx`, and since the pass IS still `'done'`, `ResultsView`'s
   `addedMetricCount` branch needs a third case too.
3. Caveat costs zero UI. It reaches the user through elements that already exist on both rendering
   paths: the measured-metric card's caveat block for a measured `verticalOscillationCm`, and
   `ExcludedEntry`'s `hint ?? metric.caveat` for a null-valued `stepWidthCm` (`hint` is `undefined`
   on a `'done'` pass, so the caveat renders). **No component file changes at all.**

**Accepted cost, stated plainly:** on a metric at `confidence >= 0.7`, `metricTier` is `'normal'`
and the caveat renders in quiet `text-xs text-neutral-500`. Promoting the treatment is a follow-up
that a *measured* real divergence would justify — not something to pre-build against a signal that
has never fired on real footage.

**Caveat text**, asserted verbatim in tests:

```
SCALE_PASS_SUBJECT_DIVERGENCE_CAVEAT =
  'This second look may have measured a different person than the other metrics.'
```

Reads correctly after the provenance sentence. Uses the established "second look" phrasing, names
no backend, and is true under uncertainty in both directions.

**Application:** a second exported pure function in `scalePassGraft.ts` —
`withSubjectDivergenceCaveat(result)` — appending to `verticalOscillationCm` and `stepWidthCm`
only. `graftScalePassResult` untouched; the call site composes the two.

## D3 — False-positive posture

**`agreeingInstants / comparedInstants < 0.5` declares divergence** — a strict majority of
comparable instants must disagree. Plus `MIN_COMPARABLE_INSTANTS = 10`, below which the answer is
**no opinion**, never divergence.

- **`MAX_PAIRING_GAP_SECONDS = 0.1`.** Derived from measured cadence: Demo 1's primary produces
  ~56–58 detections over ~6.2s ≈ 108 ms spacing, so nearest-neighbour distance is typically ≤ 54 ms;
  on the sequential path the two sequences share timestamps outright. Upper-bounded by subject
  travel: a runner crossing a 1920px frame in ~1.5 s is ~1.8 sides/s, so 0.1 s ≈ 0.18 box sides —
  boxes still overlap heavily, while reaching a *different* person requires ≳1 side.
- **Per-instant predicate: no new constant.** Reuses the run's `maxAreaRatio: 4` and
  `maxCenterSpeedSidesPerSecond: 4`. The area band absorbs cross-backend box differences (MediaPipe's
  `visibility` gate tends to keep more limbs than MoveNet's score gate, inflating its box). Measured
  Step 0 cross-backend `segments[0].medianAreaPx` ratios on the three clips: **1.004** (Demo 1),
  **1.245** (Demo 2), **0.985** (multiperson) — all far inside the 4× band, with the largest
  observed deviation using 6% of the available margin.
- **Majority rule 0.5.** Expected separation is ~1.0 vs ~0.0, so the threshold sits mid-dead-zone,
  ~0.4 wide each side. Two or three collapsed detections cannot move it. The asymmetry is
  deliberate: **the default is to graft silently; it takes a majority of the evidence to add the
  sentence.**

**Residual known-ambiguous case:** a scale-pass winner that is half runner and half bystander lands
near 0.5 and resolves to `'agreed'`. Deliberate — a mixed winner is epic #52's items 4/5, and
resolving it here would mean tightening the threshold and importing false-positive risk to fix
somebody else's bug. Any clip measuring in 0.4–0.6 is a flag (R2 below).

## D4 — Skip paths

The check never reads `segments` at all — it reads `status`. One documented branch:

> **Both passes must report `personSelection.status === 'selected'`. Otherwise: no opinion, graft
> unchanged, with a typed reason.**

- `'disabled'` / `'unknown-frame-size'`: no identity was committed on that side, so a check firing
  here would be measuring tracker hopping, not divergence. Always symmetric in practice.
- `'no-detections'` / `'no-detection-above-floor'`: nothing to compare. Only reachable on the
  primary side at the graft point — a scale pass with no detections cannot have produced a non-null
  `calibration` and would already have taken `failPass`.

Recorded as `reason: 'primary-not-selected' | 'scale-not-selected' | 'too-few-comparable-instants'
| null`, mirroring `PersonSelectionDiagnostics`'s own shape, and emitted on the dev line so a
permanently-no-opinion configuration is visible rather than silent.

This branch is also why every existing scale-pass hook test survives untouched:
`mockBothPassesResolving()` resolves both passes with `[{ timestamp: 0, frame: null }]` →
`detectedSamplesIn === 0` → `'no-detections'` on both sides → no opinion → graft unchanged.

## D4b — One guard block, not two (a lint constraint, measured)

The scale-pass effect's precondition guard now has to cover five values rather than three, and the
natural shape is two sequential early returns so each `failPass` message stays true ("no video"
would be a lie for an incomplete primary result). That shape is **rejected by
`react-hooks/set-state-in-effect`**: bisected empirically against a clean baseline, splitting the
existing single guard into two — with no other change, not even the new fields — is by itself
enough to flag the `'running'` `setState` two lines below it. One guard with a ternary message
lints clean and is behaviourally identical.

Recorded because it is not obvious from either shape which one the rule accepts, and the honest
version of the message is the reason the question came up at all.

## D5 — What is deliberately NOT wired

`subjectAgreement` is **not** added to `sameClipSession`'s comparator in
`MultiClipVideoSession.tsx`. Nothing renders it, and it only ever changes in the same commit as
`scalePass.status` and `heuristics`, both of which the comparator already compares. Noted here so a
reviewer does not flag it as an omission.

## Step 0 — measured before any code was written

Blocking precondition: **the scale pass's own `personSelection` must reach `status: 'selected'`.**
MediaPipe passes `score: landmark.visibility` verbatim and `toPoseFrame` defaults a missing score
to `0`, so if visibility values did not clear the 0.3 keypoint floor often enough for
`deriveBoundingBox` to return boxes above the area floor, **no box-based signal of any kind could
work** and this ticket would escalate back to epic #52 rather than shipping a check that can never
fire.

Hand-driven Playwright run, real GPU (`ANGLE Metal Renderer: Apple M4 Pro`), 1 trial per clip,
capturing both console lines:

| clip | pass | `status` | `detectedSamplesIn` → `Out` | `segmentCount` | `segments[0]` span | `segments[0].medianAreaPx` |
|---|---|---|---|---|---|---|
| Demo 1 | primary | `selected` | 66 → 56 | 4 | [0.08, 6.32] | 492,789 |
| Demo 1 | scale | `selected` | 57 → 57 | 1 | [0.08, 9.16] | 494,725 |
| Demo 2 | primary | `selected` | 99 → 99 | 1 | [0.033, 1.668] | 132,926 |
| Demo 2 | scale | `selected` | 87 → 87 | 1 | [0.033, 1.668] | 165,487 |
| multiperson | primary | `selected` | 204 → 127 | 2 | [1.75, 3.90] | 31,670 |
| multiperson | scale | `selected` | 123 → 122 | 2 | [0.033, 3.733] | 31,186 |

`sampling.path` was `'sequential'` for every pass on every clip, and `totalSamples` was identical
across the two passes on each clip (228 / 99 / 233).

**S1 passes on all three clips — go.** Two secondary findings, both load-bearing:

1. **The ticket's own sketched signal is refuted on real footage, not just in principle.** Demo 1's
   two passes report *different* winner partition spans — [0.08, 6.32] against [0.08, 9.16] — for
   indisputably the same runner. A span comparison would have declared divergence on this repo's
   regression-anchor clip.
2. **The cross-backend area agreement is excellent** (ratios 1.004 / 1.245 / 0.985), which is direct
   evidence that the `maxAreaRatio: 4` band is not being asked to absorb anything close to its
   width for a same-person pair.

`comparedInstants` is bounded below by the intersection of the two passes' detected sets;
post-selection detected counts are 56 vs 57 (Demo 1), 99 vs 87 (Demo 2), 127 vs 122 (multiperson),
so R3's `>= 20` has a large margin on every clip.

## Live verification — measured after implementation

Same harness as Step 0, same machine, real GPU (`ANGLE Metal Renderer: Apple M4 Pro`), 3 trials
per clip, reading `subjectAgreement` off `[analysis-diagnostics:scale-pass]` and scanning the
rendered page for the divergence sentence.

| clip | verdict (all 3 trials) | `comparedInstants` | `agreeingInstants` | fraction | divergence sentence on page |
|---|---|---|---|---|---|
| Demo 1 | `agreed` | 53 | 52 | 0.9811 | no |
| Demo 2 | `agreed` | 99 | 99 | 1.0000 | no |
| multiperson | `agreed` | 114 | 110 | 0.9649 | no |

Bit-identical across all three trials on every clip. **S2 passes** (`'agreed'` every trial,
`comparedInstants` 53–114 against a floor of 20, minimum fraction 0.9649 against a floor of 0.85).
R1, R2 and R3 all clear with wide margin, and R6 is clear — `subjectAgreement` appeared on the
console line in all nine runs.

`comparedInstants` cross-checks the box extraction. Demo 1's primary reports
`detectedSamplesOut: 56` but `segments[0].frameCount: 53`; the check compares exactly 53. The
three-frame difference is frames that carry a detection inside the winner's span but yield no box
(fewer than `minConfidentKeypoints` confident points) — the same frames the selection stage's own
scorer skipped. Re-deriving from `'detected'` keypoints reproduces the stage's box set exactly,
which is the claim D1 rests on.

**S3 passes.** Every rendered caveat is byte-identical to the Step 0 pre-change text, e.g. Demo 2:
`"The bounce rhythm in this clip wasn't perfectly steady — confidence reduced accordingly.
Real-world scale was measured in only 89% of the analyzed frames — confidence reduced accordingly.
From a second look at the same clip."`

**S4 passes, within the MoveNet primary's documented run-to-run variance.** Step 0 was executed on
the base commit with none of this change's code present, so it is a genuine before-arm. Comparing
it against the after-arm: Demo 1 and multiperson are **bit-identical on both passes**, every
`personSelection` and `sampling` field included (`integratedAreaPx` to the last digit). Demo 2's
scale pass is bit-identical; its MoveNet primary's `segments[0].integratedAreaPx` moves 0.46% at an
identical frame count. That is the known tfjs non-determinism, not a change effect — **the same
arm reproduces it internally**: Demo 1's trial 1 differs from trials 2 and 3 (`kneeFlexion` 120.69
vs 116.92, `verticalRatio` 0.068 vs 0.052) with no code difference whatsoever. No systematic
shift, and the rendered centimetre values match the pre-change run at displayed precision on all
three clips (4.4 / 10.5 / 7.2 cm).

**The true-positive direction is NOT verified, exactly as predicted.** The check did not fire on
`multiperson-track.mp4` — it read `agreed` at 0.9649 every trial. MediaPipe runs `numPoses: 1` and
picks the most prominent person, which is the same largest-subject bias `integratedAreaPx` scoring
has, so the two passes converge on the runner there. This was pre-registered as explicitly not a
reject condition, and it is reported as a known unverified direction rather than written up as a
passed criterion. **No threshold was loosened to manufacture a divergence**; doing so would invert
the entire false-positive posture the design rests on. Closing it needs a clip where the scale
pass's own most-prominent-person pick genuinely differs from MoveNet's — which does not exist in
this repo today.

## Pre-registered criteria

Constants fixed at `MAX_PAIRING_GAP_SECONDS = 0.1`, `MIN_COMPARABLE_INSTANTS = 10`,
`MIN_AGREEING_FRACTION = 0.5`. **If a measurement lands in a reject band, re-derive or escalate — do
NOT retune a constant so the measurement passes.**

**Ship only if all hold:**

- **S1** (Step 0, before code) On all three clips, the scale pass reports
  `personSelection.status === 'selected'`.
- **S2** On all three clips over 3 trials, `subjectAgreement.status === 'agreed'` **every trial**,
  with `comparedInstants >= 20` and `agreeingInstants / comparedInstants >= 0.85` at the **minimum**
  across trials (not the median).
- **S3** No divergence sentence renders on any of the three clips; both cm cards' caveats are
  byte-identical to their pre-change text.
- **S4** Every metric value on all three clips is unchanged vs. baseline.
- **S5** Unit coverage per the test plan, including the floor and boundary cases; existing
  scale-pass hook tests pass **unmodified**.
- **S6** `npm test`, `npm run build`, `npm run lint` green; `openspec validate --strict` passes.

**Do not ship if any hold:**

- **R1** Any demo clip measures `'diverged'` on any trial. False positive on known-single-subject
  footage. **Do not lower the threshold to accommodate it.**
- **R2** Any clip's agreeing fraction lands in `[0.5, 0.85)`. Margin too thin, and it is also the
  signature of a mixed winner. Investigate before shipping.
- **R3** `comparedInstants < 20` on any clip. The check is effectively no-opinion in production.
  Re-derive the pairing tolerance — **do not lower `MIN_COMPARABLE_INSTANTS`.**
- **R4** (S1 fails) The scale pass's selection skips where the primary selects. No box-based signal
  can work; **escalate back to epic #52** rather than shipping a check that can never fire.
- **R5** Any existing scale-pass hook test needs modifying to pass. The skip gate is wrong, or the
  check fires where it must not.
- **R6** The check fires but `subjectAgreement` is absent from the console payload — unobservable in
  production diagnosis, the failure mode `bridgedCuts` exists to prevent.

**Explicitly NOT a reject:** the check never firing on `multiperson-track.mp4`. MediaPipe runs
`numPoses: 1` and shares the area scorer's largest-subject bias, so both passes are expected to
agree there. To be **reported as a known unverified direction**, not written up as a passed
criterion. Manufacturing a divergence by loosening a threshold would invert the entire
false-positive posture this design rests on.

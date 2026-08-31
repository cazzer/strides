# Design — plan a grafted metric's evidence from the pass that measured it

## The measurement that decided this

Before choosing between the two fixes the bead names, the question "is the defect reachable at all,
or only in principle" was answered by measuring it. A temporary probe
(`hipOrderProbe.experimental.ts` plus one dev-only `console.log` in the scale-pass effect, both
added, measured and **reverted** per CLAUDE.md's add-measure-revert cycle) dumped, at the graft
site where both passes' frames are in hand:

- every timestamp both passes sampled, and whether they shared it exactly;
- at each shared instant, `resolveOutwardSigns` on each pass's frame — which reduces to
  `sign(left_hip.x − right_hip.x)`, i.e. which hip the detector put on the left of the image;
- the distance between the two passes' hip-mid at the same instant;
- and the same two facts at exactly the instants the grafted metrics' exemplars name.

Headless Chromium, `--headless=new --enable-gpu --ignore-gpu-blocklist`, renderer asserted
`ANGLE Metal Renderer: Apple M4 Pro`, dev server on this checkout's derived port with
`assertServesThisCheckout` passing, fresh browser process per trial.

### D1. The two passes share every timestamp, exactly

| clip | primary frames | scale frames | paired within 0.1 s | **paired at gap = 0** |
|---|---|---|---|---|
| Demo 1 | 228 | 228 | 228 | **228** |
| Demo 2 | 99 | 99 | 99 | **99** |
| multiperson | 233 | 233 | 233 | **233** |

Both passes run the same sampler over the same clip at the same `sequentialSampling` setting, so
they draw from the identical set of frame presentation times. This matters twice over: routing a
grafted metric to the other array is a **lookup**, not a re-snap under a new tolerance; and the
old behaviour was not "snapped to a nearby frame" but "read the wrong pass's frame at exactly the
right instant" — which is worse, because nothing about it looks approximate.

### D2. Hip ORDER disagrees, often, and where the hips are close

Counting only instants where both passes resolved both hips strictly:

| clip | comparable | ordered oppositely | rate | median hip separation, primary / scale |
|---|---|---|---|---|
| Demo 1 (side view, 4K) | 57 | **15** | **26.3%** | 31.6 / 25.0 px |
| Demo 2 (front approach) | 98 | **0** | **0%** | 92.6 / 88.5 px |
| multiperson (1080p) | 87 | **15** | **17.2%** | 8.9 / 9.3 px |

The mechanism is visible in the last column and is not a bug in either detector. A front view puts
the hips ~90 px apart and the ordering is robust; a side view projects them nearly on top of each
other, and at 9–32 px of separation a few pixels of independent estimation error flips the sign.
Demo 2 reading a clean **0/98** is the control that says the instrument works: the same probe, the
same code, a geometry where the answer should be stable, and it is.

### D3. It fires at the instants that are actually drawn

Twelve grafted exemplar instants across the three clips (each metric emits one exemplar; a pair is
two instants). **Three carry the inverse ordering:**

| clip | metric | instant | primary order | scale order | scale hip separation |
|---|---|---|---|---|---|
| Demo 1 | `verticalOscillationCm` | t = 5.36 base | +1 | **−1** | 15.9 px |
| Demo 1 | `stepWidthCm` | t = 4.88 ghost, `measuredSide: 'left'` | +1 | **−1** | **4.4 px** |
| multiperson | `verticalOscillationCm` | t = 2.50 ghost | −1 | **+1** | 0.28 px |

The middle row is the bead's scenario verbatim: a step-width strike, at a viewport where the two
hips sit 4.4 px apart, whose polarity read off the primary frame is the inverse of the one
`stepWidth.ts:222` used. Drawn oriented, that caliper labels a crossover strike as landing on its
own side.

**Positions disagree too, and nothing suppressed those.** Hip-mid offset between the passes at
matched instants:

| clip | median | p95 | max |
|---|---|---|---|
| Demo 1 | **31.5 px** | 50.8 | 65.0 |
| Demo 2 | 11.2 px | 306.9 | 373.4 |
| multiperson | 8.2 px | 13.0 | 26.1 |

Demo 1's torso is ~437 px (`torsoMeters` 0.5041 × `medianPixelsPerMeter` 868.0), so the median
offset is about **7% of a torso**. That is the same species of error as the PTS misregistration
`strides-ac9` fixed at 31% of a torso — smaller, but drawn over a photograph where a reader takes
the marks as fact. `GRAFTED_METRICS` never addressed it: it suppresses polarity, not geometry, and
says so.

Demo 2's bimodal offset (median 11 px, p95 307 px) is a separate observation and not something this
change acts on: on a minority of frames the two passes are looking at different bodies. That is
`scalePassSubjectAgreement`'s question, and on that clip it answers `'agreed'` 99/99 — the
disagreeing frames are ones where selection differs without a majority. Noted, not chased.

### D4. `scalePassSubjectAgreement.ts` answers a different question, and cannot answer this one

Instructed to check before duplicating it. It cannot be reused, for a structural reason rather than
a scoping one.

`assessScalePassSubjectAgreement` derives a bounding box per frame from that frame's `'detected'`
keypoints and asks whether the two passes' boxes are continuous with each other. A bounding box is a
**hull**. Relabelling `left_hip` and `right_hip` — which is exactly and only what a hip-order
disagreement is — leaves the hull bit-identical. It is likewise blind to a 31 px joint displacement
inside a box hundreds of pixels on a side.

The two verdicts co-occur, on the same run, on the same clip:

| Demo 1, one run | value |
|---|---|
| `subjectAgreement` | `'agreed'`, **52 / 53** |
| instants ordering the hips oppositely | **15 / 57** |

Both are correct. The passes agree about **who** they measured and disagree about **which side**.
So this change adds no comparison, borrows no threshold, and touches that module not at all. What it
does borrow is the **precedent for where the fix lives**: `strides-56` established that the graft
site is the one place holding both passes' frames, which is why retaining the scale pass's frames
there costs nothing to compute — they are already in scope, at the exact line the graft happens.

## Sizing the two clean fixes

The bead names two, and asks for honest sizing before choosing.

### Fix (1) — a grafted exemplar carries its own pass's frames. **Chosen.**

Feared cost: "threading a second frame array through the evidence pipeline". Measured cost: it does
not reach the pipeline. `planExemplarFrames`'s own doc already records why — *"Everything positional
is captured HERE, while the `RobustPoseFrame` is still in hand — the plan is the last place that
holds it"*. The impure extractor takes a **plan**, never frames. So the array has to reach exactly
one function, and `planMetricEvidence` already takes its frames as a parameter.

Five edits, no new layer, no new concept:

| file | edit |
|---|---|
| `types.ts` | `ScalePassState.robustFrames?: RobustPoseFrame[]`, set only on `'done'` |
| `useVideoAnalysis.ts` | store `scaleRobustFrames` in the existing `'done'` literal — it is already a local |
| `evidenceFrames.ts` | `planClipEvidence` takes a fourth optional array and routes grafted ids to it |
| `useSessionEvidence.ts` | one field on `ClipEvidenceInputs`, read, compared, passed |
| `scalePassGraft.ts` | export `GRAFTED_METRIC_IDS`, pinned by test to what the graft actually replaces |

Evidence it is genuinely a no-op where no graft happened: the whole 1351-test suite passed
**unchanged** after the routing landed, before a single new test was written.

### Fix (2) — the graft drops when no primary frame corroborates it. **Rejected, and not on cost.**

It does not fix the defect. "Corroborates" as the bead states it means a primary frame exists within
the snap tolerance — and D1 shows one always does, at gap exactly 0, on every instant of every test
clip. The polarity is wrong **anyway**, 26% of the time, on frames that corroborate perfectly. Fix
(2) removes an inability to draw; it does not remove a wrong drawing.

Strengthening "corroborates" to "and agrees about the hip order" would work, but it is a worse
version of fix (1): it detects the disagreement rather than removing it, needs a new predicate and a
new threshold, and pays for both by **deleting** evidence. The cost of that deletion was measured
rather than assumed — `verticalOscillationCm` currently renders an image on **all three** test
clips, and it is the only grafted metric that reaches a card at all (see D5). A rule keyed on hip
order would have deleted two of those three images.

### Fix (3) — reuse `scalePassSubjectAgreement`. **Not available**, see D4.

## D5. `stepWidthCm` cannot be observed live, and that is a known open bead

`strides-fn4`: MediaPipe classifies Demo 2 as view `ambiguous` where MoveNet calls it `front`, and
`stepWidthCm` is consequently **tier-3 excluded on all three clips** — confirmed in this change's own
baseline capture (`stepWidthCm: metric-excluded`, every clip, every trial). Its exemplars are built
and grafted; they never reach a card, so no image of them exists to inspect.

So the live evidence for this change is `verticalOscillationCm`, which does render on all three, plus
the probe of D3, which reads `stepWidthCm`'s planned instants directly off the scale-pass result
before the tier gate can hide them. That is why the probe measured exemplar instants rather than
inspecting images: it is the only way to observe `stepWidthCm`'s polarity today. The unit tests carry
the rest — `stepWidthCm` is exercised there against a fixture where the two passes order the hips
oppositely, which is the case no available clip can currently show on screen.

## D6. `GRAFTED_METRICS` is left in place, and is now over-suppression

`evidenceAnnotations.ts`'s `GRAFTED_METRICS` set refuses to orient any mark for a grafted metric.
Its stated premise — *"their joint positions AND their hip polarity are therefore resolved off a
primary-pass frame snapped within tolerance"* — is **false** after this change. The polarity it
suppresses is now the correct one, read off the frame that measured the number, so what remains is
not a guard but a loss: `stepWidthCm`'s caliper keeps drawing as an unsigned span when it could
honestly point.

It is **not** removed here, and the reason is coordination rather than judgement: another agent holds
`src/results/evidenceAnnotations.ts` and `src/video/drawEvidenceAnnotations.ts` in this same session.
Editing that file to delete a set while its annotation logic is being reworked is how two correct
changes clobber each other. Removal is a single-file follow-up, filed as its own bead, and it must
delete the set rather than leave two mechanisms guarding one thing.

Two doc comments elsewhere state the old premise and are corrected in place, because they are in
files this change owns: `scalePassGraft.ts`'s seam bullet, and `evidenceFrames.ts`'s
`resolveOutwardSigns` note. `evidenceAnnotations.ts:53`'s copy is **stale as of this change** and is
left for the same reason the set is.

## D7. Why presence-of-frames, not membership-of-a-set, decides the routing

`GRAFTED_METRIC_IDS` names the metrics the graft *can* replace. It does not say a graft *happened* —
on a MediaPipe-primary run (`__STRIDES_POSE_BACKEND_OVERRIDE__`) both centimetre metrics are computed
by the primary pass, the scale pass is skipped with `reason: 'primary-scale'`, and those metrics'
frames are the primary ones. Routing on the set alone would then have no second array to route to;
routing on the *presence* of scale-pass frames is correct in both regimes without a branch that has
to know which regime it is in.

Committing the frames in the same `setState` literal as the grafted `heuristics` is what makes that
safe. If they were written separately, a render could observe grafted metrics with no frames beside
them, and the planner would silently fall back to the primary array — reinstating the exact defect,
transiently, with nothing to see.

`GRAFTED_METRIC_IDS` is therefore only ever consulted **inside** the `graftedFrames !== null` branch,
and it is pinned by a test that derives the set from `graftScalePassResult`'s own behaviour rather
than comparing it to a second hand-written literal. That style is deliberate: the failure mode it
guards against — a third grafted metric that forgets to join a list — has already happened once in
this area, in the two copied step-width exemplar builders `strides-b5o` had to unify.

## Live verification

Three trials per clip, fresh Chromium process each, real GPU, this checkout's own dev server with
`assertServesThisCheckout` passing. Read from `[evidence-coverage]` (last line),
`[analysis-diagnostics]` (matched exclusively) and `[analysis-diagnostics:scale-pass]`.

### Coverage — unchanged

| clip | before | after |
|---|---|---|
| Demo 1 | 8 images / 7 sections | **8 / 7**, all 3 trials |
| Demo 2 | 5 / 4 | **5 / 4**, all 3 trials |
| multiperson | 8 / 7 | **8 / 7**, all 3 trials |

Per-metric verdicts identical, `stepWidthCm: metric-excluded` on all three throughout (D5), zero
`extraction-failed`.

### Regression anchor — unchanged, and this change touches the pass that produces it

| field | expected | measured |
|---|---|---|
| Demo 1 `verticalOscillationCm` | 4.421467928439415 | **4.421467928439415** |
| `fit.frequencyHz × 60` == `cadence.value` | 91.2 | **91.2 == 91.2** |
| `torsoMeters` | 0.504143645953322 | **0.504143645953322** |
| `medianPixelsPerMeter` | 868.0221516689736 | **868.0221516689736** |
| `subjectAgreement` | 52/53 | **52/53** |

The routing changes which frames an *image* is planned from; it cannot change a metric's value,
because `computeFormHeuristics` never sees it. The anchor holding to the last digit is the check that
nothing leaked the other way.

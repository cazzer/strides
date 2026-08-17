# Design — splice-tolerant segmentation

## D1 — Shape: the BRIDGE RULE, not "N consecutive discontinuous frames"

Do not cut at surviving index `i` when the surviving detections immediately before and after it are
continuous with each other.

Strongest argument first:

- **The bridge changes the operands, not the predicate.** It can only merge a pair `(prev, next)`
  that the *unmodified* `isBoundingBoxContinuous` already accepts, so its blast radius is bounded by
  the existing predicate's own tolerance — it can never create a merge the current code would have
  rejected between adjacent frames. The "N consecutive" alternative merges on *absence of
  corroboration*, which admits pairs the predicate never accepted. This is D11's split applied: the
  offline stage decides **whether** continuity is consulted and about **which pair**, and must not
  restate **what** continuity means.
- **It is a leave-one-out test.** The Demo 1 failure is a false measurement on one frame; the bridge
  asks exactly the question that poses — "is the discontinuity still there with the suspect frame
  removed?" "Did it persist for N frames?" is a different question with a different answer.
- **"N consecutive" is ambiguous and one natural reading doesn't even heal Demo 1.** Read as "cut
  only if both (i-1→i) and (i→i+1) are discontinuous", N=2 on Demo 1 still cuts. Read as "hold the
  reference and require N successive failures", it collapses into the bridge rule generalised — and
  still needs D2's non-advance mechanic to work at all.
- **Zero new tunables.** `N` would need justifying, defaulting, exposing through the config plane,
  and tuning, with no evidence for any value.
- **Test cost, traced not assumed:** every existing test in `retroactivePersonSelection.test.ts`
  passes unchanged under this shape — the five the ticket flagged as contradicting the "N
  consecutive" shape (`:375`, `:411`, `:427`, `:442`, `:455`) included, plus the `:597` landmine and
  the `:184` / `:198` #51-trace pair. Verified by running the file's pre-change revision verbatim
  against the new implementation: 32 test cases, all green, no assertion touched.

### The one structural requirement: `isContinuousPair` is a single shared helper

Both the adjacent check and the bridge check route through one local function. This is load-bearing,
not a convenience: it makes it structurally impossible to omit the
`elapsedSeconds <= maxContinuityGapSeconds` term on the `(prev, next)` pair. The `:597` test builds
12 mutually-discontinuous single-frame segments alternating x between 50 and 1400 at 2s spacing —
its `i-1` and `i+1` pairs share parity, so they are *geometrically* continuous with each other
(IoU 0.444, area ratio 2.25, inside the bound of 4) and are separated only by time. Simulated
against that fixture's real box math, a geometry-only bridge collapses it from **12 segments to 4,
with 8 bridged cuts**. The damage exceeds what the parity overlap alone would cause, because the
speed bound is `3 × referenceSide × elapsed`: drop the time term and a bridge over a *longer* gap
gets a proportionally *larger* displacement budget, so once the reference sticks it swallows a run
of frames on the opposite side of the frame as well (measured: one reference bridged six
consecutive frames). Writing the bridge check as a second inline expression is exactly the edit
that would reintroduce this.

Two facts recorded at the helper: its parameters are **chronological** (`reference` = earlier,
`candidate` = later), the inverse of `isBoundingBoxContinuous`'s own `(candidate, reference)`
signature; and the relation is **not symmetric**, because the speed bound normalises by the
*reference*'s own side (`movenetCrop.ts`'s `isWithinCenterSpeedBound`).

## D2 — Do NOT advance the reference across a bridged frame

When a bridge fires at `i`, `previousIndex` **stays at `prev`** and the loop continues. The next
iteration compares `next` against `prev` — the pair the bridge already verified — so it passes, no
second cut is evaluated, and the reference then advances to `next` normally.

This is designed to heal BOTH of Demo 1's cuts from ONE bridge decision: the 4.24→4.32 position
failure declined, and the 4.32→4.36 failure never asked because 4.32 never becomes the reference.
**Measured, it does not get the chance on Demo 1** — the `(4.24, 4.36)` pair fails the unmodified
predicate, so no bridge fires and this mechanic is untested on that clip (see "Measured A/B
results"). It is exercised on the multi-person fixture, where the rule fires 4 times.
If `previousIndex = i` still ran, the next iteration would compare against the wedge and cut —
recovering the 5-frame prefix but re-stranding the 49-frame tail, which is **strictly worse than
today**. This is the part a naive patch gets wrong, and it looks like partial success when it
happens: `bridgedCuts >= 1` with the winner's `frameCount` still ≈49 is its signature (do-not-ship
condition 4 below).

**Tolerance is bounded to exactly one detection by construction, not by a counter.** After a bridge,
the next surviving frame is compared against `prev`, and we only bridged *because* that comparison
passes — so it cannot bridge again. Two consecutive bad frames still cut.

**Read that bound precisely: it is on CONSECUTIVE bridges, not on total bridges.** An alternating
good/bad stream can still merge end to end at up to ⌈n/2⌉ bridges, every one of them individually
legal under D1. That is a live risk, not a foreclosed one — see R3, where it is measured, and the
alternating fixture that pins it as a unit test.

## D3 — BRIDGE-AND-KEEP, not bridge-and-null

The bridged frame stays in `surviving`, contributes its area, and survives into the output if its
segment wins. No third counter, no change to
`detectedSamplesOut = in − rejectedBelowFloor − rejectedOtherSegment`, and no touch to the invariant
test that asserts it.

The ticket's framing ("a 24,473 px² garbage box stays in the metric stream") is imprecise in a way
that decides this. Every consumer of `deriveBoundingBox` was traced: `movenet.ts` (the online crop),
this stage, and one `.experimental.ts` file. **The derived box never reaches any metric** — it is a
segmentation/scoring artifact only. What reaches the metric stream is the *pose*, whose keypoints
are at correct positions; only the *hull* is unrepresentative, because it re-formed around whichever
joints cleared the gate.

Further: `deriveBoundingBox`'s gate here is `minKeypointConfidence: 0.3`, and
`DEFAULT_MIN_KEYPOINT_CONFIDENCE` downstream is **also 0.3** (`src/pose/robustness/types.ts`). The
same threshold applies twice, so keeping the frame contributes exactly its ≥0.3-confidence
keypoints — real detections of the runner — and `applyRobustness` filters and interpolates the rest
as it already would. Nulling would discard real data to remove a box no metric reads.

Cost/benefit seals it: bridge-and-null moves neither headline number, reduces `detectedSamplesOut`
by 1 in a ticket whose premise is "13–16 detected frames lost per run", and opens a second
overlapping notion of "unverified frame inside the winner" alongside #55's, pre-empting its design.

**Recorded honestly: #55's scoped fix does not subsume this.** #55 addresses boxless frames riding
with the winner; a bridged frame sits inside the winner's *evidenced interior* and yields a real
box. If a metric ever moves implausibly and traces to t=4.32, bridge-and-null needs its own
decision as a follow-up — not a mid-flight scope change here.

## Gate amendment — the epic's headline criterion is a joint #54 + #57 outcome

Recorded before measurement, not renegotiated after. `segmentCount === 1` on Demo 1 is **not
reachable by #54 alone**. The 4K area floor resolves to `2e-4 × 3840 × 2160` = 1,658.88 px². Demo 1
carries five detections at t = 6.36, 7.20, 7.28, 7.44, 8.36 measuring 2,279–8,432 px² on
keyframe-confirmed empty frames — comfortably above that floor. The runner's boxes are
167K–755K px², so the best-case runner:phantom area ratio is `167,867 / 8,432` ≈ **19.9** against
`maxAreaRatio: 4`. That transition fails on scale and always cuts — and a bridge rule cannot merge
it, nor should it. So after #54, Demo 1 necessarily retains `segmentCount >= 2` and
`rejectedOtherSegment >= 5`; it resolves jointly with #57, whose re-derived floor demotes the
phantoms to `rejectedBelowFloor`, where D5 guarantees they neither start nor cut a segment.

## Pre-registered A/B criteria

Baseline arm is **stage-on at HEAD**, not `enabled: false` — the question is what this change does,
not what the stage does. Driver: `scripts/ab-person-selection.mjs` (#53), 3 trials, all three clips,
`--port <FREE_PORT>`, real GPU confirmed via `WEBGL_debug_renderer_info`.

### Demo 1 (side-view track) — primary. All must hold on all 3 trials.

| # | Criterion | Baseline |
|---|---|---|
| D1-1 | `bridgedCuts >= 1` | 0 (new field) |
| D1-2 | `segments[0].startTimestamp <= 3.90` — winner begins at the runner's entry | ≈4.36 |
| D1-3 | `segments[0].frameCount >= 54` (55 minus a frame of sampling jitter) | 49 |
| D1-4 | `segmentCount` median drops by ≥ 2 | 5–6 |
| D1-5 | `rejectedOtherSegment` median drops by ≥ 6, and no remaining rejection falls inside the winner's span | 13–16 |
| D1-6 | `sampling.detectedFrames` median increases by ≥ 5 | 50–52 |
| D1-7 | `detectedSamplesOut` does not decrease on any clip in any trial | — |

`segmentCount === 1` / `rejectedOtherSegment === 0` are **recorded as observations, not gates** (see
the gate amendment above).

### Demo 2 (park approach) — must stay a no-op, all 3 trials

`segmentCount === 1`, `rejectedBelowFloor === 0`, `rejectedOtherSegment === 0`,
**`bridgedCuts === 0`**, metrics bit-identical to the `enabled: false` arm. `bridgedCuts === 0` is
the tightest available no-op proof: the new path provably never fired.

### Multi-person fixture (`e2e/fixtures/multiperson-track.mp4`) — must not merge people

`separationRatio >= 3`; `segments[0].medianAreaPx >= 28,700` (within 10% of the measured
31,905–31,937); winner span still ≈[1.7, 3.9]. `segmentCount` **may** drop below 8 — allowed if a
span had its own wedge. `medianAreaPx` is what discriminates "a wedge inside one person healed" from
"a bystander merged in".

### Do NOT ship if

1. Multi-person `medianAreaPx` drops >10% or `separationRatio < 3` — a bystander was merged. This
   outranks every accept condition.
2. Demo 2 stops being a no-op in any trial — the rule is too permissive.
3. Demo 1 `bridgedCuts === 0` with `segmentCount` unchanged — it did not fire on the case it was
   built for. Re-trace, do not tune.
4. Demo 1 `bridgedCuts >= 1` but `frameCount` still ≈49 — the reference advanced across the bridge;
   only one boundary healed (D2).
5. `detectedSamplesOut` decreases on any clip.

## Measured A/B results (2026-08-16, real GPU)

`scripts/ab-person-selection.mjs`, 3 trials × 3 clips × 2 arms, `--port 5199` (5173 was held by the
main checkout's dev server — the exact hazard #53's reuse refusal exists for). Renderer confirmed
`ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)`, not SwiftShader. Server started by the run.
Both arms are **stage-on**; they differ only in code.

**Provenance caveat, stated plainly:** the driver stamps the commit, and both reports stamp `33d1abf`
because the before-arm was produced by reverting the single runtime file this change touches
(`src/results/retroactivePersonSelection.ts`) to `d9cfc1a` in place, running, and restoring it. That
file is the only runtime file #54 modifies, so the swap is exact — but the commit line in
`54-before.txt` is not a valid provenance record and the file's git blob is the real discriminator.

Medians with `[min..max]` where trials differed.

| field | Demo 1 before | Demo 1 after | Demo 2 before | Demo 2 after | multi before | multi after |
|---|---|---|---|---|---|---|
| `bridgedCuts` | — | **0** | — | **0** | — | **4** |
| `segmentCount` | 5 [5..6] | 5 [5..6] | 1 | 1 | 8 | **2** |
| `rejectedOtherSegment` | 13 [13..16] | 13 [13..16] | 0 | 0 | 52 | **47** |
| `rejectedBelowFloor` | 0 | 0 | 0 | 0 | 30 | 30 |
| `detectedSamplesOut` | 52 [50..52] | 52 [50..52] | 99 | 99 | 122 | **127** |
| `sampling.detectedFrames` | 52 [50..52] | 52 [50..52] | 99 | 99 | 122 | **127** |
| `separationRatio` | 16.149 | 16.149 | null | null | 45.749 | **33.541** |
| `segments[0].startTimestamp` | 4.36 | 4.36 | 0.0334 | 0.0334 | 1.75 | 1.75 |
| `segments[0].endTimestamp` | 7.16 [6.32..7.16] | 7.16 [6.32..7.16] | 1.6683 | 1.6683 | 3.8167 | **3.90** |
| `segments[0].frameCount` | 47 | 47 | 99 | 99 | 119 | **123** |
| `segments[0].medianAreaPx` | 515,680 | 515,680 | 134,081 | 134,081 | 31,937 | **31,670** |

Demo 1 and Demo 2 are **bit-identical on every captured field, metrics included**, and `bridgedCuts`
is 0 on both — the tightest available proof that the new path never executed.

### Verdict against the pre-registered criteria

| gate | result |
|---|---|
| **Demo 1 D1-1** `bridgedCuts >= 1` | **FAIL** — 0, all 3 trials |
| **Demo 1 D1-2** winner starts ≤ 3.90 | **FAIL** — 4.36, unchanged |
| **Demo 1 D1-3** winner `frameCount` ≥ 54 | **FAIL** — 47, unchanged |
| **Demo 1 D1-4** `segmentCount` down ≥ 2 | **FAIL** — 5, unchanged |
| **Demo 1 D1-5** `rejectedOtherSegment` down ≥ 6 | **FAIL** — 13, unchanged |
| **Demo 1 D1-6** `detectedFrames` up ≥ 5 | **FAIL** — 52, unchanged |
| **Demo 1 D1-7** `detectedSamplesOut` never decreases | PASS (unchanged everywhere, +5 on multi) |
| **Demo 2** no-op, `bridgedCuts === 0` | **PASS** — bit-identical, 3/3 trials |
| **Multi-person** `separationRatio >= 3` | **PASS** — 33.54 |
| **Multi-person** `medianAreaPx >= 28,700` | **PASS** — 31,670, a **0.84%** drop from 31,937 |
| **Multi-person** winner span ≈[1.7, 3.9] | **PASS** — [1.75, 3.90] |
| **Do-not-ship 1** (bystander merged) | not triggered — see above |
| **Do-not-ship 2** (Demo 2 no longer a no-op) | not triggered |
| **Do-not-ship 3** (Demo 1 `bridgedCuts` 0, `segmentCount` unchanged) | **FIRED** |
| **Do-not-ship 4** (`bridgedCuts >= 1` but `frameCount` ≈49) | not triggered — the rule never fired at all, so D2 is untested on Demo 1 |
| **Do-not-ship 5** (`detectedSamplesOut` decreases) | not triggered |

**Do-not-ship condition 3 fired. Its instruction is "re-trace, do not tune", and that is what was
done — no threshold was touched.**

### Re-trace: why the bridge did not fire on Demo 1

A temporary trace probe was spliced into the cut loop, one Demo 1 run captured, and the probe
reverted (`git checkout --`, tree verified clean). The wedge is exactly where the archived D7 trace
put it, and the bridge asked exactly the right question at exactly the right moment:

```
cont  #104@4.24 (a=167867, c=574,849) vs #98@4.00
  ?bridge #104@4.24 -> #107@4.36 (a=108121, c=824,738)
          elapsed=0.12 gapOK=true geom=FALSE
          overlapX=-0.49  IoU=0.0000  dist=273.2  budget=253.9  shortfall=+7.6%  areaRatio=1.553
CUT   #106@4.32 (a=24473, c=896,606) vs #104@4.24
  ?bridge #106@4.32 -> #108@4.40   elapsed=0.08 geom=FALSE (dist 404.5 vs budget 100.3, ratio 17.4)
CUT   #107@4.36 vs #106@4.32
```

**The load-bearing empirical premise of this whole change is refuted on one of its two halves.** The
ticket and the plan both assert that "t=4.24 and t=4.36 overlap at **IoU≈0.13** with an area ratio of
~1.55", and call the bridge "verified viable against the D7 trace". Measured against the boxes this
clip actually produces today:

- **area ratio 1.553** — the ~1.55 figure is correct, and it passes the bound of 4 comfortably;
- **IoU is exactly 0.0000, not 0.13** — the two boxes are disjoint in x by **0.49 px**;
- the centre-speed term, which then has to carry position alone, travels **273.2 px against a
  253.9 px budget** — short by **7.6%**.

Position therefore fails on both halves, `isBoundingBoxContinuous` short-circuits before the
(passing) area test, and the bridge is correctly declined. The rule is implemented as specified and
behaves as specified; **the fixture it was specified against does not match this clip's measured
geometry.** D1's "it can only merge a pair the unmodified predicate already accepts" is precisely
what bites here — the predicate does not accept this pair, by a margin of half a pixel of overlap
and 7.6% of speed budget.

Reaching it would require loosening `maxCenterSpeedSidesPerSecond` from 3 to ≈3.3, or otherwise
restating what continuity means. **That is the tuning D1 forbids and do-not-ship 3 explicitly rules
out**, and it would also break the deliberate parity with the online anchor gate's bound. Not done;
flagged for a human decision instead.

### What the change DOES do, measured

On `e2e/fixtures/multiperson-track.mp4` the rule fires 4 times and does exactly what it was built to
do — on real footage, not a synthetic fixture:

- `segmentCount` **8 → 2**; the runner's own span stops being chopped into pieces.
- winner `frameCount` **119 → 123**, span [1.75, 3.8167] → [1.75, **3.90**] — it recovers the tail of
  the runner's track, and the start is unmoved.
- `detectedSamplesOut` **122 → 127** (+5), `rejectedOtherSegment` **52 → 47**.
- **No bystander was merged**, which is the gate that outranks every accept condition:
  `medianAreaPx` moves 31,937 → 31,670, a **0.84%** drop against a 10% tolerance, and
  `separationRatio` stays at **33.5** against a floor of 3. A merged bystander would have dragged
  the winner's median area down hard; it did not move.

`separationRatio` falling 45.7 → 33.5 is expected and benign: with `segmentCount` down to 2 the
runner-up is now a consolidation of what were several bystander segments, so the denominator grew.
The winner is unchanged in identity, position and apparent size.

### One incidental confirmation, worth recording

The same trace shows the phantom transition `#153@6.20 -> #178@7.20` with `elapsed=1.00`: its centre
displacement of 1,956.9 px is **inside** a 2,194.6 px speed budget — position PASSES — and it is
declined purely on `areaRatio=53.4`. That is a live, on-real-footage demonstration of the
degeneracy `maxContinuityGapSeconds` exists to bound: at a full second of elapsed time the speed
term has stopped discriminating anything. It is also independent evidence for R4 and for routing
both checks through `isContinuousPair`.

### Raw reports

`54-before.txt` / `54-after.txt` and their `--json` companions, scratchpad-only (measurement
artifacts, not committed).

## Risks

| # | Risk | Bound | Detected by |
|---|---|---|---|
| R1 | The bridge merges two different people across a one-frame transition | Bounded by construction: only merges pairs the unmodified predicate already accepts | Multi-person `medianAreaPx` / `separationRatio`; unit test B |
| R2 | A genuine hard scene cut lasting exactly one surviving frame gets bridged | Requires the frames either side of a real cut to be continuous, which after a real cut they are not | **Unmeasurable today — no fixture clip has a scene cut.** Mitigated by unit test C and by `bridgedCuts` itself |
| R3 | Chained bridging swallows a long bad stretch | **Partially bounded, NOT foreclosed.** D2 forecloses *consecutive* bridging only — no two adjacent surviving detections can both be bridged, so a contiguous bad run of length ≥ 2 still cuts (unit test C). It does **not** foreclose bridging every *other* frame: an alternating good/bad stream can merge end to end, at up to ⌈n/2⌉ bridges. Measured on a 7-sample alternating runner/bystander fixture: `segmentCount` 1, `bridgedCuts` 3, all 7 detections kept including the bystander's 3, versus 7 segments and 1 detection with the bridge suppressed. Every one of those bridges is individually legal under D1 | **Multi-person `segments[0].medianAreaPx` / `separationRatio`** — the A/B gate that discriminates "a wedge inside one person healed" from "a bystander stitched in". Unit test C bounds a *contiguous* run and says nothing about an alternating one; the alternating fixture is pinned as its own unit test instead. `bridgedCuts` is the live signal: `bridgedCuts >> 1` on a clip means "check whether two people got stitched together", not "a wedge was healed" |
| R4 | The time-gap term is dropped from the bridge pair in a later edit | Structurally foreclosed by the single `isContinuousPair` helper | `:597` + its new `bridgedCuts === 0` assertion + unit test D |
| R8 | D3 leaves a collapsed pose in the metric stream | Its keypoints pass the identical 0.3 gate downstream; the box reaches no metric | Demo 1 metric values in the A/B. If a metric moves implausibly and traces to t=4.32, open bridge-and-null as a follow-up under #55 — not a mid-flight scope change |

## Implementation notes

The forward scan for the next surviving index is amortised O(n): consecutive scan ranges are
disjoint, since a scan at `i` covers `(i, bridgeTarget]` and the next cannot begin before
`bridgeTarget`. A precomputed `nextSurviving` array was considered and rejected (extra allocation,
no clarity gain). A backtracking variant was rejected too: same information, but it mutates
already-emitted decisions in `segmentStarts`.

`bridgedCuts` counts bridge **events**, not boundaries. One event removes the boundary in front of
the offending frame and prevents the one behind it from ever being evaluated, so the measured Demo 1
wedge reports 1, not 2.

# Re-derive the bounding-box area floor from 4K measurement (issue #57, epic #52 item 4)

## OUTCOME (2026-08-17) — measured, NOT shipped

**The measurement was taken and the pre-registered margin rule fired. The floor stays at `2e-4`.**
Read `design.md`'s "Measured results" and "Gate-by-gate verdict" first; the sections below are the
proposal as written *before* measuring, kept intact as the pre-registration record.

Headline: at 4K, **on the same clip and in the same scene**, the largest keyframe-confirmed
spurious detection (8,432 px², Demo 1 t=8.36, empty track) and the smallest keyframe-confirmed
genuine subject detection (24,473 px², Demo 1 t=4.32, the runner with a collapsed box) are only
**2.90× apart** — against a pre-registered requirement of ≥4. The squeeze is *intra-clip*, so no
resolution model can widen it, and a 4-arm live A/B confirmed it behaviourally: the derived value
`1.7e-3` does close epic #52's headline gate on Demo 1 with every metric unmoved, but halving it
re-breaks phantom rejection and doubling it destroys #54's healed track. Three pre-registered
do-not-ship conditions fire (5, 3, 4) plus the plateau gate on both sides.

**The spec delta is withdrawn** — its sizing requirement is unsatisfiable on this footage, and
shipping it against unchanged code would encode a contract the implementation violates.
**What ships: the test-suite decoupling (step 4.2) and this measurement record.**

## Why

`minBoundingBoxAreaFraction: 2e-4` resolves to **1,658.88 px²** at 4K
(`2e-4 × 3840 × 2160`). Demo 1 carries five detections measuring **2,279–8,432 px²** on
keyframe-confirmed empty frames — every one of them clears that floor. The confirming symptom is
already in the record: `rejectedBelowFloor` measured **0 on both 4K demo clips**. The floor rejects
nothing at the resolution where noise is largest, which is the one job it was sized for.

The floor's number was derived at 1080p, from the repro clip: a geometric mean of the largest
measured garbage detection (183 px²) and the smallest measured real person (~1,000 px²). At 4K only
the *garbage* endpoint has ever been measured. **The smallest genuine subject at 4K has never been
measured at all**, so there is a floor for the new floor and no ceiling. This is a measurement
ticket, not a config tweak.

**Why it matters now rather than as tidy-up.** #54 healed Demo 1's wedge — its winner is one
segment spanning `[0.08, 6.32]` with 53 detections. But `segmentCount` is still 3–4 and
`rejectedOtherSegment` 7–10, because those phantoms clear the floor, form their own segments, and
are then rejected as losing segments. The runner:phantom area ratio is ≈19.9 against
`maxAreaRatio: 4`, so that transition fails on scale and always cuts; a bridge rule cannot merge it
and should not. Raising the floor above the phantoms demotes them to `rejectedBelowFloor`, where D5
guarantees they neither start nor cut a segment — and Demo 1 reaches `segmentCount === 1` /
`rejectedOtherSegment === 0`. That is **epic #52's amended headline criterion**, and it is a joint
#54 + #57 outcome. This change is its second half.

## What Changes

- **`DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG.minBoundingBoxAreaFraction` is re-derived from
  measurement** on real footage at both frame areas this repo exercises, and set to the derived
  value (`src/results/retroactivePersonSelection.ts`). The **fraction model itself is unchanged** —
  see D1; a per-resolution-class table and two hybrids are rejected with reasons, and the model
  change is pre-registered as conditional on the measurement, not assumed away.
- **The derivation is written into `design.md`**, with four named measured endpoints — the largest
  keyframe-confirmed spurious detection and the smallest keyframe-confirmed winner-subject
  detection, at each of the two frame areas — each carrying its own timestamp and keyframe verdict,
  and both resolved margins.
- **A temporary per-detection bounding-box probe** (`boundingBoxTrace.experimental.ts`, a dev-only
  log line in `useVideoAnalysis.ts`, and a throwaway harvest script) produces the distribution the
  derivation reads. Per CLAUDE.md's add-measure-revert cycle it is **reverted before any A/B arm
  runs**, so the A/B measures the shipped code path exactly.
- **Four new pinning tests** (`src/results/retroactivePersonSelection.test.ts`) run against
  `DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG` directly and pin the derivation from **both**
  sides at **both** frame areas: the floor catches the largest measured phantom, and keeps the
  smallest measured genuine subject. The second half is what stops "just raise it more" passing CI.
- **The test-local `CONFIG` is decoupled from the shipped number** — a prerequisite, not cleanup.
  It currently spreads the default and overrides only `enabled`, so a dozen fixtures' above/below-
  floor status is a live function of `minBoundingBoxAreaFraction`; any admissible new value
  reclassifies at least three of them. Pinning `minBoundingBoxAreaFraction: 2e-4` explicitly there
  keeps `FLOOR_1080P`, `ABOVE_FLOOR_SIDE`/`BELOW_FLOOR_SIDE`, the 3,600 px² bystanders and the
  1,600 px² alternating fixture all meaning what their comments say, permanently.

## Impact

- Affected specs: `person-selection` (MODIFIED ×1). No `analysis-diagnostics` delta — the probe is
  temporary and reverted, and no diagnostics field is added. No `sampling-robustness-config`
  delta — its requirement pins the config's *shape*, not any default's value.
- Affected code: `src/results/retroactivePersonSelection.ts` (the default and its derivation
  comment), `src/results/retroactivePersonSelection.test.ts`. `src/results/runClipAnalysisPipeline.test.ts`
  only if its `SELECTING` fixture reclassifies under the new value.
- `scripts/ab-person-selection.mjs` is **NOT edited** — it is shared by four #52 tickets and every
  A/B in the epic must stay comparable. The probe harvest gets a separate, temporary script.
- **`src/pose/backends/movenetCrop.ts` is NOT touched.** No predicate, no bound, and no
  `deriveBoundingBox` argument changes; this change only moves the threshold a derived box is
  compared against.
- Out of scope, deliberately: #56 (primary/scale-pass selection divergence) and #52's item 5
  (Stage 2). The splice-tolerance rule and the continuity bounds #54 landed are untouched, as is
  #55's evidenced-interior rule.
- **Re-accepting `2e-4` with the measurement recorded is a pre-registered, legitimate outcome** if
  the measured window is too thin to clear the margin rule (D2's ship rule). It closes #57 with
  evidence rather than a guess, and reopens the question as a proposal that is not a single global
  fraction.

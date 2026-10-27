## Context

The guided view (`openspec/specs/guided-results-view`) renders thirteen metric cards against cited
bands, with a Try line on four of them and a withholding rule (`tryLineApplies`) for a Try line
that would point a runner further out of their band. The runner-led PRD reorganises that content
as a tour by body region. This change is only the data layer: pure modules, no UI.

## Goals / Non-Goals

**Goals:** a fixed grouping of metrics into focus areas; per area a cited why line, an existing Try
line as a cue only where the value is past its band on the costly side, or a cited non-point; at
most one cue for the whole tour; tight word budgets (the first reader called the guided page
"significantly too verbose").

**Non-Goals:** rendering, camera presets (the tour ticket maps areas to those), any new band, any
change to a band or to Try line text, any change to `src/heuristics/**`.

## Decisions

### D1. Areas, membership and headline

| area | label | metrics, in headline-preference order |
|---|---|---|
| rhythm | Rhythm | cadence, verticalOscillationCm, verticalRatio, verticalOscillation |
| arms | Arms | armSwingAmplitude |
| posture | Posture | trunkLean |
| knees | Knees | kneeFlexion, kneeDrive |
| landing | Landing | overstriding, footStrikePattern |
| footPath | Foot path | stepWidthCm, stepWidth, swingFootLateralExcursion |

The headline is the first metric whose tier is not `'excluded'`; `supporting` is the rest of the
non-excluded metrics in the same order; `excluded` lists the others; `measured` is false exactly
when there is no headline. The tour's closing stop, `oneThing`, is a `TourStopId` but not a
`FocusAreaId`.

### D2. Lines are cited or absent

The cue is the cued metric's existing `tryLine`, verbatim (D3 says which metric). The why line is
keyed to the cue's metric when there is a cue, otherwise to the headline metric, so a stop never
explains one metric while cueing another, and an area falling back to a sibling says only what that
sibling's source supports. A non-point is shown only when there is no cue: the first measured metric
in the area with a `NON_POINTS` entry. Knees never carry a cue, enforced structurally
(`NO_CUE_AREAS`) as well as by the knee metrics having no Try line.

Every URL was opened on 2026-10-27. The sentence each line rests on:

| line | source | supporting sentence (verbatim) | evidence |
|---|---|---|---|
| why `cadence`: "Quicker-stepping runners use slightly less energy, on average." | Van Hooren et al. 2024, https://pmc.ncbi.nlm.nih.gov/articles/PMC11127892/ | "A higher cadence showed a small significant association with a lower oxygen/energy cost ( r = − 0.20 [− 0.35 to − 0.05])." | association |
| why `verticalOscillationCm`: "Less-bouncy runners tend to use less energy." | Van Hooren et al. 2024, same URL | "A smaller vertical displacement and higher vertical and leg stiffness showed significant moderate associations with lower oxygen/energy cost ( r = 0.35, − 0.31, − 0.28, respectively)." | association |
| why `armSwingAmplitude`: "Running with arms held still took 3–13% more energy." | Arellano & Kram 2014, https://pmc.ncbi.nlm.nih.gov/articles/PMC4296200 | "the net metabolic cost of running in the BACK, CHEST, and HEAD conditions was 3%, 9%, and 13% greater, respectively" | trial |
| why `trunkLean`: "More forward lean moves load from the knee to the hip." | Braun et al. 2024, https://pmc.ncbi.nlm.nih.gov/articles/PMC11809138/ | Manipulation confirmed: runners "ran at a constant speed of 2.5 m/s at 5 systematically varied trunk lean conditions" held by "an auditory real-time feedback approach". Outcome: "a systematic decrease in these parameters at the knee joint in the sagittal plane" and "with every degree of anterior trunk leaning, the cumulative hip joint extension loading increases by 3.26…" | trial |
| why `kneeFlexion`, `kneeDrive`: "Runners with more swing-leg hip and knee bend used more energy, not less." | Folland et al. 2017, https://pmc.ncbi.nlm.nih.gov/articles/PMC5473370/ | "Greater flexion of the knee and hip of the swinging leg was associated with higher LEc" | association |
| why `overstriding`: "Overstriding goes with harder braking." | Lieberman et al. 2015, https://journals.biologists.com/jeb/article/218/21/3406/14416/ | "Higher magnitudes of posteriorly directed braking forces were associated with increases in foot landing position relative to the hip (P=0.0005) but not the knee (P=0.54)" (abstract; the same abstract defines overstriding as "landing with the feet too far in front of their hips or knees") | association |
| non-point `footStrikePattern`: "Most distance runners land heel-first; switching isn't recommended for uninjured heel-strikers." | Anderson et al. 2020, Sports Med 50:885–917, https://www.theinjuryclinic.com.au/wp-content/uploads/2021/06/Anderson2020_Article_WhatAreTheBenefitsAndRisksAsso.pdf | Introduction: "It is well documented that the majority of shod runners habitually run with a rearfoot strike (RFS) pattern when running longer distances [5–7]." Conclusion: "changing strike pattern cannot be recommended for an uninjured RFS runner." | mixed |
| non-point `stepWidthCm`, `stepWidth`: "Runners pushed off their own width used 3–15% more energy." | Arellano & Kram 2011, J Biomech 44(7):1291–1295, https://pubmed.ncbi.nlm.nih.gov/21316058/ | "When subjects ran at target step widths less (0% LL) or greater (15%, 20%, and 25% LL) than preferred, both net metabolic power demand (by 3%, 9%, 12%, and 15%) and step width variability (by 7%, 33%, 46%, and 69%) increased." | trial |

Notes on the record:

- **Why lines describe runners, not the cue's effect** (review round 1). Each association line is
  worded as a difference between runners ("Quicker-stepping runners …"), so it cannot be read as
  the effect of making the change the cue names.
- **Why `cadence` says "on average", not "tend to".** The review round's "Quicker-stepping runners
  tend to use slightly less energy." is 9 words. With the label, the prefix and cadence's 13-word
  Try line, the stop would reach 26. "On average" carries the same between-runner hedge and leaves
  the stop at 25. "Slightly" carries the source's "small".
- **The knees line avoids "knee lift".** Folland's "flexion of the … hip of the swinging leg" is hip
  flexion. "Knee lift" would name a movement the paper does not name, and it trips the no-lift test.
- **Foot path has no why line** (review round 1). "Narrower steps go with higher IT-band strain"
  (Wang 2024, PMC11283446: "iliotibial band strain and strain rate showed a linear increasing trend
  as the step width narrowed") pulled against the non-point beside it, so it was dropped. The
  non-point is Arellano 2011's cost finding. A `swingFootLateralExcursion` headline has neither.
- **Foot strike cites Anderson's full text from a clinic's copy.** The journal page
  (doi:10.1007/s40279-019-01238-y) and PubMed (31823338) both served a bot challenge to the fetcher.
  PubMed's abstract, read through Europe PMC's record of PMID 31823338, carries the conclusion
  sentence but not the prevalence one, which is in the introduction. The clinic-hosted PDF is the
  URL already in the research record. Bovalino & Kingsley 2021 (PMC8581084) was the fallback, but
  its other claim is about "competitive advantage", not about whether to change.
- **Step width cites PubMed 21316058, and the research-file allowlist gained that URL.** PubMed
  served a bot challenge to the fetcher. The abstract quoted above is PubMed's own, read through
  Europe PMC's API for that PMID (DOI 10.1016/j.jbiomech.2011.01.002); the publisher page returned
  403. The citation and quote were added to `docs/prd/runner-led-results-research.md`, one of the
  two places a `FEEDBACK_VERIFIED_URLS` member must appear.
- **Metrics with no why line:** `verticalRatio`, `verticalOscillation` (Van Hooren's only
  normalised bounce row is normalised to step length and is not significant), `footStrikePattern`
  and the step-width pair (their stops carry the non-point), and `swingFootLateralExcursion`.

### D3. Cue eligibility, the area cue and the one thing

Review round 1 replaced "cue wherever `tryLineApplies`" with one eligibility rule for both the
area cue and the one thing. It follows the PRD's "cue only where the value is on the side the cue
addresses". A metric is eligible only if all of these hold:

- its tier is `'normal'`;
- its Try line exists and `tryLineApplies`;
- it has a renderable cited band;
- `pastCostlySide` holds: the value is strictly beyond the band's outermost finite bound, on the
  side its `economyConsequence` names as costly. This is the Energy cost headline's own threshold.

Cadence's open-ended `<153` zone therefore counts as beyond, while exactly 153, 165 and 175 do not.
Unbanded metrics are never eligible, so `overstriding` and `verticalOscillation` stay dormant until
they have a band (`strides-yg8`, `strides-n12`), and landing falls through to the foot-strike
non-point.

`ONE_THING_PRIORITY` is cadence, overstriding, verticalOscillationCm, verticalOscillation, then
every other metric in tour order. An area's cue is its first eligible metric, headline or
supporting, in that order. The one thing is the first eligible metric across all areas, so it is
always one of the area cues the reader has already seen. For example, cadence 175 with VO_cm 10.4
gives the bounce cue on the rhythm stop and as the one thing.

When nothing is eligible, `{ kind: 'nothingToChange' }` is returned only if every cue-capable
metric was measured at the normal tier. A cue-capable metric has a Try line, a renderable band and
an economy consequence; today that is `cadence` and `verticalOscillationCm`. Otherwise the result
is `{ kind: 'unclear', reason }`, and the first matching reason wins:

1. `'caveated'`: a cue-capable reading was measured below the normal tier.
2. `'pending'`: a scale-pass metric has a null value while `scalePassStatus` is `pending` or
   `running`, read as `selectHeadlines` reads it.
3. `'unmeasured'`: anything else.

`FocusAreaView` gained an `excluded` list so that these cases can be told apart.

### D4. Word budget and how words are counted

Visible words are counted as `text.trim().split(/\s+/).filter(Boolean).length`. The count sums the
area label, the why line, and either `CUE_PREFIX` ("One studied option:") with the cue text or the
non-point. The value, the band and the citation line are excluded: they are numbers and
attribution, not prose this layer writes.

The budget is ≤ 25 per stop, tested at the worst case per area. The worst case covers every metric
with a Try line as the cue (banded or not, so that a future band cannot overrun the budget) and
every headline with the longest non-point. The one-thing stop counts `ONE_THING_LABEL` ("One thing
to try"), the prefix and the cue. Why lines are ≤ 14 words.

| stop | worst case | words |
|---|---|---|
| rhythm | Rhythm + cadence why (8) + prefix (3) + metronome cue (13) | 25 |
| rhythm | Rhythm + bounce why (7) + prefix (3) + bounce cue (13) | 24 |
| arms | Arms + why (9) | 10 |
| posture | Posture + why (11) | 12 |
| knees | Knees + why (13) | 14 |
| landing | Landing + overstriding why (5) + foot-strike non-point (11) | 17 |
| landing (if overstriding is ever banded) | Landing + why (5) + prefix (3) + step-rate cue (16) | 25 |
| foot path | Foot path (2) + step-width non-point (10) | 12 |
| one thing | One thing to try (4) + prefix (3) + longest cue that can fire (13) | 20 |
| one thing, nothing to change | One thing to try (4) + "Nothing here calls for a change." (6) | 10 |

### D5. Layering and imports

`tryLineApplies`, `renderableBand`, `sourceHasProvenance`, `pastCostlySide` and the `GuidedEntry`
type moved down into `src/guidance/bandApplicability.ts`. `src/results/guidedGroups.ts` and
`guidedHeadlines.ts` re-export them, so existing importers are untouched. The `MetricTier` and
`ScalePassStatus` types moved into `src/guidance/types.ts` and are re-exported from
`src/results/metricConfidence.ts` and `src/results/types.ts`.

No production module in `src/guidance` imports from `src/results`. Running
`grep -rn "from '../results" src/guidance` lists only test files, which import the shared fixtures
and `metricTier`. Nothing comes from `src/runner`.

### D6. The tour (`strides-trn2.3`)

- **One shell, one runner.** `RunnerTour` renders its body through `GuidedResultsView`'s children
  slot (`null` while there is no result), so the status line and Start over exist once. The body is
  a rail holding ONE `ModelRunner`, never keyed per stop (the reader's Pause lives in its state),
  beside a column of stop sections. The tour mounts no metric card, so it holds no evidence canvas;
  the summary is the first view to mount them.
- **Plan.** `tour/tourPlan.ts` (pure) builds the stops from `summaryRows` (which now also returns
  all six `views`, so `selectOneThing` reads the same views), each with `feedbackFor`, plus the one
  thing, the unmeasured areas and one capture hint. The hint reads the session's coverage needs
  whose metrics sit in an unmeasured area: one view → "Add a front-view clip." (or side), both →
  "Add a side-view and a front-view clip.", none → "Film several seconds of steady running, whole
  body in frame."
- **Active stop.** `useActiveStop`: the last `[data-tour-stop]` whose top is at or above a reading
  line at 42% of the viewport (MotionStoryStage's line), rAF-batched on scroll/resize; `focusin`
  selects the focused stop. A `#tour-<id>` fragment goes through `useRevealFragment`, which focuses
  the stop, so focus covers it. The stop sets camera and rate from `FOCUS_AREA_CAMERA`
  (`NO_FOCUS_CAMERA` for the one thing) and focus from `runnerFocusFor` over the area's measured
  metrics (memoised on their ids).
- **Intro.** `useRunnerIntro` with `order` = every area's metrics in tour order, `camera` =
  `NO_FOCUS_CAMERA.camera` — the runner's own camera for as long as the intro runs, since no stop
  is shown then — and `active` from `onActiveChange`. `resultKey` is the session's clip ids plus a
  replay count that "Replay tour" increments, so a replay plays the intro again and the scale-pass
  graft does not. UI reads `running`, never `onDone`. An effect skips the intro once the active stop
  is past the first.
- **Word budget.** Counted in jsdom per D4 on each `[data-tour-stop]`, removing `.sr-only`,
  `.runner-tour__value` (name, value, confidence), `.feedback-line__citation` (evidence kind and
  source) and `.runner-tour__end`, which is budgeted separately (≤ 25).
- **Phones.** The rail, body and stop class strings are exported constants (`TOUR_RAIL_CLASS`,
  `TOUR_BODY_CLASS`, `TOUR_STOP_CLASS`) so `strides-trn2.4` can add its `max-lg:` background layout
  in place.
- **Fidelity.** The tour is the default view and its runner animates through the scale pass. The
  A/B driver gained a `--view-arm` plane; tour vs `?view=classic` on side-landscape, side-portrait
  and front-approach, three fresh-process trials each with `--evidence`, was bit-identical in every
  field but `elapsedMs`.

## Risks / Trade-offs

- The rhythm stop with the cadence cue sits exactly on the 25-word budget, as would landing if
  overstriding were ever banded. Any longer Try line or why line there fails the test, which is
  the intent.
- A clinic-hosted copy of a paywalled paper can disappear. The URL test will not notice a dead
  link, only an unpinned one.

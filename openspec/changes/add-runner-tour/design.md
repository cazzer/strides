## Context

The guided view (`openspec/specs/guided-results-view`) renders thirteen metric cards against cited
bands, with a Try line on four of them and a withholding rule (`tryLineApplies`) for a Try line
that would point a runner further out of their band. The runner-led PRD reorganises that content
as a tour by body region. This change is only the data layer: two pure modules, no UI.

## Goals / Non-Goals

**Goals:** a fixed grouping of metrics into focus areas; per area a cited why line, the existing
Try line as a cue where it applies, or a cited non-point; at most one cue for the whole tour; tight
word budgets (the first reader called the guided page "significantly too verbose").

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
non-excluded metrics in the same order; `measured` is false exactly when there is no headline.
The tour's closing stop, `oneThing`, is a `TourStopId` but not a `FocusAreaId`.

### D2. Lines are cited or absent

A why line is keyed by the headline metric, so an area that falls back to a sibling metric says
only what that sibling's source supports (rhythm headlined by `verticalRatio` has no why line).
The cue is always the headline metric's existing `tryLine`, verbatim, gated by `tryLineApplies`.
A non-point is shown only when there is no cue: the first measured metric in the area with a
`NON_POINTS` entry. Knees never carry a cue, enforced structurally (`NO_CUE_AREAS`) as well as by
the knee metrics having no Try line.

Every URL was opened on 2026-10-27. The sentence each line rests on:

| line | source | supporting sentence (verbatim) | evidence |
|---|---|---|---|
| why `cadence`: "Higher cadence goes with slightly lower energy cost." | Van Hooren et al. 2024, https://pmc.ncbi.nlm.nih.gov/articles/PMC11127892/ | "A higher cadence showed a small significant association with a lower oxygen/energy cost ( r = − 0.20 [− 0.35 to − 0.05])." | association |
| why `verticalOscillationCm`: "Less bounce goes with lower energy cost." | Van Hooren et al. 2024, same URL | "A smaller vertical displacement and higher vertical and leg stiffness showed significant moderate associations with lower oxygen/energy cost ( r = 0.35, − 0.31, − 0.28, respectively)." | association |
| why `armSwingAmplitude`: "Running with arms held still raised energy cost 3–13%." | Arellano & Kram 2014, https://pmc.ncbi.nlm.nih.gov/articles/PMC4296200 | "the net metabolic cost of running in the BACK, CHEST, and HEAD conditions was 3%, 9%, and 13% greater, respectively" | trial |
| why `trunkLean`: "More forward lean moves load from the knee to the hip." | Braun et al. 2024, https://pmc.ncbi.nlm.nih.gov/articles/PMC11809138/ | Manipulation confirmed: runners "ran at a constant speed of 2.5 m/s at 5 systematically varied trunk lean conditions" held by "an auditory real-time feedback approach". Outcome: "a systematic decrease in these parameters at the knee joint in the sagittal plane" and "with every degree of anterior trunk leaning, the cumulative hip joint extension loading increases by 3.26…" | trial |
| why `kneeFlexion`, `kneeDrive`: "More swing-leg knee and hip bend went with higher energy cost." | Folland et al. 2017, https://pmc.ncbi.nlm.nih.gov/articles/PMC5473370/ | "Greater flexion of the knee and hip of the swinging leg was associated with higher LEc" | association |
| why `overstriding`: "Overstriding goes with harder braking." | Lieberman et al. 2015, https://journals.biologists.com/jeb/article/218/21/3406/14416/ | "Higher magnitudes of posteriorly directed braking forces were associated with increases in foot landing position relative to the hip (P=0.0005) but not the knee (P=0.54)" (abstract; the same abstract defines overstriding as "landing with the feet too far in front of their hips or knees") | association |
| why `stepWidthCm`, `stepWidth`: "Narrower steps go with higher IT-band strain." | Wang et al. 2024 (systematic review), https://pmc.ncbi.nlm.nih.gov/articles/PMC11283446/ | "iliotibial band strain and strain rate showed a linear increasing trend as the step width narrowed [37, 48]" | mixed |
| non-point `footStrikePattern`: "Most distance runners land heel-first; changing it isn't recommended for uninjured runners." | Anderson et al. 2020, Sports Med 50:885–917, https://www.theinjuryclinic.com.au/wp-content/uploads/2021/06/Anderson2020_Article_WhatAreTheBenefitsAndRisksAsso.pdf | Introduction: "It is well documented that the majority of shod runners habitually run with a rearfoot strike (RFS) pattern when running longer distances [5–7]." Conclusion: "changing strike pattern cannot be recommended for an uninjured RFS runner." | mixed |
| non-point `stepWidthCm`, `stepWidth`: "Your own width is usually your most economical." | Arellano & Kram 2011, J Biomech 44(7):1291–1295, https://pubmed.ncbi.nlm.nih.gov/21316058/ | "When subjects ran at target step widths less (0% LL) or greater (15%, 20%, and 25% LL) than preferred, both net metabolic power demand (by 3%, 9%, 12%, and 15%) and step width variability (by 7%, 33%, 46%, and 69%) increased." | trial |

Notes on the record:

- **Why `cadence` was reworded** from the PRD's "Higher step rates go with slightly lower energy
  cost." (9 words) to the source's own term "cadence" (8 words): with the label and cadence's
  13-word Try line the stop otherwise reaches 26 words, one over budget. "Slightly" carries the
  source's "small" and was kept over every shorter option.
- **Why `stepWidth` drops "modelled".** The review's sentence does not say the strain was modelled,
  and a line must not say more than its page.
- **Foot strike cites Anderson's full text on a clinic's copy.** The journal page
  (doi:10.1007/s40279-019-01238-y) and PubMed (31823338) both served a bot challenge to the
  fetcher; PubMed's abstract, read through Europe PMC's record of PMID 31823338, carries the
  conclusion sentence but not the prevalence one, which is in the introduction. The clinic-hosted
  PDF is the URL already in the research record. Bovalino & Kingsley 2021 (PMC8581084, already
  pinned) was the fallback; it supports prevalence ("79% … rising to 86%") but its other claim is
  about "competitive advantage", not about whether to change, so it fits a non-point less well.
- **Step width cites PubMed 21316058.** PubMed served a bot challenge to the fetcher; the abstract
  quoted above is PubMed's own, read through Europe PMC's API for that PMID (DOI
  10.1016/j.jbiomech.2011.01.002). The publisher page returned 403. The citation and quote were
  added to `docs/prd/runner-led-results-research.md`.
- **No line was dropped.** Every ⚠ line in the plan found a page that states it, with the two
  rewordings above.
- **No why line** for `verticalRatio`, `verticalOscillation` (Van Hooren's only normalised bounce
  row is normalised to step length and not significant), `footStrikePattern` (its stop carries the
  non-point) or `swingFootLateralExcursion`.

### D3. The one thing

`selectOneThing` walks `ONE_THING_PRIORITY` — cadence, overstriding, verticalOscillationCm,
verticalOscillation, then every other metric in tour order — over all non-excluded metrics outside
the knees area. A metric is eligible only if all hold: tier is `'normal'`; its Try line exists and
`tryLineApplies`; it has a renderable cited band; and its value is strictly beyond the band's
outermost finite bound on the side the Try line moves away from (`direction: 'higher'` → below the
lowest bound; `'lower'` → above the highest). That is the Energy cost headline's threshold
(`pastCostlySide`), and a test pins agreement for cadence and VO_cm across values on both sides of
each bound. Cadence's open-ended `<153` zone therefore counts as beyond; exactly 153 does not.
Unbanded metrics are never eligible, so `overstriding` and `verticalOscillation` stay dormant until
they have a band (`strides-yg8`, `strides-n12`). Nothing eligible → `{ kind: 'nothingToChange' }`.

### D4. Word budget and how words are counted

Visible words = `text.trim().split(/\s+/).filter(Boolean).length`, summed over the area label, the
why line, and either `CUE_PREFIX` ("If you choose:") plus the cue text or the non-point. The value,
the band and the citation line are excluded: they are numbers and attribution, not prose this
layer writes. Budget ≤ 25 per stop, tested worst case per area — every possible headline with the
longest action it could carry. The one-thing stop is `ONE_THING_LABEL` + prefix + cue. Why lines
are ≤ 14 words.

| area | worst case | words |
|---|---|---|
| rhythm | Rhythm + cadence why (8) + prefix (3) + metronome cue (13) | 25 |
| arms | Arms + why (9) | 10 |
| posture | Posture + why (11) | 12 |
| knees | Knees + why (11) | 12 |
| landing | Landing + why (5) + prefix (3) + step-rate cue (16) | 25 |
| foot path | Foot path (2) + why (7) + non-point (8) | 17 |
| one thing | Your one thing (3) + prefix (3) + longest cue (16) | 22 |

### D5. Imports

`focusAreas.ts` imports only types (`heuristics/types`, `results/metricConfidence`).
`feedbackPoints.ts` imports `results/guidedGroups` (`renderableBand`, `tryLineApplies`) and
`guidance/bandPosition`, `guidance/metricGuidance`. Nothing imports either new module yet, so no
cycle is possible; nothing comes from `src/runner`.

## Risks / Trade-offs

- Rhythm and landing sit exactly on the 25-word budget; any longer Try line or why line there fails
  the test, which is the intent.
- A clinic-hosted copy of a paywalled paper can disappear; the URL test will not notice a dead
  link, only an unpinned one.

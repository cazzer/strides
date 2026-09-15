# Design — guided results view

**Status of this document.** The reference bands below were fixed by a research pass that ran
**before** this change was scoped, and every number in them came off a page a researcher actually
loaded. Items marked **[derived]** are arithmetic on published numbers, not a published statistic,
and are labelled as such everywhere they appear — on screen as well as here. Items the research pass
could not load (HTTP 403) are named where they would otherwise have been cited, and are **not** used
as ranges.

That ordering matters for the same reason it mattered in
`derive-area-floor-from-4k-measurement`: a band is exactly the kind of number that can be nudged
until this repo's own three demo clips land inside it. **No band in this document was chosen with a
measurement from this repo's footage in hand**, and D6 records the one place where that policy costs
us — a shipped band that our own regression anchor falls outside of, left where it is.

This document is the permanent home of that provenance. The research digests it condenses live in a
session scratchpad that will not survive; everything load-bearing is reproduced here.

---

## D1 — The governing rule: a band is cited or it does not ship

**Decision: a reference band ships for a metric if and only if published literature states a range
in the unit this app already reports that metric in. No band is invented, inferred from this repo's
footage, interpolated between studies, or unit-converted through an unresolved assumption.**

This is not caution for its own sake. It is the conclusion two prior investigations in this repo
already reached, arrived at independently and recorded:

- **Bead `strides-yg8`** set out to give `overstriding` an interpretive band so a cross-clip
  disagreement could surface on it. It closed **without** one, and names the failure mode directly:
  *"A per-metric magnitude threshold means eleven unjustifiable constants … A disagreement threshold
  picked to make these two clips light up is the same mistake."*
- **CLAUDE.md, "The 4K area floor cannot be re-derived"** is the worked example: a threshold was
  measured, found to sit inside a factor-of-2.9 squeeze between its two endpoints, and the entire
  direction abandoned — *"Do not re-litigate by picking a different number."*

**Citing a published band is a different act from inventing one.** It is a sourced external fact,
attributable and falsifiable by a reader who follows the link. That is the whole distinction this
change turns on, and it is why the citation is not decoration: **a band with its provenance stripped
off is indistinguishable from a number we made up.** Hence the spec requirement that a band renders
only with its source, population and sample size visible on screen — not in a tooltip, not behind a
disclosure, not in a footnote at the bottom of the page.

**Consequence, accepted rather than worked around: the page is lopsided.** Five metrics get a scale
and seven do not, and the seven include `overstriding`, which is the metric in the original user
request. D5 and D8 handle that head-on instead of papering over it.

## D2 — The five banded metrics

Display rank is the order below and is fixed here, not left to the implementer. It ranks by
**strength of the evidence behind the band**, not by how interesting the metric is.

| # | metric | unit as this app reports it | band | source | population | n |
|---|---|---|---|---|---|---|
| 1 | `cadence` | `stepsPerMinute` | five published percentile zones: `<153` / `153–163` / `164–173` / `174–183` / `>183` spm | Garmin fenix 7 + Forerunner 945 owner's manuals (zone table); Malisoux 2023 *Orthop J Sports Med* 11(10) (distribution) | Garmin: unstated (see D9); Malisoux: recreational runners at 9.9 km/h | Garmin: unpublished; Malisoux: **860** |
| 2 | `verticalRatio` | `percent` (a 0..1 value rendered ×100) | **[derived]** Garmin's per-step zones **halved** to per-stride: `<3.05` / `3.05–3.70` / `3.75–4.30` / `4.35–5.05` / `>5.05` % | Garmin fenix 7 APAC manual (zone table) + Forerunner 255 manual (the definition that forces the halving); Folland 2017 *MSSE* 49(7):1412–1423 (independent corroboration) | Garmin: unstated; Folland: trained runners, 10–12 km/h | Garmin: unpublished; Folland: **97** |
| 3 | `verticalOscillationCm` | `centimeters` | `6.0–9.5` cm (P10–P90, pooled), midpoint `7.7` cm | Malisoux 2023 *Orthop J Sports Med* 11(10) | recreational runners at 10 km/h | **860** |
| 4 | `trunkLean` | `degrees` | `1.8–21.4°` observed range, mean `10.3°` | Folland 2017 *MSSE* 49(7):1412–1423 | trained runners, 10–12 km/h | **97** |
| 5 | `kneeFlexion` | `degrees` | `85–125°` | Fukuchi 2017 *PeerJ* 5:e3298 (speed-stratified) + Hanley 2021 (cross-convention corroboration) | Fukuchi: regular runners at 2.5 / 3.5 / 4.5 m/s; Hanley: distance runners at midswing | Fukuchi: **28**; Hanley: book chapter, cohort not restated |

**Rank 1 — `cadence`.** The strongest of the five, because two independent kinds of source agree.
Garmin's five-zone percentile table is a manufacturer statement over an unpublished population;
Malisoux 2023 is a peer-reviewed distribution over 860 recreational runners at 9.9 km/h reading
**164 ± 9 spm**, whose P10–P90 at 10 km/h is 152–174 (men) and 156–180 (women) — which brackets
Garmin's 30–69th zone (164–173) almost exactly. Three further cohorts land where you would expect:
Folland 2017 (n=97 trained) 166.8 ± 10.7 with a full range of 144–222; Heiderscheit 2011 (n=45)
172.6 ± 8.8; Burns 2019 (elite ultramarathoners) 182.0, range 155.4–203.1.

**180 spm is not a target and must not appear as one.** The figure originates in Jack Daniels
counting foot strikes at the 1984 Olympics — elite athletes at race pace. Schubert 2014 *Sports
Health* 6(3):210–217, the review usually cited for it, **never mentions 180 or any universal
optimum**, and frames the entire literature as percentage change from an individual's own preferred
rate. Anderson 2022 *Sports Med Open* 8:112 (37 studies): *"insufficient evidence to determine the
effects of changing running step rate on injury or performance."* The strongest injury finding
available is an association without a target — Kliethermes 2021 *BJSM* (n=54 collegiate cross
country): each +1 spm associated with 5% lower bone-stress-injury risk, RR 0.95 (CI 0.91–0.98).

**Rank 2 — `verticalRatio`.** The band is **[derived]**. D3 is its entire derivation.

**Rank 3 — `verticalOscillationCm`.** Malisoux 2023 defines vertical oscillation as *"difference
between minimal and maximum vertical positions of the center of mass during a step"* — peak-to-peak,
per step, at the COM. That is definitionally what `verticalOscillationCm` computes. Overall
77 ± 12 mm; men 80 ± 13, women 73 ± 11. At 10 km/h, P10–P90: men 64–95 mm (P50 78), women 60–85 mm
(P50 74). **Pooled to ship: 6.0–9.5 cm, midpoint 7.7 cm.** Heiderscheit 2011 corroborates at
8.7 ± 1.3 cm COM excursion at 2.9 m/s (falling to 7.3 cm at +10% cadence). D4 records why Garmin's
bands are **not** used here even though they exist and would have been easier.

**Rank 4 — `trunkLean`.** Folland 2017 is the only trunk-angle source the research pass read from
the paper itself: **10.3 ± 3.7° forward, range 1.8–21.4°**, n=97 trained runners at 10–12 km/h. Two
qualifications ship with it. First, Folland's zero reference is **quiet standing**, not true
vertical — a small real offset against this app's definition, disclosed rather than corrected for.
Second, and more importantly, **the direction of "better" is contested, so this band ships as a
spread with no preferred end**:

- knee load **falls** with forward lean (Teng & Powers; Braun 2024);
- hip and lumbar load **rise about three times as fast as knee load falls** — Braun 2024 *J Sport
  Health Sci* 14:100985, verbatim: per degree of anterior trunk lean, cumulative hip extension
  loading **+3.26** Nm·s/kg/1000 m against knee **−1.08**;
- impact loading rate **+29%** and impact transients **+20%** with greater trunk flexion
  (Warrener 2021);
- performance points the other way entirely — Folland: *"A more upright/extended trunk posture
  correlated with better running performance."*

Braun's own recommendation is that trunk lean be altered *"only to an extent that is not too far
from the individual's self-selected trunk angle"* — i.e. **no target angle**. A UI that put a
preferred end on this scale would be picking a side in a live disagreement between four outcomes.

Teng & Powers 2014 (7.3 ± 3.6° self-selected) is **[NOT LOADED]** — JOSPT returned 403. It is
high-confidence secondary knowledge and is **not quoted as a range** anywhere.

**Rank 5 — `kneeFlexion`.** Fukuchi 2017 (n=28 regular runners) uses the same convention this app
does — 0° is full extension — and is stratified by speed:

| speed | peak knee flexion |
|---|---|
| 2.5 m/s (~9 km/h) | 93.5 ± 10.4° |
| 3.5 m/s (~12.6 km/h) | 108.7 ± 10.7° |
| 4.5 m/s (~16.2 km/h) | 119.1 ± 10.4° |

**That is roughly +13° per 1 m/s, and it makes this the most speed-sensitive metric in the set** —
the 2.5 and 4.5 m/s means are 2.5 SDs apart. **This app cannot measure running speed at all.** The
band is therefore deliberately wide: it spans the speed range rather than pretending to a precision
the input does not support, and it carries the speed caveat most prominently of the five.

Corroboration across conventions: Hanley 2021 reports 55–60° *included* thigh–shank angle at
midswing, which is **120–125°** in this app's convention; Folland 2017 reports 94.1 ± 11.1° swing
flexion, range 71–129. **Pooled to ship: 85–125°.**

Two honest gaps, recorded rather than smoothed: Fukuchi does not state whether its maximum is swing
or stance, and stance peak is ~45° in comparable cohorts, so 93–119° **must** be swing — that is an
inference, not the paper's claim. And Novacheck 1998, to which the ubiquitous "125° at midswing"
figure is attributed everywhere, is **[NOT LOADED]** and is **not cited**.

## D3 — The halving derivation for `verticalRatio`

**This is the one band on the page that is arithmetic rather than a quotation, so it gets the
longest justification and it is labelled [derived] on screen.**

**The claim.** Garmin's published vertical-ratio zones are **per step**. This app's `verticalRatio`
is **per stride**. A stride is two steps. Therefore this app's value is approximately **half**
Garmin's for the same runner, and Garmin's zones must be halved before they can be laid against it.

```
Garmin, per step              [derived] per stride = Garmin ÷ 2
  >95th pct  : <6.1%     ->     <3.05%
  70–95      : 6.1–7.4%  ->     3.05–3.70%
  30–69      : 7.5–8.6%  ->     3.75–4.30%
  5–29       : 8.7–10.1% ->     4.35–5.05%
  <5         : >10.1%    ->     >5.05%
```

Every bound halves exactly to two decimal places; **no rounding was applied and none was needed.**

**Note the 0.05 gaps at 3.70→3.75 and 4.30→4.35. They are Garmin's, not ours.** Garmin publishes its
zone table to one decimal place with non-contiguous bounds (6.1–7.4 then 7.5–8.6), and halving
preserves the discontinuity. **The gaps are not closed.** Inventing a boundary to make the table
tile cleanly would be inventing exactly the kind of number D1 forbids, for a purely cosmetic gain.

### Leg (a) — Garmin's denominator is a step, stated in Garmin's own manual

The Forerunner 255 manual defines its "stride length" verbatim as **"the length of your stride from
one footfall to the next."** One footfall to the *next* is left-to-right or right-to-left: a **step**,
half a stride. Two independent cross-checks on Garmin's own published figures agree:

1. **Arithmetic on Garmin's own numbers.** At 10 km/h and 164 spm, distance per footfall is
   1.02 m — a step length, not a stride length. A true stride at that pace is ~2.0 m.
2. **Garmin's two band tables must be consistent with each other.** Garmin's chest-measured vertical
   oscillation bands (8.2–9.7 cm) divided by its vertical ratio bands (7.5–8.6%) imply a denominator
   of **109–113 cm**. That is a step, unambiguously — a stride would be ~200 cm.

### Leg (b) — this app's denominator is a true stride, stated in this app's own source

`src/heuristics/strideLength.ts` (lines 102–104 as written), in the module docstring section headed
*"What a 'stride' is here"*:

> A stride is the interval between two consecutive footstrikes of the SAME foot — left-to-left or
> right-to-left is a step (half a stride); this extractor only pairs same-side consecutive
> footstrikes, so every `d` in its result is a genuine full-stride displacement, not a step.

`verticalRatio.ts` is the only consumer of that extractor, and divides a per-step bounce by that
per-stride displacement. So the two denominators differ by exactly the factor of two the halving
applies. **The derivation rests on a definition on each side, not on a fit.**

### Leg (c) — two independent corroborations land where the derivation predicts

**[derived] Folland 2017, an entirely separate route.** Folland reports both terms height-normalised
over the same n=97 cohort: pelvis oscillation **0.052 H** and stride length **1.28 H**. Height
cancels:

```
0.052 H / 1.28 H = 4.06% per stride
```

**4.06% lands inside the derived 30–69th band (3.75–4.30%).** Folland measured a different cohort
with different instrumentation and published neither a vertical ratio nor a band; the agreement is
between Garmin's percentile table halved and an independent laboratory ratio, reached with no shared
assumption but the definition of a stride.

**A third check, from this repo's own footage.** CLAUDE.md records the `side-landscape` clip's
`verticalRatio` at **0.0310419** — 3.10% — measured on the shipped pipeline and reproduced exactly
across trials. That lands just inside the derived **70–95th** band, on its 3.05 boundary. Not
proof — it is one clip of one runner — but it is the reading that would have screamed if the factor
of two were backwards: an un-halved comparison would have put this runner off the bottom of the
scale, better than the 95th percentile of every Garmin user, which nobody believes.

**What would falsify this.** If Garmin ever publishes a per-stride definition, or if a cohort study
reports vertical ratio against an explicitly same-side-to-same-side stride length and lands near 7%
rather than near 4%, the halving is wrong and the band must be withdrawn — not rescaled by a fitted
constant.

## D4 — Why `verticalOscillationCm` uses Malisoux and NOT Garmin

**Garmin publishes vertical-oscillation bands in centimetres. They are not used. This is deliberate
and it is the reason the band for rank 3 comes from a paper while the band for ranks 1 and 2 comes
from a manual.**

Two facts, both against Garmin's numbers *for this metric specifically*:

1. **Measured device error, in the direction that matters.** Smith 2022 *PLoS ONE* 17(11):e0277810
   measured Garmin devices approximately **1.3–1.5 cm high** against a video reference. That is a
   fifth of the entire 6.0–9.5 cm band, in one direction.
2. **The sensor is not at the centre of mass.** Garmin's pod sits on the chest or the waist. This
   app's `verticalOscillationCm` is a COM-proxy bounce derived from the hip midpoint. A
   chest-mounted sensor sees more vertical travel than the COM does, which is the same direction as
   the measured error and compounds it.

**Using Garmin's centimetre bands unshifted would flag a normally-bouncing runner as bouncy**, on a
page whose entire premise is that it does not grade anybody. Malisoux 2023's definition, by
contrast, is the one this app implements — COM, peak-to-peak, per step — measured over 860 runners
and published with percentiles. It is used instead.

**Note what this does *not* imply for D3.** `verticalRatio` still uses Garmin's zones, halved,
because a **ratio cancels the offset a fixed centimetre band cannot**: both of Garmin's terms are
measured by the same misplaced sensor, so a proportional error in the numerator largely divides out.
That asymmetry is the reason one metric can use a manufacturer's table and its sibling cannot, and
it is worth stating plainly because the two decisions look inconsistent until you look at the units.

## D5 — The seven metrics that carry no band, each with its reason

**These render. They are not deleted and they are not hidden — they are collapsed, and they keep
their value, their description, their caveats, their research links and their remediation links.**
D1 controls whether a **scale** renders, not whether the **metric** renders. Each entry below is the
reason a reader gets when they expand it.

### 1. `overstriding` — no band exists in any unit, and the two published measurements of this exact geometry disagree by 3.4×

**This is the metric in the original request, and it is the one this design most has to refuse.**
Bead **`strides-yg8`** reached the same refusal independently, from a completely different
direction — it wanted a band so that a cross-clip disagreement caveat could fire on this metric, and
closed without one rather than pick a threshold. That bead is the in-repo precedent; the research
below is the external confirmation of it.

- **No published study normalises foot-to-hip horizontal distance by TORSO LENGTH**, which is the
  unit this app reports. A targeted Europe PMC search for "trunk length" / "torso length" combined
  with overstride / foot-to-COM returned nothing relevant. There is no band to cite in our unit
  because nobody has measured in our unit.
- **And there is no threshold in any *other* unit either.** Baker 2024, verbatim: *"there is
  currently no consensus on what qualifies as excessive overstriding."* Souza 2016's clinical 2D
  protocol uses **exactly this app's landmarks** — a vertical line up from the lateral malleolus
  against the pelvis — and is explicitly **dichotomous, with no units and no cutoff**. The closest
  thing in the literature to our measurement declines to put a number on it.
- **The two published absolute measurements of the same geometry disagree by 3.4×:**

  | source | published figure | **[derived]** in torso lengths |
  |---|---|---|
  | Heiderscheit 2011 | 9.2 ± 4.0 cm (COM-to-heel at initial contact, 2.9 m/s) | ~**0.18** |
  | Lieberman 2015 *JEB* 218(21):3406–3414 | 0.31 ± 0.08 m (ankle-to-hip, 75 strides/min) | ~**0.62** |

  **Neither paper defines its computation precisely enough to reconcile them.** Halving the gap to
  get a band would be picking a number and calling it research.

- **Correction to a figure in circulation:** Baker 2024's "5.9 ± 1.3 cm" is the **within-subject
  range across cadence conditions**, not a mean overstride. It is not a band and must not be quoted
  as one.

**The only defensible statement about `overstriding` is relative, and it ships as one:** Heiderscheit
2011 showed a +10% step rate moved foot-to-COM from 9.2 cm to 7.0 cm — a **24% reduction**. That is
a within-runner change under an intervention, not a population range, and it is exactly the shape of
statement D8 routes to the `cadence` card.

### 2. `verticalOscillation` (% of torso length) — a band is derivable and is deliberately not shipped

This one is the closest call in the set, and it is refused on process rather than on absence. A band
**is** arithmetically reachable: Folland's 0.052 H pelvis oscillation divided by Winter's
textbook torso fraction of 0.288 H gives **~0.18 torso lengths** (range 0.11–0.26) — and this repo's
own readings (~18–25%) land inside it, which is precisely the seduction.

**It is not shipped because the derivation passes through two unresolved steps**, either of which
moves the answer:

1. a textbook anthropometric constant (Winter, after Drillis & Contini 1966) standing in for a
   measured torso length, and
2. an **ambiguous per-stride versus per-step convention** in Folland's pelvis-oscillation figure —
   the same ambiguity D3 had to resolve for `verticalRatio`, and there it was resolvable from
   Garmin's own manual. Here it is not.

D3's halving survives because each leg rests on a **stated definition**. This derivation rests on an
assumed constant and an unstated convention, and "our own footage lands inside it" is corroboration
only if the band was not built to contain it. **Its two siblings carry bands instead**, which is why
the vertical-oscillation family is not left silent. This is the top candidate for a follow-up if
anyone resolves Folland's convention.

### 3 and 4. `stepWidth` and `stepWidthCm` — crossover is NORMAL at speed, and the injury link rests on a documented citation error

- **Three incompatible definitions in the literature**, differing by ~2× and by sign. Only "base of
  gait" (Stiffler-Joachim 2020 *J Athl Train* 55(12):1300–1306, n=166 Division-I athletes) matches
  this app's sign convention — and even that samples at **midstance**, where this app samples at
  footstrike.
- **Crossover is normal at speed.** Stiffler-Joachim, verbatim: *"On average, males demonstrated
  crossover at 4.47 m/s (6:00-minute mile), whereas females did not demonstrate crossover at any
  speed"*, and a negative base of gait at fast speeds *"may be normal in a healthy population"*.
- **The speed effect is as large as the value itself**: −0.353 cm at 2.95 m/s rising to −1.442 cm at
  4.47 m/s against a 2.68 m/s reference. A fixed centimetre threshold in a speed-blind app would
  label fast runners as crossover **purely for being fast**.
- Typical values for scale, not as a band: Arellano & Kram 2011 foot-to-foot 3.61 ± 2.56 cm
  (**[derived]** ~1.8 cm in this app's convention); Stiffler-Joachim's model intercept 1.358 cm
  (CI 0.968–1.747). **No published target range in centimetres exists** — searched for specifically.
- **The injury link is modelling-only in uninjured runners.** Meardon 2012 (ITB strain) and
  Meardon & Derrick 2014 (tibial stress) are both **[NOT LOADED]**, 403. No prospective study was
  found. One retrospective study points the **other way**: DeJong Lempke 2023 found post-ankle-sprain
  runners ran 1.5 ± 0.7 cm **wider**.
- **A broken citation chain worth knowing about, because it is in wide circulation.** Kilgore 2020
  asserts narrow step width → tibial stress fractures, citing Nunns 2016 (n=1065 Royal Marines) —
  whose actual predictors were **bimalleolar width**, BMI, peak heel pressure and tibial rotation.
  **Step width was never measured in that study.** An ankle *dimension* has been conflated with a
  gait *variable* downstream. Separately, "normal step width is 8–10 cm" traces to Physiopedia — not
  peer-reviewed, and describing **walking**.

**Neither of these metrics may render anything that treats a negative value as a defect.**

### 5. `footStrikePattern` — prevalence only, and no valence

Bovalino & Kingsley 2021 *Sports Med Open* 7:82, meta-analysis: rearfoot **79%** (CI 0.70–0.86)
early in a race, rising to **86%** (CI 0.85–0.88) at the final checkpoint — prevalence *rises* with
distance; non-rearfoot falls 21% → 14%. *"Inconclusive evidence of a competitive advantage"* for
non-rearfoot.

Burke 2021 *OJSM* 9(9), systematic review of 13 studies with GRADE applied, verbatim: *"There was
low evidence to suggest a relationship between FST … and RRIs … these studies were very low
quality."* Only 1 of 7 studies using continuous measures found a significant relationship.

Mechanistically the difference is a **redistribution, not an improvement**: rearfoot raises
patellofemoral load and vertical loading rate, forefoot raises Achilles and soleus load.

**So this metric reports its classification plus the prevalence fact — "about 8 in 10 distance
runners are rearfoot strikers" — and attaches no valence whatsoever.** A UI presenting forefoot as
the good end of a scale would be asserting exactly what the best available systematic review rates as
low-quality evidence.

### 6 and 7. `kneeDrive` and `armSwingAmplitude` — no published reference values exist in these units

Nothing surfaced. **This was not an exhaustive search**, and that limitation is recorded rather than
dressed up as a finding: the honest statement is "we did not find one", not "none exists". They
render their value and their description, with no band and no research-backed remediation claim.

## D6 — The known interaction with this repo's own numbers, recorded and NOT accommodated

**CLAUDE.md's standing regression anchor for `verticalOscillationCm` on the `side-landscape` track
clip is `4.421467928439415` cm — re-confirmed to every digit across at least four separate
re-measurements, on three different commits. Malisoux's P10 is 6.0 cm. Our anchor sits ~26% below
the bottom of the band we are shipping.**

**This is expected, it is already explained in this repo, and the band does not move.**

CLAUDE.md's "MediaPipe metric calibration" section records the mechanism in detail: at that clip's
`sinusoidR2` of ≈0.42–0.49 a single sinusoid explains under half the residual variance, so the
fitted amplitude **necessarily underfits the peak excursions** of a peaky waveform. The section's own
words: *"the whole VO family reads low on peaky waveforms, consistently"*, and it records the same
clip reading ~20% below the 6–13 cm literature range — *"a real shortfall, not a marginal one"*,
noted there long before this change existed.

**Two ways to make that disagreement disappear, both refused:**

- **Move the band down.** This is the 4K-area-floor mistake exactly: tuning an external constant
  until this repo's own footage lands inside it. It would also destroy the band's only value, which
  is that it came from somewhere else.
- **Suppress the metric on clips that read low.** That hides a known measurement bias behind a
  rendering rule, and it hides it precisely where it is informative.

**What ships instead: the scale shows the reading where it falls, outside the band, and says so in
words.** A value outside the band's domain clamps its marker to the edge **and states that it is
outside** — it must never silently render as "at the minimum". That is a spec requirement, not a
styling note, and D6 is why it exists.

**Read forward:** if the VO family's sine-underfit is ever corrected, this anchor moves up toward
the band and **the band will not have needed to change** — which is the test of whether it was
honest. If instead a future reader finds our clips landing low against this band and "fixes" the
band, this section is the record that they have broken it.

## D7 — Architecture

Nine decisions, locked before this change was scoped. The three that are **forced** rather than
stylistic are marked.

**D7.1 — The swap point.** `src/results/MultiClipVideoSession.tsx` renders
`<ResultsView analysis onTryAgain onChooseDifferentVideo evidence clipCount />` behind
`anyClipVideoReady`. That is the only branch this feature needs. The guided view is a **sibling**
component taking the identical prop shape, so the two are interchangeable at that one call site.

**D7.2 — `ResultsView.tsx` and `MetricsPanel.tsx` are not edited. At all.** The existing capability's
requirements, the existing unit suite and the existing e2e spec all keep passing untouched, and the
classic view stays the default. A guidance page that had to modify the page it sits beside would be
carrying risk it does not need to carry.

**D7.3 — Exactly one view mounts at a time. FORCED, not stylistic.** `useSessionEvidence` hands out
real `HTMLCanvasElement` nodes and `EvidenceCanvas` mounts them with `host.replaceChildren(canvas)`.
**A DOM node has exactly one parent.** Rendering both views simultaneously would silently *move*
every evidence canvas into whichever mounted last, emptying the other view's thumbnails with no
error anywhere. So the branch is `if`/`else`, never both — and **the guided view must not call
`useSessionEvidence` itself**; evidence arrives as a prop, from the one existing call.

**D7.4 — The switch is a `?view=` search param plus a visible toggle.** No router dependency; none is
installed and none should be. The mode resolves from `location.search`, the toggle updates it via
`history.replaceState` so a reload keeps the choice and the URL is shareable. **Default is
`'classic'`.**

**D7.5 — The guided view MUST render `role="status"` with the exact text "Analysis complete."
FORCED.** `e2e/multiPersonAcquisition.spec.ts` and `scripts/ab-person-selection.mjs` both wait on
that literal, and today it lives only in `ResultsView`. Rendering it in the guided view too means the
default can be flipped later without breaking the A/B harness or the e2e suite — and it means a
harness pointed at `?view=guide` works today.

**D7.6 — A band controls whether a SCALE renders, not whether the METRIC renders.** Three groups:
banded and measured (expanded, ranked, scale + links); measured with no band (collapsed, links, **no
scale**); not measured on this clip (collapsed, reason + capture hint).

**D7.7 — No invented thresholds.** D1, in one line, restated here because it is an architectural
constraint and not only an editorial one: the guidance record is allowed to hold a band only where a
citation exists to hang on it, and the type system should make an uncited band unrepresentable.

**D7.8 — Reference band, never a verdict.** The scale shows position against a published range,
labelled with source and population. Never a pass/fail, a grade, or a colour that means "bad".

**D7.9 — New directory `src/guidance/`**, parallel to `heuristics/`, `results/`, `video/`, `pose/`.
Pure data and pure functions plus their tests; the one React file in it (`MetricScale`) consumes only
`src/guidance/types.ts` and imports nothing from `src/results/`.

## D8 — The one content decision worth naming: overstriding's answer lives on the cadence card

**Overstriding is the metric in the original request and it cannot carry a band (D5.1). Left alone,
that would mean the page's most-asked question gets the least useful answer — a collapsed row saying
"no band exists".**

**Resolution: the evidenced intervention for overstriding *is* a 5–10% cadence increase, so that
remediation content also hangs off the `cadence` card at rank 1.** This is deliberate duplication,
not a copy-paste error, and it is defensible because the literature makes the link explicitly:
Lenhart 2014 (*Increasing Running Step Rate Reduces Patellofemoral Joint Forces*, MSSE) **frames
reduced step rate as overstriding in so many words**, and Heiderscheit 2011 measures the effect on
the geometry — +10% step rate moves foot-to-COM 9.2 → 7.0 cm.

So the headline "what do I do about overstriding" answer surfaces at the **top** of the page,
attached to a metric that **does** carry a band, while `overstriding` itself stays honestly banded-
less lower down. The reader gets the actionable answer without the page inventing a threshold to
justify showing it.

**Every link on the page is one of a verified set.** Each URL in the research digests was loaded and
returned HTTP 200 at the time of writing; a unit test pins the allowed set as a literal so an
unverified URL cannot be added silently. Sources that returned 403 (JOSPT's Teng & Powers 2014, the
two Meardon crossover papers, Novacheck 1998, the MDPI original of Gaudette 2022 — PMC mirror used
instead) are named in this document where relevant and **are not linked**.

## D9 — What this design does NOT claim

Stated flatly, because each of these is a claim a reader could reasonably think the page is making.

1. **The bands are not targets.** Every one of them is a description of where some population of
   runners was measured to be. None is a recommendation, a goal, or a healthy range. `trunkLean` is
   the sharpest case — four measured outcomes point in different directions (D2, rank 4) — but it
   applies to all five.
2. **This app cannot measure running speed, and speed moves four of the five banded metrics.**
   `kneeFlexion` most of all (+13° per 1 m/s, D2 rank 5); `verticalRatio` falls as pace rises because
   stride length climbs steeply with speed while vertical oscillation does not; `cadence` and
   `verticalOscillationCm` move **within** a runner as their pace changes, even though **between**
   runners at self-selected pace the correlation is weak or absent (Malisoux found step rate not
   correlated with speed between runners — step *length* is; and VO between runners at preferred
   speed p=.074). `trunkLean` is the one of the five with no speed caveat, because the research
   pass found no speed dependence stated for it — that is an absence of evidence, not evidence of
   absence. **A speed-blind app reads a jogger as worse than a fast runner with identical form**, on
   at least two of these scales. That caveat renders on screen; it is not confined to this document.
3. **Garmin's percentile methodology is not published.** Garmin states only that *"Garmin has
   researched many runners of all different levels."* No sample size, no population, no protocol, no
   peer review. Two of the five bands (`cadence`'s zone table and `verticalRatio`'s, before halving)
   rest on that. They ship because they are a **sourced external fact** attributable to a named
   publisher and checkable by a reader — not because the methodology is known. Where a peer-reviewed
   distribution exists alongside (Malisoux for `cadence`, Folland for `verticalRatio`) it is shown
   beside the zone table rather than merged into it.
4. **It does not claim any band is correct for an individual.** Every band is confounded by
   something the app cannot see: `verticalOscillationCm` strongly by height (an absolute-centimetre
   band penalises tall runners — this must be said on screen); `stepWidth` by pelvis width (−0.31 cm
   per +1 cm ASIS width, and explicitly **not** by height, p=.857); all five by speed, terrain,
   footwear and fatigue.
5. **It does not claim the seven unbanded metrics are unimportant** — only that no citable range
   exists for them in this app's units. D5.2 is the explicit case where a band was reachable and was
   refused on the quality of the derivation rather than its absence.
6. **It does not claim to improve any measurement.** Nothing in this change computes anything. Every
   value, confidence, caveat, exemplar, crop and image is exactly what the existing pipeline
   produced; the guided view only decides what to say about them. **A metric that reads wrong today
   reads identically wrong here** — D6 is the worked example, and it is disclosed rather than hidden.
7. **It does not claim the research digest is exhaustive.** It is a targeted pass, and D5.6/D5.7
   names the metrics where the search simply came up empty rather than the literature being known to
   be silent.

## D10 — Pre-registered rules

Written before implementation, and not to be renegotiated to make a build pass.

**R1 — The band-admission rule.** A band may be added to the guidance record only if (i) a published
source states a range, (ii) in a unit convertible to this app's reported unit **by a stated
definitional identity, not a fitted constant**, and (iii) the source's population and sample size are
known and renderable. D3's halving passes (i)–(iii); D5.2's Winter-constant derivation fails (ii).
**If a future contributor believes a metric deserves a band that this document does not list, the
correct move is to stop and say so, not to pick a number.**

**R2 — No verdict in colour.** No element on the guided view may carry red/green/amber semantics, a
check or cross, or a word grading the runner. Pinned by a test asserting no class matches
`/\b(bg|text|border)-(red|green|emerald|rose|amber|yellow)-/`.

**R3 — The link set is closed.** Every outbound URL is https, opens in a new tab with
`rel="noopener noreferrer"`, and is a member of the verified set pinned as a literal in a test.

**R4 — The classic view is byte-equivalent by default.** With no `?view=` parameter the existing page
renders exactly as it does today, and the existing suite passes untouched. If wiring the toggle
requires changing anything in `ResultsView`, `MetricsPanel`, `src/heuristics/`, `src/pose/` or
`src/video/`, the approach is wrong — stop rather than widening the blast radius.

**R5 — Live verification before "done".** Per CLAUDE.md's harness: real GPU, the derived dev-server
port, one clip per upload, on all three bundled demo clips. Expected and **not** a regression:
`side-portrait` resolves no vertical-oscillation family and no `cadence` (bead `strides-aha`), so its
Group 1 is nearly empty and most of its metrics land in Group 3.

# Design — guided results view

**Status of this document.** The reference bands below were fixed by a research pass that ran
**before** this change was scoped, and every number in them came off a page a researcher actually
loaded. Items marked **[derived]** are arithmetic on published numbers, not a published statistic,
and are labelled as such everywhere they appear — on screen as well as here. The bracketed tag is this
document's shorthand only: on screen the same fact is said in words ("worked out as 4.06% per
stride", "our arithmetic from the two papers' figures", a derivation statement), because a runner
cannot be expected to read a bracket convention (D7.11). Items the research pass
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
  disagreement could surface on it. It is **still open**, and it rejects picking a number outright,
  naming the failure mode directly:
  *"A per-metric magnitude threshold means eleven unjustifiable constants … A disagreement threshold
  picked to make these two clips light up is the same mistake."* The one route it leaves — a band
  decided on that metric's own terms — is the route D5.1's research finds no published basis for.
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
| 2 | `verticalRatio` | `percent` (a 0..1 value rendered ×100) | **[derived]** Garmin's per-step zones **halved** to per-stride: `<3.05` / `3.05–3.70` / `3.75–4.30` / `4.35–5.05` / `>5.05` %, with zone labels **restated in value order** (D3) | Garmin fenix 7 APAC manual (zone table) + Forerunner 255 manual (the definition that forces the halving); Folland 2017 *MSSE* 49(7):1412–1423 (independent corroboration) | Garmin: unstated; Folland: trained runners, 10–12 km/h | Garmin: unpublished; Folland: **97** |
| 3 | `verticalOscillationCm` | `centimeters` | **[derived]** `6.0–9.5` cm: the lowest published P10 (women, 6.0) to the highest published P90 (men, 9.5) of Malisoux's sex-stratified table at 10 km/h — **not** a single published P10–P90; mean `7.7` cm (Malisoux's overall 77 ± 12 mm) | Malisoux 2023 *Orthop J Sports Med* 11(10) | recreational runners at 10 km/h | **860** |
| 4 | `trunkLean` | `degrees` | `1.8–21.4°` observed range, mean `10.3°` | Folland 2017 *MSSE* 49(7):1412–1423 | trained runners, 10–12 km/h | **97** |
| 5 | `kneeFlexion` | `degrees` | `71.3–129°` observed range of swing knee flexion, mean `94.1°` (± 11.1°) | Folland 2017 *MSSE* 49(7):1412–1423; Fukuchi 2017 *PeerJ* 5:e3298 (speed-stratified) and Hanley 2021 shown beside it as corroboration | trained runners, 10–12 km/h | **97** (Fukuchi: 28; Hanley: book chapter, cohort not restated) |

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
(P50 74). **Shipped: 6.0–9.5 cm [derived], with Malisoux's overall mean of 7.7 cm.** Malisoux publishes no
P10–P90 for the whole cohort, so the band runs from the lowest of the four published bounds (women's
P10, 6.0 cm) to the highest (men's P90, 9.5 cm): both ends are published numbers, the span between them
is not the P10–P90 of any group Malisoux reports, and it is declared as a derivation on screen — resting
on the two published rows — rather than labelled as one percentile range. Its zone label names the
people rather than a range to aim for: *"From women's 10th to men's 90th percentile in Malisoux's 860
runners, at 10 km/h (6:00 per km)"*, and the mean renders as *"Malisoux's overall average (± 1.2 cm)"*.
(An earlier draft called it "P10–P90, pooled", which claimed a published range that does not exist.) Heiderscheit 2011 corroborates at
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

On screen the single zone is labelled *"Range across Folland's 97 runners"* and the mean *"Average in
this study (± 3.7°)"* — both name the people measured, and neither reads as a range to aim for.
Braun 2024, Carson 2024 and Teng & Powers 2016 are this metric's remediation links, and Folland alone
its research link: a URL is never listed under both headings on one card (D7.11).

Teng & Powers 2014 (7.3 ± 3.6° self-selected) is **[NOT LOADED]** — JOSPT returned 403. It is
high-confidence secondary knowledge and is **not quoted as a range** anywhere.

**Rank 5 — `kneeFlexion`.** Folland 2017 publishes the distribution directly, in Table 2: *"Minimum
knee extension angle during swing"*, **−94.1 ± 11.1° (min −129, max −71.3)**, n=97 trained runners,
each averaged across 10, 11 and 12 km/h. **Shipped: 71.3–129°, the full range observed across that
cohort, with Folland's mean of 94.1° (± 11.1°).** Folland signs flexion negative and this app signs
it positive, so the bounds are stored with their sign flipped — a change of sign, not a conversion.
This is the same source shape `trunkLean` already uses (rank 4): one cohort's observed range and its
mean, quoted — and the same labels, *"Range across Folland's 97 runners"* and *"Average in this study
(± 11.1°)"*.

Folland measures joint angles relative to **quiet standing**, not to a mathematically straight leg,
so as with `trunkLean` there may be a small real offset against this app's convention (0° is full
extension). It is disclosed on screen rather than corrected for, because correcting it would mean
assuming a standing posture nobody measured.

**Correction to an earlier draft.** This band previously shipped as **85–125°**, "pooled" across
Fukuchi's three speed-stratified means, Hanley and Folland. **No source publishes that range**: it was
interpolated between studies, which D1 forbids by name. It was replaced by the published distribution
above, and the sources it was pooled from now stand **beside** the band as corroboration.

Fukuchi 2017 (n=28 regular runners) uses the same convention this app does — 0° is full extension —
and is stratified by speed:

| speed | peak knee flexion |
|---|---|
| 2.5 m/s (~9 km/h) | 93.5 ± 10.4° |
| 3.5 m/s (~12.6 km/h) | 108.7 ± 10.7° |
| 4.5 m/s (~16.2 km/h) | 119.1 ± 10.4° |

**That is roughly +13° per 1 m/s, and it makes this the most speed-sensitive metric in the set** —
the 2.5 and 4.5 m/s means are 2.5 SDs apart. **This app cannot measure running speed at all.** The
band is one cohort at 10–12 km/h, not a span chosen to cover every speed, so the speed caveat matters
more here than anywhere and is carried most prominently of the five. All three Fukuchi means lie inside
Folland's observed range.

Corroboration across conventions: Hanley 2021 reports 55–60° *included* thigh–shank angle at
midswing, which is **120–125°** in this app's convention — also inside it.

Two honest gaps, recorded rather than smoothed: Fukuchi does not state whether its maximum is swing
or stance, and stance peak is ~45° in comparable cohorts, so 93–119° **must** be swing — that is an
inference, not the paper's claim. And Novacheck 1998, to which the ubiquitous "125° at midswing"
figure is attributed everywhere, is **[NOT LOADED]** and is **not cited**.

## D3 — The halving derivation for `verticalRatio`

**This is the one band on the page whose every bound is arithmetic rather than a quotation, so it
gets the longest justification and it is labelled [derived] on screen.** (`verticalOscillationCm` is
also declared derived, for a different and smaller reason — both of its bounds are published numbers,
but from two different published rows; see D2 rank 3.)

**The claim.** Garmin's published vertical-ratio zones are **per step**. This app's `verticalRatio`
is **per stride**. A stride is two steps. Therefore this app's value is approximately **half**
Garmin's for the same runner, and Garmin's zones must be halved before they can be laid against it.

```
Garmin, per step              [derived] per stride = Garmin ÷ 2   label as shipped (value order)
  >95th pct  : <6.1%     ->     <3.05%                            Lowest 5% of Garmin's table
  70–95      : 6.1–7.4%  ->     3.05–3.70%                        5th–30th percentile of Garmin's table
  30–69      : 7.5–8.6%  ->     3.75–4.30%                        31st–70th percentile of Garmin's table
  5–29       : 8.7–10.1% ->     4.35–5.05%                        71st–95th percentile of Garmin's table
  <5         : >10.1%    ->     >5.05%                            Highest 5% of Garmin's table
```

Every bound halves exactly to two decimal places; **no rounding was applied and none was needed.**

**The zone labels are restated, not quoted, and the derivation statement says so on screen.**
Garmin ranks vertical ratio so that a **lower** value earns a **higher** percentile: its percentile
is a rank of performance, not of value. Printed verbatim, a 3.00% reading "falls in the
Above-the-95th-percentile zone" — which tells the runner that low ranks higher, exactly the verdict
D7.8 and the spec forbid. Each zone is therefore labelled by where its values sit **in value order**,
which is **100 minus Garmin's percentile**, applied to Garmin's own integer bins: `70–95` → `5–30`,
`30–69` → `31–70`, `5–29` → `71–95`, `>95` → lowest 5%, `<5` → highest 5%. Every label ends *"of
Garmin's table"*, so each one names whose table the percentile belongs to rather than reading as a
standing of the runner's own. The arithmetic is pinned in a test. `cadence`'s Garmin labels are **not** restated: a higher cadence is a higher Garmin
percentile, so that table already runs in value order and is quoted verbatim — a test pins that too,
so nobody "harmonises" the two.

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

On screen this leg is stated without the file name, which means nothing to a runner: *"This app
measures a full stride: it pairs each footstrike only with the next footstrike of the same foot, so
every stride it measures is two steps long."* This document keeps the file reference as the record.

### Leg (c) — two independent corroborations land where the derivation predicts

**[derived] Folland 2017, an entirely separate route.** Folland reports both terms height-normalised
over the same n=97 cohort: pelvis oscillation **0.052 H** and stride length **1.28 H**. Height
cancels:

```
0.052 H / 1.28 H = 4.06% per stride
```

**4.06% lands inside the derived middle zone (3.75–4.30%; Garmin's 30–69th, labelled 31st–70th
percentile of Garmin's table).** On screen the corroboration carries Folland's own title, and the
arithmetic moves into its population line — *"4.06% per stride, calculated from the paper's pelvis
bounce (5.2% of height) and stride length (128% of height)"*. Folland measured a different cohort
with different instrumentation and published neither a vertical ratio nor a band; the agreement is
between Garmin's percentile table halved and an independent laboratory ratio, reached with no shared
assumption but the definition of a stride.

**A third check, from this repo's own footage.** CLAUDE.md records the `side-landscape` clip's
`verticalRatio` at **0.0310419** — 3.10% — measured on the shipped pipeline and reproduced exactly
across trials. That lands just inside the derived **3.05–3.70%** zone (Garmin's 70–95th, labelled
5th–30th percentile of Garmin's table), on its 3.05 boundary. Not
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
   measured Garmin devices approximately **1.3–1.5 cm high** against a video reference — an error
   in one direction, set against a band (6.0–9.5 cm, itself **[derived]** from Malisoux's two
   sex-stratified P10–P90 rows, D2 rank 3) only 3.5 cm wide **[derived]** end to end. (An earlier draft misstated this as a fraction of the band; the published numbers are now
   stated side by side instead of as a new percentage.)
2. **The sensor is not at the centre of mass.** Garmin's pod sits on the chest or the waist. This
   app's `verticalOscillationCm` is a COM-proxy bounce derived from the hip midpoint. A
   chest-mounted sensor sees more vertical travel than the COM does, which is the same direction as
   the measured error and compounds it.

**Using Garmin's centimetre bands unshifted would flag a normally-bouncing runner as bouncy**, on a
page whose entire premise is that it does not grade anybody. Malisoux 2023's definition, by
contrast, is the one this app implements — COM, peak-to-peak, per step — measured over 860 runners
and published with percentiles. It is used instead.

**Note what this does *not* imply for D3.** `verticalRatio` still uses Garmin's zones, halved,
because a **ratio cancels what a fixed centimetre band cannot**: both of Garmin's terms are measured
by the same misplaced sensor, so a *proportional* error in the numerator largely divides out. That
asymmetry is the reason one metric can use a manufacturer's table and its sibling cannot, and it is
worth stating plainly because the two decisions look inconsistent until you look at the units.

**But the error Smith 2022 actually measured is not proportional, and this must be said on screen.**
Garmin's vertical-oscillation numerator reads ~1.3–1.5 cm high — an **additive** offset, and an
additive offset does not cancel in a ratio. Garmin's published vertical-ratio zones inherit that
numerator offset, so they may sit somewhat high relative to a hip-derived measurement like this
app's. The offset is disclosed, **not quantified as a percentage and not corrected for**. The check
that survives it is independent of Garmin entirely: Folland 2017's laboratory figure, **4.06% per stride
[derived]** (D3 leg (c)), lands inside the middle zone — Garmin's 30th–69th, labelled 31st–70th
percentile of Garmin's table. On screen the note says *"where this page declines to use Garmin's
table for the centimetre measurement"* rather than citing this section by number.

## D5 — The seven metrics that carry no band, each with its reason

**These render. They are not deleted and they are not hidden — they are collapsed, and they keep
their value, their description, their caveats, their research links and their remediation links.**
D1 controls whether a **scale** renders, not whether the **metric** renders. Each entry below is the
reason a reader gets when they expand it.

### 1. `overstriding` — no band exists in any unit, and the two published measurements of this exact geometry disagree by 3.4×

**This is the metric in the original request, and it is the one this design most has to refuse.**
Bead **`strides-yg8`** (still open) reached the same caution independently, from a completely
different direction — it wanted a band so that a cross-clip disagreement caveat could fire on this
metric, and rejects picking a threshold to get one. It leaves open a band decided on the metric's own
terms; the research below is what finds no published basis for such a band.

- **No published study normalises foot-to-hip horizontal distance by TORSO LENGTH**, which is the
  unit this app reports. A targeted Europe PMC search for "trunk length" / "torso length" combined
  with overstride / foot-to-COM returned nothing relevant. There is no band to cite in our unit
  because nobody has measured in our unit.
- **And there is no threshold in any *other* unit either.** Baker 2024, verbatim: *"there is
  currently no consensus on what qualifies as excessive overstriding."* Souza 2016's clinical 2D
  protocol uses **exactly this app's landmarks** — a vertical line up from the lateral malleolus
  against the pelvis — and is explicitly **dichotomous, with no units and no cutoff**. The closest
  thing in the literature to our measurement declines to put a number on it.
- **The two published absolute measurements of the same geometry disagree by about 3.4×
  [derived]** (0.31 m ÷ 9.2 cm):

  | source | published figure |
  |---|---|
  | Heiderscheit 2011 | 9.2 ± 4.0 cm (COM to heel at initial contact, 2.9 m/s) |
  | Lieberman 2015 *JEB* 218(21):3406–3414 | 0.31 ± 0.08 m (ankle ahead of hip, 75 strides/min) |

  **The disagreement is stated in the papers' own published units, and only there.** An earlier
  draft also converted both to torso lengths (~0.18 and ~0.62); that conversion rests on an assumed
  torso-length constant — the same kind of unresolved step D5.2 refuses — whereas the 3.4× ratio
  needs no constant at all, so the torso figures are withdrawn rather than rendered.

  **Neither paper defines its computation precisely enough to reconcile them.** Halving the gap to
  get a band would be picking a number and calling it research.

- **Correction to a figure in circulation:** Baker 2024's "5.9 ± 1.3 cm" is the **within-subject
  range across cadence conditions**, not a mean overstride. It is not a band and must not be quoted
  as one.

**Links.** Heiderscheit 2011 measured what raising step rate does to this geometry, so it is one of
this card's remediation links (with Lenhart 2014 and Gaudette 2022) and not also a research link;
Lieberman 2015 and Souza 2016 are the research links. The on-screen description is the guided view's
own (D7.10 (d)): the shared one calls this metric "a proxy for braking-force risk", which reads as a
verdict on a page about published ranges.

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

The reason renders in plain words, without the constant's name, the height notation or this
section's number: *"A range could be calculated for this measurement, but it isn't shown. It would
divide a published pelvis-bounce figure by a textbook estimate of torso length rather than a measured
one, and the published figure doesn't say whether it is per step or per stride — either uncertainty
changes the answer. The centimetre and ratio versions above do have published ranges."*

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

On screen, ASIS width is "pelvis width", the p-value and confidence interval are dropped, the
Arellano & Kram figure reads *"about 1.8 cm in this app's convention (half of Arellano & Kram's
foot-to-foot figure)"*, and Wang 2024 is a research link only — it reviews what step width does to
the body, not how to change it — leaving Meardon & Miller 2013 and Lashien 2024 as remediation.

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

On screen Burke is paraphrased rather than quoted, because the quotation is built from the paper's
own abbreviations ("FST", "RRIs") and a grading-system name no runner knows: *"the evidence linking
foot-strike pattern to running injuries was rated low, and the studies behind it very low
quality"*. The guided description drops the shared one's method note (D7.10 (d)).

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
re-measurements, on three different commits. The band's lower bound is 6.0 cm — Malisoux's P10 for
women, the lower of the two published P10s (men's is 6.4 cm). Our anchor sits ~26% below the bottom of
the band we are shipping.**

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

**D7.2 — `ResultsView.tsx` and `MetricsPanel.tsx` are not edited — with one exception.** The existing
capability's requirements, the existing unit suite and the existing e2e spec all keep passing
untouched, and the classic view stays the default. A guidance page that had to modify the page it
sits beside would be carrying risk it does not need to carry.

**The one exception** (commit `fd3d1f7`, `strides-kgi.5`): `METRIC_DESCRIPTIONS` moved verbatim out
of `MetricsPanel.tsx` into `src/results/metricDescriptions.ts`, so that both views read one copy of
the twelve descriptions instead of two tables that would drift the first time someone edited one.
`MetricsPanel` renders identical DOM, and its own unit suite passing untouched is the proof. The
guided view overrides that copy for two metrics without editing it (D7.10 (d)).

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

**The capture hint is chosen by cause, not by metric.** Each guidance entry carries two:
`captureHints.wrongAngle`, shown when the metric was excluded because the camera angle cannot
support it (`viewFit === 'unsuitable'`), and `captureHints.notEnoughData`, shown for every other
cause — too few strides or bounce cycles, detection gaps, no real-world scale. The earlier single
hint was keyed per metric, so a front-view clip that was merely too short got told to film
side-on. Each `wrongAngle` is written against that metric's row in `DEFAULT_VIEW_FIT_TABLE` and a
test pins it both ways (side-on exactly where a front view is unsuitable, front-or-rear exactly
where a side view is). `armSwingAmplitude`'s names the real reason a side view fails — the far arm
is hidden behind the body — where the old shared hint wrongly said it "reads side-to-side
placement". The three metrics no angle rules out (`cadence`, `verticalOscillation`,
`verticalOscillationCm`) still carry a true `wrongAngle`, which the view never has cause to show.

**D7.7 — No invented thresholds.** D1, in one line, restated here because it is an architectural
constraint and not only an editorial one: the guidance record is allowed to hold a band only where a
citation exists to hang on it, and the type system should make an uncited band unrepresentable.

**D7.8 — Reference band, never a verdict.** The scale shows position against a published range,
labelled with source and population. Never a pass/fail, a grade, or a colour that means "bad".

**D7.9 — New directory `src/guidance/`**, parallel to `heuristics/`, `results/`, `video/`, `pose/`.
Pure data and pure functions plus their tests; the one React file in it (`MetricScale`) consumes only
`src/guidance/types.ts` and imports nothing from `src/results/`.

**D7.10 — Where the guided view presents a metric differently from the classic panel.** "Changes no
measurement" (spec) is about values, confidences, caveats, tiers and imagery, and it holds. The
*presentation* differs in five recorded places, each deliberate:

- **(a) A banded headline prints at the band's precision.** `verticalRatio` reads "4.00%" where the
  classic panel reads "4.0%"; `cadence` reads "163.5 steps/min" where the classic panel reads "164".
  Rounded to the classic precision, a headline could sit on a bound the scale beside it says the
  value does not reach — 163.5 is in the gap between Garmin's `153–163` and `164–173`, and "164"
  would print it inside a zone the marker is outside of.
- **(b) A normal-tier guided card carries no "High confidence" label.** Only a caveated card carries
  a confidence label. On a page that already ranks by evidence, a label on every trustworthy card is
  noise, and its absence is the unmarked case.
- **(c) The vertical-oscillation chart is not shown in the guided view.** The guided card is about
  where a value sits against published ranges; the chart remains in the classic view.
- **(d) `guidedDescription` overrides the shared description where the shared copy reads badly on a
  page about published ranges** — `overstriding` (the shared copy says "a proxy for braking-force
  risk" and "this pipeline") and `footStrikePattern` (the shared copy's method note). `null` means
  the shared `METRIC_DESCRIPTIONS` entry renders. The shared copy is the classic view's and is not
  edited (D7.2).
- **(e) Per-card disclosure hides secondary research content.** Always visible: the value, a
  confidence label when caveated, the description, the metric's own caveat, the scale (or the
  no-band reason), the band's provenance — source, population, sample size, and a derived band's
  statement, which the spec requires on screen without a click — the speed caveat, the first
  sentence of each mandatory note, marked "(continued below)" where the note goes on, and the first
  few remediation studies under "Research on changing this", with `remediationIntro` above them,
  each a short-title link over one line of its kind and summary. Behind one disclosure per card:
  what a derivation rests on, the band's assembly note, the central statistic, corroborating
  sources, the research links, the visible studies' full citations, the remaining remediation
  studies and the rest of each mandatory note, labelled with that note's opening words; the
  disclosure's summary says whether notes and research are inside and counts the distinct links.
  No link is dropped for sharing a URL with one already on the card: it keeps its title as text,
  its kind and its summary, and loses only the second anchor, so every summary reaches the card
  (D7.11). The classic panel has no such disclosure. Because
  the first sentence of a mandatory note is what stays visible, each note's first sentence is
  written to stand on its own ("180 steps per minute is not a target.", "A negative value is not a
  defect."), and cadence's remediation list puts the two studies its intro names inside the visible
  few.

**D7.11 — Every string in the guidance record is runner-facing copy.** Titles, labels, notes,
reasons, summaries and hints all reach the screen, so none of them may carry implementation or
research-shorthand leakage: no source path or file name, no reference to this document or its
decision numbers, no "ship", no bracketed "[derived]" tag, no p-value, no "CI", "GRADE", "FST",
"RRIs" or "ASIS", no unit string like "Nm·s/kg/1000 m", and no all-caps emphasis. A test walks every
string and fails on those patterns; cited titles alone keep their own capitalisation. Three further
rules ride with it:

- **Zone and central-tendency labels name the people measured, never a target** — "Range across
  Folland's 97 runners", "…percentile of Garmin's table", "Malisoux's overall average". A
  central-tendency label is a short noun with its spread in brackets; the view prints
  `{label}: {value}`, so the label never repeats the value.
- **A speed's first mention carries a runner's pace** — 10 km/h is 6:00 per km (9:39 per mile);
  2.68 → 3.83 m/s is 6:13 → 4:21 per km (10:00 → 7:00 per mile); 2.9 m/s is 5:45 per km;
  2.5 / 3.5 / 4.5 m/s are 6:40 / 4:46 / 3:42 per km. Each is unit arithmetic, not a new number, and a
  test recomputes every stated pace from the speed beside it to the second. The within-runner and
  between-runner sentences carry no "Within one runner" / "Between runners" prefix, because the view
  labels the two halves.
- **A URL appears at most once across one metric's research and remediation lists**, under
  remediation when the source measured a change and under research otherwise. The Velocity Project
  handout is removed from every remediation list and from the verified URL set: its own summary said
  it names a ">166 steps/min" target the primary literature does not support, and a link this page
  has to warn against is not one it should offer.

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

**The bridge is said in words, not left to the link list.** A reader scanning cadence's remediation
links for "overstriding" found nothing that named it, so the connection was undiscoverable. Each
guidance entry now carries an optional `remediationIntro`, one plain sentence the view renders above
that metric's remediation links; `cadence` is the only one set: *"Raising step rate is also the
most-studied way to reduce overstriding — how far the foot lands ahead of the body. The Heiderscheit
and Lenhart studies below measured that directly."* The list is ordered so the sentence lands next to
what it names — Huber 2024 (the self-administered protocol) first, then Heiderscheit 2011 and Lenhart
2014, then Petri 2026, Davis 2020 and Gaudette 2022.

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
   absence. **A speed-blind app reads a jogger differently from a fast runner with identical form**,
   on at least two of these scales — lower on `kneeFlexion`, higher on `verticalRatio` — and the
   on-screen wording says which way ("reads higher"), never "worse". That caveat renders on screen; it is not confined to this document.
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

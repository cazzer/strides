# Research record for the runner-led results PRD (2026-10-27)

This record comes from a web-research pass. **Every URL needs re-verification before it ships in
copy.** The rule in `metricGuidance.test.ts` still applies: a link must state the claim that cites
it. Uncertain items are marked.

## Whole body: cadence and bounce
- **Low step rate and shin injury.** Prospective study of 68 high-school runners. The lowest third
  (≤166 spm) had OR 5.85 (95% CI 1.1–32.1) for shin injury; there was no anterior-knee-pain link.
  https://pubmed.ncbi.nlm.nih.gov/26818150/
- **Heiderscheit 2011 (lab, n=45).** Running at +5% or +10% step rate lowered knee energy
  absorption, vertical COM excursion and braking impulse. The hip effect appeared only at +10%.
  These are load changes, not injury outcomes. https://pubmed.ncbi.nlm.nih.gov/20581720/
- **Willy 2016 (RCT, n=30, at-risk runners).** In-field cue of +7.5%; runners achieved +8.6%. Load
  rate and hip adduction fell, retained at 30 days.
  https://umimpact.umt.edu/en/publications/in-field-gait-retraining-and-mobile-monitoring-to-address-running/
- **Bramah 2019 (case series, n=12, uncontrolled).** One metronome session at +10% improved pain and
  kinematics at 3 months. https://pmc.ncbi.nlm.nih.gov/articles/PMC6883353
- **Folland 2017 (n=97).** Less pelvis vertical movement during contact correlated with better
  economy. Direction is UNVERIFIED against the primary source.
  https://pmc.ncbi.nlm.nih.gov/articles/PMC5473370/

## Arms
- **Restricting arm swing raised metabolic cost by 3, 9 and 13%** across conditions and increased
  torso rotation. No injury evidence. No cue has been trialled. The defensible message is "let them
  swing; don't pin them" (an inference). https://pmc.ncbi.nlm.nih.gov/articles/PMC4296200

## Trunk lean
- **Bramah 2018 (case-control, 72 injured vs 36 controls).** Injured runners leaned further forward at
  mid-stance. https://salford-repository.worktribe.com/output/1380218
- **Teng & Powers 2014 (n=24).** More lean lowered patellofemoral stress and shifted load to the hip.
  https://www.running-physio.com/pfp-forward-lean/ (a secondary site; find the primary).
- The direction depends on context, so there is no cue.

## Knees
- **Folland 2017.** Greater peak swing hip flexion went with WORSE economy (r=0.337), and a more
  flexed minimum stance knee angle also went with worse economy (r=−0.530). Do not cue "lift your
  knees".
- **Souza 2016.** Peak stance knee flexion is about 45°, and below 40° may be associated with some
  patellofemoral-pain subgroups. https://pmc.ncbi.nlm.nih.gov/articles/PMC4714754
- ⚠️ The Folland band of 71.3–129° may be a contact-phase angle, while Strides' `kneeFlexion` is
  described as swing knee bend. Verify the domains match.

## Landing: overstriding and foot strike
- **Lieberman 2015 (n=14).** The foot landing further ahead of the hip went with larger braking
  forces; landing ahead of the knee went with a larger and faster impact peak. A higher step rate
  shortens the overstride. Cue: land with the shin near vertical. https://pubmed.ncbi.nlm.nih.gov/26538175/
- **There is no consensus on what counts as excessive overstriding.**
  https://pmc.ncbi.nlm.nih.gov/articles/PMC10942980/
- **Heel-to-COM distance has poor reproducibility in 2D video** (Souza, link above).
- **Anderson 2020 meta-analysis (53 studies).** The rearfoot-strike injury link is retrospective
  only, and there is no economy benefit from switching. Switching moves load to the ankle, calf and
  Achilles, and the authors say it "cannot be recommended for an uninjured RFS runner".
  https://www.theinjuryclinic.com.au/wp-content/uploads/2021/06/Anderson2020_Article_WhatAreTheBenefitsAndRisksAsso.pdf
- **Burke 2021.** Evidence linking foot strike to injury is of very low quality.
  https://doras.dcu.ie/28875/1/burke-et-al-2021-risk-factors-for-injuries-in-runners-a-systematic-review-of-foot-strike-technique-and-its.pdf
- **Larson 2011 (n=936, Manchester marathon).** At 10 km: 88.9% rearfoot, 3.4% midfoot, 1.8%
  forefoot, 5.9% asymmetric. At 32 km: 93.0% rearfoot (n=286).
  https://paulogentil.com/pdf/Foot%20strike%20patterns%20of%20recreational%20and%20sub-elite%20runners%20in%20a%20long-distance%20road%20race.pdf
  (Hosted on a personal site; find the journal DOI.)
- **Hasegawa 2007 (n=283 elite, half marathon).** 74.9% rearfoot, 23.7% midfoot, 1.4% forefoot.
  https://pubmed.ncbi.nlm.nih.gov/17685722/

## Foot path: step width
- **Meardon 2012 (n=15).** Narrower steps raised IT-band strain.
  https://www.ncbi.nlm.nih.gov/pubmed/23259236. Meardon & Derrick: tibial stress also rose with
  narrower steps.
- **2024 systematic review.** Widening steps may help PFP, ITBS and tibial bone stress injury.
  https://sportsmedicine-open.springeropen.com/articles/10.1186/s40798-024-00750-4
- **Arellano 2011.** Running narrower or wider than preferred raised cost by 3–15%; preferred width
  is the economy optimum. Souza's rule of thumb: the feet should not overlap.
  Arellano & Kram 2011, J Biomech 44(7):1291–1295, https://pubmed.ncbi.nlm.nih.gov/21316058/
  (verified 2026-10-27 for `add-runner-tour`): "When subjects ran at target step widths less (0%
  LL) or greater (15%, 20%, and 25% LL) than preferred, both net metabolic power demand (by 3%, 9%,
  12%, and 15%) and step width variability (by 7%, 33%, 46%, and 69%) increased."
- 2D step width is unreliable (reliability study, 2022).
  https://vivo.weill.cornell.edu/display/pubid36263278

## Cross-cutting: impact
- **Chan 2018 (RCT, n=320 novices).** Two weeks of real-time impact feedback gave 16% vs 38% injury at
  12 months (HR 0.38). https://pubmed.ncbi.nlm.nih.gov/29065279/
- **Tate & Milner 2017 (n=14, one session).** Sound feedback lowered loading rate from 69 to 44 BW/s.
  https://researchdiscovery.drexel.edu/esploro/outputs/journalArticle/Sound-Intensity-Feedback-During-Running-Reduces-Loading/991019168872104721

## Prior-art UX
- **Garmin.** Shows percentile colour gauges, but labels zones "typical for more experienced or
  faster runners", an implied grade. Avoid this.
- **Runeasi.** A 0–100 composite plus a "weakest link" recommendation. The focus-on-one pattern is
  good; the opaque score is something to avoid.
- **Ochy.** A gait score plus tips; it concedes that ankle and elbow are weak in 2D.
- **OnForm / Kinovea.** Manual side-by-side video comparison with no interpretation.
- **Stryd.** A metric wall with little guidance.

## Cues: how many, and how
- **External focus improved economy** in trained runners (Schücker 2009).
  https://www.bisp-surf.de/Record/PU201103002122
- **Faded feedback** over 8–18 sessions works best (Davis 2011).
  https://jfootankleres.biomedcentral.com/articles/10.1186/1757-1146-4-S1-A5
- **No study tested how many cues to give at once.** "One cue at a time" is coaching convention,
  though every trial above changed a single variable.

import type { MetricId } from '../heuristics/types'
import type { BandSource, GuidanceLink, MetricGuidance } from './types'

/**
 * One guidance entry per metric: its reference band or its explicit, reasoned absence, what the
 * literature says about direction, the notes that must render with it, its research and
 * remediation links, and what to film differently when this clip could not measure it.
 *
 * ## The governing rule
 *
 * **A reference band ships for a metric if and only if published literature states a range in the
 * unit this app already reports that metric in** (or in a unit convertible to it by a stated
 * definitional identity, never by a fitted constant). No band here was invented, inferred from
 * this repo's own footage, interpolated between studies, or chosen to make measured values land
 * inside it. Five of the twelve metrics clear that bar; seven do not, and each of the seven
 * carries the reason a reader gets when they ask.
 *
 * That is not caution for its own sake. Two prior investigations in this repo reached the same
 * refusal independently — bead `strides-yg8` set out to give `overstriding` an interpretive
 * threshold and closed without one, and CLAUDE.md's "The 4K area floor cannot be re-derived"
 * records a measured threshold abandoned outright rather than re-picked. **Citing a published
 * band is a different act from inventing one**: it is a sourced external fact, attributable and
 * falsifiable by a reader who follows the link. That distinction is the only thing separating
 * this file from eleven unjustifiable constants, which is why every band carries its source,
 * population and sample size and why a test pins the URL set as a literal.
 *
 * The permanent home of the provenance behind every number below is
 * `openspec/changes/guided-results-view/design.md` — D2 for the five bands (and for the
 * derived pairing behind `verticalOscillationCm`'s), D3 for the halving derivation and the
 * value-order zone labels, D4 for why one band comes from a paper where its sibling comes from a
 * manual, D5
 * for the seven refusals one at a time, D8 for the one place a metric's remediation deliberately
 * hangs off another metric's card, and D9 for what none of this claims.
 *
 * ## What this file does NOT claim
 *
 * 1. **The bands are not targets.** Each is a description of where some population of runners was
 *    measured to be. None is a recommendation, a goal, or a healthy range.
 * 2. **This app cannot measure running speed, and speed moves four of the five banded metrics** —
 *    `kneeFlexion` most of all, at roughly +13° per 1 m/s. A speed-blind app reads a jogger
 *    differently from a fast runner with identical form, on at least two of these scales — lower
 *    on knee flexion, higher on vertical ratio. See `speedSensitivity` on each entry.
 * 3. **It does not claim any band is correct for an individual.** Every one is confounded by
 *    something the app cannot see — height, pelvis width, terrain, footwear, fatigue.
 * 4. **It does not claim the seven unbanded metrics are unimportant**, only that no citable range
 *    exists for them in this app's units. `verticalOscillation` is the explicit case where a band
 *    was arithmetically reachable and was refused on the quality of the derivation rather than on
 *    its absence.
 * 5. **It does not claim the research behind it is exhaustive.** It was a targeted pass, and two
 *    entries below say plainly that nothing surfaced rather than that nothing exists.
 * 6. **Nothing here computes anything.** Every value, confidence, caveat and image is exactly what
 *    the existing pipeline produced. A metric that reads wrong today reads identically wrong
 *    against these bands — which is information about the measurement, never a reason to move a
 *    band.
 */

// ---------------------------------------------------------------------------------------------
// Sources, defined once each.
//
// Every URL below was loaded during the research pass and returned HTTP 200. They are declared as
// shared constants rather than repeated inline so that one source cannot acquire two spellings of
// its own URL, and so that the test file's pinned allow-list has a single thing to check against.
// Sources the research pass could not retrieve (Teng & Powers 2014 at JOSPT, both Meardon
// crossover papers, Novacheck 1998, the MDPI original of Gaudette 2022) are named in design.md
// where they would otherwise have been cited and are deliberately absent here.
// ---------------------------------------------------------------------------------------------

const GARMIN_FENIX_7_ZONES_URL =
  'https://www8.garmin.com/manuals/webhelp/GUID-C001C335-A8EC-4A41-AB0E-BAC434259F92/EN-US/GUID-EE9E7F6F-49BE-4452-82E6-B40371D0AEC1.html'
const GARMIN_FENIX_7_APAC_ZONES_URL =
  'https://www8.garmin.com/manuals-apac/webhelp/fenix7series/EN-SG/GUID-CC006ABA-CE80-45BE-BD87-5B5A0FBC1125-3223.html'
const GARMIN_FORERUNNER_255_URL =
  'https://www8.garmin.com/manuals/webhelp/GUID-676967A0-1B23-4384-9BC9-76F3D643F1C8/EN-US/GUID-62A09512-518A-424A-8491-FE2B80CD2091.html'
const MALISOUX_2023_URL = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10588426/'
const FOLLAND_2017_URL = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5473370'
const HEIDERSCHEIT_2011_URL =
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC3022995/'
const FUKUCHI_2017_URL = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5426356/'
const HANLEY_2021_URL =
  'https://eprints.leedsbeckett.ac.uk/id/eprint/7491/6/TheBiomechanicsOfDistanceRunningAM-HANLEY.pdf'
const STIFFLER_JOACHIM_2020_URL =
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC7740069/'

/**
 * Garmin's own population, in Garmin's own words. The same string appears on both bands that rest
 * on a Garmin zone table, because it is the same non-statement in both manuals — and it renders
 * rather than being smoothed over, per design.md D9.3: these two bands are shown because they are a
 * sourced external fact attributable to a named publisher, not because the methodology is known.
 */
const GARMIN_POPULATION =
  'Not stated. Garmin says only that it "has researched many runners of all different levels"; no protocol and no peer review are published.'
const GARMIN_SAMPLE_SIZE = 'Not published'

const MALISOUX_2023_SOURCE: BandSource = {
  title: 'Malisoux et al. 2023, Orthopaedic Journal of Sports Medicine 11(10)',
  shortTitle: 'Malisoux et al. 2023',
  url: MALISOUX_2023_URL,
  population: 'Recreational runners at 10 km/h (6:00 per km, 9:39 per mile)',
  sampleSize: '860',
}

const FOLLAND_2017_SOURCE: BandSource = {
  title:
    'Folland et al. 2017, Medicine & Science in Sports & Exercise 49(7):1412–1423',
  shortTitle: 'Folland et al. 2017',
  url: FOLLAND_2017_URL,
  population:
    'Trained runners at 10–12 km/h (6:00 to 5:00 per km, 9:39 to 8:03 per mile)',
  sampleSize: '97',
}

const HEIDERSCHEIT_2011_SOURCE: BandSource = {
  title:
    'Heiderscheit et al. 2011, "Effects of Step Rate Manipulation on Joint Mechanics during Running", Medicine & Science in Sports & Exercise',
  shortTitle: 'Heiderscheit et al. 2011',
  url: HEIDERSCHEIT_2011_URL,
  population: 'Runners at 2.9 m/s (5:45 per km, 9:15 per mile)',
  sampleSize: '45',
}

const GARMIN_FENIX_7_LINK: GuidanceLink = {
  title: "Garmin fenix 7 owner's manual — running-dynamics zones",
  shortTitle: 'Garmin fenix 7 manual',
  url: GARMIN_FENIX_7_ZONES_URL,
  kind: 'manufacturer',
  summary:
    'The five-zone percentile table Garmin publishes for cadence, over a population it does not describe.',
}

const GARMIN_FENIX_7_APAC_LINK: GuidanceLink = {
  title: "Garmin fenix 7 owner's manual (APAC) — vertical ratio zones",
  shortTitle: 'Garmin fenix 7 manual (APAC)',
  url: GARMIN_FENIX_7_APAC_ZONES_URL,
  kind: 'manufacturer',
  summary:
    'The five-zone percentile table for vertical ratio, published per step.',
}

const GARMIN_FORERUNNER_255_LINK: GuidanceLink = {
  title: "Garmin Forerunner 255 owner's manual — running dynamics",
  shortTitle: 'Garmin Forerunner 255 manual',
  url: GARMIN_FORERUNNER_255_URL,
  kind: 'manufacturer',
  summary:
    'Defines Garmin\'s "stride length" verbatim as "the length of your stride from one footfall to the next" — one footfall to the next is a step, which is why Garmin\'s vertical-ratio table is halved on this page.',
}

const MALISOUX_2023_LINK: GuidanceLink = {
  title: 'Malisoux et al. 2023, Orthopaedic Journal of Sports Medicine 11(10)',
  shortTitle: 'Malisoux et al. 2023',
  url: MALISOUX_2023_URL,
  kind: 'peer-reviewed',
  summary:
    'Running-dynamics distribution over 860 recreational runners at 9.9–10 km/h (6:04 to 6:00 per km): cadence 164 ± 9 steps/min, vertical oscillation 77 ± 12 mm, with percentiles by sex.',
}

const FOLLAND_2017_LINK: GuidanceLink = {
  title:
    'Folland et al. 2017, Medicine & Science in Sports & Exercise 49(7):1412–1423',
  shortTitle: 'Folland et al. 2017',
  url: FOLLAND_2017_URL,
  kind: 'peer-reviewed',
  summary:
    'Whole-body movement of 97 trained runners at 10–12 km/h (6:00 to 5:00 per km) — cadence, trunk angle, swing knee flexion, and pelvis bounce and stride length as fractions of height.',
}

const SCHUBERT_2014_LINK: GuidanceLink = {
  title: 'Schubert, Kempf & Heiderscheit 2014, Sports Health 6(3):210–217',
  shortTitle: 'Schubert et al. 2014',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4000471/',
  kind: 'peer-reviewed',
  summary:
    'The review usually cited for "180 steps per minute". It never mentions 180, or any universal optimum, and frames the whole literature as percentage change from a runner\'s own preferred rate.',
}

const ANDERSON_2022_LINK: GuidanceLink = {
  title: 'Anderson et al. 2022, Sports Medicine — Open 8:112',
  shortTitle: 'Anderson et al. 2022',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9441414/',
  kind: 'peer-reviewed',
  summary:
    'Review of 37 studies: "insufficient evidence to determine the effects of changing running step rate on injury or performance".',
}

const SMITH_2022_LINK: GuidanceLink = {
  title: 'Smith et al. 2022, PLoS ONE 17(11):e0277810',
  shortTitle: 'Smith et al. 2022',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9671438/',
  kind: 'peer-reviewed',
  summary:
    "Measured Garmin devices reading roughly 1.3–1.5 cm high for vertical oscillation against a video reference — an error in one direction, set against Malisoux's separate 10th–90th percentile ranges for men (6.4–9.5 cm) and women (6.0–8.5 cm).",
}

const HEIDERSCHEIT_2011_LINK: GuidanceLink = {
  title:
    'Heiderscheit et al. 2011, "Effects of Step Rate Manipulation on Joint Mechanics during Running", Medicine & Science in Sports & Exercise',
  shortTitle: 'Heiderscheit et al. 2011',
  url: HEIDERSCHEIT_2011_URL,
  kind: 'peer-reviewed',
  summary:
    'Raising step rate 5% and 10% shortened the stride and cut knee energy absorption about 20% and 34%; foot-to-centre-of-mass distance at contact fell from 9.2 cm to 7.0 cm at +10%. Dropping step rate 10% loaded every joint more.',
}

const LENHART_2014_LINK: GuidanceLink = {
  title:
    'Lenhart, Thelen, Wille, Chumanov & Heiderscheit 2014, "Increasing Running Step Rate Reduces Patellofemoral Joint Forces", Medicine & Science in Sports & Exercise',
  shortTitle: 'Lenhart et al. 2014',
  url: 'https://uwnmbl.engr.wisc.edu/pubs/msse14_lenhart.pdf',
  kind: 'peer-reviewed-author-copy',
  summary:
    'Running at 110% of preferred step rate lowered peak patellofemoral joint force 14%. The paper frames a reduced step rate as overstriding in so many words.',
}

const GAUDETTE_2022_LINK: GuidanceLink = {
  title:
    'Gaudette, Heiderscheit, Hollander, Tenforde et al. 2022, "Clinical Application of Gait Retraining in the Injured Runner", Journal of Clinical Medicine',
  shortTitle: 'Gaudette et al. 2022',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9655004/',
  kind: 'peer-reviewed',
  summary:
    'How gait retraining is actually delivered: 8–12 sessions over 2–4 weeks, 2–3 a week, 15 rising to 30 minutes, with feedback faded out. Includes the verbatim cues clinicians use.',
}

const HUBER_2024_LINK: GuidanceLink = {
  title:
    'Huber & Verhoff 2024, "A One Session Gait Retraining Protocol with Metronome Augmentation Increases Cadence in Novice and Recreational Runners", IJSPT',
  shortTitle: 'Huber & Verhoff 2024',
  url: 'https://ijspt.scholasticahq.com/article/90909-a-one-session-gait-retraining-protocol-with-metronome-augmentation-increases-cadence-in-novice-and-recreational-runners',
  kind: 'peer-reviewed',
  summary:
    'A self-administered protocol: a phone metronome 5–10% above your own baseline, 4–6 independent runs over two weeks, 2–3 a week, up to 30 minutes.',
}

const DAVIS_2020_LINK: GuidanceLink = {
  title:
    'Davis, Tenforde, Neal, Roper & Willy 2020, "Gait Retraining as an Intervention for Patellofemoral Pain", Current Reviews in Musculoskeletal Medicine',
  shortTitle: 'Davis et al. 2020',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7083994/',
  kind: 'peer-reviewed',
  summary:
    'A 7.5–10% step-rate increase reduced peak hip adduction and patellofemoral joint stress 10–22%; dosing was 8–18 sessions over 2–6 weeks with faded feedback.',
}

const PETRI_2026_LINK: GuidanceLink = {
  title:
    'Petri et al. 2026, "Gait Retraining for Patellofemoral Pain in Runners: An Umbrella Review", Sports Medicine — Open',
  shortTitle: 'Petri et al. 2026',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC13269574/',
  kind: 'peer-reviewed',
  summary:
    'Umbrella review: a 5–10% cadence adjustment is the most consistently supported gait-retraining intervention.',
}

const ADAMS_2018_LINK: GuidanceLink = {
  title:
    'Adams, Pozzi, Willy, Carrol & Zeni 2018, "Altering Cadence or Vertical Oscillation During Running: Effects on Running Related Injury Factors", IJSPT',
  shortTitle: 'Adams et al. 2018',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6088121/',
  kind: 'peer-reviewed',
  summary:
    'Cueing runners to "keep their body as low to the ground as possible without slouching" cut peak vertical ground reaction force 11.4%, against 3.5% for a cadence cue — though only the cadence cue reduced braking impulse.',
}

const MOORE_2016_LINK: GuidanceLink = {
  title:
    'Moore 2016, "Is There an Economical Running Technique?", Sports Medicine',
  shortTitle: 'Moore 2016',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4887549/',
  kind: 'peer-reviewed',
  summary:
    'Review: greater vertical oscillation raises oxygen consumption — while cautioning against prescribing an economical technique wholesale.',
}

const BRAUN_2024_LINK: GuidanceLink = {
  title:
    'Braun, Mai, Willwacher et al. 2024, "Managing lower extremity loading in distance running by altering sagittal plane trunk leaning", Journal of Sport and Health Science 14:100985',
  shortTitle: 'Braun et al. 2024',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11809138/',
  kind: 'peer-reviewed',
  summary:
    "For each degree of forward trunk lean, hip loading rose about three times as fast as knee loading fell — and the authors recommend altering trunk angle only a little either side of a runner's own natural one.",
}

const CARSON_2024_LINK: GuidanceLink = {
  title:
    'Carson, Aslan & Ortega 2024, "The effect of forward postural lean on running economy, kinematics, and muscle activation", PLOS ONE',
  shortTitle: 'Carson et al. 2024',
  url: 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0302249',
  kind: 'peer-reviewed',
  summary:
    'A deliberate forward lean worsened running economy by about 8%, with no meaningful difference between leaning from the ankles and from the waist.',
}

const TENG_POWERS_2016_LINK: GuidanceLink = {
  title:
    'Teng & Powers 2016, "Hip-Extensor Strength, Trunk Posture, and Use of the Knee-Extensor Muscles During Running", Journal of Athletic Training',
  shortTitle: 'Teng & Powers 2016',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5317187/',
  kind: 'peer-reviewed',
  summary:
    'Hip-extensor strength explained 30.5% of the variance in trunk posture — so what looks like a posture to cue may be a strength difference.',
}

const FUKUCHI_2017_LINK: GuidanceLink = {
  title: 'Fukuchi, Fukuchi & Duarte 2017, PeerJ 5:e3298',
  shortTitle: 'Fukuchi et al. 2017',
  url: FUKUCHI_2017_URL,
  kind: 'peer-reviewed',
  summary:
    'Peak knee flexion in 28 regular runners, stratified by speed: 93.5 ± 10.4° at 2.5 m/s, 108.7 ± 10.7° at 3.5 m/s, 119.1 ± 10.4° at 4.5 m/s — the same convention this app uses, where 0° is full extension.',
}

const HANLEY_2021_LINK: GuidanceLink = {
  title: 'Hanley 2021, "The Biomechanics of Distance Running"',
  shortTitle: 'Hanley 2021',
  url: HANLEY_2021_URL,
  // A book chapter, not a journal article. The URL is an institutional repository's copy of the
  // accepted manuscript — a fact about the link, so it lives in the summary, not in the title.
  kind: 'book-chapter',
  summary:
    "A book chapter reporting 55–60° of included thigh–shank angle at midswing for distance runners, which is 120–125° in this app's convention. Linked at an institutional repository's copy of the accepted manuscript.",
}

const LIEBERMAN_2015_LINK: GuidanceLink = {
  title:
    'Lieberman et al. 2015, Journal of Experimental Biology 218(21):3406–3414',
  shortTitle: 'Lieberman et al. 2015',
  url: 'https://journals.biologists.com/jeb/article/218/21/3406/14416/',
  kind: 'peer-reviewed',
  summary:
    "Measured ankle-to-hip horizontal distance at contact as 0.31 ± 0.08 m at 75 strides/min — one of the two published measurements of this geometry, and about 3.4× the other one (our arithmetic from the two papers' figures).",
}

const SOUZA_2016_LINK: GuidanceLink = {
  title:
    'Souza 2016, "An Evidence-Based Videotaped Running Biomechanics Analysis"',
  shortTitle: 'Souza 2016',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4714754/',
  kind: 'peer-reviewed',
  summary:
    "A clinical video-analysis protocol using exactly this app's landmarks — a vertical line up from the outer ankle bone, judged against the pelvis — and explicitly a yes/no judgement, with no units and no cutoff.",
}

const STIFFLER_JOACHIM_2020_LINK: GuidanceLink = {
  title:
    'Stiffler-Joachim et al. 2020, Journal of Athletic Training 55(12):1300–1306',
  shortTitle: 'Stiffler-Joachim et al. 2020',
  url: STIFFLER_JOACHIM_2020_URL,
  kind: 'peer-reviewed',
  summary:
    'Base of gait in 166 Division-I athletes across speeds: "On average, males demonstrated crossover at 4.47 m/s (6:00-minute mile), whereas females did not demonstrate crossover at any speed", and a negative base of gait at fast speeds "may be normal in a healthy population".',
}

const WANG_2024_LINK: GuidanceLink = {
  title:
    'Wang, Mei, Jiang, Hollander, Van den Berghe, Fernandez & Gu 2024, "The Biomechanical Influence of Step Width on Typical Locomotor Activities: A Systematic Review", Sports Medicine — Open',
  shortTitle: 'Wang et al. 2024',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11283446/',
  kind: 'peer-reviewed',
  summary:
    'Systematic review: a narrower step width goes with greater hip adduction and knee internal rotation, and modelled iliotibial band strain rises as width narrows.',
}

const MEARDON_MILLER_2013_LINK: GuidanceLink = {
  title:
    'Meardon & Miller 2013, "A new approach to iliotibial band syndrome in runners", Lower Extremity Review',
  shortTitle: 'Meardon & Miller 2013',
  url: 'https://lermagazine.com/article/a-new-approach-to-iliotibial-band-syndrome-in-runners',
  kind: 'trade-publication',
  summary:
    "The primary researcher's own clinical write-up: widening step width reduced modelled iliotibial band strain 16–30% and strain rate 13–22%, is metabolically costlier, and pairs with gluteus medius strengthening.",
}

const LASHIEN_2024_LINK: GuidanceLink = {
  title:
    'Lashien, Abdelnaeem & Gomaa 2024, "Effect of hip abductors training on pelvic drop and knee valgus in runners with medial tibial stress syndrome", Journal of Orthopaedic Surgery and Research',
  shortTitle: 'Lashien et al. 2024',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11520670/',
  kind: 'peer-reviewed',
  summary:
    'A named 8-week hip-strengthening programme (pelvic drop, single-leg bridge, side-lying leg raise with the hip turned in, lateral step-up, banded standing leg raise), 3 times a week at a load that can be lifted 10 times. The runners in the trial had shin splints (medial tibial stress syndrome), not a crossover gait.',
}

const BOVALINO_2021_LINK: GuidanceLink = {
  title: 'Bovalino & Kingsley 2021, Sports Medicine — Open 7:82',
  shortTitle: 'Bovalino & Kingsley 2021',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8581084/',
  kind: 'peer-reviewed',
  summary:
    'Meta-analysis of foot-strike prevalence in distance racing: 79% rearfoot early in a race rising to 86% at the final checkpoint, with "inconclusive evidence of a competitive advantage" for landing any other way.',
}

const BURKE_2021_LINK: GuidanceLink = {
  title:
    'Burke et al. 2021, "Risk Factors for Injuries in Runners: A Systematic Review of Foot Strike Technique", Orthopaedic Journal of Sports Medicine 9(9)',
  shortTitle: 'Burke et al. 2021',
  url: 'https://doras.dcu.ie/28875/1/burke-et-al-2021-risk-factors-for-injuries-in-runners-a-systematic-review-of-foot-strike-technique-and-its.pdf',
  kind: 'peer-reviewed-author-copy',
  summary:
    'Systematic review of 13 studies: the evidence linking foot-strike pattern to running injuries was rated low, and the studies behind it very low quality. Only 1 of 7 studies using continuous measures found a significant relationship.',
}

// ---------------------------------------------------------------------------------------------
// Capture hints, one per cause.
//
// `wrongAngle` is the hint for a metric excluded because the camera angle cannot support it — its
// `viewFit` is 'unsuitable' — and each one is written against that metric's row in
// `DEFAULT_VIEW_FIT_TABLE` (`src/heuristics/types.ts`), because that table, not this file, decides
// whether a metric survives on a given clip. `notEnoughData` is the hint for every other cause.
// Every hint is about CAPTURE, never about how the runner runs.
// ---------------------------------------------------------------------------------------------

const SIDE_ON_SQUARE =
  "Film side-on, with the camera square to the runner's line of travel."

const FRONT_OR_REAR_SQUARE =
  'Film from directly in front of or behind the runner, square to their line of travel.'

/**
 * `wrongAngle` for the three metrics no camera angle rules out (no row in the view-fit table is
 * 'unsuitable'). The guided view never shows it today, because those metrics are never excluded
 * for their angle — but it is still a true sentence, and a sentence that is never shown must not
 * be wrong in case that changes.
 */
const NO_ANGLE_RULED_OUT_HINT =
  "No camera angle rules this measurement out. Filmed from the side, square to the runner's line of travel, it reads most reliably, and a clip filmed from in front or behind still works at reduced confidence."

const NOT_ENOUGH_DATA_HINT =
  'Record several seconds of steady running, with the whole body in frame the whole time.'

const REAL_WORLD_SCALE_HINT =
  "It also needs the app to work out the runner's real size from the video, which is most reliable with the whole body in frame."

// ---------------------------------------------------------------------------------------------
// The record.
// ---------------------------------------------------------------------------------------------

export const METRIC_GUIDANCE: Record<MetricId, MetricGuidance> = {
  // === Rank 1 — the strongest band in the set: two independent kinds of source agree. ==========
  cadence: {
    metric: 'cadence',
    displayRank: 1,
    band: {
      unit: 'stepsPerMinute',
      /**
       * Garmin's five percentile zones, transcribed as published: `<153`, `153–163`, `164–173`,
       * `174–183`, `>183`. Note 163→164 and 173→174 leave a one-unit gap on the number line.
       * That gap is Garmin's — it prints the table in whole steps per minute — and it is NOT
       * closed here, for the same reason design.md D3 declines to close the vertical-ratio gaps.
       *
       * **These labels are Garmin's own, verbatim, and they already run in VALUE order**: a higher
       * cadence is a higher Garmin percentile. Do not "harmonise" them with `verticalRatio`'s
       * restated labels — that table needed restating only because Garmin ranks it the other way
       * round. `metricGuidance.test.ts` pins both directions.
       */
      zones: [
        { label: 'Below the 5th percentile', min: null, max: 153 },
        { label: '5th–29th percentile', min: 153, max: 163 },
        { label: '30th–69th percentile', min: 164, max: 173 },
        { label: '70th–95th percentile', min: 174, max: 183 },
        { label: 'Above the 95th percentile', min: 183, max: null },
      ],
      centralTendency: null,
      source: {
        title: "Garmin fenix 7 owner's manual — running-dynamics zone table",
        shortTitle: 'Garmin fenix 7 manual',
        url: GARMIN_FENIX_7_ZONES_URL,
        population: GARMIN_POPULATION,
        sampleSize: GARMIN_SAMPLE_SIZE,
      },
      corroboration: [
        {
          ...MALISOUX_2023_SOURCE,
          population:
            "Recreational runners at 9.9 km/h (6:04 per km) — 164 ± 9 steps/min, with a 10th–90th percentile of 152–174 (men) and 156–180 (women), which brackets Garmin's 30th–69th zone almost exactly",
        },
        {
          ...FOLLAND_2017_SOURCE,
          population:
            'Trained runners at 10–12 km/h (6:00 to 5:00 per km) — 166.8 ± 10.7 steps/min, with a full observed range of 144–222',
        },
      ],
      derivation: null,
      note: "Garmin's percentile methodology is not published — no sample size, no population, no protocol, no peer review. It is shown because Garmin publishes it and anyone can check it, not because the method behind it is known; the peer-reviewed distributions beside it are shown separately rather than merged into it.",
    },
    noBandReason: null,
    evidenceDirection: 'association-without-target',
    mandatoryNotes: [
      '180 steps per minute is not a target. The figure comes from Jack Daniels counting foot strikes at the 1984 Olympics — elite athletes at race pace — and the review usually cited for it never mentions 180, or any universal optimum. The strongest injury finding available is an association with no target attached: in 54 collegiate cross-country runners, each extra step per minute went with about 5% lower bone-stress-injury risk (relative risk 0.95). A review of 37 studies found insufficient evidence to determine the effects of changing step rate on injury or performance at all.',
    ],
    speedSensitivity: {
      summary:
        'This app cannot measure how fast you were running, and speed affects step rate differently within one runner than between runners.',
      withinRunner:
        'Step rate climbs as a runner speeds up — measured at 169.2 rising to 177.9 steps/min from 2.68 to 3.83 m/s (6:13 to 4:21 per km, 10:00 to 7:00 per mile).',
      betweenRunners:
        'Comparing runners each at their own preferred pace, Malisoux found step rate was not correlated with speed; step length is what varies.',
    },
    research: [
      GARMIN_FENIX_7_LINK,
      MALISOUX_2023_LINK,
      FOLLAND_2017_LINK,
      SCHUBERT_2014_LINK,
      ANDERSON_2022_LINK,
    ],
    /**
     * **Heiderscheit, Lenhart and Gaudette are `overstriding`'s links, on purpose. This is design.md
     * D8, not a copy-paste error — do not "tidy" them away.** `remediationIntro` says so on screen,
     * and Heiderscheit and Lenhart sit second and third, straight after the self-administered
     * protocol, so the sentence naming them lands next to them.
     *
     * `overstriding` cannot carry a band (see its own entry), so left alone the page's most-asked
     * question would get its least useful answer. The evidenced intervention for overstriding IS a
     * 5–10% step-rate increase, and the literature makes the link explicitly: Lenhart 2014 frames
     * a reduced step rate as overstriding in so many words, and Heiderscheit 2011 measures the
     * effect on the geometry itself, moving foot-to-centre-of-mass from 9.2 cm to 7.0 cm at +10%.
     * So the actionable answer surfaces here, at rank 1, attached to a metric that does carry a
     * band — while `overstriding` itself stays honestly bandless further down the page.
     */
    remediation: [
      HUBER_2024_LINK,
      HEIDERSCHEIT_2011_LINK,
      LENHART_2014_LINK,
      PETRI_2026_LINK,
      DAVIS_2020_LINK,
      GAUDETTE_2022_LINK,
    ],
    captureHints: {
      wrongAngle: NO_ANGLE_RULED_OUT_HINT,
      notEnoughData: NOT_ENOUGH_DATA_HINT,
    },
    remediationIntro:
      'Raising step rate is also the most-studied way to reduce overstriding — how far the foot lands ahead of the body. The Heiderscheit and Lenhart studies below measured that directly.',
    guidedDescription: null,
  },

  // === Rank 2 — the one band whose every bound is arithmetic rather than a quotation. ==========
  verticalRatio: {
    metric: 'verticalRatio',
    displayRank: 2,
    band: {
      unit: 'percent',
      /**
       * **These are 0..1 values, not percentages.** `3.05 %` is stored as `0.0305`, because
       * `MetricResult.value` for a `'percent'` metric is the dimensionless 0..1 number the panel
       * renders as `value × 100`. See the numeric-convention section on `ReferenceBand`.
       *
       * Two further things to read carefully before editing:
       *
       * 1. **Garmin's percentile order runs OPPOSITE to the numeric order, and the labels below are
       *    therefore NOT Garmin's.** Garmin ranks vertical ratio so that a lower value earns a
       *    higher percentile — a rank of performance, not of value. Printed verbatim, a 3.00%
       *    reading would "fall in the Above-the-95th-percentile zone", which tells the runner low
       *    ranks higher — a verdict the spec forbids (design.md D7.8). Each label is restated in value order,
       *    as 100 minus Garmin's percentile, and the derivation statement says so on screen.
       *    Garmin's `>95th / 70–95th / 30–69th / 5–29th / <5th` become `lowest 5% / 5th–30th /
       *    31st–70th / 71st–95th / highest 5%`. The zones are ordered ascending by value, like every
       *    other band here.
       * 2. **The 0.0005 gaps at 0.0370→0.0375 and 0.0430→0.0435 are Garmin's, and are not
       *    closed.** Garmin publishes to one decimal place with non-contiguous bounds (6.1–7.4
       *    then 7.5–8.6) and halving preserves the discontinuity exactly. Inventing a boundary to
       *    make the table tile cleanly would be inventing exactly the kind of number this module
       *    refuses to invent, for a purely cosmetic gain. design.md D3.
       */
      zones: [
        // Garmin's label, for each: above the 95th percentile.
        { label: "Lowest 5% of Garmin's table", min: null, max: 0.0305 },
        // Garmin's: 70th–95th percentile.
        {
          label: "5th–30th percentile of Garmin's table",
          min: 0.0305,
          max: 0.037,
        },
        // Garmin's: 30th–69th percentile.
        {
          label: "31st–70th percentile of Garmin's table",
          min: 0.0375,
          max: 0.043,
        },
        // Garmin's: 5th–29th percentile.
        {
          label: "71st–95th percentile of Garmin's table",
          min: 0.0435,
          max: 0.0505,
        },
        // Garmin's: below the 5th percentile.
        { label: "Highest 5% of Garmin's table", min: 0.0505, max: null },
      ],
      centralTendency: null,
      source: {
        title:
          "Garmin fenix 7 owner's manual (APAC) — vertical ratio zone table, halved",
        shortTitle: 'Garmin fenix 7 manual (APAC)',
        url: GARMIN_FENIX_7_APAC_ZONES_URL,
        population: GARMIN_POPULATION,
        sampleSize: GARMIN_SAMPLE_SIZE,
      },
      corroboration: [
        {
          ...FOLLAND_2017_SOURCE,
          population:
            "Trained runners at 10–12 km/h (6:00 to 5:00 per km, 9:39 to 8:03 per mile) — 4.06% per stride, calculated from the paper's pelvis bounce (5.2% of height) and stride length (128% of height). That lands inside the middle zone (31st–70th percentile of Garmin's table), reached by an entirely separate route with no shared assumption but the definition of a stride",
        },
      ],
      derivation: {
        statement:
          "Garmin's published vertical-ratio zones are per step. This app's vertical ratio is per stride, and a stride is two steps — so every Garmin bound is halved before it can be laid against this app's number. Every bound halves exactly to two decimal places in percent: 6.1 → 3.05, 7.4 → 3.70, 7.5 → 3.75, 8.6 → 4.30, 8.7 → 4.35, 10.1 → 5.05. No rounding was applied and none was needed. The zone labels are restated too, not quoted: Garmin ranks vertical ratio so that a lower value earns a higher percentile, which would label the lowest readings with the highest percentile. Each zone is labelled instead by where its values sit in value order, which is 100 minus Garmin's percentile — Garmin's above-95th becomes the lowest 5% of the table, 70th–95th becomes 5th–30th, 30th–69th becomes 31st–70th, 5th–29th becomes 71st–95th, and below-5th becomes the highest 5%.",
        restsOn: [
          'Garmin\'s own manual defines its "stride length" verbatim as "the length of your stride from one footfall to the next" — one footfall to the next is left-to-right or right-to-left, which is a step. Two cross-checks on Garmin\'s own published figures agree: at 10 km/h and 164 steps/min the distance per footfall is 1.02 m, a step rather than a stride; and Garmin\'s own chest-measured vertical oscillation bands divided by its vertical ratio bands imply a denominator of 109–113 cm, which is a step, not a ~200 cm stride.',
          'This app measures a full stride: it pairs each footstrike only with the next footstrike of the same foot, so every stride it measures is two steps long.',
        ],
      },
      note: "Unlike an absolute measurement, this ratio cancels height — both of its terms scale with stature — which is its main advantage over raw vertical oscillation. It is also why a manufacturer's table can be used here, where this page declines to use Garmin's table for the centimetre measurement: a sensor error proportional to the reading largely divides out of a ratio, and does not divide out of an absolute number of centimetres. The error actually measured on Garmin's vertical-oscillation reading — the top half of this ratio — is not proportional, though: devices read roughly 1.3–1.5 cm high against a video reference, which is a fixed offset, and a fixed offset does not cancel in a ratio. Garmin's published zones inherit that offset, so they may sit somewhat high relative to a hip-based measurement like this app's. Folland 2017's independent laboratory figure, worked out as 4.06% per stride, lands inside the middle zone, the 31st–70th percentile of Garmin's table.",
    },
    noBandReason: null,
    evidenceDirection: 'none-established',
    mandatoryNotes: [],
    speedSensitivity: {
      summary:
        'This app cannot measure how fast you were running, and vertical ratio falls as pace rises — so a clip filmed at a jog reads higher than the same form filmed faster.',
      withinRunner:
        'Stride length climbs steeply with speed while vertical oscillation does not, so the ratio between them falls as a runner speeds up.',
      betweenRunners: null,
    },
    research: [
      GARMIN_FENIX_7_APAC_LINK,
      GARMIN_FORERUNNER_255_LINK,
      FOLLAND_2017_LINK,
    ],
    // Nothing in the research pass reports an intervention on vertical ratio itself. Adams 2018
    // is linked because it targets this ratio's NUMERATOR — the bounce — and its summary says so.
    remediation: [ADAMS_2018_LINK],
    captureHints: {
      wrongAngle: `${SIDE_ON_SQUARE} This ratio divides by stride length, and a stride seen from in front, from behind or at an angle looks shorter than it is, which would make the ratio read high.`,
      notEnoughData: `${NOT_ENOUGH_DATA_HINT} A stride runs from one footstrike to the next footstrike of the same foot, so the clip needs several strides in a row.`,
    },
    remediationIntro: null,
    guidedDescription: null,
  },

  // === Rank 3 — a paper rather than a manual, for the reason design.md D4 records. =============
  verticalOscillationCm: {
    metric: 'verticalOscillationCm',
    displayRank: 3,
    band: {
      unit: 'centimeters',
      /**
       * **Both bounds are published; the range between them is not.** Malisoux publishes its
       * 10th–90th percentiles by sex, not for the cohort as a whole, so 6.0 is women's 10th and 9.5
       * is men's 90th — which is why `derivation` is non-null and the label names both rows.
       */
      zones: [
        {
          label:
            "From women's 10th to men's 90th percentile in Malisoux's 860 runners, at 10 km/h (6:00 per km)",
          min: 6.0,
          max: 9.5,
        },
      ],
      centralTendency: {
        value: 7.7,
        label: "Malisoux's overall average (± 1.2 cm)",
      },
      source: MALISOUX_2023_SOURCE,
      corroboration: [
        {
          ...HEIDERSCHEIT_2011_SOURCE,
          population:
            'Runners at 2.9 m/s (5:45 per km, 9:15 per mile) — 8.7 ± 1.3 cm of centre-of-mass bounce, falling to 7.3 cm at a 10% higher step rate',
        },
      ],
      derivation: {
        statement:
          "Malisoux publishes 10th–90th percentile ranges for men and for women separately, not one range for the whole cohort. This band runs from the lowest of those four published bounds (women's 10th percentile, 6.0 cm) to the highest (men's 90th percentile, 9.5 cm), so it contains both published ranges. Both ends are published numbers, but the span between them is not the 10th–90th percentile range of any group Malisoux reports, and no percentile of the combined cohort is claimed.",
        restsOn: [
          'Malisoux et al. 2023, men at 10 km/h: 10th–90th percentile 64–95 mm, which is 6.4–9.5 cm.',
          'Malisoux et al. 2023, women at 10 km/h: 10th–90th percentile 60–85 mm, which is 6.0–8.5 cm.',
        ],
      },
      // The height confound is deliberately NOT repeated here: it is a statement about the
      // metric, so it renders once, from `mandatoryNotes`. This note is for how the band was built.
      note: 'Garmin publishes vertical-oscillation bands in centimetres that are deliberately not used here — Garmin devices were measured reading roughly 1.3–1.5 cm high against a video reference, and their sensor sits on the chest or waist rather than at the centre of mass, which sees more travel again. Malisoux measures what this app computes: centre of mass, peak to peak, per step.',
    },
    noBandReason: null,
    evidenceDirection: 'association-without-target',
    mandatoryNotes: [
      'This range is in absolute centimetres over a population whose heights are not controlled for, so it reads high against a tall runner and low against a short one for reasons that have nothing to do with how they run.',
    ],
    speedSensitivity: {
      summary:
        'This app cannot measure how fast you were running, and speed affects vertical oscillation differently within one runner than between runners.',
      withinRunner: 'Vertical oscillation falls as a runner speeds up.',
      betweenRunners:
        'Comparing runners each at their own preferred pace, Malisoux found essentially no relationship with speed.',
    },
    research: [
      MALISOUX_2023_LINK,
      SMITH_2022_LINK,
      HEIDERSCHEIT_2011_LINK,
      MOORE_2016_LINK,
    ],
    // Moore 2016 is a review of what vertical oscillation costs, not a way to change it, so it sits
    // under research only — a link never appears in both lists of one metric.
    remediation: [ADAMS_2018_LINK],
    captureHints: {
      wrongAngle: NO_ANGLE_RULED_OUT_HINT,
      notEnoughData: `${NOT_ENOUGH_DATA_HINT} ${REAL_WORLD_SCALE_HINT} A steady side-on pass makes that easiest.`,
    },
    remediationIntro: null,
    guidedDescription: null,
  },

  // === Rank 4 — a spread with no preferred end, because four outcomes disagree. ================
  trunkLean: {
    metric: 'trunkLean',
    displayRank: 4,
    band: {
      unit: 'degrees',
      zones: [
        { label: "Range across Folland's 97 runners", min: 1.8, max: 21.4 },
      ],
      centralTendency: {
        value: 10.3,
        label: 'Average in this study (± 3.7°)',
      },
      source: FOLLAND_2017_SOURCE,
      // Teng & Powers 2014 (7.3 ± 3.6° self-selected) would corroborate, and is deliberately
      // absent: JOSPT returned 403 to the research pass, so it is high-confidence secondary
      // knowledge and is not quoted as a range anywhere.
      corroboration: [],
      derivation: null,
      note: "Folland measures each runner's trunk angle against their own quiet standing posture, not against true vertical, so there is a small real offset against the way this app defines the angle. It is disclosed rather than corrected for, because correcting it would mean assuming a standing posture nobody measured.",
    },
    noBandReason: null,
    evidenceDirection: 'contested',
    mandatoryNotes: [
      'There is no defensible target for trunk lean, and this range carries no preferred end: four measured outcomes point in different directions at once. Knee load falls with forward lean. Hip and lower-back load rise about three times as fast as knee load falls. The rate and size of the impact at landing rose 29% and 20% with more forward bend. And performance points the other way again: a more upright trunk correlated with better running performance. The authors of the loading study recommend altering trunk angle "only to an extent that is not too far from the individual\'s self-selected trunk angle" — that is, no target angle at all.',
    ],
    // Deliberately null, and specifically NOT a claim that trunk lean is speed-invariant: the
    // research pass found no speed dependence stated for it, which is an absence of evidence.
    // The spec requires the speed caveat to stay off where nothing was established, so that it
    // keeps meaning something on the four metrics where something was.
    speedSensitivity: null,
    // Braun and Carson both measured what happens when trunk angle is changed, so they sit under
    // remediation only — a link never appears in both lists of one metric.
    research: [FOLLAND_2017_LINK],
    remediation: [BRAUN_2024_LINK, TENG_POWERS_2016_LINK, CARSON_2024_LINK],
    captureHints: {
      wrongAngle: `${SIDE_ON_SQUARE} Leaning forward or back shows only from the side; from in front, from behind or at an angle it barely changes the picture.`,
      notEnoughData: NOT_ENOUGH_DATA_HINT,
    },
    remediationIntro: null,
    guidedDescription: null,
  },

  // === Rank 5 — the most speed-sensitive band in the set: one cohort's observed range. ==========
  kneeFlexion: {
    metric: 'kneeFlexion',
    displayRank: 5,
    band: {
      unit: 'degrees',
      /**
       * Folland 2017, Table 2, "Minimum knee extension angle during swing": −94.1 ± 11.1°
       * (min −129, max −71.3). Folland signs flexion negative; this app signs it positive, so the
       * range is stored as 71.3–129 — a change of sign, not a conversion. An earlier draft shipped
       * 85–125°, pooled across Fukuchi's speed means, Hanley and Folland; no source publishes that
       * range, so it was replaced (design.md D1, D2 rank 5).
       */
      zones: [
        { label: "Range across Folland's 97 runners", min: 71.3, max: 129 },
      ],
      centralTendency: {
        value: 94.1,
        label: 'Average in this study (± 11.1°)',
      },
      source: FOLLAND_2017_SOURCE,
      corroboration: [
        {
          title: 'Fukuchi, Fukuchi & Duarte 2017, PeerJ 5:e3298',
          shortTitle: 'Fukuchi et al. 2017',
          url: FUKUCHI_2017_URL,
          population:
            'Regular runners at 2.5, 3.5 and 4.5 m/s (6:40, 4:46 and 3:42 per km) — 93.5 ± 10.4°, 108.7 ± 10.7° and 119.1 ± 10.4° respectively, in the same convention this app uses, where 0° is full extension',
          sampleSize: '28',
        },
        {
          title: 'Hanley 2021, "The Biomechanics of Distance Running"',
          shortTitle: 'Hanley 2021',
          url: HANLEY_2021_URL,
          population:
            "Distance runners at midswing — 55–60° of included thigh–shank angle, which is 120–125° in this app's convention",
          sampleSize: 'Book chapter; the cohort is not restated',
        },
      ],
      derivation: null,
      note: 'This is the spread of one cohort at 10–12 km/h, not a span chosen to cover every running speed — and speed moves this measurement more than any other this app makes: the speed-stratified means beside it, at 2.5 and 4.5 m/s, sit about two and a half standard deviations apart, and this app cannot tell which speed a clip was filmed at. Folland measures each knee angle against the runner\'s own quiet standing posture rather than a fully straight leg, and reports flexion as a negative number; it is shown here as positive flexion, and the standing reference is disclosed rather than corrected for, because correcting it would mean assuming a standing posture nobody measured. Two honest gaps go with the corroboration. Fukuchi does not state whether its maximum is a swing or a stance peak; stance peak is around 45° in comparable cohorts, so 93–119° must be swing — an inference, not the paper\'s claim. And Novacheck 1998, to which the ubiquitous "125° at midswing" figure is attributed everywhere, could not be retrieved and is not cited.',
    },
    noBandReason: null,
    evidenceDirection: 'none-established',
    mandatoryNotes: [],
    speedSensitivity: {
      summary:
        'This app cannot measure how fast you were running, and this is the most speed-sensitive measurement it makes — roughly 13° more knee flexion for every extra 1 m/s.',
      withinRunner:
        'Fukuchi measured the same runners at three speeds: average peak knee flexion was 93.5°, 108.7° and 119.1° at 2.5, 3.5 and 4.5 m/s (6:40, 4:46 and 3:42 per km) — about +13° per 1 m/s, and the slowest and fastest means are about two and a half standard deviations apart.',
      betweenRunners: null,
    },
    research: [FOLLAND_2017_LINK, FUKUCHI_2017_LINK, HANLEY_2021_LINK],
    // Nothing in the research pass reports an intervention on swing knee flexion.
    remediation: [],
    captureHints: {
      wrongAngle: `${SIDE_ON_SQUARE} The knee bends forward and back, so from in front, from behind or at an angle the bend is hidden or looks smaller than it is.`,
      notEnoughData: NOT_ENOUGH_DATA_HINT,
    },
    remediationIntro: null,
    guidedDescription: null,
  },

  // === Ranks 6–12: no band. Each renders its value, its description, its caveats and its =======
  // === links; only the SCALE is withheld. The order follows design.md D5's own sections. =======

  overstriding: {
    metric: 'overstriding',
    displayRank: 6,
    band: null,
    noBandReason:
      'No published study measures foot-to-hip horizontal distance relative to torso length, which is the unit this app reports it in — a targeted search for that combination returned nothing relevant. And there is no threshold in any other unit either: the most recent review states plainly that "there is currently no consensus on what qualifies as excessive overstriding", and the clinical video protocol that uses exactly this app\'s landmarks is explicitly a yes/no judgement with no units and no cutoff. Halving the gap between the two published measurements to manufacture a range would be picking a number and calling it research.',
    evidenceDirection: 'association-without-target',
    mandatoryNotes: [
      "The two published absolute measurements of this same geometry disagree: Heiderscheit 2011 measured 9.2 ± 4.0 cm from centre of mass to heel at initial contact, and Lieberman 2015 measured the ankle 0.31 ± 0.08 m ahead of the hip — about 3.4× apart (our arithmetic from the two papers' figures). Neither paper defines its computation precisely enough to reconcile them, so neither is offered here as a reference point.",
      'The only defensible statement about overstriding is a relative one, and this is it: raising step rate by 10% was measured moving foot-to-centre-of-mass distance from 9.2 cm to 7.0 cm, a 24% reduction. That is a change within one runner under an intervention, not a range a population falls in — which is why the intervention links for this metric also appear on the cadence card.',
    ],
    speedSensitivity: null,
    // Heiderscheit 2011 measured what raising step rate does to this geometry, so it sits under
    // remediation only — a link never appears in both lists of one metric.
    research: [LIEBERMAN_2015_LINK, SOUZA_2016_LINK],
    remediation: [
      HEIDERSCHEIT_2011_LINK,
      LENHART_2014_LINK,
      GAUDETTE_2022_LINK,
    ],
    captureHints: {
      wrongAngle: `${SIDE_ON_SQUARE} How far the foot lands ahead of the hips is a forward distance, which a camera in front of or behind the runner looks straight along and cannot see.`,
      notEnoughData: NOT_ENOUGH_DATA_HINT,
    },
    remediationIntro: null,
    guidedDescription:
      'How far your foot lands ahead of your hips at footstrike, relative to your torso length.',
  },

  verticalOscillation: {
    metric: 'verticalOscillation',
    displayRank: 7,
    band: null,
    // The closest call in the set, and the one place a band was REACHABLE and was refused on the
    // quality of the derivation rather than on its absence. design.md D5.2.
    noBandReason:
      "A range could be calculated for this measurement, but it isn't shown. It would divide a published pelvis-bounce figure by a textbook estimate of torso length rather than a measured one, and the published figure doesn't say whether it is per step or per stride — either uncertainty changes the answer. The centimetre and ratio versions above do have published ranges.",
    evidenceDirection: 'association-without-target',
    mandatoryNotes: [],
    speedSensitivity: null,
    research: [FOLLAND_2017_LINK, MALISOUX_2023_LINK, MOORE_2016_LINK],
    remediation: [ADAMS_2018_LINK],
    captureHints: {
      wrongAngle: NO_ANGLE_RULED_OUT_HINT,
      notEnoughData: NOT_ENOUGH_DATA_HINT,
    },
    remediationIntro: null,
    guidedDescription: null,
  },

  // `stepWidth` and `stepWidthCm` are deliberately parallel entries with the same reasoning and
  // the same links: they are the same measurement in two units, and the literature's problems with
  // it are problems with the quantity, not with the unit. They are NOT collapsed into one shared
  // constant, so that either can diverge later without silently dragging the other with it.
  stepWidth: {
    metric: 'stepWidth',
    displayRank: 8,
    band: null,
    noBandReason:
      'The literature carries three incompatible definitions of step width, differing by about 2× and by sign, and only one of them — "base of gait" — matches the sign convention this app uses. Even that one samples at midstance where this app samples at footstrike, and it publishes in centimetres, where this metric reports a fraction of the runner\'s own hip width. No published target range exists in either unit; the "normal step width is 8–10 cm" figure in wide circulation traces to a non-peer-reviewed page and describes walking, not running.',
    evidenceDirection: 'contested',
    mandatoryNotes: [
      'A negative value is not a defect. Crossover is normal at speed: in 166 Division-I athletes, "On average, males demonstrated crossover at 4.47 m/s (6:00-minute mile), whereas females did not demonstrate crossover at any speed", and the authors note that a negative base of gait at fast speeds "may be normal in a healthy population".',
      'The link between a narrow step width and injury is modelling-only, in uninjured runners; no prospective study was found, and the two primary crossover papers could not be retrieved and are therefore not cited. One retrospective study points the other way entirely — runners who had sprained an ankle ran 1.5 ± 0.7 cm wider. The widely repeated claim that narrow step width causes shin stress fractures rests on a documented citation error: the study it cites (1065 Royal Marines) never measured step width at all, and its actual predictors were ankle width, body mass index, peak heel pressure and shin rotation. The width of the ankle itself has been confused with how far apart the feet land.',
      'Pelvis width matters and height does not: step width changed by −0.31 cm for every extra 1 cm of pelvis width, and height was unrelated.',
    ],
    speedSensitivity: {
      summary:
        'This app cannot measure how fast you were running, and the speed effect on step width is as large as the whole measurement.',
      withinRunner:
        'Compared with running at 2.68 m/s (6:13 per km), base of gait shifted −0.353 cm at 2.95 m/s (5:39 per km) and −1.442 cm at 4.47 m/s (3:44 per km). A fixed threshold in a speed-blind app would label fast runners as crossing over purely for being fast.',
      // No between-runner SPEED statement surfaced for step width. The pelvis-width finding that
      // used to sit here is about body dimensions, not speed, so it is a mandatory note instead.
      betweenRunners: null,
    },
    // Wang 2024 reviews what step width does to the body rather than how to change it, so it sits
    // under research only — a link never appears in both lists of one metric.
    research: [STIFFLER_JOACHIM_2020_LINK, WANG_2024_LINK],
    remediation: [MEARDON_MILLER_2013_LINK, LASHIEN_2024_LINK],
    captureHints: {
      wrongAngle: `${FRONT_OR_REAR_SQUARE} Where each foot lands relative to the body's midline is a side-to-side distance, which a side-on camera looks straight along and cannot see.`,
      notEnoughData: NOT_ENOUGH_DATA_HINT,
    },
    remediationIntro: null,
    guidedDescription: null,
  },

  stepWidthCm: {
    metric: 'stepWidthCm',
    displayRank: 9,
    band: null,
    noBandReason:
      'The literature carries three incompatible definitions of step width, differing by about 2× and by sign, and only one of them — "base of gait" — matches the sign convention this app uses; even that one samples at midstance where this app samples at footstrike. No published target range in centimetres exists; it was searched for specifically. For scale rather than as a band, two figures: a foot-to-foot measurement of 3.61 ± 2.56 cm, which is about 1.8 cm in this app\'s convention (half of Arellano & Kram\'s foot-to-foot figure), and a statistical model\'s baseline of 1.358 cm. The "normal step width is 8–10 cm" figure in wide circulation traces to a non-peer-reviewed page and describes walking, not running.',
    evidenceDirection: 'contested',
    mandatoryNotes: [
      'A negative value is not a defect. Crossover is normal at speed: in 166 Division-I athletes, "On average, males demonstrated crossover at 4.47 m/s (6:00-minute mile), whereas females did not demonstrate crossover at any speed", and the authors note that a negative base of gait at fast speeds "may be normal in a healthy population".',
      'The link between a narrow step width and injury is modelling-only, in uninjured runners; no prospective study was found, and the two primary crossover papers could not be retrieved and are therefore not cited. One retrospective study points the other way entirely — runners who had sprained an ankle ran 1.5 ± 0.7 cm wider. The widely repeated claim that narrow step width causes shin stress fractures rests on a documented citation error: the study it cites (1065 Royal Marines) never measured step width at all, and its actual predictors were ankle width, body mass index, peak heel pressure and shin rotation. The width of the ankle itself has been confused with how far apart the feet land.',
      'Pelvis width matters and height does not: step width changed by −0.31 cm for every extra 1 cm of pelvis width, and height was unrelated.',
    ],
    speedSensitivity: {
      summary:
        'This app cannot measure how fast you were running, and the speed effect on step width is as large as the whole measurement.',
      withinRunner:
        'Compared with running at 2.68 m/s (6:13 per km), base of gait shifted −0.353 cm at 2.95 m/s (5:39 per km) and −1.442 cm at 4.47 m/s (3:44 per km). A fixed centimetre threshold in a speed-blind app would label fast runners as crossing over purely for being fast.',
      // No between-runner SPEED statement surfaced for step width. The pelvis-width finding that
      // used to sit here is about body dimensions, not speed, so it is a mandatory note instead.
      betweenRunners: null,
    },
    // Wang 2024 reviews what step width does to the body rather than how to change it, so it sits
    // under research only — a link never appears in both lists of one metric.
    research: [STIFFLER_JOACHIM_2020_LINK, WANG_2024_LINK],
    remediation: [MEARDON_MILLER_2013_LINK, LASHIEN_2024_LINK],
    captureHints: {
      wrongAngle: `${FRONT_OR_REAR_SQUARE} Where each foot lands relative to the body's midline is a side-to-side distance, which a side-on camera looks straight along and cannot see.`,
      notEnoughData: `${NOT_ENOUGH_DATA_HINT} ${REAL_WORLD_SCALE_HINT}`,
    },
    remediationIntro: null,
    guidedDescription: null,
  },

  footStrikePattern: {
    metric: 'footStrikePattern',
    displayRank: 10,
    band: null,
    noBandReason:
      'This metric reports a classification, and what the literature publishes for it is a prevalence rather than a range: how many distance runners land each way, not a value to compare a number against. No reference range exists for the underlying ankle-relative-to-knee offset this app measures the classification from.',
    evidenceDirection: 'redistribution-not-improvement',
    mandatoryNotes: [
      'About 8 in 10 distance runners are rearfoot strikers. A meta-analysis of distance racing found 79% rearfoot early in a race, rising to 86% at the final checkpoint — the share goes up with distance, not down — and reported inconclusive evidence of any competitive advantage for landing otherwise.',
      'No valence attaches to any of the three patterns here, and that is a finding rather than a hedge. A systematic review of 13 studies rated the evidence for a link between foot-strike pattern and running injuries as low, and the studies behind it as very low quality; only 1 of the 7 using continuous measures found a significant relationship. Mechanically the difference is a redistribution rather than an improvement: landing rearfoot raises patellofemoral load and vertical loading rate, landing forefoot raises Achilles and soleus load.',
    ],
    speedSensitivity: null,
    research: [BOVALINO_2021_LINK, BURKE_2021_LINK],
    // Deliberately empty, and this emptiness is the finding: with the injury link rated low
    // evidence and the mechanical difference a redistribution, there is nothing to remediate
    // TOWARD. Offering a retraining protocol here would assert exactly what the best available
    // systematic review declines to.
    remediation: [],
    captureHints: {
      wrongAngle: `${SIDE_ON_SQUARE} This is read from where the ankle sits relative to the knee as the foot lands, which shows only from the side.`,
      notEnoughData: NOT_ENOUGH_DATA_HINT,
    },
    remediationIntro: null,
    guidedDescription:
      'Whether your foot tends to land heel-, midfoot- or forefoot-first.',
  },

  kneeDrive: {
    metric: 'kneeDrive',
    displayRank: 11,
    band: null,
    noBandReason:
      'No published reference values surfaced for knee drive in the unit this app reports it in. The search behind this page was targeted rather than exhaustive, so the honest statement is that we did not find one — not that none exists.',
    evidenceDirection: 'none-established',
    mandatoryNotes: [],
    speedSensitivity: null,
    research: [],
    remediation: [],
    captureHints: {
      wrongAngle: `${SIDE_ON_SQUARE} How high the thigh lifts is a forward-and-up angle, which looks smaller than it is from in front, from behind or at an angle.`,
      notEnoughData: NOT_ENOUGH_DATA_HINT,
    },
    remediationIntro: null,
    guidedDescription: null,
  },

  armSwingAmplitude: {
    metric: 'armSwingAmplitude',
    displayRank: 12,
    band: null,
    noBandReason:
      'No published reference values surfaced for arm swing amplitude in the unit this app reports it in. The search behind this page was targeted rather than exhaustive, so the honest statement is that we did not find one — not that none exists.',
    evidenceDirection: 'none-established',
    mandatoryNotes: [],
    speedSensitivity: null,
    research: [],
    remediation: [],
    captureHints: {
      wrongAngle:
        "Film from directly in front of or behind the runner. From the side, the far arm is hidden behind the body, so only one arm's swing can be seen.",
      notEnoughData: NOT_ENOUGH_DATA_HINT,
    },
    remediationIntro: null,
    guidedDescription: null,
  },
}

/**
 * Every metric's guidance in its fixed presentation order.
 *
 * Provided here rather than left to each consumer so that two views cannot disagree about the
 * order, and computed from `displayRank` rather than from `Object.values` so it does not silently
 * depend on the key order this file happens to be written in.
 */
export function guidanceInDisplayOrder(): MetricGuidance[] {
  return Object.values(METRIC_GUIDANCE).sort(
    (a, b) => a.displayRank - b.displayRank,
  )
}

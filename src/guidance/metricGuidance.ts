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
 * `openspec/changes/guided-results-view/design.md` — D2 for the five bands, D3 for the one
 * derivation, D4 for why one band comes from a paper where its sibling comes from a manual, D5
 * for the seven refusals one at a time, D8 for the one place a metric's remediation deliberately
 * hangs off another metric's card, and D9 for what none of this claims.
 *
 * ## What this file does NOT claim
 *
 * 1. **The bands are not targets.** Each is a description of where some population of runners was
 *    measured to be. None is a recommendation, a goal, or a healthy range.
 * 2. **This app cannot measure running speed, and speed moves four of the five banded metrics** —
 *    `kneeFlexion` most of all, at roughly +13° per 1 m/s. A speed-blind app reads a jogger as
 *    worse than a fast runner with identical form, on at least two of these scales. See
 *    `speedSensitivity` on each entry.
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
 * rather than being smoothed over, per design.md D9.3: these two bands ship because they are a
 * sourced external fact attributable to a named publisher, not because the methodology is known.
 */
const GARMIN_POPULATION =
  'Not stated. Garmin says only that it "has researched many runners of all different levels"; no protocol and no peer review are published.'
const GARMIN_SAMPLE_SIZE = 'Not published'

const MALISOUX_2023_SOURCE: BandSource = {
  title: 'Malisoux et al. 2023, Orthopaedic Journal of Sports Medicine 11(10)',
  url: MALISOUX_2023_URL,
  population: 'Recreational runners on a treadmill at 10 km/h',
  sampleSize: '860',
}

const FOLLAND_2017_SOURCE: BandSource = {
  title:
    'Folland et al. 2017, Medicine & Science in Sports & Exercise 49(7):1412–1423',
  url: FOLLAND_2017_URL,
  population: 'Trained runners at 10–12 km/h',
  sampleSize: '97',
}

const HEIDERSCHEIT_2011_SOURCE: BandSource = {
  title:
    'Heiderscheit et al. 2011, "Effects of Step Rate Manipulation on Joint Mechanics during Running", Medicine & Science in Sports & Exercise',
  url: HEIDERSCHEIT_2011_URL,
  population: 'Healthy recreational runners at 2.9 m/s',
  sampleSize: '45',
}

const GARMIN_FENIX_7_LINK: GuidanceLink = {
  title: "Garmin fenix 7 owner's manual — running-dynamics zones",
  url: GARMIN_FENIX_7_ZONES_URL,
  kind: 'manufacturer',
  summary:
    'The five-zone percentile table Garmin publishes for cadence, over a population it does not describe.',
}

const GARMIN_FENIX_7_APAC_LINK: GuidanceLink = {
  title: "Garmin fenix 7 owner's manual (APAC) — vertical ratio zones",
  url: GARMIN_FENIX_7_APAC_ZONES_URL,
  kind: 'manufacturer',
  summary:
    'The five-zone percentile table for vertical ratio, published per step.',
}

const GARMIN_FORERUNNER_255_LINK: GuidanceLink = {
  title: "Garmin Forerunner 255 owner's manual — running dynamics",
  url: GARMIN_FORERUNNER_255_URL,
  kind: 'manufacturer',
  summary:
    'Defines Garmin\'s "stride length" verbatim as "the length of your stride from one footfall to the next" — one footfall to the NEXT is a step, which is the definition that forces the halving.',
}

const MALISOUX_2023_LINK: GuidanceLink = {
  title: 'Malisoux et al. 2023, Orthopaedic Journal of Sports Medicine 11(10)',
  url: MALISOUX_2023_URL,
  kind: 'peer-reviewed',
  summary:
    'Running-dynamics distribution over 860 recreational runners at 9.9–10 km/h: cadence 164 ± 9 steps/min, vertical oscillation 77 ± 12 mm, with percentiles by sex.',
}

const FOLLAND_2017_LINK: GuidanceLink = {
  title:
    'Folland et al. 2017, Medicine & Science in Sports & Exercise 49(7):1412–1423',
  url: FOLLAND_2017_URL,
  kind: 'peer-reviewed',
  summary:
    'Whole-body kinematics of 97 trained runners at 10–12 km/h — cadence, trunk angle, swing knee flexion, and height-normalised pelvis oscillation and stride length.',
}

const SCHUBERT_2014_LINK: GuidanceLink = {
  title: 'Schubert, Kempf & Heiderscheit 2014, Sports Health 6(3):210–217',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4000471/',
  kind: 'peer-reviewed',
  summary:
    'The review usually cited for "180 steps per minute". It never mentions 180, or any universal optimum, and frames the whole literature as percentage change from a runner\'s own preferred rate.',
}

const ANDERSON_2022_LINK: GuidanceLink = {
  title: 'Anderson et al. 2022, Sports Medicine — Open 8:112',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9441414/',
  kind: 'peer-reviewed',
  summary:
    'Review of 37 studies: "insufficient evidence to determine the effects of changing running step rate on injury or performance".',
}

const SMITH_2022_LINK: GuidanceLink = {
  title: 'Smith et al. 2022, PLoS ONE 17(11):e0277810',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9671438/',
  kind: 'peer-reviewed',
  summary:
    'Measured Garmin devices reading roughly 1.3–1.5 cm high for vertical oscillation against a video reference — a fifth of the whole published range, in one direction.',
}

const HEIDERSCHEIT_2011_LINK: GuidanceLink = {
  title:
    'Heiderscheit et al. 2011, "Effects of Step Rate Manipulation on Joint Mechanics during Running", Medicine & Science in Sports & Exercise',
  url: HEIDERSCHEIT_2011_URL,
  kind: 'peer-reviewed',
  summary:
    'Raising step rate 5% and 10% shortened the stride and cut knee energy absorption about 20% and 34%; foot-to-centre-of-mass distance at contact fell from 9.2 cm to 7.0 cm at +10%. Dropping step rate 10% loaded every joint more.',
}

const LENHART_2014_LINK: GuidanceLink = {
  title:
    'Lenhart, Thelen, Wille, Chumanov & Heiderscheit 2014, "Increasing Running Step Rate Reduces Patellofemoral Joint Forces", Medicine & Science in Sports & Exercise',
  url: 'https://uwnmbl.engr.wisc.edu/pubs/msse14_lenhart.pdf',
  kind: 'peer-reviewed-author-copy',
  summary:
    'Running at 110% of preferred step rate lowered peak patellofemoral joint force 14%. The paper frames a reduced step rate as overstriding in so many words.',
}

const GAUDETTE_2022_LINK: GuidanceLink = {
  title:
    'Gaudette, Heiderscheit, Hollander, Tenforde et al. 2022, "Clinical Application of Gait Retraining in the Injured Runner", Journal of Clinical Medicine',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9655004/',
  kind: 'peer-reviewed',
  summary:
    'How gait retraining is actually delivered: 8–12 sessions over 2–4 weeks, 2–3 a week, 15 rising to 30 minutes, with feedback faded out. Includes the verbatim cues clinicians use.',
}

const HUBER_2024_LINK: GuidanceLink = {
  title:
    'Huber & Verhoff 2024, "A One Session Gait Retraining Protocol with Metronome Augmentation Increases Cadence in Novice and Recreational Runners", IJSPT',
  url: 'https://ijspt.scholasticahq.com/article/90909-a-one-session-gait-retraining-protocol-with-metronome-augmentation-increases-cadence-in-novice-and-recreational-runners',
  kind: 'peer-reviewed',
  summary:
    'A self-administered protocol: a phone metronome 5–10% above your own baseline, 4–6 independent runs over two weeks, 2–3 a week, up to 30 minutes.',
}

const DAVIS_2020_LINK: GuidanceLink = {
  title:
    'Davis, Tenforde, Neal, Roper & Willy 2020, "Gait Retraining as an Intervention for Patellofemoral Pain", Current Reviews in Musculoskeletal Medicine',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7083994/',
  kind: 'peer-reviewed',
  summary:
    'A 7.5–10% step-rate increase reduced peak hip adduction and patellofemoral joint stress 10–22%; dosing was 8–18 sessions over 2–6 weeks with faded feedback.',
}

const PETRI_2026_LINK: GuidanceLink = {
  title:
    'Petri et al. 2026, "Gait Retraining for Patellofemoral Pain in Runners: An Umbrella Review", Sports Medicine — Open',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC13269574/',
  kind: 'peer-reviewed',
  summary:
    'Umbrella review: a 5–10% cadence adjustment is the most consistently supported gait-retraining intervention.',
}

const ADAMS_2018_LINK: GuidanceLink = {
  title:
    'Adams, Pozzi, Willy, Carrol & Zeni 2018, "Altering Cadence or Vertical Oscillation During Running: Effects on Running Related Injury Factors", IJSPT',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6088121/',
  kind: 'peer-reviewed',
  summary:
    'Cueing runners to "keep their body as low to the ground as possible without slouching" cut peak vertical ground reaction force 11.4%, against 3.5% for a cadence cue — though only the cadence cue reduced braking impulse.',
}

const MOORE_2016_LINK: GuidanceLink = {
  title:
    'Moore 2016, "Is There an Economical Running Technique?", Sports Medicine',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4887549/',
  kind: 'peer-reviewed',
  summary:
    'Review: greater vertical oscillation raises oxygen consumption — while cautioning against prescribing an economical technique wholesale.',
}

const VELOCITY_PROJECT_LINK: GuidanceLink = {
  title:
    'The Velocity Project (UW–Madison Family Medicine), "Contributors to Track and Field Running-Related Injury"',
  url: 'https://velocityproject.fammed.wisc.edu/wp-content/uploads/sites/2347/2025/05/Running-Injury-Risk-Reduction-Infographic.pdf',
  kind: 'handout',
  summary:
    'A practitioner handout adapted from a youth-running consensus statement. The weakest source linked anywhere here — and note it names a step-rate target (">166 steps/min") that the primary literature above explicitly does not support.',
}

const BRAUN_2024_LINK: GuidanceLink = {
  title:
    'Braun, Mai, Willwacher et al. 2024, "Managing lower extremity loading in distance running by altering sagittal plane trunk leaning", Journal of Sport and Health Science 14:100985',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11809138/',
  kind: 'peer-reviewed',
  summary:
    "Per degree of anterior trunk lean, cumulative hip extension loading rose 3.26 Nm·s/kg/1000 m while knee loading fell 1.08 — and the authors recommend altering trunk angle only a little either side of a runner's own self-selected one.",
}

const CARSON_2024_LINK: GuidanceLink = {
  title:
    'Carson, Aslan & Ortega 2024, "The effect of forward postural lean on running economy, kinematics, and muscle activation", PLOS ONE',
  url: 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0302249',
  kind: 'peer-reviewed',
  summary:
    'A deliberate forward lean worsened running economy by about 8%, with no meaningful difference between leaning from the ankles and from the waist.',
}

const TENG_POWERS_2016_LINK: GuidanceLink = {
  title:
    'Teng & Powers 2016, "Hip-Extensor Strength, Trunk Posture, and Use of the Knee-Extensor Muscles During Running", Journal of Athletic Training',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5317187/',
  kind: 'peer-reviewed',
  summary:
    'Hip-extensor strength explained 30.5% of the variance in trunk posture — so what looks like a posture to cue may be a strength difference.',
}

const FUKUCHI_2017_LINK: GuidanceLink = {
  title: 'Fukuchi, Fukuchi & Duarte 2017, PeerJ 5:e3298',
  url: FUKUCHI_2017_URL,
  kind: 'peer-reviewed',
  summary:
    'Peak knee flexion in 28 regular runners, stratified by speed: 93.5 ± 10.4° at 2.5 m/s, 108.7 ± 10.7° at 3.5 m/s, 119.1 ± 10.4° at 4.5 m/s — the same convention this app uses, where 0° is full extension.',
}

const HANLEY_2021_LINK: GuidanceLink = {
  title:
    'Hanley 2021, "The Biomechanics of Distance Running" (accepted manuscript)',
  url: HANLEY_2021_URL,
  kind: 'peer-reviewed-author-copy',
  summary:
    "Reports 55–60° of included thigh–shank angle at midswing for distance runners, which is 120–125° in this app's convention.",
}

const LIEBERMAN_2015_LINK: GuidanceLink = {
  title:
    'Lieberman et al. 2015, Journal of Experimental Biology 218(21):3406–3414',
  url: 'https://journals.biologists.com/jeb/article/218/21/3406/14416/',
  kind: 'peer-reviewed',
  summary:
    'Measured ankle-to-hip horizontal distance at contact as 0.31 ± 0.08 m at 75 strides/min — one of the two published measurements of this geometry, and 3.4× the other one.',
}

const SOUZA_2016_LINK: GuidanceLink = {
  title:
    'Souza 2016, "An Evidence-Based Videotaped Running Biomechanics Analysis"',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4714754/',
  kind: 'peer-reviewed',
  summary:
    "A clinical 2D protocol using exactly this app's landmarks — a vertical line up from the lateral malleolus against the pelvis — and explicitly dichotomous, with no units and no cutoff.",
}

const STIFFLER_JOACHIM_2020_LINK: GuidanceLink = {
  title:
    'Stiffler-Joachim et al. 2020, Journal of Athletic Training 55(12):1300–1306',
  url: STIFFLER_JOACHIM_2020_URL,
  kind: 'peer-reviewed',
  summary:
    'Base of gait in 166 Division-I athletes across speeds: "On average, males demonstrated crossover at 4.47 m/s (6:00-minute mile), whereas females did not demonstrate crossover at any speed", and a negative base of gait at fast speeds "may be normal in a healthy population".',
}

const WANG_2024_LINK: GuidanceLink = {
  title:
    'Wang, Mei, Jiang, Hollander, Van den Berghe, Fernandez & Gu 2024, "The Biomechanical Influence of Step Width on Typical Locomotor Activities: A Systematic Review", Sports Medicine — Open',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11283446/',
  kind: 'peer-reviewed',
  summary:
    'Systematic review: a narrower step width goes with greater hip adduction and knee internal rotation, and modelled iliotibial band strain rises as width narrows.',
}

const MEARDON_MILLER_2013_LINK: GuidanceLink = {
  title:
    'Meardon & Miller 2013, "A new approach to iliotibial band syndrome in runners", Lower Extremity Review',
  url: 'https://lermagazine.com/article/a-new-approach-to-iliotibial-band-syndrome-in-runners',
  kind: 'trade-publication',
  summary:
    "The primary researcher's own clinical write-up: widening step width reduced modelled iliotibial band strain 16–30% and strain rate 13–22%, is metabolically costlier, and pairs with gluteus medius strengthening.",
}

const LASHIEN_2024_LINK: GuidanceLink = {
  title:
    'Lashien, Abdelnaeem & Gomaa 2024, "Effect of hip abductors training on pelvic drop and knee valgus in runners with medial tibial stress syndrome", Journal of Orthopaedic Surgery and Research',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11520670/',
  kind: 'peer-reviewed',
  summary:
    'A named 8-week hip-abductor programme (pelvic drop, single-leg bridge, side-lying abduction with internal rotation, lateral step-up, banded standing abduction), 3× a week at 10-RM. The trial population had medial tibial stress syndrome, not a crossover gait.',
}

const BOVALINO_2021_LINK: GuidanceLink = {
  title: 'Bovalino & Kingsley 2021, Sports Medicine — Open 7:82',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8581084/',
  kind: 'peer-reviewed',
  summary:
    'Meta-analysis of foot-strike prevalence in distance racing: 79% rearfoot (CI 0.70–0.86) early in a race rising to 86% (0.85–0.88) at the final checkpoint, with "inconclusive evidence of a competitive advantage" for non-rearfoot.',
}

const BURKE_2021_LINK: GuidanceLink = {
  title:
    'Burke et al. 2021, "Risk Factors for Injuries in Runners: A Systematic Review of Foot Strike Technique", Orthopaedic Journal of Sports Medicine 9(9)',
  url: 'https://doras.dcu.ie/28875/1/burke-et-al-2021-risk-factors-for-injuries-in-runners-a-systematic-review-of-foot-strike-technique-and-its.pdf',
  kind: 'peer-reviewed-author-copy',
  summary:
    'Systematic review of 13 studies with GRADE applied: "There was low evidence to suggest a relationship between FST … and RRIs … these studies were very low quality." Only 1 of 7 studies using continuous measures found a significant relationship.',
}

// ---------------------------------------------------------------------------------------------
// Capture hints. Grouped by the camera angle each metric's `viewFitTable` row demands
// (`src/heuristics/types.ts`, `DEFAULT_VIEW_FIT_TABLE`), because that table — not this file — is
// what actually decides whether a metric survives on a given clip. Every one is about CAPTURE.
// ---------------------------------------------------------------------------------------------

const SIDE_VIEW_REQUIRED_HINT =
  "Film side-on, with the camera square to the runner's line of travel. This measurement reads the fore-and-aft plane, which collapses to nothing when the camera looks down it — a front or rear clip cannot produce it at any quality."

const SIDE_VIEW_PREFERRED_HINT =
  "Film side-on if you can — this reads best square to the runner's line of travel, though a front or rear clip still works at reduced confidence. Keep the runner in frame for a few seconds of steady running: the rhythm is fitted to the hip bounce and needs at least three complete bounce cycles before it will report."

const FRONT_VIEW_REQUIRED_HINT =
  'Film from directly in front of or behind the runner, square to their line of travel. This measurement reads side-to-side placement, which a side-on camera looks straight along and cannot see.'

const REAL_WORLD_SCALE_HINT =
  'It also needs the background real-world-scale pass to succeed, so keep the whole body in frame and the runner at a roughly constant distance from the camera; a clip where the runner grows or shrinks across the frame gives the scale pass nothing stable to calibrate against.'

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
        title:
          "Garmin fenix 7 / Forerunner 945 owner's manuals — running-dynamics zone table",
        url: GARMIN_FENIX_7_ZONES_URL,
        population: GARMIN_POPULATION,
        sampleSize: GARMIN_SAMPLE_SIZE,
      },
      corroboration: [
        {
          ...MALISOUX_2023_SOURCE,
          population:
            "Recreational runners at 9.9 km/h — 164 ± 9 steps/min, with a 10th–90th percentile of 152–174 (men) and 156–180 (women), which brackets Garmin's 30th–69th zone almost exactly",
        },
        {
          ...FOLLAND_2017_SOURCE,
          population:
            'Trained runners at 10–12 km/h — 166.8 ± 10.7 steps/min, with a full observed range of 144–222',
        },
      ],
      derivation: null,
      note: "Garmin's percentile methodology is not published — no sample size, no population, no protocol, no peer review. This band ships because it is a sourced external fact attributable to a named publisher and checkable by a reader, not because the method is known; the peer-reviewed distributions beside it are shown separately rather than merged into it.",
    },
    noBandReason: null,
    evidenceDirection: 'association-without-target',
    mandatoryNotes: [
      '180 steps per minute is not a target. The figure comes from Jack Daniels counting foot strikes at the 1984 Olympics — elite athletes at race pace — and the review usually cited for it never mentions 180, or any universal optimum. The strongest injury finding available is an association with no target attached: in 54 collegiate cross-country runners, each extra step per minute went with about 5% lower bone-stress-injury risk (relative risk 0.95, CI 0.91–0.98). A review of 37 studies found insufficient evidence to determine the effects of changing step rate on injury or performance at all.',
    ],
    speedSensitivity: {
      summary:
        'This app cannot measure how fast you were running, and step rate depends on which question you ask about speed.',
      withinRunner:
        'Within one runner, step rate climbs as they speed up — measured at 169.2 rising to 177.9 steps/min across 2.68 to 3.83 m/s.',
      betweenRunners:
        'Between runners each at their own preferred pace, Malisoux found step rate was NOT correlated with speed. Step LENGTH is what varies.',
    },
    research: [
      GARMIN_FENIX_7_LINK,
      MALISOUX_2023_LINK,
      FOLLAND_2017_LINK,
      SCHUBERT_2014_LINK,
      ANDERSON_2022_LINK,
    ],
    /**
     * **The last three links are `overstriding`'s, on purpose. This is design.md D8, not a
     * copy-paste error — do not "tidy" them away.**
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
      PETRI_2026_LINK,
      DAVIS_2020_LINK,
      HEIDERSCHEIT_2011_LINK,
      LENHART_2014_LINK,
      GAUDETTE_2022_LINK,
    ],
    captureHint: SIDE_VIEW_PREFERRED_HINT,
  },

  // === Rank 2 — the one band on the page that is arithmetic rather than a quotation. ===========
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
       * 1. **The percentile order runs OPPOSITE to the numeric order.** A lower vertical ratio is
       *    a higher percentile among Garmin's users. The zones are still ordered ascending by
       *    value, like every other band here.
       * 2. **The 0.0005 gaps at 0.0370→0.0375 and 0.0430→0.0435 are Garmin's, and are not
       *    closed.** Garmin publishes to one decimal place with non-contiguous bounds (6.1–7.4
       *    then 7.5–8.6) and halving preserves the discontinuity exactly. Inventing a boundary to
       *    make the table tile cleanly would be inventing exactly the kind of number this module
       *    refuses to invent, for a purely cosmetic gain. design.md D3.
       */
      zones: [
        { label: 'Above the 95th percentile', min: null, max: 0.0305 },
        { label: '70th–95th percentile', min: 0.0305, max: 0.037 },
        { label: '30th–69th percentile', min: 0.0375, max: 0.043 },
        { label: '5th–29th percentile', min: 0.0435, max: 0.0505 },
        { label: 'Below the 5th percentile', min: 0.0505, max: null },
      ],
      centralTendency: null,
      source: {
        title:
          "Garmin fenix 7 owner's manual (APAC) — vertical ratio zone table, halved",
        url: GARMIN_FENIX_7_APAC_ZONES_URL,
        population: GARMIN_POPULATION,
        sampleSize: GARMIN_SAMPLE_SIZE,
      },
      corroboration: [
        {
          ...FOLLAND_2017_SOURCE,
          title:
            'Folland et al. 2017, Medicine & Science in Sports & Exercise 49(7):1412–1423 (derived: 0.052 H pelvis oscillation ÷ 1.28 H stride length)',
          population:
            'Trained runners at 10–12 km/h. Height cancels between the two published terms, giving 4.06% per stride — inside the derived 30th–69th zone, reached by an entirely separate route with no shared assumption but the definition of a stride',
        },
      ],
      derivation: {
        statement:
          "Garmin's published vertical-ratio zones are per STEP. This app's vertical ratio is per STRIDE, and a stride is two steps — so every Garmin bound is halved before it can be laid against this app's number. Every bound halves exactly to two decimal places in percent: 6.1 → 3.05, 7.4 → 3.70, 7.5 → 3.75, 8.6 → 4.30, 8.7 → 4.35, 10.1 → 5.05. No rounding was applied and none was needed.",
        restsOn: [
          'Garmin\'s own manual defines its "stride length" verbatim as "the length of your stride from one footfall to the next" — one footfall to the NEXT is left-to-right or right-to-left, which is a step. Two cross-checks on Garmin\'s own published figures agree: at 10 km/h and 164 steps/min the distance per footfall is 1.02 m, a step rather than a stride; and Garmin\'s own chest-measured vertical oscillation bands divided by its vertical ratio bands imply a denominator of 109–113 cm, which is a step, not a ~200 cm stride.',
          "This app's denominator is a true stride, stated in its own source: `src/heuristics/strideLength.ts` pairs only same-side consecutive footstrikes, so every displacement it returns is a genuine full-stride one. `verticalRatio.ts` is that extractor's only consumer.",
        ],
      },
      note: "Unlike an absolute measurement, this ratio cancels height — both of its terms scale with stature — which is its main virtue over raw vertical oscillation. It is also why a manufacturer's table can be used here where design.md D4 refuses one for the centimetre metric: a proportional sensor error divides out of a ratio, and does not divide out of an absolute number of centimetres.",
    },
    noBandReason: null,
    evidenceDirection: 'none-established',
    mandatoryNotes: [],
    speedSensitivity: {
      summary:
        'This app cannot measure how fast you were running, and vertical ratio falls as pace rises — so a clip filmed at a jog reads worse than the same form filmed faster.',
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
    captureHint: `${SIDE_VIEW_REQUIRED_HINT} It also needs at least two footstrikes of the SAME foot to measure a stride, so film several consecutive strides rather than a single step.`,
  },

  // === Rank 3 — a paper rather than a manual, for the reason design.md D4 records. =============
  verticalOscillationCm: {
    metric: 'verticalOscillationCm',
    displayRank: 3,
    band: {
      unit: 'centimeters',
      zones: [
        {
          label: '10th–90th percentile, pooled across men and women at 10 km/h',
          min: 6.0,
          max: 9.5,
        },
      ],
      centralTendency: {
        value: 7.7,
        label:
          "Midpoint of the pooled range, and Malisoux's overall mean (77 ± 12 mm)",
      },
      source: MALISOUX_2023_SOURCE,
      corroboration: [
        {
          ...HEIDERSCHEIT_2011_SOURCE,
          population:
            'Healthy recreational runners at 2.9 m/s — 8.7 ± 1.3 cm of centre-of-mass excursion, falling to 7.3 cm at a 10% higher step rate',
        },
      ],
      derivation: null,
      note: 'Two things this band cannot escape. It is an ABSOLUTE measurement in centimetres, with no denominator, so it penalises tall runners: a taller body bounces further for the same proportional movement, and this range does not adjust for that. And Garmin publishes vertical-oscillation bands in centimetres that are deliberately NOT used here — Garmin devices were measured reading roughly 1.3–1.5 cm high against a video reference, and their sensor sits on the chest or waist rather than at the centre of mass, which sees more travel again. Malisoux measures what this app computes: centre of mass, peak to peak, per step.',
    },
    noBandReason: null,
    evidenceDirection: 'association-without-target',
    mandatoryNotes: [
      'This range is in absolute centimetres over a population whose heights are not controlled for, so it reads high against a tall runner and low against a short one for reasons that have nothing to do with how they run.',
    ],
    speedSensitivity: {
      summary:
        'This app cannot measure how fast you were running, and vertical oscillation depends on which question you ask about speed.',
      withinRunner:
        'Within one runner, vertical oscillation falls as they speed up.',
      betweenRunners:
        'Between runners each at their own preferred pace, Malisoux found essentially no relationship with speed (p = .074).',
    },
    research: [
      MALISOUX_2023_LINK,
      SMITH_2022_LINK,
      HEIDERSCHEIT_2011_LINK,
      MOORE_2016_LINK,
    ],
    remediation: [ADAMS_2018_LINK, MOORE_2016_LINK, VELOCITY_PROJECT_LINK],
    captureHint: `${SIDE_VIEW_PREFERRED_HINT} ${REAL_WORLD_SCALE_HINT}`,
  },

  // === Rank 4 — a spread with no preferred end, because four outcomes disagree. ================
  trunkLean: {
    metric: 'trunkLean',
    displayRank: 4,
    band: {
      unit: 'degrees',
      zones: [
        { label: 'Full range observed across the cohort', min: 1.8, max: 21.4 },
      ],
      centralTendency: {
        value: 10.3,
        label: 'Mean forward lean (10.3 ± 3.7°)',
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
      'There is no defensible target for trunk lean, and this range carries no preferred end: four measured outcomes point in different directions at once. Knee load FALLS with forward lean. Hip and lumbar load RISE about three times as fast as knee load falls — per degree of anterior lean, cumulative hip extension loading rose 3.26 Nm·s/kg/1000 m against the knee\'s 1.08 fall. Impact loading rate rose 29% and impact transients 20% with greater trunk flexion. And performance points the other way again: a more upright, extended trunk correlated with better running performance. The authors of the loading study recommend altering trunk angle "only to an extent that is not too far from the individual\'s self-selected trunk angle" — that is, no target angle at all.',
    ],
    // Deliberately null, and specifically NOT a claim that trunk lean is speed-invariant: the
    // research pass found no speed dependence stated for it, which is an absence of evidence.
    // The spec requires the speed caveat to stay off where nothing was established, so that it
    // keeps meaning something on the four metrics where something was.
    speedSensitivity: null,
    research: [FOLLAND_2017_LINK, BRAUN_2024_LINK, CARSON_2024_LINK],
    remediation: [BRAUN_2024_LINK, TENG_POWERS_2016_LINK, CARSON_2024_LINK],
    captureHint: SIDE_VIEW_REQUIRED_HINT,
  },

  // === Rank 5 — the most speed-sensitive band in the set, and deliberately the widest. =========
  kneeFlexion: {
    metric: 'kneeFlexion',
    displayRank: 5,
    band: {
      unit: 'degrees',
      zones: [
        {
          label:
            'Pooled across running speeds and across two measurement conventions',
          min: 85,
          max: 125,
        },
      ],
      centralTendency: null,
      source: {
        title: 'Fukuchi, Fukuchi & Duarte 2017, PeerJ 5:e3298',
        url: FUKUCHI_2017_URL,
        population:
          'Regular runners at 2.5, 3.5 and 4.5 m/s — 93.5 ± 10.4°, 108.7 ± 10.7° and 119.1 ± 10.4° respectively, in the same convention this app uses, where 0° is full extension',
        sampleSize: '28',
      },
      corroboration: [
        {
          title: 'Hanley 2021, "The Biomechanics of Distance Running"',
          url: HANLEY_2021_URL,
          population:
            "Distance runners at midswing — 55–60° of included thigh–shank angle, which is 120–125° in this app's convention",
          sampleSize: 'Book chapter; the cohort is not restated',
        },
        {
          ...FOLLAND_2017_SOURCE,
          population:
            'Trained runners at 10–12 km/h — 94.1 ± 11.1° of swing knee flexion, with a full observed range of 71–129°',
        },
      ],
      derivation: null,
      note: 'The band is deliberately wide because it spans a speed range rather than pretending to a precision the input does not support: the published means at 2.5 and 4.5 m/s sit about two and a half standard deviations apart, and this app cannot tell which of those a clip was filmed at. Two honest gaps go with it. Fukuchi does not state whether its maximum is a swing or a stance peak; stance peak is around 45° in comparable cohorts, so 93–119° must be swing — an inference, not the paper\'s claim. And Novacheck 1998, to which the ubiquitous "125° at midswing" figure is attributed everywhere, could not be retrieved and is not cited.',
    },
    noBandReason: null,
    evidenceDirection: 'none-established',
    mandatoryNotes: [],
    speedSensitivity: {
      summary:
        'This app cannot measure how fast you were running, and this is the most speed-sensitive measurement it makes — roughly 13° more knee flexion for every extra 1 m/s.',
      withinRunner:
        'The same runners measured at 2.5, 3.5 and 4.5 m/s flexed 93.5°, 108.7° and 119.1° — about +13° per 1 m/s, and the slowest and fastest means are about two and a half standard deviations apart.',
      betweenRunners: null,
    },
    research: [FUKUCHI_2017_LINK, HANLEY_2021_LINK, FOLLAND_2017_LINK],
    // Nothing in the research pass reports an intervention on swing knee flexion.
    remediation: [],
    captureHint: SIDE_VIEW_REQUIRED_HINT,
  },

  // === Ranks 6–12: no band. Each renders its value, its description, its caveats and its =======
  // === links; only the SCALE is withheld. The order follows design.md D5's own sections. =======

  overstriding: {
    metric: 'overstriding',
    displayRank: 6,
    band: null,
    noBandReason:
      'No published study normalises foot-to-hip horizontal distance by TORSO LENGTH, which is the unit this app reports it in — a targeted search for that combination returned nothing relevant. And there is no threshold in any other unit either: the most recent review states plainly that "there is currently no consensus on what qualifies as excessive overstriding", and the clinical 2D protocol that uses exactly this app\'s landmarks is explicitly a yes/no judgement with no units and no cutoff. Halving the gap between the two published measurements to manufacture a range would be picking a number and calling it research.',
    evidenceDirection: 'association-without-target',
    mandatoryNotes: [
      'The two published absolute measurements of this same geometry disagree by 3.4×: 9.2 ± 4.0 cm of centre-of-mass-to-heel distance at contact in one study, against 0.31 ± 0.08 m of ankle-to-hip distance in the other — roughly 0.18 against 0.62 torso lengths. Neither paper defines its computation precisely enough to reconcile them, so neither is offered here as a reference point.',
      'The only defensible statement about overstriding is a relative one, and this is it: raising step rate by 10% was measured moving foot-to-centre-of-mass distance from 9.2 cm to 7.0 cm, a 24% reduction. That is a change within one runner under an intervention, not a range a population falls in — which is why the intervention links for this metric also appear on the cadence card.',
    ],
    speedSensitivity: null,
    research: [HEIDERSCHEIT_2011_LINK, LIEBERMAN_2015_LINK, SOUZA_2016_LINK],
    remediation: [
      HEIDERSCHEIT_2011_LINK,
      LENHART_2014_LINK,
      GAUDETTE_2022_LINK,
    ],
    captureHint: SIDE_VIEW_REQUIRED_HINT,
  },

  verticalOscillation: {
    metric: 'verticalOscillation',
    displayRank: 7,
    band: null,
    // The closest call in the set, and the one place a band was REACHABLE and was refused on the
    // quality of the derivation rather than on its absence. design.md D5.2.
    noBandReason:
      'A band is arithmetically reachable for this metric and is deliberately not shipped. Dividing Folland\'s height-normalised pelvis oscillation (0.052 H) by a textbook torso fraction (0.288 H) gives about 0.18 torso lengths, and this repo\'s own readings land inside it — which is precisely the seduction. The derivation passes through two unresolved steps, either of which moves the answer: a textbook anthropometric constant standing in for a measured torso length, and an unstated per-step versus per-stride convention in the published pelvis figure. The vertical-ratio band survives a similar halving because each leg of it rests on a STATED definition; this one rests on an assumed constant and an unstated convention, and "our own footage lands inside it" is corroboration only if the band was not built to contain it. Its centimetre and ratio siblings carry bands instead, so the vertical-oscillation family is not left silent.',
    evidenceDirection: 'association-without-target',
    mandatoryNotes: [],
    speedSensitivity: null,
    research: [FOLLAND_2017_LINK, MALISOUX_2023_LINK, MOORE_2016_LINK],
    remediation: [ADAMS_2018_LINK, MOORE_2016_LINK, VELOCITY_PROJECT_LINK],
    captureHint: SIDE_VIEW_PREFERRED_HINT,
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
      'The link between a narrow step width and injury is modelling-only, in uninjured runners; no prospective study was found, and the two primary crossover papers could not be retrieved and are therefore not cited. One retrospective study points the other way entirely — runners who had sprained an ankle ran 1.5 ± 0.7 cm WIDER. The widely-repeated claim that narrow step width causes tibial stress fractures rests on a documented citation error: the study it cites (1065 Royal Marines) never measured step width at all, and its actual predictors were bimalleolar width, BMI, peak heel pressure and tibial rotation. An ankle DIMENSION has been conflated with a gait VARIABLE downstream.',
    ],
    speedSensitivity: {
      summary:
        'This app cannot measure how fast you were running, and the speed effect on step width is as large as the whole measurement.',
      withinRunner:
        'Against a 2.68 m/s reference, base of gait shifted −0.353 cm at 2.95 m/s and −1.442 cm at 4.47 m/s. A fixed threshold in a speed-blind app would label fast runners as crossing over purely for being fast.',
      betweenRunners:
        'Pelvis width matters and height does not: −0.31 cm per extra 1 cm of ASIS width, with height explicitly unrelated (p = .857).',
    },
    research: [STIFFLER_JOACHIM_2020_LINK, WANG_2024_LINK],
    remediation: [WANG_2024_LINK, MEARDON_MILLER_2013_LINK, LASHIEN_2024_LINK],
    captureHint: FRONT_VIEW_REQUIRED_HINT,
  },

  stepWidthCm: {
    metric: 'stepWidthCm',
    displayRank: 9,
    band: null,
    noBandReason:
      'The literature carries three incompatible definitions of step width, differing by about 2× and by sign, and only one of them — "base of gait" — matches the sign convention this app uses; even that one samples at midstance where this app samples at footstrike. No published target range in centimetres exists; it was searched for specifically. For scale rather than as a band, two figures: a foot-to-foot measurement of 3.61 ± 2.56 cm (about 1.8 cm in this app\'s convention), and a model intercept of 1.358 cm (CI 0.968–1.747). The "normal step width is 8–10 cm" figure in wide circulation traces to a non-peer-reviewed page and describes walking, not running.',
    evidenceDirection: 'contested',
    mandatoryNotes: [
      'A negative value is not a defect. Crossover is normal at speed: in 166 Division-I athletes, "On average, males demonstrated crossover at 4.47 m/s (6:00-minute mile), whereas females did not demonstrate crossover at any speed", and the authors note that a negative base of gait at fast speeds "may be normal in a healthy population".',
      'The link between a narrow step width and injury is modelling-only, in uninjured runners; no prospective study was found, and the two primary crossover papers could not be retrieved and are therefore not cited. One retrospective study points the other way entirely — runners who had sprained an ankle ran 1.5 ± 0.7 cm WIDER. The widely-repeated claim that narrow step width causes tibial stress fractures rests on a documented citation error: the study it cites (1065 Royal Marines) never measured step width at all, and its actual predictors were bimalleolar width, BMI, peak heel pressure and tibial rotation. An ankle DIMENSION has been conflated with a gait VARIABLE downstream.',
    ],
    speedSensitivity: {
      summary:
        'This app cannot measure how fast you were running, and the speed effect on step width is as large as the whole measurement.',
      withinRunner:
        'Against a 2.68 m/s reference, base of gait shifted −0.353 cm at 2.95 m/s and −1.442 cm at 4.47 m/s. A fixed centimetre threshold in a speed-blind app would label fast runners as crossing over purely for being fast.',
      betweenRunners:
        'Pelvis width matters and height does not: −0.31 cm per extra 1 cm of ASIS width, with height explicitly unrelated (p = .857).',
    },
    research: [STIFFLER_JOACHIM_2020_LINK, WANG_2024_LINK],
    remediation: [WANG_2024_LINK, MEARDON_MILLER_2013_LINK, LASHIEN_2024_LINK],
    captureHint: `${FRONT_VIEW_REQUIRED_HINT} ${REAL_WORLD_SCALE_HINT}`,
  },

  footStrikePattern: {
    metric: 'footStrikePattern',
    displayRank: 10,
    band: null,
    noBandReason:
      'This metric reports a classification, and what the literature publishes for it is a prevalence rather than a range: how many distance runners land each way, not a value to compare a number against. No reference range exists for the underlying ankle-relative-to-knee offset this app measures the classification from.',
    evidenceDirection: 'redistribution-not-improvement',
    mandatoryNotes: [
      'About 8 in 10 distance runners are rearfoot strikers. A meta-analysis of distance racing found 79% rearfoot early in a race (CI 0.70–0.86), rising to 86% at the final checkpoint (0.85–0.88) — prevalence goes UP with distance, not down — and reported inconclusive evidence of any competitive advantage for landing otherwise.',
      'No valence attaches to any of the three patterns here, and that is a finding rather than a hedge. A systematic review of 13 studies with GRADE applied concluded there was "low evidence to suggest a relationship between foot strike technique and running-related injuries", and that the studies were of very low quality; only 1 of the 7 using continuous measures found a significant relationship. Mechanically the difference is a redistribution rather than an improvement: landing rearfoot raises patellofemoral load and vertical loading rate, landing forefoot raises Achilles and soleus load.',
    ],
    speedSensitivity: null,
    research: [BOVALINO_2021_LINK, BURKE_2021_LINK],
    // Deliberately empty, and this emptiness is the finding: with the injury link rated low
    // evidence and the mechanical difference a redistribution, there is nothing to remediate
    // TOWARD. Offering a retraining protocol here would assert exactly what the best available
    // systematic review declines to.
    remediation: [],
    captureHint: SIDE_VIEW_REQUIRED_HINT,
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
    captureHint: SIDE_VIEW_REQUIRED_HINT,
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
    captureHint: FRONT_VIEW_REQUIRED_HINT,
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

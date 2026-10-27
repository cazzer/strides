# PRD — Runner-led results: a tour of your stride, then a summary

Status: draft for review (2026-10-27, produced by /jam under /drive). Beads epics: see "Epic
structure" at the end.

## Problem

Strides measures 13 things about a stride and shows them as cards: a number, a cited band where one
exists, a citation, a disclosure. It is accurate and honest, but it reads as **a list of what the
pipeline could compute**, not as **what this runner should take away**. A runner finishing an
analysis wants three answers, in this order:

1. *What does my stride look like?* (a picture, not 13 numbers)
2. *Is anything worth changing, and why?* (one or two points, with the consequence)
3. *What would I do about it?* (one cue)

The current page answers 1 with a 2D replay of detected keypoints that is view-locked (side clips
can't show step width; front clips can't show trunk lean), loops with a visible seam, and on phones
is a 64 px thumbnail. It answers 2 and 3 only for the four metrics that carry a `Try:` line, and
only after the reader has worked through the band, the citation and the description. Earlier user
feedback on this page was "significantly too verbose".

Who: recreational runners filming themselves on a phone. Most will look at the result once, on that
phone.

## Proposed solution

**A wireframe runner built from your numbers is the page.** Words annotate it.

### 1. Your runner (intro, ~4 s, skippable)

When analysis completes, a grey, dashed model runner appears on a treadmill-like line. Your
measurements are applied to it one at a time: cadence sets its rhythm, bounce sets its hip
travel, lean tilts its torso, and so on. Each one shows its number for a moment as it locks in. The
dashes become solid only where a measurement was applied. The result is a runner that moves with
your rhythm, your bounce and your posture, and is never presented as a target. This is the "slowly
adopts the person's gait" beat.

### 2. The tour (default after analysis)

The page scrolls through **focus areas**. The runner stays on screen, running continuously. At each
stop the camera turns and zooms to the body part in question:

| # | Focus area | Camera | Metrics behind it |
|---|---|---|---|
| 1 | Rhythm & bounce | side, whole body, true tempo | cadence, verticalRatio, verticalOscillationCm, verticalOscillation |
| 2 | Arms | front ¾, upper body | armSwingAmplitude |
| 3 | Posture | side, torso | trunkLean |
| 4 | Knees | side, hips to feet | kneeDrive, kneeFlexion |
| 5 | Landing | side, shin and foot, slow motion | overstriding, footStrikePattern |
| 6 | Foot path | front, feet, slow motion | stepWidth / stepWidthCm, swingFootLateralExcursion |
| 7 | Your one thing | whole body | at most one cue, or "nothing here calls for a change" |

Every stop shows the same four things, and only these:

- **The value**, as one number on the runner (the angle drawn as an arc on the torso, the bounce as
  a bracket on the hip path). The picture carries the measurement and the number labels it.
- **Where you sit among runners**: the existing compact cited band, only where a band is cited. No
  band means no scale, as today.
- **Why it matters**: one line, cited, worded to the strength of the evidence ("linked with", not
  "causes").
- **Try**: one cue, only where an intervention has evidence *and* the value is on the side the cue
  addresses (the existing `tryLineApplies` rule). Otherwise the stop says what is **not** worth
  changing where the evidence supports that. For foot strike: "Most runners land heel-first. No
  evidence says to change it."

A stop with nothing measured is skipped. The final stop lists which areas went unmeasured and the one
capture that would fill them (for example "add a front-view clip"). A **Skip to summary** control is
visible throughout the tour.

### 3. The summary (standard view)

The summary shows the runner (smaller, still running) beside one row per focus area, each row with
its headline number. A row expands to the existing per-metric depth: the band, the citation, the
methodology disclosure, and the **inline evidence frame**, which is the real footage with the
detected skeleton drawn on it. That frame stays the truth anchor for everything the model runner
shows. Expanding a row points the runner's camera at that area. The summary also offers "Replay
tour".

### 4. Phones

On a phone the runner fills the viewport as a **fixed background**, and the stops are
semi-transparent panels that scroll over it. Panels have opaque enough backgrounds for AA contrast;
the runner shows through the margins and between panels. A pause control is always visible inline.
With reduced motion, the runner holds one still pose per stop and the camera cuts instead of moving.

## Why a model runner rather than a replay of the footage

This is the load-bearing decision, so it gets a section.

- **Only a model can reorient.** The data is 2D and monocular, and MediaPipe world landmarks are
  dropped after scale (`mediapipePoseLandmarker.ts:116-150`). A replay can't turn to the front to
  show step width.
- **Only a model can unify clips.** Fusion picks a winning clip per metric (`fuseHeuristics.ts:180`).
  Trunk lean comes from a side clip and step width from a front clip, so no single replay contains
  both. One model runner can show both.
- **Only a model loops cleanly.** The replay's loop seam isn't phase-aligned and is hidden by a fade.
  The pipeline also discards gait phase (`VerticalOscillationFit` keeps no phase or tMean).
- **Nearly every metric maps to one degree of freedom.** Cadence maps to cycle rate, bounce to pelvis
  amplitude, trunk lean to torso pitch, kneeDrive to peak thigh angle, kneeFlexion to peak swing
  knee bend, overstriding to the foot's landing offset ahead of the hip, footStrikePattern to ankle
  angle at contact, armSwingAmplitude to arm amplitude, stepWidth to lateral placement, and
  swingFootLateralExcursion to the swing-foot arc.

**Honesty rules for the model** (spec-level, the same spirit as "a band is cited or it doesn't ship"):

1. Every degree of freedom is either **bound to exactly one measured value** or held at a fixed,
   documented neutral constant.
2. A neutral part is drawn **dashed grey**. Only measured parts are solid. At a stop, the focus
   area's measured part is accented and carries its number.
3. The neutral constants are never shown as targets, and no ghost "ideal" runner is ever drawn
   alongside. Label: "Model built from your numbers", never "your body".
4. The model shows each measurement as one fixed setting. Strides has no per-side values and no
   per-stride spread, so the model never draws left/right asymmetry or variability.
5. The real footage is one tap away in the summary, as the evidence frame.

## Success criteria

- [ ] A runner who has never seen Strides can say their one takeaway after the tour, without opening
      a disclosure. Check: a hallway test with 3 people, and the user's own review.
- [ ] The tour has ≤ 7 stops and ≤ 25 visible words per stop, excluding the number and the citation
      line. Pinned by a test, as the current word budgets are.
- [ ] Every "why it matters" and "Try" line has a verified URL that states it. Pinned the same way
      `metricGuidance.test.ts` pins links today.
- [ ] Each measured metric's value is visibly applied to the model: a test drives parameters to their
      extremes and asserts joint geometry changes.
- [ ] **Measurements are bit-identical** with the tour mounted vs `?view=classic`, on all three
      `--evidence` clips, by the A/B driver (all fields except `elapsedMs`).
- [ ] 390 px phone width: no horizontal scroll, AA text contrast over the runner, inline pause,
      reduced-motion still frames.
- [ ] Skip works from any stop. Skipping once makes the summary the landing view next time (per-viewer
      `localStorage`, wrapped in try/catch).

## Scope

### In scope
- The parametric wireframe runner: a pure kinematics model, parameter binding from fused results, an
  orthographic camera (yaw and zoom), an SVG renderer, the intro, reduced motion, and pausing when
  hidden or offscreen.
- The focus-area taxonomy and a feedback content layer: one impact line and one cue per area, cited,
  with the selection rule for the "one thing".
- The tour view (desktop with a sticky runner; phone with the runner as background).
- The summary view: focus-area rows that expand to the existing card depth and evidence.
- View routing: `?view=tour|summary|classic`, a skip control, a remembered landing view, and
  `role="status"` "Analysis complete." in every view.
- The model runner replaces `MotionStoryStage` as the page's stage. Bugs `strides-au2` and
  `strides-v2d` are superseded or closed by it.

### Out of scope
- **New cited bands** for currently unbanded metrics. Research found one usable source, Larson 2011
  (categorical foot-strike prevalence, n=936), but `strides-2po` (the foot-strike proxy disagrees
  with itself) must be fixed before we tell anyone "you're in the 89%". Filed as a follow-up.
- Per-side or asymmetry display. The data doesn't exist yet.
- Hip drop (the strongest injury discriminator in Bramah 2018). It isn't measured. Follow-up.
- Any score, grade or composite. This is forbidden by the spec's "never where they should be" rule.
- Changing any measurement, threshold or evidence planning.
- Deleting the classic view. It stays reachable at `?view=classic`, used by the harness and power
  users.

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runner source | Parametric model bound to measured values | Only option that can reorient, unify clips, and loop cleanly (section above) |
| Rendering | Hand-rolled 3D→2D orthographic projection in SVG, no new dependency | ~20 joints. three.js would cost ~150 kB for a stick figure. SVG strokes stay crisp at any zoom |
| Neutral constants | Fixed, documented, drawn dashed, never a target | Avoids `strides-v2d`'s "reads as target posture" failure |
| Stop order | Whole body first, then head to toe, then the one thing | The user's brief; also matches how attention moves down a body |
| What counts as feedback | Existing `tryLineApplies` rule; non-points where evidence says "don't change" | Keeps the no-grading rule; research shows foot strike and preferred step width are not things to change |
| "One thing" | The applicable cue with the strongest evidence. Order: cadence (RCTs: Willy 2016, Heiderscheit 2011) > landing/overstride (Lieberman 2015, via step rate) > bounce > others. None applicable gives "No studied change to try for these readings." | Coaching convention: one cue at a time, external focus (Schücker 2009). Every trial found changed one variable |
| Knee drive | Never cued "lift your knees". Described only | Folland 2017: more swing hip flexion correlated with *worse* economy |
| Tempo | True tempo at Rhythm & bounce; labelled slow motion at Landing and Foot path | Feeling the cadence *is* the cadence feedback; contact is too fast to read at 1× |
| Default view | Tour on first analysis; summary once the reader has skipped | Low friction for returning users. Reversible |
| Classic view | Kept at `?view=classic`, linked from the summary footer | Harness depends on it; retiring it isn't needed for this value |
| Stage | The model runner replaces `MotionStoryStage` in tour and summary; classic keeps the detected replay | One stage per view. Real pixels and skeleton remain in the evidence frames |
| Spec | New capability `runner-tour`. Guided "Guided is the default" is REMOVED and re-ADDED as the tour default | Per CLAUDE.md, a reversal is REMOVE + ADD, not MODIFIED |

## Open questions
- [ ] **User call:** is "the model runner replaces the detected replay in tour and summary" acceptable?
      The detected replay is the most literal picture of the runner. The plan keeps it in classic and
      in every evidence frame.
- [ ] **User call:** should "Your one thing" ever name a cue for a value *inside* the cited band? The
      plan says no.
- [ ] The kneeFlexion band domain. The research flags Folland's 71.3–129° as a contact-phase angle,
      while Strides' `kneeFlexion` is described as swing knee bend. To verify before the model shows
      it against that band (follow-up bead, not blocking).
- [ ] Neutral constants: where does each come from? Proposed: a documented illustrative constant with
      no claim attached, and never the band midpoint, which would read as "typical = target".

## Dependencies
- Archive the two implemented but unarchived openspec changes (`add-motion-story-stage`,
  `add-swing-foot-lateral-excursion`; `strides-t1e`) **before** the new change's deltas are written
  against `openspec/specs/`.
- The fused results, clips and evidence already owned by `MultiClipVideoSession.tsx`.

## Risks
| Risk | L | I | Mitigation |
|---|---|---|---|
| Animation on the main thread steals frames from the post-completion scale pass (playback path) and moves VO_cm/stepWidthCm | M | H | A/B bit-identical gate. If it fails, hold the runner still until the scale pass reports, then animate |
| The model reads as "your body" when half its parts are neutral | M | M | Dashed neutral parts, the label, and the parameters applied one by one in the intro |
| The tour becomes a slideshow nobody finishes | M | M | ≤ 7 stops, skip always visible, the summary carries the same content |
| Contrast over a moving background on phones | M | M | Panel opacity ≥ 0.85, measured with a contrast test like `scalePalette.test.ts` |
| Mobile perf (S21 epic `strides-6i6`) | M | M | Pause when hidden or offscreen; rAF capped at 30 fps; SVG with ~40 primitives |
| Copy drifts verbose again | H | M | Word-budget tests per stop |

## Epic structure (beads)

1. **Prep** (task): archive the two in-flight changes and fix the stale MetricId counts
   (`strides-t1e`). Blocks everything that writes spec deltas.
2. **Epic A: Model runner** (`src/runner/`): pure gait kinematics, parameter binding from
   fused results, camera presets, SVG renderer, the intro beat, reduced motion, pause-when-hidden, and
   the perf/A-B gate.
3. **Epic B: Results tour and summary**:
   - B1, focus-area taxonomy + feedback content layer (pure data, cited, budget tests).
     Parallel with A.
   - B2, tour view, desktop.
   - B3, tour on phones (background runner, translucent panels).
   - B4, summary view with expandable rows reusing the card depth and evidence.
   - B5, view routing, skip and remembered landing.
   - B6, live verification on all clips, A/B gate, the agent note, and the openspec archive.
4. **Follow-ups** (not in this drive): the categorical foot-strike band (Larson 2011) after
   `strides-2po`; the kneeFlexion band-domain check; a hip drop metric.

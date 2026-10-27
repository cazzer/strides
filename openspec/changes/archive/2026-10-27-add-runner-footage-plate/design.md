## Context

The model runner (`src/runner/ModelRunner.tsx`) renders one SVG and moves it with one rAF loop that
writes attributes from refs (`drawRef`), so animation never re-renders React. A still figure stands
at the first annotated limb parameter's key leg phase (`planAnnotations`). The session extracts
each metric's evidence once (`useSessionEvidence`) into canvases the summary's cards mount; the
tour mounts no card. Evidence plans (`EvidenceFramePlan`) carry the base instant's keypoints in
native video pixels, the square crop, the per-instant measured side and the clip-wide travel
direction.

Honesty rules (`docs/prd/runner-led-results.md`, `docs/agent-notes/runner-tour.md`): the figure is
built from the reader's numbers, neutral constants are never targets, and no ghost "ideal" runner is
drawn. The plate must read as the reader's own footage, never as a target or a second figure.

## Goals / Non-Goals

**Goals:**
- Show the headline metric's evidence image (its measured moment, with a paired metric's fainter
  second moment ghosted over it) faintly behind a still side-stop figure in the tour
  and the summary, aligned closely enough that the two legs can be compared.
- Keep the plate honest: placed, never reshaped, so a difference between footage and model stays
  visible.
- No new loop, no per-frame React render, no measurement change.

**Non-Goals:**
- A mark-free source image (the evidence canvas has its annotation marks baked in; a clean copy
  needs an extraction change).
- Foot-strike plates (no hip in its frame), posture and rhythm plates (no key leg phase).
- Front views, or a plate while the figure plays.

## Decisions

Six were open in the plan and resolved by the orchestrator before implementation:

1. **Still means React-level `!playing` only.** The landing loop's contact holds (300 ms and
   150 ms) are shorter than the fade, so a plate shown on them would flicker. The plate shows only
   when the reader has paused, or under reduced motion before play.
2. **Foot strike gets no plate.** Its frame names ankle, knee, heel and toe but no hip, and the fit
   is hip-anchored. Threading `robustFrames` to recover a hip is out of scope (follow-up bead).
3. **Pausing with a limb focus snaps the figure to its key phase**, extending the landing camera's
   rule to every non-beat focus with a key leg phase. Without it a paused knee-flexion figure stood
   at an arbitrary phase with its arc floating off the knee, and the plate could never show.
   Cadence (`beat`) pauses where it is, since its beat reads at any phase. The snap reaches every
   stop with a keyed limb focus, not only the plate's: knees and landing, and also the front Foot
   path stop (`stepWidth` keyed at contact, `swingFootArc` at mid-arc), which pauses on its key
   phase now too. Posture, arms and rhythm have no keyed focus and are unchanged.
4. **Posture and rhythm are excluded**: no key leg phase, so no measured moment matches the figure.
5. **Baked-in marks are accepted.** The copy carries the evidence annotation marks at 0.26 opacity,
   greyscale since round 1 (D9). Where they were clutter (a magnified small subject) the clutter
   cap (D10) withholds the plate instead.
6. **Fade 240 ms, opacity 0.26, no transition under reduced motion, hidden under forced colours.**
   0.26 matches the motion story's ghost (`.motion-story__ghost`). Since round 1 it fades in on its
   first appearance too (D11).
7. **The plate is the evidence IMAGE, ghosting included (review round 1).** For a paired metric the
   card's picture is the measured (base) moment at 65% with a second moment ghosted over it at 35%
   (`EVIDENCE_GHOST_BLEND_ALPHA`); the plate copies that picture as it is. The reader asked for the
   evidence ghosting in the runner, so it is kept, not gated on `ghost === null`. What changed is
   every claim about it: the fit is read from the base moment's joints only, and the words say
   "evidence image of the measured moment, with a fainter second moment over it", never "the
   measured instant" (design, spec deltas, PRD rule 5, `runner-tour.md`, the text alternative and
   the visible legend line).

Implementation decisions:

- **D1. Pure adapter in `src/results`, pure fit in `src/runner`.** `runnerFootageFor` applies every
  gate that does not depend on the drawn figure (plate metric, side camera preset, the winning
  clip's raw `View` is `'side'`, travel direction known, a hip present, measured side resolvable)
  and converts the base instant's keypoints into the image's unit square
  (`u = (x − crop.x) / crop.side`). `fitFootagePlate` is runner-local and imports only pose and
  runner types, keeping the runner core free of results imports.
- **D2. Hip-anchored, scale from segment lengths, not least squares.** Least squares over the joints
  turns an angle difference into scale and translation that hide it. Pinning hip-mid to hip-mid and
  taking scale as Σ model / Σ footage over hip-mid → knee → ankle (hip-mid → ankle without a knee;
  feet excluded) leaves a different knee angle exactly as different as it is. Mirror is
  `travelDirection === −1` (the model always travels screen-right); 0 is indeterminate and gets no
  plate. The measured side's joints map onto the model's held (near) leg, the other side's onto the
  other leg.
- **D3. Side gate on the raw view, not the label.** `clipViewKinds` is added beside `clipViews` in
  `MultiClipVideoSession` and `ResultsViewProps`; `'ambiguous'` and unknown are not side.
- **D4. One more target in `drawRef`, no loop changes.** The `<image>` is the svg's first child,
  laid on the unit square (`x=0 y=0 width=1 height=1`, `preserveAspectRatio="none"`); the loop
  writes `transform="matrix(a 0 0 d e f)"` in viewBox units from the projected pose it already
  builds (after the still lift, with the live camera), and sets `data-shown` only when still, at
  the held phase, with no camera or value tween. Hidden, it stops writing the transform, so it
  never slides during the fade-out. Pause → play re-renders and the layout effect's draw hides it
  in the same commit. `wants()` is unchanged: a still figure with no tween runs no frames.
- **D5. Second guard in the renderer.** The footage metric's key leg phase on the held leg must
  equal the scene's held phase, so a focus whose first keyed parameter differs from the footage's
  metric never shows the plate.
- **D6. Pixels copied, never adopted.** The summary's card owns the evidence canvas (an element
  has one parent). The runner calls `canvas.toBlob` once per source canvas, only while still, wraps
  it in `try/catch` (a canvas that cannot be read back: no plate), and revokes the URL when the
  source changes or the runner unmounts. The `<image>` is rendered only for the current source's
  copy, and stays mounted while playing so the fade-out runs.
- **D7. CSS through Tailwind variants.** `opacity-0 transition-opacity duration-[240ms] ease-in-out
  data-[shown]:opacity-[0.26] motion-reduce:transition-none forced-colors:hidden`; all generated by
  Tailwind 4 (checked in the built CSS), so no `index.css` fallback was needed. The plate inherits
  the svg's `aria-hidden`; no new `data-runner-part` hook (those are pinned by
  `runnerPhoneStructure.test.tsx`).

Review round 1:

- **D8. Say what the faint picture is, visibly and in text, only when it is drawn.** The legend
  row (the hidden-from-AT `p` beside Play) gains one line while the plate is on offer: "Faint photo:
  your clip, not a target", plus " · flipped" when mirrored, in the legend's own register. Measured
  live: one line (240 px) at 1280; within the row's note chip at 390×844; two lines inside the
  14rem chip on a 375×667 short phone, no overflow. The text alternative gets the full sentence:
  the metric, "evidence image", "the measured moment", "with a fainter second moment over it" when
  the image is ghosted, "flipped to face the way the model runs" when mirrored, "Your footage, not a
  target." Both follow `plateShown`, which runs the same placement the loop draws (held phase,
  still lift, target camera, static values) at render, so neither names a picture the fit or the
  cap refuses; and neither shows under forced colours (`useForcedColors`), where the image is
  `display: none`. During a camera tween the words stay while the loop hides the picture until the
  camera rests (≤ 600 ms): they describe the frame it rests on.
- **D9. Greyscale.** `grayscale` on the `<image>` (CSS `filter` applies to SVG `<image>` in
  Chromium: computed `grayscale(1)` live), so the baked cyan and amber marks never read as a second
  accented limb beside the figure's cyan focus limb.
- **D10. A clutter cap on magnification, `MAX_PLATE_SIDE_IN_FRAME_WIDTHS = 2.5`.** Measure: the
  placed image's side in drawing widths, `|a| / (2 × CAMERA_FRAME_HALF_WIDTH)` (viewBox units, so
  independent of the screen size; the drawing is `meet`-fitted). Measured on the three live cases:

  | case | `|a|` (viewBox) | drawing widths | live verdict |
  |---|---|---|---|
  | side-landscape knee flexion (640 px canvas) | 4.64–4.84 | 1.55–1.61 | readable |
  | side-portrait knee flexion (320 px canvas) | 4.93 | 1.64 | readable |
  | side-portrait overstriding (640 px canvas, far-apart pair) | 12.54 | 4.18 | cluttered |

  The two readable cases sit within 6% of each other and 2.5× below the cluttered one; 2.5 is about
  their geometric mean (2.62), rounded down. The alternative measure, evidence-canvas pixels per
  screen pixel, did NOT separate them: portrait knees' small 320 px canvas is already magnified
  0.0154·P against the cluttered case's 0.0196·P (P = screen px per viewBox unit), so it was not
  used. Live after the cap: portrait landing shows no plate, label or note (tour and summary);
  both knee plates unchanged. Three cases is thin evidence: the cap is a picture-legibility
  threshold, not a measurement, and should be re-read if new clips land near it.
- **D11. Fade in on the first appearance.** The copy mounts the `<image>` already marked shown, so
  there was no "from" style. `starting:opacity-0!` (`@starting-style`, important so its starting
  value beats the `[data-shown]` rule's specificity) gives one. Live: opacity rises 0 → 0.26 over
  the frames after the copy lands; reduced motion still cuts (`transition-none`).
- **D12. The adapter needs a knee or an ankle besides the hip** (a hip alone gives the fit nothing
  to scale from), and `clipViewKinds` is derived from `clips`, the array `computeFusionSourceIndices`
  and every evidence section's `clipIndex` index into (not `clipIds`, which can lead it by a
  just-mounted clip).

## Risks / Trade-offs

- **First appearance popped in** (live, every case) until D11; fixed.
- **Hard square edge** of the crop shows at 0.26 (visible inside the phone drawing on
  side-landscape). Accepted, not masked.
- **Thigh-angle offset at the knee-flexion moment** (accepted). On side-portrait the photo's thigh
  is ~30–40° ahead of the model's at the measured moment (~20° on side-landscape) while hips and
  segment lengths agree. It is an honest difference between one stride's photograph and the model's
  one fixed setting per measurement (the model's thigh at its peak-knee-bend phase is its own curve,
  bound by a different metric), and the fit deliberately keeps angle differences visible (D2).
- **Discoverability** (accepted, by design): the plate shows only while the figure is still, i.e.
  after Pause or under reduced motion. A reader who never pauses never sees it.
- **Copy latency in the summary:** the plate appeared ~0.8–1.8 s after Pause in the summary (the
  card's canvas is encoded while the row's cards mount), against a few ms in the tour. Accepted; a
  driver must wait for `[data-shown]`, not a fixed delay.
- **Phone panels over the plate** in the tour's phone layout: the plate is under the figure, so it
  is covered exactly where the figure is.
- **Perf:** one PNG encode (≤ 640², the evidence output cap) per pause per new source canvas.
- **Pause snap is a behaviour change** for every limb focus; existing pause, landing and cadence
  tests stay green, and a new test pins the knee-flexion snap.
- **Landing shows no plate on the side demo clips.** side-landscape: overstriding `no-candidates`
  (tour: none; summary: the headline falls to foot strike, no hip, none). side-portrait: its
  overstriding image exists but is the cluttered 4.18-width case, withheld by D10.

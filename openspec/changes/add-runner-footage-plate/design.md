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
- Show the measured instant's evidence frame faintly behind a still side-stop figure in the tour
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
   Cadence (`beat`) pauses where it is, since its beat reads at any phase.
4. **Posture and rhythm are excluded**: no key leg phase, so no footage instant matches the figure.
5. **Baked-in marks are accepted.** The copy carries the evidence annotation marks at 0.26 opacity.
   A follow-up bead if the live check finds them cluttered.
6. **Fade 240 ms, opacity 0.26, no transition under reduced motion, hidden under forced colours.**
   0.26 matches the motion story's ghost (`.motion-story__ghost`).

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

## Risks / Trade-offs

- **First appearance pops in.** The copy is made on pause, so the `<image>` mounts with
  `data-shown` already set and has no "from" state to transition from; later hide/show toggles
  fade. Accepted at 0.26; `@starting-style` would fix it if the live check finds the pop jarring.
- **Hard square edge** of the crop shows at 0.26. Accepted; noted for the live check.
- **Portrait clip alignment** (`park-side-portrait.mp4`: portrait crop, weaker knee confidence) and
  dark mode with baked-in marks may read cluttered. Live check (second run) decides follow-ups.
- **Phone panels over the plate** in the tour's phone layout: the plate is under the figure, so it
  is covered exactly where the figure is.
- **Perf:** one PNG encode (≤ 640², the evidence output cap) per pause per new source canvas.
- **Pause snap is a behaviour change** for every limb focus; existing pause, landing and cadence
  tests stay green, and a new test pins the knee-flexion snap.
- **Landing on the demo clips may show no plate:** overstriding has no evidence on both side demo
  clips (`no-candidates`, `docs/agent-notes/evidence.md`), so the landing headline falls to foot
  strike, which has no hip. Expected by decision 2.

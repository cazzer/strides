## Context

Spike `strides-uz48.1` (`docs/agent-notes/swing-foot-travel.md`) measured the method on
`park-approach.mp4` with offline masks. Production has to produce those masks in the browser
without touching any other metric, and without trading pose-input fidelity for speed.

## Decisions

1. **Plan in the primary pass, measure in a background pass.** The primary heuristics know the
   rhythm, strikes and MoveNet hips/knees, so they plan which frames need a mask and for which leg.
   The background outline pass re-decodes the clip on the sequential (WebCodecs) path — frames
   reach it by the same HLG-safe `drawImage(VideoFrame)` canvas route as every detector — and an
   adapter `PoseDetector` crops each planned frame and segments it. Unplanned frames cost no
   inference. Playback-path clips skip with a caveat (decision 1 of the bead).
2. **A dedicated IMAGE-mode segmenter.** The scale pass's VIDEO-mode full-frame masks failed the
   spike on the far frames. IMAGE mode on a MoveNet-guided crop (hip-mid centred, 7 × 12 hip widths,
   hip width floored at 60 px, native pixels) agreed with MoveNet on every frame but one. Its own
   cached instance, same `.task` (no new download).
3. **Masks never outlive their frame.** Each confidence mask is thresholded at 0.5 and reduced in
   the loop to per-row runs from the higher thigh band's top down, measured, and dropped; the
   segmentation result is closed in a `finally`. What is retained per frame is a measurement and a
   ≤ 64-point contour.
4. **Graft one metric.** `graftOutlineResult` spreads the displayed result and replaces only
   `swingFootLateralExcursion`, so every other metric keeps its reference.
5. **Lane order.** All scale passes run before any outline pass; at most one background pass runs at
   a time, and no primary advances while an outline pass runs or holds the lease.
6. **Value.** Larger side's median of usable-window P80s; exactly 0 inside the stance floor (P80 of
   pooled stance protrusion); null when no window is usable or the floor has < 6 stance frames.
   Confidence = view multiplier × (ok swing frames / swing frames in in-clip windows) × min(1,
   usable windows / 3).
7. **Constants are the spike's**, each commented "tuned on park-approach; validated by
   strides-uz48.2".

## Risks / Trade-offs

- Production pixels (Chrome's HLG→sRGB draw) differ from the spike's ffmpeg PNGs → the live
  park-approach run is the acceptance check (4 usable windows, all inside, value 0).
- Whether a real blurred whip stays in the mask and connected is untested (`strides-uz48.2`).
- A hidden flick reads 0: this is a detection threshold set by thigh width, stated in the copy.
- Two MediaPipe GPU graphs resident; the outline pass adds ~1.5 s on park-approach after the scale
  pass.

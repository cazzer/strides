## Data ownership

`MultiClipVideoSession` already owns fused metrics, per-clip robust frames, source indices, and extracted evidence. It passes those to one `MotionStoryStage` beside the active Classic or Guided results view. The stage copies an evidence canvas's pixels into a private canvas. The metric card remains the sole owner of the extracted canvas element. Interpolated joints are drawn faintly, consistent with the existing skeleton overlay.

The stage projects the nearest robust pose frame through the evidence plan's exact square crop. Centimeter metrics select the winning clip's scale-pass robust frames. If no evidence exists, it displays a full-body detected pose without an image. If the metric was not measured, it keeps the reference trace and states the absence.

## Motion and navigation

The illustration alternates two distinct gait poses only during analysis. On readiness, the first measured pose receives one 680 ms reference-to-pose interpolation, skipped for reduced-motion preference. Later metric changes select their pose immediately. Cards in both views expose a metric identity; scroll, keyboard focus, and guide hashes select the active metric. The stage remains sticky beside desktop results and becomes a compact sticky rail on mobile; a `ResizeObserver` measures the real header height so it sits below the header even when the header grows. A mobile "View" control opens the same active visual at a legible size in a native modal dialog, with Escape and focus return.

Carried evidence is retained during re-extraction only while its clip index remains the current fused winner for that metric. The session composition and stage apply the same winner check during the render before the hook's next effect commits. A changed winner can thus show pending or no image briefly, but never an old clip's pixels attributed to the new winner.

## Boundaries

The stage neither reads nor reparents the live clip's video element and does not run pose inference or evidence extraction. It describes the dashed pose as an illustration, never an ideal to match.

# Dynamic valgus proxy investigation

> Moved verbatim from CLAUDE.md on 2026-10-27 to keep the auto-loaded file under the size limit. Index: CLAUDE.md "Notes index". Cross-references like "above"/"below" may now point into a sibling file in this directory.

## Dynamic valgus proxy investigation (2026-08-14)

Spike for GitHub #47, executed on branch `spike-heel-whip-pronation` — a prototype and a
recommendation, not a shipped feature. `src/pose/backends/mediapipeImageSegmenter.experimental.ts`
and `src/heuristics/dynamicValgusProxy.experimental.ts` exist on that branch as of this writing.

**Motivation.** #47 originally scoped a heel-whip + shoe-roll pronation-proxy spike against
rear-view running footage. Before this run started, a scope check found no rear-view test clips
exist anywhere in this repo — the only two demo clips are side-view (`try a demo video`, fetched
live from Pexels) and front-approach (`park-approach.mp4`). Heel-counter roll and heel-whip
(mid-swing lateral heel kick-out) are both structurally occluded or foreshortened from a front
view — the heel counter is hidden by the foot/shin mass, and mid-swing the foot tucks behind the
shin/thigh — so neither of the ticket's original two signals is testable on the footage actually
available; both stay blocked on a real rear-view clip the user will record later, not attempted
this run. What IS front-visible at zero new-footage cost: dynamic ankle/knee frontal-plane
collapse toward the midline during stance ("dynamic valgus" / colloquially "knock-knee") — a
distinct, coaching-relevant signal, correlated with but NOT identical to true rearfoot
pronation. This run retargets #47's SAME technique (crop + MediaPipe Image Segmenter silhouette
+ major-axis fit) at the lower leg (shin/ankle) on `park-approach.mp4`, the one available
front-view clip, instead of attempting signals that clip structurally can't show. Naming
discipline carried over unchanged from the original ticket: "dynamic valgus proxy" only — never
"pronation," never "clinical" anything.

**What was tried.**

*Crop* (`src/pose/backends/movenetCrop.ts`, reused as-is, untouched). `pickTrackingSide` (new,
`dynamicValgusProxy.experimental.ts`) picks ONE side for the whole clip — by summed knee+ankle
confidence on the first frame both resolve — rather than re-deciding per frame, which would make
the crop (and the signal) discontinuous for reasons unrelated to real motion. Picked `'left'`
every trial, all 3 runs. `deriveLegCropRect` builds a 2-point knee+ankle bounding box
(`deriveBoundingBox`) and pads it (`computeCropRect`, 1.8x multiplier, 150px floor) — the same
primitives MoveNet's tracking crop uses for a full-body box, here over just the tracked side's
shank so the crop shows the shank, not just the foot.

*Segmentation* (new, `src/pose/backends/mediapipeImageSegmenter.experimental.ts`, mirrors
`mediapipePoseLandmarker.ts`'s integration pattern). MediaPipe's stock `selfie_segmenter`
(float16, fetched live from Google's hosted bucket — a throwaway probe has no shipped bytes
worth pinning the way the self-hosted pose-landmarker model does), `outputCategoryMask: true`,
GPU delegate, VIDEO running mode. `getLabels()` returned `["selfie"]` on every run — confirms
the assumed binary foreground/background category encoding (any nonzero mask pixel =
foreground) rather than a multiclass scheme, which is also what the architecture note in #47
predicted this specific model would give in a tight leg crop.

*The candidate calc* (new, `dynamicValgusProxy.experimental.ts`). `computeMaskPca`: 2D PCA over
foreground-mask pixel coordinates (centroid + covariance, closed-form 2x2 dominant eigenvector),
with the sign-continuity rule the ticket flagged as a real gotcha up front — always orient the
axis to point "up" (toward the knee end) rather than trust frame-to-frame continuity, since a
single noisy/fragmented mask could break continuity-based disambiguation. `computeMaskIoU`:
intersection-over-union between consecutive masks — the crop canvas is a fixed 256x256
regardless of the source crop rect's own side length, so this always compares same-size masks.

*Splice* (`src/results/sampleClip.ts`'s `onFrame`, right after `detector.estimatePose`
resolves — reverted after use, see below, `git diff` on that file is clean). Dev-only
(`import.meta.env.DEV`-guarded), draws the crop into a 256x256 offscreen canvas, segments it,
computes PCA + IoU-vs-previous, accumulates into a module-level array, logs once under
`[dynamic-valgus-probe]` when `sampleClip` finishes (plus a one-time `[dynamic-valgus-probe:labels]`
line for the model's label list).

*Driving the app.* `window.__STRIDES_POSE_BACKEND_OVERRIDE__ = { backend:
'mediapipePoseLandmarker' }`, `window.__STRIDES_SCALE_PASS_CONFIG_OVERRIDE__ = { enabled: false
}` — the background scale pass shares `sampleClip.ts` and would otherwise re-invoke this
splice's module-level segmenter singleton a second time with a restarted, non-monotonic
timestamp; simplest to disable it for a one-shot probe rather than add restart-remap logic
(`mediapipePoseLandmarker.ts`'s own trick for exactly this problem) that would never ship.
Headless Chromium, real GPU (`ANGLE Metal Renderer: Apple M4 Pro`, confirmed via
`WEBGL_debug_renderer_info`, not SwiftShader). **A real methodological finding, not just a probe
detail**: at native 1x playback, the splice's added per-frame cost (a second MediaPipe task
serialized after pose detection in the same `onFrame` cycle) was heavy enough that only 2-3
frames sampled across the whole 1.65s clip — nowhere near enough to evaluate any gate. Fixed by
monkey-patching `HTMLMediaElement.prototype.play` (in the Playwright driver, not shipped code)
to force `playbackRate = 0.1` before playing — gives the pipeline 10x the wall-clock time per
video-time frame without touching frame content, timestamps, or either task's own per-frame
logic. 3 trials at 0.1x playback sampled 83, 84, and 84 of the clip's 99 frames respectively — a
real, if slow, technique-viability signal, not a runtime-cost benchmark (segmentation throughput
was never optimized here; moot once gates 1-2 failed, see below).

**Findings.**

*Gate 1 — segmentation quality.* Usable most of the time, but not clean. Across all 3 trials,
8/83, 8/84, and 8/84 frames (9.5-9.6%, strikingly consistent) came back with the ENTIRE 256x256
crop canvas classified foreground — a degenerate "everything is person" mask with a meaningless
dead-center centroid and, by construction via the axis-aligned PCA fallback, an exact 90.0°
reading. These saturated frames cluster late in the clip — 6 of the 8 in the trial-2/3 timestamps
land after t=1.1s (of a ~1.47s sampled span) — consistent with, though not proven to be caused
by, this clip's own already-documented camera-distance change (the subject's on-screen size
roughly triples across this clip — see "Vertical oscillation accuracy investigation" above): a
fixed-multiplier crop sized appropriately for a distant subject can end up with no background
margin left at all once the subject fills most of the frame, which is exactly the observed
failure signature. Separately, isolated severe fragmentation also occurs with no obvious visual
explanation: trial 2's minimum (2,657 of 65,536 px, ~4%) at t=0.217s pulls a keyframe showing
nothing unusual about the runner's visible leg position — a genuine segmenter-quality glitch,
not a crop or occlusion artifact. Non-saturated frames have a plausible median foreground
fraction (~76% of the crop canvas) that looks like a real leg/shoe blob. Net: doesn't hit the
ticket's hard "noisy/fragmented on every frame → stop here" floor, but falls well short of
"segments cleanly."

*Gate 2 — signal-vs-noise.* Clear FAIL. Frame-to-frame lean-angle changes exceeded 90° on
16.2% (trial 1, 12/74) and 25.3% (trials 2 and 3, 19/75) of non-saturated transitions. This is
the exact gotcha the ticket called out — PCA eigenvector sign ambiguity — but manifesting as a
DIFFERENT, harder problem than the sign-continuity rule already guards against: not a ±180° sign
flip of the SAME axis (handled), but the dominant/secondary eigenvalue IDENTITY swapping between
consecutive frames whenever the mask's width and height are close to equal — which principal
axis "wins" becomes highly sensitive to single-pixel noise, and the winner alternates between
near-vertical and near-horizontal essentially at random. Concrete, visually-verified example:
trial 2's two most extreme readings, -89.85° at t=0.86753s and +89.99° at t=0.88422s, are ONE
60fps video frame apart — 16.7ms of real playback time (the harness's 0.1x slowdown only
stretches wall-clock *processing* time, never the video's own frame spacing or content). Pulled
keyframes at both timestamps (`ffmpeg -ss` + `drawgrid`, per this file's keyframe-review method)
show the runner in visually indistinguishable poses — a real leg cannot reorient ~180° in 17ms,
so this swing is unambiguously computational noise, not signal. The raw lean-angle series'
standard deviation (64-68° across trials) is on the same order as its entire physically
meaningful range (180°, from -90° to +90°) — noise amplitude comparable to signal amplitude.

*Gate 3 — directional plausibility.* Undermined by gate 2's failure (sign can't be trusted to
mean "inward" vs "outward" when adjacent frames flip ~180° with no visible cause), but the
keyframe review surfaced a more fundamental, unplanned finding. The clip's one sustained,
high-IoU (0.8-0.97), non-noisy stretch (t≈0.60-0.78s, trial 2) holds steady near +73-88°
(silhouette axis close to horizontal) — and the matching keyframe shows why: the trailing leg's
shin is genuinely near-horizontal at that instant, heel kicked up behind during the stride's
recovery phase. That IS a real, stable, non-noisy signal — but it's a SAGITTAL-plane feature
(fore-aft leg swing), not the FRONTAL-plane collapse this proxy is supposed to measure. A 2D
silhouette's projected tilt-off-vertical cannot distinguish "the shin is tilted sideways toward
the midline" from "the shin is swinging backward and foreshortens into an off-vertical
silhouette from this camera angle" — a structural confound specific to a front/near-front camera
view with substantial fore-aft leg swing, separate from and additional to gate 2's noise
problem, and one that would persist even if a better segmentation model or a temporally-smoothed
PCA fit fully solved the axis-swap issue above.

**Recommendation: NO-GO for the silhouette-major-axis-PCA technique as implemented, on this
clip — evaluated against the ticket's own 4 pre-registered gates.** Gate 1 is a soft pass with
real caveats (9.5% saturation, isolated fragmentation). Gate 2 is a clear, visually-confirmed
fail: noise dominates signal via a PCA axis-identity-swap failure mode distinct from, and not
fixed by, the sign-continuity rule already implemented. Gate 3 can't be cleanly evaluated
because of gate 2, but reveals a second, independent problem — a sagittal/frontal-plane
confound baked into measuring silhouette tilt from a front-ish camera angle at all. Per the
ticket's own gate-4 fork ("is there a narrower version worth a follow-up spike, or is this a
clean no-go"), this lands closer to the former — two separable, unproven ideas are worth naming
rather than abandoning the whole direction outright:
- **Track the mask centroid's lateral (x) displacement directly, instead of a fitted major-axis
  angle.** Centroid position is a far simpler statistic than a 2x2 eigendecomposition and has no
  analogous "which axis wins" instability — it would plausibly fix gate 2 on its own. Not tried
  this pass (this run's design was pre-committed to the ticket's "major axis" framing); worth a
  narrow, cheap follow-up before writing off segmentation-based proxies as a category.
- **The sagittal/frontal confound (gate 3) is a camera-angle problem, not a math problem** — no
  amount of noise reduction fixes it. A true rear-view or dead-front-view clip (camera roughly
  along the direction of travel, minimizing the shin's fore-aft swing component in the 2D
  projection) is the only real fix, and that is the SAME rear-view-footage gap the original
  ticket was already blocked on.

Both follow-ups point back toward "a narrower centroid-tracking idea, validated on real
rear/front-square-on footage that doesn't exist yet" rather than "ship something today" — so
this write-up treats the overall result as a no-go for now, not a promising caveated metric, but
not a dead end either.

**Risk notes.**
- **Single-clip sample size.** Everything above comes from 3 trials on ONE clip
  (`park-approach.mp4`) — a smoke test, not a validated result. No cross-clip generalization is
  claimed or implied.
- **Front-view ≠ rear-view signal.** This investigation's target (dynamic valgus, frontal-plane
  knee/ankle collapse) is a DIFFERENT signal from the original ticket's heel-whip/shoe-roll
  pronation proxy — findings here say nothing about whether THOSE signals would fare better or
  worse on real rear-view footage, which remains completely untested.
- **Valgus ≠ pronation — not interchangeable, don't conflate.** Dynamic valgus is a
  frontal-plane knee/ankle motion; pronation is rearfoot/subtalar motion. They're correlated in
  some populations but are different joints and different mechanisms; this investigation never
  measured, and never claims to measure, pronation.
- **Determinism.** Trials 2 and 3 (of 3) were bit-identical — all 84 samples, every downstream
  statistic matched exactly — consistent with this repo's previously-documented finding that the
  MediaPipe Tasks Vision path is bit-reproducible on this machine (see the pipeline-comparison
  table earlier in this file). Trial 1 differed by exactly one sampled frame (83 vs. 84 total),
  the same ±1-frame run-to-run sampling variance already documented elsewhere in this file — not
  evidence against the determinism finding, just the known frame-count jitter.
- **Splice performance is not representative of any real cost.** The 10x playback slowdown was a
  harness workaround, not evidence about how expensive this technique would be to ship — no
  attempt was made to optimize segmentation throughput (e.g. running it at a lower cadence than
  every detected frame) because gates 1-2 failed before that question became relevant.

**Backlog.**
- **Centroid-lateral-displacement variant** — the narrower follow-up flagged above (replace the
  PCA major-axis fit with straight centroid x-tracking), cheap to try against this same clip
  before requiring new footage.
- **Heel whip and true heel-roll — still blocked on rear-view footage**, entirely unattempted
  this run (out of scope, correctly deferred — see Motivation). Whenever a rear-view clip
  exists, both the original ticket's signals AND a rear/front-square-on retry of the
  centroid-tracking variant above become testable for the first time.
- **A real rear-view or dead-front-view (camera along the direction of travel) clip** — the
  single highest-value next step for this whole direction, the same shape as the slow-motion
  investigation's "real device-native slow-motion clip" gap above: without one, gate 3's
  sagittal/frontal confound can't be ruled out for ANY silhouette-tilt-based proxy, including the
  centroid-tracking variant.
- Prospective openspec slug if this crystallizes into something shippable later:
  `dynamic-valgus-proxy-metric`.

**Not filed as an openspec change this pass.** The recommendation above is a no-go for the
implemented technique, with two narrower, unvalidated follow-up ideas — not something ready to
scope as a shipped metric.



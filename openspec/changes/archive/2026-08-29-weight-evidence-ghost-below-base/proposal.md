# A ghosted evidence photograph is weighted toward its base instant (`strides-c37`)

## Why

A ghosted evidence thumbnail says three things about which instant is the subject, and one of them
disagrees with the other two.

- **The caption picks a winner.** `evidenceCaptions.ts` writes "X, ghosted against Y" — one instant
  is the thing being shown, the other is what it is shown against.
- **The annotation picks the same winner.** `frameOpacityFor` (`evidenceAnnotations.ts:366`) gives
  the base's marks `1.0` and the ghost's `0.5`, and the results-view spec REQUIRES that asymmetry:
  "a ghosted pair's marks are as solid as a single frame's".
- **The photograph picks nobody.** `extractFrames.ts` draws the base at `globalAlpha` 1 onto a
  transparent canvas and then the ghost at `EVIDENCE_GHOST_OPACITY = 0.5` over it. `source-over`
  collapses that to exactly `0.5·base + 0.5·ghost` — a symmetric double exposure. The intent was
  stated only in a code comment and an archived design doc; no requirement asserts it.

So the solid cyan skeleton sits on a body the picture gives no reason to read as the subject, and a
reader resolves the contradiction from whatever cue happens to be strongest in that particular
image — which is not reliably the base. A user reported exactly that on Demo 2's
`verticalOscillation` thumbnail: the solid skeleton looked like it was on the wrong body.

The RCA (`strides-c37`) confirmed the mechanism by measurement rather than by reading the code: a
blend-weight sweep against the app's own rendered canvas peaks at exactly 50/50. Base/ghost
ordering, skeleton registration, the per-clip seek offset and the captions were each checked and are
correct. The photograph's symmetry is the whole defect.

## What Changes

- **Split one constant into two.** `EVIDENCE_GHOST_OPACITY` is doing two unrelated jobs — the alpha
  the ghost PHOTOGRAPH is composited at, and the frame-level multiplier on the ghost's ANNOTATION
  marks. They are separate decisions and must be able to move independently:
  - `EVIDENCE_GHOST_BLEND_ALPHA = 0.35` — the photographic weight, read only by `evidenceFrames.ts`
    when it plans the ghost instant.
  - `EVIDENCE_GHOST_MARK_OPACITY = 0.5` — unchanged in value, read only by `evidenceAnnotations.ts`.
  - `EVIDENCE_BASE_OPACITY = 1` is NOT split: it is genuinely `1` in both jobs, and two constants
    that must always be equal are a coupling waiting to break.
- **The photograph becomes 65/35 in favour of the base**, so the base instant reads as the
  foreground body while the ghost stays unmistakably a second body.
- **Documentation that currently asserts the reversed intent is corrected** — `evidenceFrames.ts`'s
  "symmetric 50/50 double exposure" comment, `extractFrames.ts`'s `extractFrame` doc and its
  dirty-alpha note, and `frameOpacityFor`'s doc (which quotes "the ghost's blend value, 0.5", which
  stops being one number).
- **Tests gain the assertions the old ones could not make.** `extractFrames.test.ts` recorded only
  `ctx.globalAlpha` per `drawImage`, so reversing draw order, inserting an opaque `fillRect`, or
  changing `globalCompositeOperation` all passed. The draw log is pinned instead, and the resulting
  per-instant weights are replayed through a test-local `source-over` reducer — including one test
  named for the invariant rather than the number.

Not in scope, and deliberately untouched: base/ghost ordering, crop planning, seek offset, captions,
annotation geometry, and `EVIDENCE_CROP_MIN_SIDE_PX`.

## Impact

- Affected specs: `results-view` (one ADDED requirement; nothing modified — no existing sentence
  asserts the photograph is symmetric).
- Affected code: `src/results/evidenceFrames.ts`, `src/results/evidenceAnnotations.ts`,
  `src/video/extractFrames.ts` and `src/video/drawEvidenceAnnotations.ts` (both documentation only —
  each carried a statement that the inherited `globalAlpha` is a half), `src/test/canvasTestUtils.ts`,
  and the four test files that reference the old constant.
- **Every ghosted image on every metric changes**, not just `verticalOscillation` — 12 ghosted
  exemplars across the three test clips at the time of measurement. No unghosted image changes at
  all: a single-instant exemplar draws one `drawImage` at `EVIDENCE_BASE_OPACITY`, which is
  untouched.
- No performance impact: the same two draw calls at a different alpha.

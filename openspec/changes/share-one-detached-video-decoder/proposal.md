# Share one detached video decoder

## Why

Two features open a detached `<video>` on a clip's own bytes: poster derivation
(`posterFrame.ts`, at clip-add time) and evidence extraction (`extractFrames.ts`, after analysis).
Each kept a module-level promise queue of its own, so each guaranteed at most one decoder **of its
own kind** — and nothing coordinated the pair. A global peak of two concurrent 4K decoders was
structurally possible (beads `strides-3uy`).

It has never been observed, and the reason is timing rather than design: posters all close by
~950 ms while extraction only starts after analysis at ~13.5 s. That separation is incidental. A
slow poster decode on a large clip, or a faster analysis path, closes the gap — and a per-feature
ceiling composes to N, not to 1, so a third feature would make it three.

The spec has the same shape as the code did. `video-input`'s poster requirement bounds "one **such**
decoder"; `results-view`'s two evidence requirements bound the extractor's own. Nothing states the
ceiling for the pair, so re-splitting the queues would be spec-compliant and would silently
reintroduce this.

The two features had also grown duplicate plumbing (beads `strides-k03`): `posterFrame.ts` imported
`seekTo`/`waitForPresentedFrame` from `extractFrames.ts` and then re-implemented `waitForDecodedData`,
`HAVE_CURRENT_DATA`, the load timeout and the decoder teardown alongside them. A fix to the teardown
sequence or the readiness wait had to be made twice, and only one of the two sites was reachable by
grepping the other's imports. The shared queue belongs in the module those primitives move to, so the
two land together.

## What changes

- A new `src/video/videoElement.ts` owns the generic `<video>` plumbing both features use: `seekTo`,
  `waitForPresentedFrame`, `waitForDecodedData`, `HAVE_CURRENT_DATA`, the three timeout constants,
  the detached-decoder open/teardown, and **one** serialization point.
- Both features go through that one queue, so the ceiling is one detached decoder globally rather
  than one per feature. No caller changes.
- `video-input` gains a requirement stating the cross-feature ceiling. The three existing per-feature
  statements are left exactly as they are — they remain true, and the new requirement strictly
  strengthens what they say rather than contradicting any of it.

## Impact

- `src/video/videoElement.ts` (new), `src/video/videoElement.test.ts` (new).
- `src/video/extractFrames.ts`, `src/video/posterFrame.ts` — imports and two call sites; every moved
  primitive is byte-identical to the copy it replaced.
- `src/video/extractFrames.test.ts` — `waitForPresentedFrame`'s four tests move with the function.
- `openspec/specs/video-input/spec.md` — via the delta in this change.

No user-visible behaviour changes. No evidence policy, crop math, annotation geometry, or metric
value moves. `src/video/useClipPoster.ts` is untouched, so nothing changes about when or how any
`<video>` is mounted, sized or presented.

# Tasks

## 1. The shared module

- [x] 1.1 Add `src/video/videoElement.ts` holding the generic `<video>` plumbing: `SEEK_TIMEOUT_MS`,
      `LOAD_TIMEOUT_MS`, `FRAME_PRESENTATION_TIMEOUT_MS`, `HAVE_CURRENT_DATA`, `SeekOutcome`,
      `seekTo`, `FramePresentationSignal`, `waitForPresentedFrame`, `waitForDecodedData`.
- [x] 1.2 Move each of those verbatim, and verify mechanically against `git show HEAD:` that every
      moved block is byte-identical to the copy it replaced.
- [x] 1.3 Restate, rather than transplant, the three doc sentences that were true only of the
      evidence path (the load timeout's provenance, `seekTo`'s `'extraction-failed'` clause, the
      "runs strictly after `phase: 'ready'`" schedule claim).
- [x] 1.4 Add `withDecodedVideo` — one detached decoder opened, awaited to readiness, handed to the
      caller's work, torn down on every exit path — replacing the two comment-for-comment copies of
      that open/`try`/`finally` sequence.
- [x] 1.5 Add `queueDetachedDecode`, the single serialization point, replacing `posterQueue` and
      `evidenceQueue`.

## 2. The two consumers

- [x] 2.1 `posterFrame.ts`: import from `./videoElement` instead of `./extractFrames`; delete
      `POSTER_LOAD_TIMEOUT_MS`, its `HAVE_CURRENT_DATA`, its `waitForDecodedData` and `posterQueue`;
      route `decodePosterFrame` through `withDecodedVideo` and `deriveClipPoster` through
      `queueDetachedDecode`.
- [x] 2.2 `extractFrames.ts`: the same, for `LOAD_TIMEOUT_MS`/`SEEK_TIMEOUT_MS`/
      `FRAME_PRESENTATION_TIMEOUT_MS`, `HAVE_CURRENT_DATA`, `waitForDecodedData` and `evidenceQueue`.
- [x] 2.3 Keep the "runs strictly after `phase: 'ready'`" invariant in `extractFrames.ts`, where it
      is true, and say there that it describes when THIS module is called rather than a property of
      the primitives — `useClipPoster` runs them during sampling on purpose.
- [x] 2.4 Update both modules' "one detached decoder at a time" doc sections to say the queue is one
      queue for the app rather than one per feature.
- [x] 2.5 Correct `drawPosterFrame`'s and `deriveClipPoster`'s never-throws claim to state both
      halves — nulls for the failures the code decides, propagation for the ones it does not (D5).

## 3. Tests

- [x] 3.1 Add `src/video/videoElement.test.ts`, and move `waitForPresentedFrame`'s four tests into it
      unchanged from `extractFrames.test.ts`.
- [x] 3.2 Cover `withDecodedVideo` directly: the undecodable path returns the caller's own answer
      without running the work, and the object URL is revoked even when the work throws.
- [x] 3.3 Add the cross-module queue tests — a poster derivation and an evidence extraction started
      in the same tick, in both orders, several of each interleaved, and one feature's outright
      failure not blocking the other's turn.
- [x] 3.4 Confirm by mutation that 3.3 detects a per-feature split: restore a private queue to
      `posterFrame.ts` and check the tests fail on a peak of 2, then revert.

## 4. Verify

- [x] 4.1 `npx tsc -b` clean.
- [x] 4.2 `npx eslint src/` clean.
- [x] 4.3 `npm test` green.
- [x] 4.4 Live browser, real GPU: posters appear on the clip strip and evidence thumbnails render, on
      Demo 1 and Demo 2, with coverage matching CLAUDE.md's per-metric table.
- [x] 4.5 Regression anchor: Demo 1 `verticalOscillationCm` = 4.421467928439415 with
      `fit.frequencyHz * 60 == cadence.value == 91.2`.

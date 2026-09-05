# Tasks — seek evidence frames to the frame midpoint

## 1. Measure before touching anything

- [x] 1.1 Capture the BEFORE A/B on the unmodified tree —
      `scripts/ab-person-selection.mjs --arm 'base={}' --clips
      side-landscape,side-portrait,front-approach --trials 3 --evidence`, derived port, fresh
      Chromium per trial, identity-verified server.
- [x] 1.2 Read the two `footStrikePattern` exemplars' planned instants and crop rects with a
      temporary `[evidence-seek]` probe in `extractFrames.ts` (added, measured, reverted).
      Measured: left `3.083333` at crop `(531.98, 1472.91, 320)`, right `3.433333` at
      `(0, 1475.55, 320)`, both `pairedTimestamp: null`, both `outputSide` 320.
- [x] 1.3 PSNR argmax on the BEFORE arm against ffmpeg-reconstructed crops. **Measured: media
      frames 182 and 203** — one early, so risk 1 (symptom fails to reproduce) did not fire.
- [x] 1.4 Establish physical ground truth by looking at the source frames: 182 and 203 show a
      separated shadow band with tarmac between shoe and sole; 183 and 204 show a continuous
      sole/ground boundary. First contact is 183 and 204.
- [x] 1.5 Resolve the rounding mode by measurement rather than assumption — pure Chromium seek,
      no app: assigning `3.049999666666667` reads back `3.049999`. **Truncation.**

## 2. Implementation

- [x] 2.1 `evidenceSeekOffset.ts`: add `EvidenceSeekCalibration`, a zero constant, and
      `frameMidpointOffsetSeconds(track)` = `1 / nominalFps / 2`, declining to `0` on `null`,
      non-finite or non-positive rates.
- [x] 2.2 Restructure `derive()` to probe FIRST, then compute the two terms independently; the
      `sequentialSampling` gate and the expensive `canUseSequentialDecode` gate now guard only the
      edit-list term, and the latter stays last and unreachable when that term is zero.
- [x] 2.3 Rename `resolveEvidenceSeekOffsetSeconds` → `resolveEvidenceSeekCalibration`, widen the
      cache to the struct, delete the old export (single consumer — no shim).
- [x] 2.4 `extractFrames.ts`: add `DEFAULT_EVIDENCE_MIDPOINT_OFFSET_SECONDS = 0` and
      `midpointOffsetSeconds` to the options and resolved options.
- [x] 2.5 `decodeClipEvidence`: derive once per clip, and let each explicit option win its own
      field so pinning one term does not silently pin the other.
- [x] 2.6 `drawInstant`: three-term sum, clamped to `video.duration` only where finite, then
      floored at 0.
- [x] 2.7 Document the added cost — every clip now pays the probe even with `sequentialSampling`
      disabled, where the old early return skipped it.

## 3. Unit tests

- [x] 3.1 `frameMidpointOffsetSeconds` on the three bundled clips' real rates (60, 30, 60000/1001).
- [x] 3.2 Its no-duration fallbacks: `null`, `0`, negative, `Infinity`, `NaN` → `0`.
- [x] 3.3 `resolveEvidenceSeekCalibration` on all three clips' real container shapes.
- [x] 3.4 The two terms are independent: `sequentialSampling` off, `canUseSequentialDecode` false,
      and no `elst` at all each zero the offset while the midpoint survives.
- [x] 3.5 Every probe-failure arm zeroes BOTH terms — `'parse-error'` (the WebM case),
      `'unsupported-container'`, no video track, `arrayBuffer()` rejecting, null blob.
- [x] 3.6 One derivation per clip (the cache).
- [x] 3.7 `extractFrames`: the shipping numbers — `3.083333` and `3.433333` with the real
      calibration seek to 3058333 µs and 3408333 µs, inside their frames, where the pre-midpoint
      target quantises to 3049999 µs, one microsecond below the boundary.
- [x] 3.8 Composition order and explicit-option precedence, including the asymmetric case where
      only one term is supplied.
- [x] 3.9 Final-frame clamp at a finite duration; no clamp at `NaN` or `Infinity`.
- [x] 3.10 Never negative; and `extractPlannedFrames(video, plan)` with no options seeks the plan
      unchanged.

## 4. Live verification

- [x] 4.1 AFTER A/B, same invocation and same regime as 1.1.
- [x] 4.2 Compare with `rtk proxy diff` plus an `md5` cross-check of the report **body** (the
      header stamps the commit, so a whole-file md5 always differs across arms).
      **Gate: no `metrics.*`, `sampling.*`, `personSelection.*`, `view.*` or `evidence.*` field
      moves.** PASS — the only difference is `elapsedMs`.
- [x] 4.3 PSNR argmax on the AFTER arm. **Measured: media frames 183 and 204.**
- [x] 4.4 Look at the two images and judge planted vs airborne on the bead's own criterion.
      Planted: the shadow gap closes into a continuous sole/ground boundary.
- [x] 4.5 Playback path (D7): re-measure under `{"sequentialSampling":{"enabled":false}}` on
      `side-landscape`. **Drawn frame unchanged; the midpoint stays uniform across samplers, and
      the pre-registered fallback of gating it to WebCodecs was not needed.**
- [x] 4.6 Regression anchor: `verticalOscillationCm` and its `fit.*` fields unmoved. **Not measured
      by 4.2** — `scripts/ab-person-selection.mjs` discards every `[analysis-diagnostics:` line, and
      the anchor lives on the scale-pass one. It holds by CONTAINMENT instead: both calibration
      terms are read only inside `drawInstant`'s seek, and reach no `ClipEvidencePlan`, no
      `robustFrames[].timestamp` and no diagnostics payload — so there is no path by which a
      heuristics input, and therefore the anchor, could move.

## 5. Gates

- [x] 5.1 `npx tsc -b` — clean apart from the pre-existing `vite.config.ts` `port` error (D9).
- [x] 5.2 `npm run lint`
- [x] 5.3 `npm run test`
- [x] 5.4 `openspec validate seek-evidence-frames-to-the-frame-midpoint --strict`

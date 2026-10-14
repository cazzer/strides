## 1. Forward decoding

- [x] 1.1 `decodedFrames.ts`: `presentationShiftSeconds`, `presentationEndSeconds`, `presentationTimeline`, `frameShownAt` (pure), `decodeRange` (pure), `decodeFramesForward`, `openDecodedFrameSource`
- [x] 1.2 `clipBytesCache.ts`: `borrowClipDemux` — cached track or an uncached private demux
- [x] 1.3 Unit tests: `decodedFrames.test.ts` (frame model incl. the long-sample case, guard band, decode range, pass outcomes)

## 2. Consumers

- [x] 2.1 `extractFrames.ts`: shared extraction run; forward-decode driver with seek fallback that reuses finished metrics; perf line gains `frameSource`/`decodeSourceMs`/`decodeMs`/`decodePasses`
- [x] 2.2 ~~`posterFrame.ts`: forward-decoded poster~~ — built, measured, WITHDRAWN in review round 1 (design D9)
- [x] 2.3 Unit tests: `extractFrames.decode.test.ts`

## 3. Verification

- [x] 3.1 Frame model vs Chromium on every frame of all ten gate clips
- [x] 3.2 In-page pixel probe (temporary, reverted): every forward-decoded evidence image vs the seek path
- [x] 3.3 Shared metric gate, base vs branch, `rtk proxy` diff + md5
- [x] 3.4 `[perf-timings]` evidence before/after on desktop
- [x] 3.5 Phone run (Galaxy S21): timings, and that forward-decoded images match seeked ones there

## 4. Review round 1

- [x] 4.1 Restore this file (emptied by `7be0c85`)
- [x] 4.2 `forwardDecodeConfig.ts`: its own switch, independent of `sequentialSampling.enabled`
- [x] 4.3 Container `colr` to `decoder.configure`; refuse a declaration that cannot pass verbatim
- [x] 4.4 Refuse a shift that leaves a frame presenting before zero
- [x] 4.5 Tests: sampler off, `canUseSequentialDecode` false, non-shift edit list → `null`; `borrowClipDemux` after release does not repopulate
- [x] 4.6 Posters back on the seek path
- [x] 4.7 Drop the frame source before a `<video>` fallback; a pass that delivered everything is done
- [x] 4.8 Re-run the shared metric gate and the pixel probe

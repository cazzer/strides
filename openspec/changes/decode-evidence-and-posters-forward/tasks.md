## 1. Forward decoding

- [x] 1.1 `decodedFrames.ts`: `presentationShiftSeconds`, `presentationEndSeconds`, `presentationTimeline`, `frameShownAt` (pure), `decodeRange` (pure), `decodeFramesForward`, `openDecodedFrameSource`
- [x] 1.2 `clipBytesCache.ts`: `borrowClipDemux` — cached track or an uncached private demux
- [x] 1.3 Unit tests: `decodedFrames.test.ts` (frame model incl. the long-sample case, guard band, decode range, pass outcomes)

## 2. Consumers

- [x] 2.1 `extractFrames.ts`: shared extraction run; forward-decode driver with seek fallback that reuses finished metrics; perf line gains `frameSource`/`decodeSourceMs`/`decodeMs`/`decodePasses`
- [x] 2.2 `posterFrame.ts`: forward-decoded poster with seek fallback; perf line gains `frameSource`/`decodeMs`
- [x] 2.3 Unit tests: `extractFrames.decode.test.ts`, `posterFrame.decode.test.ts`

## 3. Verification

- [x] 3.1 Frame model vs Chromium on every frame of all ten gate clips
- [x] 3.2 In-page pixel probe (temporary, reverted): every forward-decoded evidence image and poster vs the seek path
- [x] 3.3 Shared metric gate, base vs branch, `rtk proxy` diff + md5
- [x] 3.4 `[perf-timings]` poster/evidence before/after on desktop
- [ ] 3.5 Phone run (Galaxy S21): timings, and that forward-decoded images match seeked ones there

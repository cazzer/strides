# Tasks

## 1. Stride-length extractor

- [x] 1.1 Add an exported `STRIDE_PERIOD_TOLERANCE` constant to `src/heuristics/strideLength.ts`,
      with the derivation (design D4) in its doc comment — including the RSS budget, the
      insensitivity check, and the explicit note that it was not fitted to any clip.
- [x] 1.2 Add a `StrideLengthOptions` parameter carrying an optional `stepFrequencyHz`, and derive
      the expected stride period as `2 / stepFrequencyHz`, guarded to `null` for a missing,
      non-finite or non-positive value.
- [x] 1.3 Add failure reason `'no-period-consistent-pairs'` and success field
      `periodRejectedPairCount`.
- [x] 1.4 Apply the log-symmetric interval gate as step 4a — before hip resolution and the `d > 0`
      filter — counting rejections and skipping those pairs.
- [x] 1.5 Return `'no-period-consistent-pairs'` when no pair survived and at least one was
      period-rejected; keep `'no-usable-pairs'` otherwise.

## 2. Stride-length documentation

- [x] 2.1 Add the missing **halving** bias direction to the module doc (spurious extra strike →
      interval spans ~½ a stride → `strideLengthPx` LOW → caller's ratio HIGH), with the Demo 1
      measurement and the note that the median does not defend against it when it is systematic.
- [x] 2.2 Update the rejected "fit-period multiplicity correction" mitigation to record that it is
      now superseded for the timing case by an external physical reference, and why the original
      objection (a self-referential "suspicious 2x" threshold) does not apply to it.
- [x] 2.3 Update the gate-order list with step 4a and the counts' invariant.

## 3. Vertical ratio

- [x] 3.1 Pass `{ stepFrequencyHz: fit.frequencyHz }` to `estimateStrideLength`, with a comment
      recording the two-steps-per-stride identity and that the fit is already gated by this point.
- [x] 3.2 Add the `'no-period-consistent-pairs'` caveat, naming the real cause.
- [x] 3.3 Subtract `periodRejectedPairCount` from the "couldn't be read cleanly" caveat's count, and
      add a separate caveat for period rejections.

## 4. Tests

- [x] 4.1 `strideLength.test.ts`: a pair whose interval matches the fitted period is kept.
- [x] 4.2 `strideLength.test.ts`: a pair at ~half the fitted period is rejected and counted.
- [x] 4.3 `strideLength.test.ts`: a doubled-interval pair is rejected by the gate when a reference
      is supplied (and still only median-absorbed when one is not).
- [x] 4.4 `strideLength.test.ts`: all pairs rejected → `'no-period-consistent-pairs'`; none rejected
      → `'no-usable-pairs'` unchanged.
- [x] 4.5 `strideLength.test.ts`: with no reference supplied, every field is identical to the
      pre-change result on the same frames (asserted against a same-frames baseline call, not a
      hardcoded number).
- [x] 4.6 `strideLength.test.ts`: a non-finite / non-positive `stepFrequencyHz` is inert.
- [x] 4.7 `strideLength.test.ts`: the gate is log-symmetric — pin both band edges.
- [x] 4.8 `verticalRatio.test.ts`: the metric degrades honestly (null, confidence 0, cause-naming
      caveat) when no pair is period-consistent.
- [x] 4.9 `verticalRatio.test.ts`: a clean synthetic clip still reports its value at full
      confidence, proving the gate is not eating genuine strides. Its caveat is no longer null —
      the gate correctly drops the fixture's two run-edge artifacts — so the assertion pins the
      exclusion sentence and the reason it fires, rather than pinning `null`.
- [x] 4.10 Update the two tests that call `estimateStrideLength` alongside `computeVerticalRatio`
      (`verticalRatio.test.ts`'s median-pair test, `index.test.ts`'s drift guard) to pass the same
      reference the metric now passes, so the comparison stays structural rather than coincidental.

## 5. Verify

- [x] 5.1 `npx tsc -b` clean.
- [x] 5.2 `npx eslint` clean on every touched file.
- [x] 5.3 `npm test` green.
- [x] 5.4 `openspec validate gate-stride-pairs-on-fitted-period --strict`.
- [ ] 5.5 Live browser verification — **owner runs this**, not the implementing agent (concurrent
      GPU runs contend on this repo's timing-sensitive measurements). Expected: Demo 1's
      `verticalRatio` goes null with the new caveat instead of reporting ~6.8% at High confidence.

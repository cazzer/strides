# Tasks

One change, four implementation tickets. **Check off only your own numbered section.** If you need a
requirement another section already ADDED to say something different, edit that block in place —
adding a second block for the same requirement is the clobber failure mode this single change exists
to avoid (design.md D1).

`strides-utn.2` is a measurement spike that ships no production code; it gates section 3 only. Its
findings belong on the bead and in design.md, not in this list.

## 1. `strides-utn.1` — Expose model-load state reactively from both detector owners

- [x] 1.1 Add `src/pose/modelLoadState.ts`: `ModelLoadPhase` (`idle | loading | ready | error`),
      `ModelLoadProgress` (`loadedBytes`/`totalBytes`), `ModelLoadState`
      (`{ phase, progress: ModelLoadProgress | null }`), `ModelLoadStates`
      (`{ primary, scalePass }`), and an `IDLE_MODEL_LOAD_STATE` constant. Document that a `null`
      progress means indeterminate and must never be rendered as a percentage (design.md D2).
- [x] 1.2 Widen `src/pose/usePoseDetector.ts`: redefine `PoseDetectorStatus` as
      `Exclude<ModelLoadPhase, 'idle'>` so the existing union is unchanged, and add a `load:
      ModelLoadState` to `SharedPoseDetector`, memoised so its identity is stable between
      transitions. Progress stays `null` here — section 2 populates it.
- [x] 1.3 Give `src/pose/scalePassDetector.ts` a plain, React-free observation channel: a
      module-level listener set, `getScalePassDetectorLoadState()`, and
      `subscribeToScalePassDetectorLoad(listener)` returning an unsubscribe. Publish `loading` when
      an attempt is installed, `ready` on success, `error` on a failure that was our own attempt.
- [x] 1.4 Rewrite that module's doc comment rather than deleting the clause this change falsifies:
      keep the module-level rationale (page-lifetime cache, not a component-lifetime resource) and
      replace "nothing re-renders on this detector's readiness" with the observation-channel design.
      Justification is design.md D3.
- [x] 1.5 Reset the published state to `idle` in `__disposeForTests()`, without clearing the
      listener set.
- [x] 1.6 Add `src/pose/useScalePassDetectorLoad.ts` — a `useSyncExternalStore` over the two
      accessors above, in its own file so `scalePassDetector.ts` imports no React.
- [x] 1.7 `src/App.tsx`: stop dropping `status`. Read both owners and pass one memoised
      `modelLoad: ModelLoadStates` prop alongside `detector`.
- [x] 1.8 `src/results/MultiClipVideoSession.tsx`: declare `modelLoad` on
      `MultiClipVideoSessionProps`, documented as reserved for section 4 and deliberately unread in
      this ticket. Destructure only `detector` from the props object so the seam is documented
      rather than eslint-suppressed.
- [x] 1.9 Tests: keep `usePoseDetector.test.ts` green unchanged and add coverage for the new `load`
      field; extend `scalePassDetector.test.ts` for the channel (idle before first request,
      subscribing does not create, transitions are delivered, unsubscribe stops delivery, the
      page-lifetime cache and the backend-override exemption still hold while observed); add a test
      for the `useScalePassDetectorLoad` hook.
- [x] 1.10 `npx tsc -b`, `npm run lint`, `npm test` all green.
- [x] 1.11 Live check in headless Chromium on real GPU (derived dev-server port, never SwiftShader):
      confirm both channels really transition on a real page load — the primary at mount, the scale
      pass once a clip reaches `ready` — via a temporary dev-only log, then remove the log.

## 2. `strides-utn.3` — Shared model fetch/cache/progress utility, proven on the MediaPipe `.task`

- [x] 2.1 Add the shared utility (`src/pose/modelAssetCache.ts` or similar): fetch an asset,
      streaming byte progress against `Content-Length` where present and reporting progress as
      absent where it is not.
- [x] 2.2 Back it with Cache Storage, keyed by asset URL **plus an explicit model version token**.
      Populate on miss; remove the superseded entry when the token changes.
- [x] 2.3 Guard every cache read and write: `caches` is absent in some contexts and throws in others
      (private browsing, blocked site data). An unavailable cache must still yield a completed,
      uncached download — never a download failure.
- [x] 2.4 Route `pose_landmarker_full.task` through it: swap `modelAssetPath` for
      `BaseOptions.modelAssetBuffer` at `src/pose/backends/mediapipePoseLandmarker.ts:142-146`.
- [x] 2.5 Correct the stale caching claim in that file's comment (`:17-23`): the deploy is GitHub
      Pages, response headers are not controllable, and the `.task` is measured serving
      `cache-control: max-age=600` — six times worse than the bucket it replaced, which is why
      client-side storage is required. Keep the byte-pinning rationale, which is still correct.
- [x] 2.6 Populate `ModelLoadState.progress` through the channel section 1 added, for both owners.
      Both owners fold their assets' readings with `aggregateModelAssetProgress`. The scale pass
      genuinely reports bytes today; the primary's stays `null` until section 3 routes MoveNet,
      which is the honest reading for a download nobody is measuring (design.md D8).
- [x] 2.7 Unit tests: cache hit, miss-populates, version-token eviction, unavailable/throwing
      `caches`, and a missing `Content-Length` reporting absent progress.
- [x] 2.8 Verify LIVE, network-observed rather than inferred, that a second page load does not
      re-download the `.task`. Measured: cold 1 request / 9,398,460 transferred bytes, warm **no
      request at all** (design.md D9).
- [x] 2.9 `npx tsc -b`, `npm run lint`, `npm test` all green.

## 3. `strides-utn.4` — Route MoveNet through the shared cache via a custom tfjs IOHandler

Gated on `strides-utn.2`. **If the spike returns no-go for these assets**, do not weaken the
requirement: delete "MoveNet model weights load from the shared model cache" from
`specs/pose-detection/spec.md` in this change, close `strides-utn.4` as not-feasible with the
measurement recorded, and skip the rest of this section (design.md D7).

- [x] 3.1 Read `strides-utn.2`'s recorded per-asset go/no-go before writing any code here.
- [x] 3.2 Implement an `io.IOHandler` that assembles `ModelArtifacts` from the shared utility —
      `model.json` plus weight shards, each cached separately. `detector.js:495-520` sets
      `fromTFHub=false` when `modelUrl` is not a string and passes it to `loadGraphModel`, so this
      is a supported input.
- [x] 3.3 Pass it as `modelUrl` for both single-pose and multi-pose creation
      (`src/pose/backends/movenet.ts:317-330`).
- [x] 3.4 Report byte progress where `Content-Length` is readable; degrade to indeterminate where it
      is not. Do not fabricate a total.
- [x] 3.5 Unit tests for the handler's artifact assembly and its per-shard cache behaviour.
- [x] 3.6 Verify LIVE that a second page load does not re-download the weights.
- [x] 3.7 **Acceptance gate, not a nicety**: before/after `scripts/ab-person-selection.mjs` across
      `demo1,demo2,multiperson`, fresh-process default, showing no field moving except `elapsedMs`.
      This changes how WEIGHTS load; this repo has a documented history of clean, plausible, wrong
      numbers.
- [x] 3.8 `npx tsc -b`, `npm run lint`, `npm test` all green.

## 4. `strides-utn.5` — Render a model-download entry at the head of the header bar

- [x] 4.1 New component + test for the model entry, borrowing `ClipStripEntry`'s frame/caption/
      `ConditionBar` markup rather than adding a kind discriminator to it —
      `ClipStripEntry.test.tsx:96-165` asserts on `.clip-strip__frame` / `.clip-strip__poster` class
      names and the `w-24` utility, so shared-markup refactors ripple.
- [x] 4.2 Render it in `src/results/MultiClipVideoSession.tsx` as a **preceding sibling** of the
      clip `<ul>`, not a member of it, and outside the `clipIds.length > 0` gate at `:282` so it
      renders at zero clips. Read the `modelLoad` prop section 1 threaded in.
- [x] 4.3 Do not widen `ClipStripCondition`'s closed 8-member union to carry model states, and do
      not renumber clips.
- [x] 4.4 Never a fabricated percentage, and never a reading that can decrease. **Amended in place
      by implementation** (this list's own rule; the original read "determinate width only where a
      byte total exists"): the primary owner's total is *known* and *not yet the total*
      simultaneously, so every fraction derived from it falls when the shards begin. What ships is
      the measured transferred-byte figure — monotonic by construction — with the indeterminate bar
      treatment throughout and no width anywhere. Reasoning and the two rejected alternatives:
      design.md **D11.1**. The spec requirement was refined to match; `strides-utn.6` is closed by
      it.
- [x] 4.5 Failure caption on error, instead of sitting at a loading caption forever. **Decide retry
      explicitly** — implemented, or declined in writing in design.md D7 — noting
      `movenet.ts:313-316`'s argument that there is no natural retry moment. **DECLINED**, with the
      copy naming the recovery instead; design.md **D11.2**, revisitable as `strides-2rp`.
- [x] 4.6 Keep the single-live-region budget: the entry must not become a second announcer against
      the active clip's `role="status"` caption (`ClipStripEntry.tsx:169`). State the ownership rule.
- [x] 4.7 House style: `animate-pulse bg-brand-600` for indeterminate work and a hatched
      `repeating-linear-gradient` for error (`ClipStripEntry.tsx:223-249`); neutral placeholder
      rather than a spinner (`:143-151`); sentence case with a trailing ellipsis. The determinate
      inline-width treatment is deliberately unused here — see 4.4.
- [x] 4.8 **Verify LIVE in headless Chromium at narrow viewports** that the leading entry does not
      push the analysing clip's `<video>` out of the horizontally-scrolling strip. A concealed
      element measures healthy through layout APIs and dead at the sampler, so a unit test cannot
      catch this; concealment costs ~20–24% of sampled frames on the playback path.
- [x] 4.9 `npx tsc -b`, `npm run lint`, `npm test` all green.

## 5. Epic close-out

- [x] 5.1 Reconcile this change's deltas against `openspec/specs/` one last time, including deleting
      the MoveNet requirement if section 3 was withdrawn.
- [x] 5.2 `openspec validate model-load-visibility-and-cache --strict` clean.
- [x] 5.3 Update CLAUDE.md with what was measured — the model-fetch seam per asset, the cache key
      scheme, and any determinism or throughput effect the live checks turned up.
- [ ] 5.4 `openspec archive model-load-visibility-and-cache --yes`, once the whole epic has shipped
      and is verified. Not before.

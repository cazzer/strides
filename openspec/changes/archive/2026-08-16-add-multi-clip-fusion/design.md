## D1 — Compose hooks unmodified, don't rewrite them per-clip

Rejected alternative: turn `useVideoSource`/`useVideoAnalysis`'s single-instance refs/effects/state
into per-clip-keyed maps internally. React's rules of hooks forbid a hook owning a *variable
number* of effects/refs at runtime — every `useEffect`/`useRef` call site has to be static across
renders. Faking that with an internal map of clip-id → state is possible but turns two already
carefully-reasoned-about hooks (`useVideoAnalysis.ts` alone runs ~500 lines of run-id-guarded
async coordination, scale-pass sequencing, and auto-start/loop effects) into their own worst case:
every one of those effects would need to iterate a dynamic clip set, and every stale-closure /
cleanup-ordering bug this codebase's existing comments show was hard-won (`runIdRef`,
`autoStartedForRef`, `scalePassStartedForRunRef`) would need re-deriving per-clip.

Chosen: mount one full, completely unmodified `useVideoSource()` + `useVideoAnalysis()` pair per
clip id, via `ClipSlot`, a component rendered once per id. `useVideoAnalysis.ts` needs zero
internal changes beyond the mechanical `runClipAnalysisPipeline` extraction (which is itself
behavior-preserving and independently tested); `useVideoSource.ts` needs none at all. This is what
makes the single-clip regression provable rather than merely asserted: for N=1 the render tree is
one `ClipSlot` wrapping the exact hook pair `App.tsx` used to call directly, so N=1 behavior is
N=1 behavior by construction, not by a parallel code path that happens to agree today.

## D2 — `runClipAnalysisPipeline` extraction scope

The extraction pulls exactly the synchronous part of the pipeline — sort → `applyRobustness` →
`trimToPresenceWindow` → `computeFormHeuristics` → `computeAnalysisDiagnostics` — into one pure
function, called from both of `useVideoAnalysis.ts`'s two existing call sites (the primary run's
IIFE, the scale pass's effect). The async sampling (`sampleClip`) and all state-machine/ref
bookkeeping around it stay in `useVideoAnalysis.ts` untouched — this is not a rewrite of the hook,
just de-duplication of the one pure computation both branches already performed identically.

**Deviation from the initial pipeline sketch**: an earlier sketch of this function's signature
included a third `samplingPath: 'sequential' | 'playback'` parameter threaded into
`computeAnalysisDiagnostics`. This worktree's checkout of `computeAnalysisDiagnostics`
(`analysisDiagnostics.ts`) takes exactly three parameters — `(samples, robustFrames, heuristics)`
— with no such concept anywhere in the codebase (`grep -rn samplingPath src` — zero matches
pre-change). Adding a fourth argument to a call the function doesn't accept is a type error, and
more importantly would not be a mechanical, behavior-preserving extraction — the entire point of
landing this file first and re-running the untouched test suite against it. The parameter was
dropped; `runClipAnalysisPipeline` takes `(samples, samplingRobustnessConfig)` and reproduces the
exact 3-argument call `useVideoAnalysis.ts` already makes. (A `samplingPath` concept may exist on
a newer `main` than this worktree branched from — the WebCodecs sequential-decode sampling work
referenced in this repo's CLAUDE.md — but reconciling with that is out of scope for a worktree
this ticket was explicitly told not to rebase onto main.)

## D3 — `fuseFormHeuristicsResults` picks the whole object, explicit fields not a loop

Per the ticket: picking a scalar field per metric and reassembling would silently drop
`verticalOscillation.series`/`.fit` and `verticalOscillationCm.calibration` — payload that has to
travel with whichever clip's object won. Explicit per-field picks (one line per `MetricId`) rather
than a generic `Object.keys` loop matches this codebase's established style
(`FormHeuristicsResult`'s own field list, `graftScalePassResult`'s explicit metric name) of
concretely-typed code over generic patterns needing casts — and makes the #45/#46 follow-up (one
more line per new metric) a visible, unmissable diff rather than something a generic loop would
absorb silently (and incorrectly, if a future metric's fusion policy ever needs to differ).

`view: ViewDetectionResult` is not a `MetricId` and has no `caveat` field, so it gets its own
one-line rule: highest-confidence source's `view` object, by reference, no provenance suffix.

N=1 short-circuits to `results[0]` by reference (`===`, not deep-equal) — this is the concrete
mechanism the single-clip acceptance criterion rests on: `computeAggregateAnalysisState` calls
`fuseFormHeuristicsResults([soleClip.heuristics])` once that clip is ready, and that call returns
the exact object `computeFormHeuristics` produced, untouched.

## D4 — `multiClipAnalysis.ts`'s aggregate is intentionally lossy for `robustFrames`/`diagnostics`

`computeAggregateAnalysisState` always reports `robustFrames: null` and `diagnostics: null` at the
aggregate level. Neither has a sane N-clip merge (whose skeleton overlay would an aggregate
`robustFrames` even draw?) and neither is read by anything downstream of the aggregate:
`ResultsView`/`MetricsPanel` read `heuristics`, and the skeleton overlay is rendered per-clip
inside `ClipSlot` off that clip's own `analysis.robustFrames` — never off the aggregate. Making
these fields honestly `null` rather than e.g. concatenating them avoids inventing a merge
semantics nothing consumes.

## D5 — `nextActiveClipIndex` terminal-state rule doubles as the concurrency mitigation

A clip is "done with the shared detector" only once BOTH its primary pass (`phase` is `'ready'` or
`'error'`) AND its scale pass (`scalePass.status` is `'done'`/`'failed'`/`'skipped'`) are terminal
— not just the primary. The scale pass runs its own separate MediaPipe detector
(`scalePassDetector.ts`, a second module-level-cached singleton, same VIDEO-mode
strictly-increasing-timestamp hazard as the primary's tracking-crop hazard) *after* the primary
reaches `'ready'`, replaying the clip a second time — so gating only on the primary phase would
still let clip N+1's primary pass start sampling against the shared *primary* detector while clip
N's scale pass is still replaying against its own detector. Those are different detector
instances, so that specific overlap wouldn't corrupt tracking state by itself — but the rule is
written on "this clip's entire pipeline is finished touching any shared detector" rather than
"the primary detector specifically is free," both because that is the simpler invariant to reason
about and because it keeps `MultiClipVideoSession` from needing to track two independent
detector-busy flags per clip.

For N=1, `nextActiveClipIndex` is a permanent no-op (stays 0 forever) — there is never a second
clip to advance to.

## D6 — `ClipSlot`'s `detector: null` reuses an existing contract, adds no new one

`useVideoAnalysis(videoSource, detector)` already treats `detector === null` as "don't auto-start,
and error if `start()` is called explicitly" (`detector-unavailable`). `MultiClipVideoSession`
handing `null` to every non-active clip is therefore not a new gating mechanism grafted onto
`useVideoAnalysis` — it's the same signal the hook already understands as "no detector available
yet," reused to mean "no detector available *to this clip* right now." The queued-clip UI hint in
`ClipSlot` (`videoSource.status === 'ready' && analysis.phase === 'idle' && !detector`) is the only
new behavior layered on top, and it's presentational only.

## D7 — a real StrictMode/object-URL race, found only by live-browser verification

Live two-clip verification (real GPU, side-view + front-view demo clips uploaded as separate
files) initially reproduced a genuine bug: the SECOND mounted `ClipSlot`'s video reliably failed
to decode (`MEDIA_ELEMENT_ERROR: Format error`, native `HTMLMediaElement.error.code === 4`) while
the first clip's decoded fine — reproducible regardless of which file was "first" vs. "second",
ruling out anything about the specific clip content. Root cause, isolated by process of
elimination (a minimal two-`<video>` harness outside React worked fine; a raw non-React `<video>`
injected into the running app while clip 1 was actively GPU-sampling also worked fine — so it was
neither a generic browser decode-contention limit nor a page-wide GPU contention issue): this
app mounts under `<StrictMode>` (`src/main.tsx`, pre-existing, untouched), and `ClipSlot`'s
original implementation called `videoSource.load(pendingLoad.source, ...)` **synchronously**
inside a mount-time `useLayoutEffect`. `useVideoSource.ts` (explicitly out of this change's scope)
has its own unmount-only cleanup effect that revokes the current object URL. StrictMode's dev-only
"run every effect's setup, then every effect's cleanup, then every effect's setup again" mount
simulation therefore revoked the JUST-created blob URL a moment after creating it — for the
SECOND clip specifically, because it was the first (and, before this change, ONLY) place in this
codebase where `load()` had ever been called from a mount-time effect. Every existing call site
(`VideoInputPanel`'s picker, `DemoVideoButton`, `WebcamCapture`) calls `load()` from a real user
event, always well after a component's initial StrictMode dance has already settled — so this
latent interaction between `useVideoSource`'s cleanup and a mount-time caller was never triggered
before `ClipSlot`'s `pendingLoad` path existed.

Fix (`ClipSlot.tsx`, not `useVideoSource.ts` — the latter is out of scope and the bug is really
about *when* it's called, not a flaw in its own logic): defer the `load()` call by one microtask
(`queueMicrotask`) rather than calling it directly in the effect body. Microtasks flush after the
current synchronous JS finishes — which includes StrictMode's cleanup-then-resetup dance, itself
entirely synchronous — but still before the browser paints, so this doesn't reintroduce the
picker-UI flash `useLayoutEffect` was chosen to avoid. Verified fixed live: re-ran the identical
two-clip session after the fix and both clips' videos decoded and analyzed successfully end to
end, including the fused `MetricsPanel` correctly attributing `armSwingSymmetry` to the front-view
clip ("Combined from clip 2 of 2") while every side-view-primary metric attributed to the side
clip ("Combined from clip 1 of 2") — the acceptance criterion made concrete. A regression test
(`ClipSlot.test.tsx`) asserts the deferred load still lands (`await act(async () => {})` to flush
the microtask) so this doesn't silently regress to a synchronous call later.

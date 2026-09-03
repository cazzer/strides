# Design — model load visibility and persistent model cache

## D1. Why this is one change and not four

`strides-utn` has four implementation children (`.1`, `.3`, `.4`, `.5`) plus a measurement spike
(`.2`). All four implementation children write to the `pose-detection` spec.

CLAUDE.md records a real, silent data-loss footgun in this repo's openspec workflow: a MODIFIED
block REPLACES the whole requirement body, so two in-flight changes that MODIFY the same requirement
clobber each other — last archive wins, the loss is invisible in the archive output's `~ 1 modified`
line, and `openspec validate --strict` does not catch it. It has already happened here once for
real (`navbar-clip-shell` vs `inline-annotated-evidence`, 2026-08-18), and neither change was a
superset of the other, so no archive order alone was correct.

Four parallel changes on one capability is exactly the shape that produces that. One change with a
per-ticket `tasks.md` removes the failure mode structurally instead of relying on archive ordering
and on every later agent remembering to diff delta headers against each other. The cost is that the
change stays in flight until the whole epic ships — which is the intended lifetime anyway, since
`.5` cannot render honest progress until `.3` populates it.

**Consequence for later agents on this epic**: check off your own numbered section in `tasks.md`,
and if you need to change a requirement another section already ADDED, edit that block in place
rather than adding a second one.

## D2. The load-state shape: a phase, and progress that is allowed to be absent

```ts
export type ModelLoadPhase = 'idle' | 'loading' | 'ready' | 'error'
export interface ModelLoadProgress { loadedBytes: number; totalBytes: number }
export interface ModelLoadState { phase: ModelLoadPhase; progress: ModelLoadProgress | null }
```

Three decisions worth stating.

**`progress: null` means indeterminate, and it is not a zero.** `strides-utn.2` has already
established from `node_modules` that at least one asset is structurally uninstrumentable: MediaPipe's
`FilesetResolver` exposes no WASM progress hook at all, and tfjs's own `LoadOptions.onProgress` is a
fraction of FILES, not bytes (`tfjs-core/dist/io/weights_loader.js:74`), so it cannot be converted
into one. A shape that forced a number would force `.5` to invent one. `null` is the honest value,
and `.5`'s spec forbids rendering a percentage from it.

**`idle` exists for the scale pass, not for the primary.** The primary detector is created on mount,
so its phase is `'loading'` from the first render and never idle. That is expressed in the type
rather than in a comment: `PoseDetectorStatus` is now `Exclude<ModelLoadPhase, 'idle'>`, which keeps
the existing `'loading' | 'ready' | 'error'` union byte-for-byte and keeps
`usePoseDetector.test.ts` green unchanged. The scale-pass detector is lazy — it is genuinely idle
until an analysis run asks for it — so the shared phase union has to carry a fourth member.

**Progress is per-owner, not per-asset.** Each owner already fetches more than one asset (MoveNet
fetches single-pose and multi-pose; the scale pass fetches WASM and a `.task`). Aggregating inside
the owner keeps `.5` from having to know the asset inventory. `strides-utn.3` populates these
fields; `strides-utn.1` builds the channel and leaves them `null`.

**Where `.3` plugs progress in** (recorded so it is not re-litigated): the primary hook holds
`progress` as its own state, so the natural extension is an optional progress callback threaded into
`createDetector`; the scale-pass module publishes through the same `setLoadState` the phase already
goes through. `.1` deliberately does not pick between that and a progress bus inside the shared
cache utility, because the choice belongs with the utility. What `.1` pins is the **shape** — which
is the part `.5` renders against. `.3` has since chosen the callback, for reasons that only became
visible once the utility existed: **D8**.

## D3. The scale-pass singleton gains an observation channel, and stays a singleton

This is the part of `strides-utn.1` that contradicts an existing, deliberate comment, so the
justification is recorded here rather than the comment being quietly deleted.

The module doc at `src/pose/scalePassDetector.ts:6-11` reads, in part:

> Lives at module level rather than in a hook because the scale pass is not a render concern:
> nothing re-renders on this detector's readiness, and the whole point of the cache is amortizing
> MediaPipe's WASM/model load across every analysis run on the page — a per-pass create/dispose
> cycle would pay it every time.

**That sentence bundles an observation and a reason, and only the observation has changed.** The
reason the detector lives at module level is that a React-owned resource is scoped to a component's
lifetime: a hook that creates it would tie a 9.4 MB model plus a WASM runtime to a mount, and a
remount would pay for both again. That is still true and this change does not touch it. The clause
that is now false is the incidental one — "nothing re-renders on this detector's readiness" — and it
was never the load-bearing half. It described the product as it stood, not a property the design
requires. `strides-utn` exists precisely because that state of affairs is the bug: the reader waits
on an unmentioned 9.4 MB fetch while the UI says the clip is Ready.

So the singleton gains an **observation channel** and does not become a React resource. Mechanically:

- **The channel is plain publish/subscribe with no rendering library involved.** A module-level
  `Set` of listeners, a `getScalePassDetectorLoadState()` snapshot reader, and a
  `subscribeToScalePassDetectorLoad(listener)` returning an unsubscribe function.
  `scalePassDetector.ts` imports no React, and that is the enforcement: the React adapter is a
  separate file (`useScalePassDetectorLoad.ts`, a `useSyncExternalStore` over those two functions),
  so the singleton cannot acquire a component lifetime by accident.
- **Ownership is unchanged.** `getScalePassDetector()` is still the only creator, still the only
  thing that installs the pending promise, and still the only thing that caches the instance for the
  page lifetime. Subscribers read; they never create.
- **Subscribing SHALL NOT start a download**, and there is a spec scenario for it. An observation
  channel that triggers the thing it observes would have converted a lazy 9.4 MB fetch into an eager
  one on every page load — which is the cost this epic explicitly declined to take.
- **The two existing guarantees are untouched and still tested**: the page-lifetime instance cache,
  and the refusal to read `resolvePoseDetectorConfig()` / `__STRIDES_POSE_BACKEND_OVERRIDE__`. The
  channel publishes phase transitions the accessor was already making internally; it adds no new
  branch to the creation path beyond `setLoadState` calls.
- **`__disposeForTests()` resets the published state to `idle`** along with the instance and pending
  promise, so module state is genuinely isolated between tests. It does not clear the listener set:
  listeners are owned by whoever subscribed, and `renderHook`'s unmount already removes them.

**The comment is rewritten, not removed.** Its new wording keeps the module-level rationale and
replaces the falsified clause with the design that replaced it — a plain subscription for observers,
with creation still owned by the accessor.

One React mechanic worth recording because getting it wrong is an infinite render loop rather than a
visible bug: `useSyncExternalStore`'s `getSnapshot` must return a **referentially stable** value
between transitions. The module holds one `ModelLoadState` object and replaces it only on an actual
phase change, so the snapshot reader returns the same reference across renders.

## D4. Threading, and why `MultiClipVideoSession` does not read it yet

`src/App.tsx:17-19` destructures `.detector` and drops `status`. It now reads both owners and passes
one grouped prop:

```tsx
const poseDetector = usePoseDetector()
const scalePassLoad = useScalePassDetectorLoad()
const modelLoad = useMemo(
  () => ({ primary: poseDetector.load, scalePass: scalePassLoad }),
  [poseDetector.load, scalePassLoad],
)
return <MultiClipVideoSession detector={poseDetector.detector} modelLoad={modelLoad} />
```

The `useMemo` is not ceremony: `App` re-renders on every phase transition of either owner, and this
repo has already been bitten by a fresh object identity per render forcing work downstream
(`sameClipSession`'s whole docstring). A stable `modelLoad` keeps that prop quiet once both owners
settle.

`MultiClipVideoSession` **declares and receives the prop and deliberately does not render it.**
`strides-utn.1` is the wire only — `.5` owns every pixel — and the two tickets run in parallel, so a
placeholder rendering here would collide with the component `.5` is writing. The prop is declared on
the props interface and documented as reserved for `.5`; the component destructures only `detector`
from its props object, so the unread prop is a documented seam rather than an eslint-suppressed
dead binding. That the value genuinely arrives was verified live, not by unit test — see D6.

## D5. Which capability each requirement lands in

- **`pose-detection`** takes the observability requirement, the shared cache/progress seam, and both
  per-asset routing requirements. That capability already owns
  "Scale-pass detector is dedicated, cached, and exempt from the backend override", which is the
  requirement the observability one sits beside.
- **`results-view`** takes the header model-download entry. It is deliberately NOT in
  `multi-clip-analysis`, even though the clip strip is specified there: placing it there would imply
  the entry participates in the clip enumeration that
  "Clips are presented as a strip in the application header, one entry per clip" depends on, and the
  entire resolution of that conflict is that it does not. The new requirement names that one and
  asserts the counting invariant is unchanged.
- **Nothing is MODIFIED.** Every requirement in this change is ADDED. The existing scale-pass
  requirement's text — page-lifetime cache, null-not-throw, retry after failure, no config read —
  remains true word for word after this change, so rewriting its body would only create clobber
  surface for no gain.

## D6. Verification, and what unit tests cannot reach

The unit suite mocks `createDetector` outright (`usePoseDetector.test.ts`,
`scalePassDetector.test.ts` both `vi.mock('./detector')`), so it can prove the state machine and
cannot prove the wire. `strides-utn.1`'s live check therefore drove the real app in headless
Chromium on real GPU per CLAUDE.md's harness section — derived dev-server port 5349, renderer
`ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)`, never SwiftShader — with a temporary dev-only
log inside `MultiClipVideoSession` reading `props.modelLoad`. Measured, on a cold page load followed
by Demo 2 (the local clip):

| t (ms from first render) | `primary.phase` | `scalePass.phase` |
|---|---|---|
| 0 | `loading` | `idle` |
| +1,326 | **`ready`** | `idle` |
| +7,980 | `ready` | **`loading`** |
| +8,328 | `ready` | **`ready`** |

Two things that reading confirms beyond "the prop arrives". The primary settles **6.7 s before** the
scale pass even starts, which is the two-independent-downloads shape this epic is built around — a
single aggregate phase would have hidden it. And the scale pass sat at `idle` through the whole of
that window despite being subscribed from mount, which is the live evidence for D3's "subscribing
does not start a download". `progress` was `null` on every line, as `strides-utn.1` intends.

The log was removed before the ticket closed, per this repo's add-measure-revert cycle.

`strides-utn.5`'s viewport check is the same class of problem and is an acceptance criterion for the
same reason: a concealed `<video>` measures healthy through `getBoundingClientRect` and dead at the
sampler, so no unit test can see it. Measured cost of concealment: ~20–24% of sampled frames on the
playback path, at any size, by any mechanism.

## D7. Open decisions deliberately left to their own tickets

- **Retry after a failed model download (`strides-utn.5`).** `movenet.ts:313-316` argues at length
  that there is no natural "try again" moment: the detector instance is created once and cached for
  the whole app lifetime, and creation cost is paid up front for every run it will ever serve. So
  retry is a real product decision, not a checkbox. `.5` must decide it explicitly — implemented, or
  declined in writing — and its spec requirement says so.
- **`strides-utn.4`'s withdrawal path.** That ticket is gated on `strides-utn.2`'s browser
  measurement of whether MoveNet's responses are CORS-readable with a usable `Content-Length` from a
  real page. If the spike returns no-go, the requirement
  "MoveNet model weights load from the shared model cache" is **deleted from this change's
  `pose-detection` delta** before archive and `strides-utn.4` closes as not-feasible with the
  measurement recorded — the same discipline `derive-area-floor-from-4k-measurement` used when its
  measurement showed a drafted requirement was unsatisfiable. Weakening the requirement to fit
  whatever the spike found would be editing a criterion to match a result.
- **Eager prefetch of the MediaPipe model is out of scope for the whole epic**, by an explicit
  decision on `strides-utn`: 9.4 MB unconditional for a visitor who may never analyse a clip is a
  cost this repo is not paying today. Downloads are instrumented where they already happen.

## D8. `strides-utn.3` chose a callback over a progress bus, and why

D2 left this open on purpose. The choice is a **callback**: `createDetector` takes a second
argument, `DetectorCreationOptions`, carrying an optional `onAssetProgress`, and each owner folds
its assets' readings with `aggregateModelAssetProgress` from the cache utility.

The bus alternative was not rejected for being heavier. It was rejected because **it does not buy
less threading**. `createMediaPipePoseLandmarkerDetector` serves BOTH owners — the scale pass
always, and the primary whenever `__STRIDES_POSE_BACKEND_OVERRIDE__` selects mediapipe — so a bus
would still need an owner tag threaded down through exactly the same call chain. It would replace a
function argument with a string argument and add module-global mutable state that tests must reset,
for the same reach.

Two things decided it beyond that:

- **A bus would introduce a second writer to the scale-pass channel**, which contradicts D3. That
  section's whole claim is that ownership is unchanged: `getScalePassDetector` is still the only
  thing that publishes, and observers only read. A bus that published progress from inside the
  fetch utility would make the utility a publisher on a channel it does not own.
- **`strides-utn.4` needs per-shard progress from inside a tfjs `io.IOHandler` that WE
  construct.** A closure is the natural carrier there; there is nothing to key a bus on that is
  more convenient than the callback already in hand.

The utility therefore knows nothing about owners, phases, or React — it reports bytes for an asset
id, and the owner decides what that means. `aggregateModelAssetProgress` is the piece that keeps
`.5` from needing the asset inventory: it sums per-file readings into one `ModelLoadProgress`, and
**one unknown total makes the whole reading indeterminate**, because summing only the totals that
happen to be known would report a total that is not the total.

**The primary's `progress` stays `null` on today's default backend.** MoveNet routes nothing through
the utility until section 3. That is the seam working, not a gap: `null` means indeterminate, and a
download nobody is measuring is exactly that.

### D8.1 Two guards on `Content-Length`, because one is not enough

`strides-utn.2` measured that trust has to be decided per response. The header check
(`content-encoding` absent or `identity`) is the first guard. It is **not sufficient on its own**: a
cross-origin response only exposes `content-encoding` when the server lists it in
`access-control-expose-headers`, so a compressed cross-origin body can present a compressed
`Content-Length` with nothing to flag it.

The second guard is in the read loop — a declared total the decoded body has already **overrun** was
measuring something else, whatever the headers said, and the reading drops to indeterminate from
that point. Together they catch the measured ~376% case from either direction.

The download closes with `{ loadedBytes, totalBytes: loadedBytes }`. That is a measurement, not an
invention — the asset is complete and it was exactly that many bytes — and it stops an asset whose
total was never readable from holding a multi-file aggregate at indeterminate after it has finished.

### D8.2 The cache key is a caller-supplied identity, never the fetched URL

The single most load-bearing line in the utility. `strides-utn.2`'s headline finding: MoveNet's
files resolve through two 302s to a `storage.googleapis.com` URL whose `X-Goog-Date` and
`X-Goog-Signature` **differ on every request**. A cache keyed on `response.url` would miss 100% of
the time and silently do nothing at all — no error, no warning, just a feature that does not work.

So `ModelAssetSpec` separates `id` (stable, the key) from `url` (what is fetched, may be signed and
may redirect), and nothing in the module reads `response.url`. For the `.task` the two are the same
string; for MoveNet they will not be. There is a unit test that fetches twice under one `id` with
two different signed URLs and asserts the second issues no request.

Keys live under a synthetic `https://model-asset.strides.invalid/asset/<id>?v=<version>` origin:
`Cache.put` requires an http(s) scheme but never fetches the key, so a URL that cannot resolve is
both legal and unambiguous about being a key rather than a resource. Eviction scans `cache.keys()`
for the same `id` prefix at a different `v` — **scoped to the asset whose token moved**, so bumping
one model does not discard every other cached asset.

## D9. What the live run measured (`strides-utn.3`)

Headless Chromium, `--headless=new --enable-gpu --ignore-gpu-blocklist`, renderer
`ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)` — never SwiftShader. Derived dev-server port
5371, identity-verified by nonce. Two runs against **one persistent Chromium profile**, so Cache
Storage survives between them; Demo 2 driven to "Analysis complete" and then to the
`[analysis-diagnostics:scale-pass]` line, which is what creates the MediaPipe detector and therefore
what pulls the `.task`. Network read via CDP `Network.*` (`encodedDataLength` and `fromDiskCache`
are available nowhere else).

| `pose_landmarker_full.task` | requests | transferred |
|---|---|---|
| cold (fresh profile) | 1 | **9,398,460 bytes** |
| warm (same profile) | **0** | **0 bytes** |

**The warm run issues no request at all** — not a 304, which is what `strides-utn.2` measured on the
old path (127 bytes), and not a disk-cache hit either. Cache Storage held exactly one entry, of
9,398,198 bytes, under
`https://model-asset.strides.invalid/asset/%2Fstrides%2Fmodels%2Fpose_landmarker_full.task?v=md5-5a9ad88919b2231d02b1fdf4a54090ec`.

**Analysis output did not move.** Both runs report `verticalOscillationCm`
**`10.486597716761532`**, `fit.frequencyHz` 3.12, `sampleCount` 98, `torsoMeters`
`0.464629504405643`, `medianPixelsPerMeter` `520.898452525673`, `subjectAgreement` 99/99 — every
digit matching CLAUDE.md's standing fresh-process Demo 2 anchor. Since that whole figure is derived
from the landmarker's own output, it is the check that the model bytes reaching MediaPipe are
identical whether they came from the cache or the network.

**The WASM confirms the decision to leave it alone** (constraint 1): cold 2 requests /
3,207,489 bytes, warm 2 requests / **0 bytes**, served from the browser's own disk cache. Caching it
ourselves would have cost 11.76 MB of quota to save nothing.

⚠️ **One harness limitation, recorded so it is not misread**: this driver classifies assets by their
FINAL URL, and MoveNet's final URL is the signed GCS one, which matches no `movenet/...` pattern. Its
rows therefore read "NO REQUEST" in both runs — that is the classifier, not the network.
`strides-utn.2`'s driver tracked the redirect chain and is the one to reuse for section 3.

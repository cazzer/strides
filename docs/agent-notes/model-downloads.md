# Model downloads and caching

> Moved verbatim from CLAUDE.md on 2026-10-27 to keep the auto-loaded file under the size limit. Index: CLAUDE.md "Notes index". Cross-references like "above"/"below" may now point into a sibling file in this directory.

## Model downloads: cached client-side, and visible in the header (2026-09-03, epic `strides-utn`)

Pipeline model assets used to re-download on every page load and say nothing while they did. Both
halves are fixed. Change: `openspec/changes/archive/2026-10-14-model-load-visibility-and-cache/`.
Built 2026-09-03, **merged to `main` 2026-10-14**, six weeks late, onto a main that had meanwhile
gained `strides-w59`'s scale-pass prefetch. The two now cooperate: the prefetch asks
`hasCachedModelAsset` first and leaves the `.task` out once it is cached, so a returning visitor's
prefetch never re-downloads 9.4 MB. Re-verified at merge, real GPU: `ab-person-selection --evidence`
on three clips identical to `main` on every field but `elapsedMs`; cold visit downloads the `.task`
ONCE (the prefetch; creation's fetch then reads a 0-byte body from the HTTP cache); warm visit makes
**zero** MoveNet and zero `.task` requests. The separate eager page-load prefetch branch
(`strides-noo`/`strides-gyl`) was NOT merged — `strides-w59` superseded it.

**Two independent, differently-timed downloads, and MoveNet is the big one.** The epic's own spike
(`strides-utn.2`) inverted its priority, so do not repeat the original assumption:

| | when | cold | warm (after the cache) |
|---|---|---|---|
| MoveNet SinglePose + MultiPose Lightning, 7 files | **app mount** | **14,522,593 B** (7 requests, 2 redirect hops each) | **0 requests, 0 bytes** |
| MediaPipe `pose_landmarker_full.task` | only after a first clip reaches `'ready'` | 9,398,198 B | **no request at all** |
| tasks-vision WASM (jsdelivr) | with the `.task` | 3.12 MB on the wire | 0 B, from the browser's own cache |

- **MultiPose alone (9,697,908 B) exceeds the `.task`**, and is paid only because
  `personOfInterestConfig.enabled` is `true`.
- **The browser's cache can never hold MoveNet's bytes**: tfhub 302s to Kaggle, which 302s to a
  **per-request SIGNED** `storage.googleapis.com` URL served `cache-control: private, max-age=0`.
  Client-side storage is the only route, which is why `strides-utn.4` exists.

**`src/pose/modelAssetCache.ts` is the one fetch seam** — progress and caching together, because
they read the same stream. Cache Storage (`strides-model-assets-v1`), keyed on a caller-supplied
**stable identity plus a version token**, never on `response.url` (a signed URL would miss 100% of
the time and silently disable the cache). The version is SPLIT OUT of the id so a model bump evicts
rather than orphans. Three measured constraints not to relax without re-measuring:

1. **Do not cache the tasks-vision WASM.** Already `immutable`, already 0 warm bytes, and Cache
   Storage stores the DECODED body — 3.12 MB on the wire would occupy 11.76 MB of quota to save
   nothing. It also has no progress hook at all (`FilesetResolver` exposes none).
2. **Trust `Content-Length` PER RESPONSE.** The WASM ships `content-encoding: br`, so its declared
   length is the compressed one and a naive `loaded/total` there reads **~376%**.
3. Cache Storage round-trips all of it byte-identically, CORS responses included; measured quota
   ~10.76 GB, so the whole model set is ~0.2–0.3% of it.

**⚠️ `ModelLoadState.progress.totalBytes` GROWS during a load, and a percentage derived from it goes
BACKWARDS.** Each file's total is known only when its own headers arrive, and MoveNet's shards are
not NAMED until `model.json` is parsed — so the primary's aggregate climbs ~417 kB → ~14.5 MB, and
`loaded/total` falls from ~100% to ~3%. This is honest data, not a bug in the reading. Seeding the
shard totals from the weights manifest was **rejected**: the manifest gives a per-GROUP total but not
its split across `paths`, so reconstructing it means assuming the converter's 4 MiB shard size. The
header therefore renders **transferred bytes and no fraction anywhere** — `loadedBytes` is the one
monotonic quantity available (`src/results/modelLoadStripStatus.ts`; design.md D10.4/D11.1). A
high-water mark on the fraction is WORSE, not safer: both `model.json` files complete before any
shard's headers arrive, so it pins at 100% for the remaining ~14.1 MB.

**Reading it live**: the entry is `.model-load-entry`, with
`data-model-load-condition="loading" | "error"`, `.model-load-entry__caption`, and no `%` anywhere.
Measured cold, 60 Hz rAF sampling: 43 strictly non-decreasing readings, `Loading` → 417 kB → 14.5 MB
→ gone, over **1,302 ms**. Warm it is visible for **67 ms** and issues **0** model requests. The
scale-pass download brings it back mid-session (~2.2 s after mount on Demo 2, gone by 2.8 s) reading
*Downloading the scale model…*.

**The strip's scroller is the wrapper `<div className="clip-strip">`, not the `<ul>`** — moved out
one level so the model entry can be a preceding SIBLING of `<ul aria-label="Clips">` (the
one-entry-per-clip count that makes *"Combined from clip N of TOTAL"* matchable by counting must not
be broken) while still scrolling with the clips. At **390 px the strip's own box is 158 px**, so a
leading entry OUTSIDE the scroller would leave a 96 px clip frame **50 px visible** — the
concealment failure, not a cosmetic one. `ClipStripEntry`'s scroll effect now keys on
`leadingEntryPresent` as well as `hostsLiveElement`, because the scale pass's download starts while
a clip is ALREADY hosting its element, so nothing about the clip changes: measured, the strip scrolls
46 px at that moment and the frame stays 96/96 px visible. Latent hazard recorded as `strides-kkl`.

**No throughput cost.** Narrow-viewport (390×844) Demo 2 on the PLAYBACK sampler, 3 trials/arm,
fresh process and fresh profile each: primary `detectedFrames` 58/56/57 before → **58/58/58** after;
scale pass 85/85/85 → 84/85/85. Full-matrix
`ab-person-selection --arm 'base={}' --clips demo1,demo2,multiperson --trials 3` before/after differs
on **`elapsedMs` alone**.

**No in-product retry, deliberately** (design.md D11.2, revisit on `strides-2rp`): the primary
detector is created once at mount and cached for the app lifetime, so its failure window is before
any clip exists and a page reload costs the reader nothing; the scale pass already retries itself on
the next analysis run. The failure copy names the action instead — *"The pose model could not be
downloaded. Reload the page to try again."*

**The entry never announces.** `results-view` allows one live region for session progress and the
active clip's `role="status"` caption holds it; the entry exposes its condition as `sr-only` text
and adds no live region (verified live: 0 in the failure state, and the banner still has exactly 1
while a clip is analysed). It is NOT `aria-hidden` — unlike `strides-8zv`'s evidence placeholder,
which conveys nothing.


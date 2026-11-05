## Context

Strides is a static SPA on GitHub Pages (`https://cazzer.github.io/strides/`). Nothing runs on a
server we control, and the product promise is that video is analysed in the browser and never
reaches a Strides server. `strides-w85q` asks for persistence anyway: save an assessment to
storage the runner owns, and show how each metric moves across assessments. It subsumes
`strides-6ch` (local history, numbers only) and relates to `strides-83y` (before/after compare,
blocked on a measured same-runner noise floor).

What there is to save, at the moment a session is finished (`MultiClipVideoSession.tsx`):

- `aggregate.heuristics: FormHeuristicsResult`, the fused session result: `view` plus thirteen
  `MetricResult`s (`value`, `unit`, `confidence`, `viewFit`, `caveat`, `sampleSize`,
  `frameCoverage`, `interpolatedFraction`, optional `exemplars`). Tier is derived by
  `metricTier` (`normal | caveated | excluded`).
- `sourceIndices` (which clip each fused metric came from), `clipViewKinds`, each clip's
  `videoSource.metadata` and `videoSource.sourceBlob` (the original `File`/`Blob`, retained).
- The resolved pose-backend and sampling-robustness configs, each clip's
  `diagnostics.sampling.path`, scale-pass and outline-pass status.

## Goals / Non-Goals

**Goals:** a runner on desktop Chrome or Android Chrome (iOS Safari as best effort, D1) can
connect their own Google Drive, save an assessment, and open a progress view, with no Strides
server. Every saved number says which definition produced it. Nothing persists unless the runner
presses Save, and video is saved only if they tick it.

**Non-goals:** a second provider in this change (the adapter makes one cheap, D2); sync or
merge across providers; editing or deleting saved assessments from the app (the runner does that
in Drive); any "improved / got worse" verdict (`strides-83y`: no noise floor yet); re-analysing
saved footage; reading back exemplars or evidence images.

## Decisions

### D1. Provider: Google Drive via GIS token client + Drive API v3, `drive.file` scope

Compared for a backend-less SPA that must work on phones:

| option | browser-only auth | Android Chrome | iOS Safari | runner owns / sees the files | cost to us |
|---|---|---|---|---|---|
| **Google Drive**, GIS token client, `drive.file` | yes: implicit-style access token via popup, no secret, no refresh token | yes | popup must open inside the tap; reported flaky in some iOS versions | yes, a visible `Strides` folder in My Drive | one OAuth client; `drive.file` is **non-sensitive**, so basic verification only |
| File System Access API (`showDirectoryPicker`) | no auth at all | picker support is recent and not something we can rely on | **not supported** (WebKit position: oppose) | yes, but local disk only, no cloud copy | none |
| Dropbox, OAuth PKCE (`token_access_type=offline`) | yes, PKCE with refresh token, works in an SPA | yes (redirect flow) | yes (redirect flow, no popup) | yes, an App folder | a Dropbox app; production approval past 50 users |
| OneDrive, MSAL.js PKCE (SPA) | yes; SPA refresh tokens last 24 h | yes | yes (redirect) | yes, `approot` | an Entra app registration; ~70 kB msal-browser |

Decision: **Google Drive first**, as the user asked, and because `drive.file` gives exactly the
access we want: the app can see only files it created (or the runner opened with it), not the rest
of their Drive, and the scope is non-sensitive. `drive.appdata` was rejected: the app-data
folder is hidden from the runner, so they would not "own" their files in any visible sense.
File System Access fails on iOS outright, so it can only ever be a desktop extra. Dropbox (redirect
PKCE, refresh tokens) is the natural second provider if iOS popups prove unreliable; the adapter
(D2) keeps that a provider-sized change.

How the Google provider works (`src/storage/googleDrive/`):

- **Script loading is opt-in.** `https://accounts.google.com/gsi/client` is injected only after
  the runner taps *Connect Google Drive*, or on a later visit once they have connected before (the
  `strides.storage` record, D7). Nobody who never chooses Drive makes a request to Google.
- **Token client.** `google.accounts.oauth2.initTokenClient({ client_id, scope:
  'https://www.googleapis.com/auth/drive.file', callback, error_callback })`. The access token is
  held **in memory only** (never in `localStorage`), with its expiry (`expires_in`, about an hour).
  There is no refresh token in this model; an expired token is re-requested with
  `requestAccessToken({ prompt: '' })`, which opens and closes the popup without a click once
  consent exists.
- **The popup opens inside the tap.** `requestAccessToken` is called synchronously in the click
  handler, before any `await`, because Safari's transient activation lasts about a second and
  Chrome's about five. That is why Connect is two steps on a first visit: tap *Connect Google
  Drive* (loads the script), then *Continue to Google* once it is loaded. On a returning visit the
  script is preloaded and Save requests a token directly in its own click handler.
  `popup_failed_to_open` and `popup_closed` map to plain-language errors with a retry.
- **Drive API v3 over `fetch`**, no `gapi` client library. JSON files are written with
  `uploadType=multipart`; clips with `uploadType=resumable`, one `PUT` through `XMLHttpRequest`
  for upload progress events. Folders and files carry `appProperties` (`stridesKind`:
  `root | assessment | analysis | manifest | index | clip`, plus `stridesAssessmentId`) so lookups
  query by property, never by a name the runner might change.
- **Disconnect** calls `google.accounts.oauth2.revoke(token)`, drops the token and clears
  `strides.storage`. Saved files stay in the runner's Drive; the copy says so.
- **Config.** `VITE_GOOGLE_CLIENT_ID` at build time. Absent, the Google provider reports
  `unavailable` and the save panel says saving is not set up on this build; nothing else changes.
  `deploy.yml` passes the repository variable `VITE_GOOGLE_CLIENT_ID` (a client ID is public, so a
  variable, not a secret). GitHub Pages sets no `Cross-Origin-Opener-Policy`, so the GIS popup
  can post back.
- **Authorised JavaScript origins** are exact, port included: `https://cazzer.github.io`,
  `http://localhost:5177` (`npm run dev`'s default) and `http://localhost:5262` (the main
  checkout's derived harness port). An agent worktree's derived port is not registered; run it
  with `STRIDES_DEV_PORT=5262` (or 5177) when a check needs real Drive.

Creating the OAuth client is the runner/owner's job in Google Cloud Console, filed as a bd human
decision under `strides-w85q` with the click path. Everything else is built and tested against the
fake provider until it exists.

### D2. A small provider adapter; the store is provider-agnostic

```ts
interface StorageProvider {
  readonly id: 'google-drive' | 'fake'
  readonly label: string                      // "Google Drive"
  availability(): 'unavailable' | 'disconnected' | 'connected'
  prepare(): Promise<void>                    // load scripts; no popup
  isPrepared(): boolean
  connect(): Promise<void>                    // MUST be called synchronously from a user gesture
  ensureAccess(): Promise<void>               // same; re-asks with prompt '' when expired
  disconnect(): Promise<void>                 // same (may need a token to revoke with)
  findRoot(knownId?): Promise<StoredFolder | null>   // never creates
  ensureRoot(knownId?): Promise<StoredFolder>
  trash(folder: StoredFolder): Promise<void>  // clears a save that failed before its commit point
  createFolder(parent: StoredFolder, name: string, props: StoredProps): Promise<StoredFolder>
  writeJson(parent: StoredFolder, name: string, data: unknown, props: StoredProps,
            existing?: StoredFile): Promise<StoredFile>
  uploadBlob(parent: StoredFolder, name: string, blob: Blob, props: StoredProps,
             onProgress?: (fraction: number) => void): Promise<StoredFile>
  readJson(file: StoredFile): Promise<unknown>
  findByProps(parent: StoredFolder, props: StoredProps): Promise<StoredFile[]>
}
```

`src/storage/assessmentStore.ts` implements save, load-index and rebuild-index once, over any
provider. The fake provider (`fakeProvider.ts`) is in-memory, with an optional `localStorage`
mirror of metadata and JSON (never blobs, only their sizes). It backs unit tests and, through the
dev-only `window.__STRIDES_STORAGE_PROVIDER_OVERRIDE__ = 'fake'` (set with `addInitScript`, like
the other overrides), live checks with no Google account. The override is `import.meta.env.DEV`-gated
and absent from `vite build`.

### D3. On-disk layout

```
My Drive/
  Strides/                                        appProperties.stridesKind = root
    strides-index.json                            stridesKind = index
    2026-11-05 14.32 side+front (3f9a)/           stridesKind = assessment, stridesAssessmentId
      analysis-m1-2026-11-05.json                 stridesKind = analysis
      footage-manifest.json                       stridesKind = manifest
      clip-1.mp4                                  stridesKind = clip   (only if ticked)
      clip-2.mov
```

- **Folder name:** local date and time of the save, the session's distinct views, and the first
  four hex characters of the assessment id, so two saves in one minute never collide and a runner
  browsing Drive reads it at a glance. Names are for people; the app always finds things by
  `appProperties`.
- **Analysis file name:** `analysis-m<methodologyVersion>-<YYYY-MM-DD>.json` (the save's local
  date). The methodology version and date are in the name, as asked, and both are inside the file
  too, which is what the app reads.
- **Footage manifest is always written**, even when no clip is uploaded: per clip its position,
  file name, MIME type, size, `lastModified`, duration, dimensions, detected view, a SHA-256 of
  the bytes (`crypto.subtle.digest`), and whether the bytes were saved (with the uploaded file's
  name). The hash lets a runner match an assessment to a clip on their own phone without it ever
  being uploaded.
- **Clips are opt-in per save**, unticked by default, labelled with the total size. Uploaded
  under `clip-<n>.<ext>`, ext from the MIME type (`mp4`, `mov`, `webm`), never the original file
  name (it can carry personal details); the original name lives only in the manifest.
- **Root index** `strides-index.json`: a cache, not the source of truth.
  `{ kind: 'strides-index', schemaVersion: 1, updatedAt, assessments: IndexEntry[] }`, one entry
  per assessment: id, `savedAt`, `methodologyVersion`, views, clip count, the provider ids of its
  folder and analysis file, and a per-metric summary (`value`, `unit`, `tier`, `confidence`,
  `definitionVersion`). The progress view needs this one read.
- **Write order:** folder → manifest → clips → analysis file → index. The analysis write is the
  commit point: Cancel is honoured only before it, and a save that fails or is cancelled before it
  trashes its folder. An index failure after it retries the index step only (`IndexUpdateError`,
  `updateIndex`), so a retry cannot duplicate an assessment. Index rows this build cannot read are
  carried through every write, and an index with a newer `schemaVersion` is never written.
  Saves are kept in a session-lifetime store keyed by the result (`saveJobs.ts`), because the
  progress page unmounts the save panel. The analysis file goes last
  of the folder's contents, so a folder with an analysis file is complete. The index is re-read
  immediately before it is written and merged by id. Two devices saving in the same second can
  still lose one index entry (Drive v3 offers no compare-and-swap on content); *Rebuild index*
  in the progress view repairs that by listing `assessment` folders and reading each analysis
  file, and is also what runs when the index is missing or fails validation.

### D4. The analysis file

```jsonc
{
  "kind": "strides-assessment",
  "schemaVersion": 1,                  // file FORMAT version, independent of methodology
  "id": "3f9a…",                       // crypto.randomUUID()
  "savedAt": "2026-11-05T14:32:10.000Z",
  "localDate": "2026-11-05",
  "methodology": { "version": 1, "metricDefinitions": { "cadence": 1, … } },
  "build": { "commit": "aefbfb52", "builtAt": "…" },
  "run": {
    "poseBackend": { …resolved config… },
    "samplingRobustness": { …resolved config… },
    "clips": [{ "index": 0, "view": "side", "samplingPath": "sequential",
                "scalePass": "done", "outlinePass": "skipped" }]
  },
  "view": { "view": "side", "confidence": 0.82, "clipViews": ["side", "front"] },
  "metrics": {
    "cadence": { "value": 172.4, "unit": "stepsPerMinute", "confidence": 0.91, "tier": "normal",
                 "viewFit": "primary", "caveat": null, "sampleSize": 12, "frameCoverage": 0.97,
                 "interpolatedFraction": 0.02, "sourceClipIndex": 0, "definitionVersion": 1 }
    // … all thirteen MetricIds, excluded ones included (value null, tier "excluded")
  }
}
```

Exemplars, timeseries, robust frames and evidence images are not saved: they are large, they
carry per-frame body geometry beyond what a progress view needs, and nothing reads them back.
Built by a pure `buildAssessmentRecord(...)` and validated on read by `parseAssessmentRecord`,
which rejects unknown `kind`, a newer `schemaVersion`, or malformed metrics (an index entry
that fails is dropped from the view with a count shown, never guessed).

Only save once the session is **finished**: `aggregate.phase === 'ready'` and every clip's scale
pass and outline pass terminal. The grafts can still change `verticalOscillationCm`,
`stepWidthCm` and `swingFootLateralExcursion` until then, and a saved number must be the number
the runner saw at the end. Until then the Save button is disabled with "Finishing background
checks…".

### D5. Methodology versions

Two levels, in `src/storage/methodology.ts`:

- `METRIC_DEFINITION_VERSIONS: Record<MetricId, number>`, one integer per metric, bumped when that
  metric's definition changes in a way that moves its readings (formula, signal, unit, the
  aggregation, the window it searches). Confidence recalibrations and copy changes do not bump it.
  **This is what the progress view compares on.**
- `METHODOLOGY_VERSION`, one app-wide integer, bumped whenever any metric definition version
  changes (and allowed to bump for other analysis-wide changes, such as person selection). It is
  the label in the file name.
- `METHODOLOGY_HISTORY`, a frozen, append-only table `{ version, date, summary,
  metricDefinitions }[]`. A test requires: versions strictly increase from 1; the last entry's
  `version` is `METHODOLOGY_VERSION` and its `metricDefinitions` equal
  `METRIC_DEFINITION_VERSIONS`; no metric version ever decreases; every `MetricId` is present.
  So bumping a metric without a methodology entry, or editing history, fails the suite.
- Everything starts at **1** on 2026-11-05: earlier re-definitions (`strides-cjl`,
  `strides-eiil`, the `strides-2iw` rescale) predate storage, and nothing saved before today
  exists to be compared.
- The build commit is stamped by `vite.config.ts` into `import.meta.env.VITE_STRIDES_COMMIT` from
  `GITHUB_SHA` in Actions, else `git rev-parse --short HEAD`, else `"unknown"` (`buildInfo.ts`).
  An env variable rather than a `define`, because vitest does not load `vite.config.ts`. It identifies the
  exact code; the versions say what is comparable.

The rule for reviewers goes in `docs/agent-notes/runner-storage.md` and in a comment beside the
table: a change that moves a metric's readings bumps that metric and appends a history entry.

### D6. The progress view

- **Entry:** a *Progress* button in the header (beside add-a-clip; shown once a provider is
  connected or the `strides.storage` record exists) and `?page=progress`. It is a page state
  inside `MultiClipVideoSession`, not a route: the session and its clip `<video>` elements stay
  mounted (never conceal a clip's video), and only `main`'s content switches. History entries are
  stamped `{ stridesPage: 'progress' }`, alongside the existing `stridesView` stamps; Back returns
  to the results with the in-memory analysis intact.
- **Content, loaded only from the runner's storage:** a list of assessment dates (newest first,
  each with its views and clip count), then one small chart per metric that has at least one
  measured reading, in focus-area order, each with its unit. Excluded readings are listed as
  "not measured" gaps, never plotted as zero. Caveated readings are hollow markers.
- **Definition versions never join.** A metric's readings are split into runs of equal
  `definitionVersion`. Each run is its own line; between runs the chart draws a labelled break,
  "Definition changed (v1 → v2): earlier readings are not comparable", and the latest run is the
  only one drawn at full strength. A version newer than this build knows is shown as "saved by a
  newer Strides" and not plotted.
- **No verdicts.** No "improved", no trend line, no colour for better or worse: same-runner
  clip-to-clip spread is real and unmeasured (`strides-83y`). The axis says values; the runner
  reads the movement.
- **Charts are inline SVG**, no chart library, with a visually hidden table of the same numbers
  as the text alternative and a visible *Show as table* toggle. Phone width first.
- **States:** not connected (connect prompt), loading, empty ("No saved assessments yet"), index
  invalid or missing (rebuild offered, then run automatically), provider error with retry.

### D7. What persists locally

`localStorage['strides.storage'] = { provider: 'google-drive', rootFolderId }`: enough to show
the Progress entry and preload the GIS script on return. No token, no email, no results. All reads
and writes in try/catch (private windows); failure just means the runner connects again.

### D8. Privacy copy

`ClipPicker`'s *Video handling* paragraph keeps its first sentence and adds: nothing is saved
unless you press Save; saving goes to your own Google Drive, never to a Strides server; video is
included only if you tick it. The save panel repeats the destination and the footage choice next
to the button, and Disconnect's copy says it stops access and that saved files stay in Drive.

## Risks / Trade-offs

- **iOS Safari popups** may still be blocked in some versions. Mitigation: token request inside
  the tap, explicit errors with retry; fallback is a redirect-flow provider (Dropbox PKCE, D1).
  Not verifiable here (no iOS device); recorded as an open check.
- **Hourly token expiry** means a re-consent popup can flash on Save after an hour. Accepted:
  there is no refresh token without a backend.
- **Index races** across devices: repairable by rebuild (D3).
- **Large clips** (4K, tens to hundreds of MB) on mobile data: opt-in, size shown, progress
  shown, cancellable; a failed clip upload fails the save before the analysis file is written, so
  no half-assessment is indexed (the folder may remain; rebuild ignores folders without an
  analysis file).
- **Methodology drift if someone forgets to bump**: the test catches a bump without a history
  entry, not a definition change without a bump. That stays a review rule (D5).

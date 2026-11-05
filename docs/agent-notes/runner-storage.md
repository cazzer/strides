# Runner storage and the progress page (`strides-w85q`)

> Written 2026-11-05 when epic `strides-w85q` shipped on `feat/runner-storage`. Decisions D1–D8:
> `openspec/changes/archive/*-save-assessments-to-runner-storage/design.md`. Specs:
> `openspec/specs/runner-storage`, `openspec/specs/progress-view`.

## What and where

| path | what |
|---|---|
| `src/storage/methodology.ts` | `METRIC_DEFINITION_VERSIONS`, `METHODOLOGY_VERSION`, append-only `METHODOLOGY_HISTORY`. **Read the rule in its header before changing any metric.** |
| `src/storage/assessmentRecord.ts` | Pure builders and validators: analysis file, footage manifest, index entry, names. |
| `src/storage/provider.ts` | `StorageProvider` adapter. Lookups are by `appProperties` (`stridesKind`, `stridesAssessmentId`), never by name. |
| `src/storage/assessmentStore.ts` | `saveAssessment` / `updateIndex` / `loadIndex` / `rebuildIndex` over any provider. |
| `src/storage/googleDrive/` | GIS token client (`tokenManager.ts`), script loader (`gis.ts`), Drive v3 over fetch (`driveApi.ts`), the provider. |
| `src/storage/fakeProvider.ts` | In-memory provider for tests and dev live checks. |
| `src/storage/saveJobs.ts` | Save jobs keyed by the session's result key (`clipIds.join(' ')`), outliving the panel. |
| `src/storage/storageConnection.ts` | The connection as React sees it; the `strides.storage` localStorage record. |
| `src/storage/SaveAssessmentPanel.tsx` | "Keep this assessment", under the results view region. |
| `src/progress/` | `progressSeries.ts` (pure), `MetricProgressChart.tsx` (inline SVG), `ProgressPage.tsx`, `progressPageRoute.ts`, `ProgressHeaderEntry.tsx`. |

## Rules that are easy to break

- **A change that moves a metric's readings bumps that metric's definition version and appends a
  `METHODOLOGY_HISTORY` entry.** The test catches a bump with no entry, not a definition change with
  no bump. The progress view joins readings only within one definition version.
- **Popup-opening calls run synchronously in the click handler**: `connect()`, `ensureAccess()`, and
  the Google provider's `disconnect()` (it may need a token to revoke with). They are deliberately
  not `async` functions. Do not put an `await` (or a hash, or a build of the record) before them;
  Safari gives a popup about a second of transient activation.
- **No request to Google until the runner chooses Drive.** The GIS script is injected only by
  `prepare()`: the Connect tap, or a preload for a runner with a `strides.storage` record. Opening
  Progress with no root folder creates nothing (`findRoot`, not `ensureRoot`).
- **Save is gated on a finished session**: aggregate `ready` and no clip's scale or outline pass
  `pending`/`running` (`saveReadiness.ts`). The grafts change VO_cm, stepWidthCm and
  swingFootLateralExcursion until then.
- **Write order is the integrity rule**: folder → manifest → clips → analysis → index. The analysis
  write is the commit point: Cancel stops working there, and anything that fails before it trashes
  the folder. An index failure after it is an `IndexUpdateError`; the retry redoes the index only.
- **The index is a cache.** Rows this build can't read are carried through every write. An index with
  a newer `schemaVersion` is never written (`newer-version`, not retryable). A missing or invalid
  index is rebuilt from the `assessment` folders.
- **The progress page is a page state, not a route.** Only `main`'s content switches; the header and
  every clip `<video>` stay mounted. History entries carry `stridesPage: 'progress'` alongside the
  results views' `stridesView` stamp.
- **No verdicts** on the progress page: no better/worse, no trend line, no direction colour. Same-runner
  spread is unmeasured (`strides-83y`).

## Driving it live without Google

```js
await context.addInitScript(() => { window.__STRIDES_STORAGE_PROVIDER_OVERRIDE__ = 'fake' })
```

Dev builds only. The fake mirrors JSON and blob sizes (never bytes) to
`localStorage['strides.devFakeStorage']`, so a reload keeps saved assessments. First visit: Connect
Test storage → Continue to Google → Save to Test storage. Hooks: `section.save-assessment`,
`[data-progress-state]` (`not-connected | reconnect | loading | empty | loaded | error`),
`figure.metric-progress[data-metric]`, `[data-run]`, `[data-definition-break]`, `circle[data-tier]`.

⚠️ Screenshots taken right after `page.emulateMedia({ colorScheme })` catch the 150 ms
`transition-colors` mid-way, so outlined buttons look disabled. Wait about 500 ms after a scheme
switch before capturing.

The build commit in a saved file is the commit at **dev-server start** (`vite.config.ts` reads it once).

## Live check, 2026-11-05 (fake provider, `0b053e4b`)

Real GPU (ANGLE Metal, M4 Pro), port 5356 (derived), the 3-clip demo, 1280×900 and 390×844, light
and dark:

- Save stayed disabled with "Finishing background checks…" for 6.5–7.3 s after "Analysis complete"
  (the scale and outline passes), then saved. VO_cm in the saved file was 7.19338, the
  side-landscape scale-pass anchor recorded in `runner-tour.md`.
- Without the footage box: folder, manifest, analysis, index. With it: `clip-1..3.mp4`
  (38.5 + 20.5 + 12.6 MB; label read "68 MB").
- Progress: two dated entries (same day, so shown with times), 12 metric charts with two points each
  (`stepWidthCm` not measured on this demo). No horizontal overflow at either width. Three clip
  videos stayed mounted in the header. Back returned to the results with "Saved" still shown and no
  second Save button.
- Disconnect cleared `strides.storage` and removed the Progress entry. **Zero requests to
  `accounts.google.com` or `www.googleapis.com`** across the run, and no console or page errors.

## Fidelity gate, 2026-11-05 (`0b053e4b` vs base `aefbfb52`)

`ab-person-selection.mjs --view-arm 'tour={}' --view-arm 'summary={"view":"summary"}' --clips
side-landscape,side-portrait,front-approach --trials 1 --evidence --scale-pass --outline-pass`, fresh
process per trial, ANGLE Metal on M4 Pro, base from a temporary detached worktree. Each trial's fields
were canonicalised (sorted `key\tJSON`) without `elapsedMs`, `outlinePass.totalMs` and
`outlinePass.detectMedianMs` (wall-clock), then hashed: **one hash per clip across both checkouts and
both arms** (side-landscape 444 fields, side-portrait 420, front-approach 433). The save panel and the
progress entry move no reading.

## Not verified here (needs the OAuth client, `strides-w85q.8`)

The real Google Drive path (consent popup, Drive writes, revoke) on desktop Chrome, Android Chrome and
iOS Safari, and on the deployed Pages site. The unit tests cover request shapes against stubs only.
iOS Safari popup behaviour is the known risk (design D1); a redirect-flow provider (Dropbox PKCE) is the
fallback if it fails.

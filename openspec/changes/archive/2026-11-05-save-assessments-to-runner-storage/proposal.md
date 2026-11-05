## Why

Every visit starts from zero: a runner cannot keep an assessment or see how their form shifts
across weeks (`strides-w85q`). Strides is a static GitHub Pages SPA with no backend, and its
promise is that video never reaches a Strides server. So persistence has to go to storage the
runner already owns, reached directly from the browser, and only when they ask for it.
Methodology also keeps changing (metric re-definitions such as `strides-cjl`, `strides-eiil`), so
anything saved has to say which definition produced each number, or a progress view would
compare readings that do not measure the same thing.

## What Changes

- A storage-provider adapter (`src/storage/`) with one real provider, **Google Drive**: Google
  Identity Services token client, Drive API v3 over `fetch`, narrow `drive.file` scope. A fake
  in-memory provider backs tests and dev-only live checks. The Google provider is built behind
  `VITE_GOOGLE_CLIENT_ID`; without it the save action says saving is not set up on this build.
- **Save an assessment**: once a session's analysis and its background passes have finished, a
  runner can save it. Each save creates one folder in a `Strides` folder in their Drive,
  containing a methodology-version- and date-stamped analysis file, a footage manifest, and (only
  if the runner ticks it) the source clips. A root index lists every assessment.
- **Methodology versions**: an app-wide methodology version plus a per-metric definition version,
  tied together by a frozen history table and a test, and the build's commit.
- **Progress view**: lists saved assessment dates and charts each metric across them, from the
  runner's storage only. Readings under different definition versions are drawn as separate
  segments and never joined. No "improved/worse" verdict (no measured noise floor yet;
  `strides-83y`).
- **Privacy copy** says what persists and where, and Disconnect revokes the token.

## Capabilities

### New Capabilities

- `runner-storage`: connecting a runner-owned provider, the saved layout and file formats,
  methodology versioning, disconnect.
- `progress-view`: the progress page over the saved index.

### Modified Capabilities

None. The results views are unchanged; the save control and the progress entry are additions.

## Impact

- New: `src/storage/**`, `src/progress/**`, a Save panel under the results view region, a
  Progress entry in the header.
- `vite.config.ts` (`define` for the build commit), `.github/workflows/deploy.yml` (passes the
  repo variable `VITE_GOOGLE_CLIENT_ID` to the build), `src/vite-env.d.ts`.
- `ClipPicker.tsx` privacy copy.
- No measurement changes: storage reads the finished aggregate and never writes into the
  pipeline.
- Human prerequisite: a Google OAuth client ID (bd human decision under `strides-w85q`).

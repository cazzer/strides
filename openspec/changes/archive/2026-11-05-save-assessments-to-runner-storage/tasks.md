## 1. Methodology versions (`strides-w85q.1`)

- [x] 1.1 `src/storage/methodology.ts`: `METRIC_DEFINITION_VERSIONS`, `METHODOLOGY_VERSION`, frozen `METHODOLOGY_HISTORY`
- [x] 1.2 History-consistency test (monotonic, last entry equals current, no metric decreases, all MetricIds)
- [x] 1.3 Build commit as `VITE_STRIDES_COMMIT` (set in `vite.config.ts`, typed in `src/vite-env.d.ts`)

## 2. Assessment record (`strides-w85q.2`)

- [x] 2.1 `buildAssessmentRecord`, `buildFootageManifest`, `indexEntryFor`, naming helpers
- [x] 2.2 `parseAssessmentRecord`, `parseIndex` validators
- [x] 2.3 Unit tests

## 3. Adapter, fake provider, store (`strides-w85q.3`)

- [x] 3.1 `StorageProvider` interface and types
- [x] 3.2 Fake provider (+ dev override, optional localStorage mirror)
- [x] 3.3 `saveAssessment` (write order, index merge), `loadIndex`, `rebuildIndex`
- [x] 3.4 `strides.storage` local record
- [x] 3.5 Unit tests

## 4. Google Drive provider (`strides-w85q.4`)

- [x] 4.1 GIS script loader (opt-in only)
- [x] 4.2 Token client wrapper (memory-only token, expiry, gesture-safe request, error mapping)
- [x] 4.3 Drive v3 calls: folders, multipart JSON, resumable XHR upload, property queries, read
- [x] 4.4 `VITE_GOOGLE_CLIENT_ID` config and `deploy.yml` variable
- [x] 4.5 Unit tests with stubbed `google` and network

## 5. Save panel (`strides-w85q.5`)

- [x] 5.1 Finished-session gate
- [x] 5.2 Connect (two-step first time), Save, footage opt-in with size, progress, retry, Disconnect
- [x] 5.3 Mount under the results view region
- [x] 5.4 Privacy copy in `ClipPicker.tsx`
- [x] 5.5 Component tests

## 6. Progress page (`strides-w85q.6`)

- [x] 6.1 `progressSeries` (runs by definition version, exclusions, newer versions)
- [x] 6.2 `MetricProgressChart` SVG + table alternative
- [x] 6.3 `ProgressPage` states and assessment list
- [x] 6.4 Page state, `?page=progress`, history stamps, header entry
- [x] 6.5 Tests

## 7. Verify and close (`strides-w85q.7`)

- [x] 7.1 Live check with the fake provider (desktop + 390 px, light + dark)
- [x] 7.2 View-arm A/B: save panel moves no reading
- [x] 7.3 `docs/agent-notes/runner-storage.md` + CLAUDE.md index row
- [x] 7.4 Archive this change

## Human prerequisite (`strides-w85q.8`)

- [ ] H.1 Google OAuth client ID created, repo variable set (blocks real-Drive and Android checks only)

## Review round 1 (reviewer agent, 2026-11-05)

- [x] R.1 Save jobs outlive the panel (Progress mid-save, Back after save)
- [x] R.2 Cancel ends at the commit point; pre-commit failure trashes the folder
- [x] R.3 Index failure retries the index step only
- [x] R.4 Disconnect after reload asks for a token in the tap to revoke
- [x] R.5 Unreadable index rows carried through; newer-schema index never written
- [x] R.6 New result key starts clean
- [x] R.7–R.9 Drive error mapping, fingerprint size cap, oldest root first

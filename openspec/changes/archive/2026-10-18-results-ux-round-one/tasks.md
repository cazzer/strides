## 1. Guided view is the default (strides-8c3)

- [x] 1.1 Invert `resolveResultsViewMode` / `searchWithResultsViewMode` and their tests
- [x] 1.2 Order the toggle Guided first; update session tests that assumed classic by default

## 2. Session coverage notice (strides-pz0u)

- [x] 2.1 Pure `sessionCoverage` with unit tests
- [x] 2.2 `SessionCoverageNotice` rendered once in the session shell; `AddClipAction` `openRequest`

## 3. Confirmed "Start over" (strides-qi5q)

- [x] 3.1 Shared `StartOverControl` used by both views; tests

## 4. Wake lock and phone wait notice (strides-6os1)

- [x] 4.1 `useScreenWakeLock` with tests; wire to "any clip in flight"
- [x] 4.2 Coarse-pointer wait notice

## 5. Verify

- [x] 5.1 `tsc -b`, lint, unit tests
- [x] 5.2 Live browser run on the derived port, both views, at 390 px and 1280 px
- [x] 5.3 A/B harness before/after shows only `elapsedMs` moving

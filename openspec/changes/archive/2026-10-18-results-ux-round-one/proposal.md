## Why

A 2026-10-16 UX review against comparable running-form apps found four cheap, high-yield gaps:

- The view that sets each measurement against cited research, and carries the only cues, is opt-in
  behind `?view=guide`, so a first reader gets the flat classic card list (`strides-8c3`, user
  decision 2026-10-16: flip it).
- What the session is MISSING is never said in one place. A front-only session silently loses every
  sagittal metric; the reason is scattered across per-metric hints (`strides-pz0u`).
- "Choose a different video" deletes every clip in the session, unconfirmed, from a button beside
  the results (`strides-qi5q`).
- Most readers use a phone, where analysis takes a minute or more (`strides-6i6`) and the screen can
  sleep mid-run. Nothing keeps it awake or sets the expectation (`strides-6os1`).

## What Changes

- **BREAKING (address contract):** the guided view is the default. Classic is selected by exactly
  `?view=classic`; the guided default address carries no `view` parameter.
- A session coverage notice names which camera views the session has, and how many measurements a
  missing view would be needed for, with an action that opens the header's add-a-clip panel.
- The whole-session reset is renamed "Start over" and asks for an in-page confirmation first.
- While any clip is being analysed the page holds a screen wake lock where the browser offers one,
  and on a touch-first device it says analysis can take a minute or more.

## Capabilities

### Modified Capabilities

- `guided-results-view`: the default view flips (REMOVED + ADDED, since the behaviour reverses).
- `results-view`: adds the coverage notice, the confirmed reset and the wake-lock/wait notice.

## Impact

- `src/results/resultsViewMode.ts` and its tests; `ResultsViewToggle.tsx` order.
- `src/results/MultiClipVideoSession.tsx`, `ResultsView.tsx`, `GuidedResultsView.tsx`,
  `src/video/AddClipAction.tsx`; new `SessionCoverageNotice.tsx`, `sessionCoverage.ts`,
  `StartOverControl.tsx`, `useScreenWakeLock.ts`.
- Harnesses (`e2e/`, `scripts/ab-person-selection.mjs`) now drive the guided view by default. Both
  views render the same "Analysis complete." status and the console diagnostics are view-independent.
- No metric, sampling or evidence computation changes.

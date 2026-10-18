## Context

Four independent UX changes from the 2026-10-16 review, bundled because each is small and all of
them touch the session shell (`MultiClipVideoSession.tsx`) rather than any metric.

## Decisions

### D1. Flip by inverting the strict parse, not loosening it

`resolveResultsViewMode` keeps its strictness, mirrored: exactly one `view=classic` selects classic,
everything else guided. That keeps "which view does this address show" single-valued, and makes
every old `?view=guide` link keep working for free. The default address stays clean: choosing
guided removes `view` entirely. The toggle lists Guided first, since it is now the default; neither
option is styled as recommended.

### D2. Coverage is derived from the fused result's own view fits, not a second table

A measurement counts toward "needs a <view> clip" only when the FUSED metric is tier-excluded with
`viewFit: 'unsuitable'` and `DEFAULT_VIEW_FIT_TABLE[metric][view].fit === 'primary'`. That reuses
the exact reason the metric was excluded, so the notice cannot blame the camera for an exclusion it
did not cause, and it never promises a number (a front clip can still fail on too few samples).
Rendered once in the session shell, so both views show it identically and neither view file grows a
copy. The action opens `AddClipAction` through an `openRequest` nonce and moves focus to its trigger.

### D3. In-page confirmation, never `window.confirm`

A browser dialog blocks the Playwright harness and the Chrome extension alike, so the confirmation
is an inline replacement of the button. One shared component, so the two views cannot drift.

### D4. Wake lock is presentation-only

`navigator.wakeLock` is feature-detected; a rejected request is swallowed. It is tied to
`clipHostsLiveElement`, the same "analysis in flight" predicate the strip already uses, and
re-requested on `visibilitychange` because browsers release a wake lock when the page is hidden.
Nothing in the sampling path reads it (memory `perf-no-fidelity-tradeoffs`). The phone notice is
gated on `(pointer: coarse)` rather than a user-agent sniff, and it is a plain paragraph because the
results view allows exactly one live region.

## Risks

- Every harness reading now drives the guided view. Both views render the same status line and the
  three dev console lines are emitted outside either view, so readings should not move. Verify with
  `scripts/ab-person-selection.mjs` before archiving.

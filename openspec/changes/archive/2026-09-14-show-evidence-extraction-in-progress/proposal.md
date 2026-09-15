# Show that a metric's evidence is still being extracted

## Why

Evidence extraction runs **after** the results are already on screen, and takes real time: roughly
3.5–3.8 s on `park-side-landscape`, 3.5 s on `park-approach`, 4.5 s on `multiperson-track` between
"Analysis complete" and settled imagery. It then runs a **second** time on every default run, when
the background scale pass — the app's own "second look at the clip" — grafts its centimetre metrics
and the recomputed plan genuinely moves.

For that whole window a card that is about to show a picture and a card that will never show one are
**the same empty space**. Nothing on screen distinguishes them, and evidence coverage varies by clip
by design, so "this metric has no picture" is a perfectly ordinary outcome the reader has no way to
rule out. `strides-3ui` already fixed the worse half of this — a re-extraction no longer *removes*
imagery that is already up — but a metric whose picture has not arrived yet was left with nothing to
say, and that is exactly the metric the second pass adds: `verticalOscillationCm` is
`metric-excluded` on the first extraction and `planned` on the second.

## What Changes

- **A card whose evidence is planned but not yet decoded renders a placeholder** in the thumbnail's
  place — a pulsing block at the thumbnail's own size — plus a `role="status"` line saying the
  frames are being prepared.
- **The evidence state names which metrics those are.** `useSessionEvidence`'s `extracting` state
  gains `pending: MetricId[]`, read off the run's own plan (the only statement of intent that exists
  before a decoder opens) at each metric's winning clip.
- **A metric whose previous image is still on screen is NOT pending.** Covering a correct picture
  with a placeholder would be a downgrade, so `pending` excludes anything the run carried forward.
- **A metric with no evidence planned is untouched** — still no thumbnail, no placeholder, no
  reserved space. The existing requirement said "no evidence"; it is narrowed to say "no evidence
  planned", which is what it always meant.

## Impact

- `src/results/useSessionEvidence.ts` — the `extracting` state and one derivation off the plans.
- `src/results/MultiClipVideoSession.tsx` — pending metrics ride into the card list as entries with
  no items.
- `src/results/MetricsPanel.tsx` — `MetricCardEvidence.pending`, and the branch that renders it.
- **No metric value, plan, crop, exemplar or image changes**, and `[evidence-coverage]` is untouched
  — this is a rendering state, decided from a plan that was already being computed.
- `ResultsView.tsx` is unchanged: it passes the evidence list straight through.

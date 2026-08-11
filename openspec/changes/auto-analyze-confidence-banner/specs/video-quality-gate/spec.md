## REMOVED Requirements

### Requirement: Quality check result contract
**Reason**: Analysis now runs automatically and every computed metric already carries its own
`confidence`/`viewFit`/`value` — a separate pre-analysis check contract duplicated that signal
before analysis ever ran.
**Migration**: Use `FormHeuristicsResult`'s per-metric `confidence`, `viewFit`, and `value`
(surfaced post-analysis via results-view's new "Low-confidence results banner" requirement).

### Requirement: Fail-open overall verdict
**Reason**: There is no more pre-analysis overall verdict to compute — only the post-analysis,
per-metric confidence produced by the analysis pipeline matters now.
**Migration**: See results-view's "Low-confidence results banner" requirement.

### Requirement: Resolution check
**Reason**: Pre-analysis resolution gating is removed; a low-resolution clip now simply degrades
whatever metric confidence the analysis itself produces, like any other detection-quality
problem, rather than being flagged separately beforehand.
**Migration**: None — reflected through ordinary post-analysis metric confidence, no direct
replacement check.

### Requirement: Frame rate check is best-effort
**Reason**: Pre-analysis frame-rate gating is removed for the same reason as the resolution
check — the app no longer screens clips before running analysis.
**Migration**: None — reflected through ordinary post-analysis metric confidence, no direct
replacement check.

### Requirement: Detection-confidence sample
**Reason**: Superseded by the full-clip analysis itself, which produces real per-metric
confidence directly, rather than estimating it beforehand from a five-frame pre-sample.
**Migration**: See results-view's "Low-confidence results banner" requirement.

### Requirement: Quality gate hook lifecycle
**Reason**: `useVideoQualityGate` is deleted along with the rest of the pre-analysis gate; there
is no assessment lifecycle left to run.
**Migration**: See results-view's modified "Explicit analysis trigger" requirement, which now
starts analysis automatically instead of waiting on a quality-gate assessment.

### Requirement: Quality warning banner
**Reason**: Replaced by a post-analysis banner driven by the analysis' own computed metric
confidence, instead of a pre-analysis check's result.
**Migration**: See results-view's new "Low-confidence results banner" requirement.

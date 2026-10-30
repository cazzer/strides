import type { AggregateAnalysisState } from './types'
import type { MetricId, MetricResult, View } from '../heuristics/types'
import { MetricsPanel } from './MetricsPanel'
import type { MetricCardEvidence } from './MetricsPanel'
import { metricTier } from './metricConfidence'
import { StartOverControl } from './StartOverControl'

export interface ResultsViewProps {
  /** Has no `progress` — see `AggregateAnalysisState`; per-clip progress lives on the clip strip. */
  analysis: AggregateAnalysisState
  /** Called instead of `analysis.reset` directly for "Try again" — the alert this button lives
   * in unmounts the instant it's clicked, so whoever composes this component (`App.tsx`) needs
   * the chance to move focus somewhere stable first, the same fix already applied there and in
   * `WebcamCapture`. */
  onTryAgain: () => void
  /** The whole-session reset behind "Start over", called only once the reader has confirmed it
   * (`StartOverControl`, `strides-qi5q`). It unmounts this whole component (no clip is loaded any
   * more), taking the focused button with it, so the composer must move focus somewhere stable
   * first. Same contract as `onTryAgain`. */
  onStartOver: () => void
  /** The imagery each metric was measured from. Passed straight through to `MetricsPanel`, which
   * renders each metric's thumbnails inside that metric's own card. Already extracted by the
   * composer (`MultiClipVideoSession`, which owns `useSessionEvidence`) — this component stays
   * presentational and calls no hook, exactly as before. */
  evidence?: readonly MetricCardEvidence[]
  /** How many clips the session holds, so a card can say which one its evidence came from. */
  clipCount?: number
  clipViews?: readonly string[]
  /** Each clip's raw view classification (null until known), beside `clipViews`' display strings:
   * the runner's footage plate is offered only for a clip classified a side view, and a gate must
   * not read a label. */
  clipViewKinds?: readonly (View | null)[]
  sourceIndices?: Record<MetricId, number> | null
  /**
   * The relative hip bounce measured on vertical ratio's own clip, read off that clip's result (null
   * until fused, or with one clip). Presentation only: what vertical ratio's derivation and the
   * runner's stride cite, never a fused value.
   */
  ratioClipBounce?: MetricResult | null
  onOpenEvidenceVideo?: (clipIndex: number, timestamp: number, returnFocus: HTMLButtonElement | null) => void
}

/**
 * Presentational composition of the analysis controls and results — mirrors
 * `QualityWarningBanner`'s pattern of taking already-derived props and never calling hooks
 * itself. Renders the "Analyze" button, the session status line, and once `phase === 'ready'`,
 * the metrics panel (which itself renders the vertical-oscillation chart).
 *
 * Per-clip sampling progress is NOT here — it moved onto each clip's own header strip entry
 * (`clipStripStatus.ts`), because this component only ever saw the aggregate's mean across clips.
 */
export function ResultsView({
  analysis,
  onTryAgain,
  onStartOver,
  evidence,
  clipCount = 1,
  clipViews,
  sourceIndices,
  onOpenEvidenceVideo,
}: ResultsViewProps) {
  const { phase, heuristics, error, start } = analysis
  // A 'done' scale pass includes the measured-but-unfittable graft, where a grafted metric's
  // value is still null and the panel lists it as not measured — saying a metric "was added"
  // there would be false. Shared with the 'failed' branch: for the reader both outcomes are the
  // same fact (the second look produced no extra metrics). Plain plural, not "metric(s)" — this
  // call site only ever fires when the added count is 0 and there are always exactly 2 candidate
  // metrics, so there's no real 0/1/2+ ambiguity here for a parenthetical marker to resolve
  // (unlike the genuinely-ranging `footstrike(s)`/`frame(s)` caveat pattern elsewhere).
  const scalePassCouldntAdd =
    " A second look at the clip couldn't add the extra metrics."
  // Two metrics (`verticalOscillationCm`, `stepWidthCm`, #45) can now independently gain a value
  // from the same completed scale pass — count how many the panel actually shows as measured,
  // excluding non-null values from unsuitable views, rather than assuming
  // "added" means exactly one, so the status line says "1 more metric" or "2 more metrics"
  // correctly instead of a copy that undercounts once a pass grafts both.
  const addedMetricCount = heuristics
    ? [heuristics.verticalOscillationCm, heuristics.stepWidthCm]
        .filter((metric) => metricTier(metric) !== 'excluded').length
    : 0
  // 'error' doesn't disable the button -- Analyze must stay re-runnable after a failed run,
  // not get stuck permanently disabled with no way forward. After a *completed* run the
  // button doesn't render at all: analysis is deterministic, so re-running the same clip has
  // nothing new to say -- the forward action is starting over with a different video.
  const analyzeDisabled = phase === 'sampling' || phase === 'processing'
  const analyzeDisabledReason = analyzeDisabled
    ? 'Analysis already in progress'
    : undefined

  return (
    <section className="space-y-6" aria-label="Analysis results">
      <div className="flex flex-wrap gap-2">
        {phase !== 'ready' && (
          <button
            type="button"
            onClick={start}
            disabled={analyzeDisabled}
            title={analyzeDisabledReason}
            className="inline-flex items-center justify-center border-2 border-brand-700 bg-brand-700 px-5 py-2.5 font-sans text-sm font-semibold uppercase tracking-wide text-white transition-colors hover:bg-brand-800 hover:border-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-700"
          >
            {phase === 'error' ? 'Analyze again' : 'Analyze'}
          </button>
        )}
        <StartOverControl onConfirm={onStartOver} clipCount={clipCount} />
      </div>

      {/*
        The per-clip progress readout that used to sit here is gone, MOVED rather than deleted: it
        was rendered from `computeAggregateAnalysisState`'s MEAN progress across clips, which is
        exactly the wrong summary — only one clip holds the shared detector at a time, so an
        average hides which clip is actually working. Each clip now shows its own `phase`/`progress`
        on its own header strip entry, carrying the identical strings (`Analyzing… 42%`,
        `Processing results…`, and the paused suffix) on the clip they belong to. See
        `clipStripStatus.ts` and design.md D3.

        The `role="status"` line below is a SESSION fact and stays. "The centimetre card reflects
        scale-pass progress" requires it be always-visible, and both `e2e/multiPersonAcquisition`
        and `scripts/ab-person-selection.mjs` wait on its "Analysis complete." — which is also why
        no strip entry is allowed to say those two words.
      */}
      {phase === 'ready' && (
        <p role="status">
          Analysis complete.
          {/* The scale pass's only always-visible narrative (and the screen-reader
              announcement path): the hint in the excluded list sits below the fold, and the
              video visibly replays during the pass — this line explains both. Count-agnostic
              while in progress ("more metrics", not "one more metric") because how many of the
              two scale-pass-backed metrics (#45) end up gaining a value isn't known until the
              pass concludes — see `addedMetricCount` above for the done-state count itself. */}
          {(analysis.scalePass.status === 'pending' ||
            analysis.scalePass.status === 'running') &&
            ' Measuring more metrics with a second look at the clip…'}
          {analysis.scalePass.status === 'done' &&
            (addedMetricCount > 0
              ? ` A second look at the clip added ${addedMetricCount} more metric${addedMetricCount === 1 ? '' : 's'}.`
              : scalePassCouldntAdd)}
          {analysis.scalePass.status === 'failed' && scalePassCouldntAdd}
          {/* The outline pass (`strides-uz48`) runs after every scale pass; same words as the
              guided view's line. */}
          {analysis.scalePass.status !== 'pending' &&
            analysis.scalePass.status !== 'running' &&
            (analysis.outlinePass?.status === 'pending' ||
              analysis.outlinePass?.status === 'running') &&
            ' Checking sideways foot travel with a closer look at the clip…'}
        </p>
      )}

      {phase === 'error' && error && (
        <div className="border-2 border-black dark:border-white border-l-4 border-l-brand-600 dark:border-l-brand-400 p-4 space-y-2" role="alert">
          <p>{error.message}</p>
          <button
            type="button"
            onClick={onTryAgain}
            className="inline-flex items-center justify-center border-2 border-black dark:border-white px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide text-black dark:text-white transition-colors hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Try again
          </button>
        </div>
      )}

      {phase === 'ready' && heuristics && (
        <div className="results-view__results space-y-4">
          <MetricsPanel
            heuristics={heuristics}
            scalePassStatus={analysis.scalePass.status}
            evidence={evidence}
            clipCount={clipCount}
            clipViews={clipViews}
            sourceIndices={sourceIndices}
            onOpenEvidenceVideo={onOpenEvidenceVideo}
          />
          {/*
            Save/export (e.g. Google Drive) is explicitly out of scope for this build — this is
            the seam a future ticket hooks into. No auth, no API calls, no stub button: just the
            documented empty slot.
          */}
        </div>
      )}
    </section>
  )
}

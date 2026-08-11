import type { VideoAnalysisState } from './types'
import { LowConfidenceBanner } from './LowConfidenceBanner'
import { MetricsPanel } from './MetricsPanel'

export interface ResultsViewProps {
  analysis: VideoAnalysisState
  /** Called instead of `analysis.reset` directly for "Try again" — the alert this button lives
   * in unmounts the instant it's clicked, so whoever composes this component (`App.tsx`) needs
   * the chance to move focus somewhere stable first, the same fix already applied there and in
   * `WebcamCapture`. */
  onTryAgain: () => void
}

function progressLabel(
  phase: VideoAnalysisState['phase'],
  progress: number,
): string {
  if (phase === 'sampling') {
    return `Analyzing… ${Math.round(progress * 100)}%`
  }
  return 'Processing results…'
}

/**
 * Presentational composition of the analysis controls and results — mirrors
 * `QualityWarningBanner`'s pattern of taking already-derived props and never calling hooks
 * itself. Renders the "Analyze" button, a progress readout while sampling/processing, and once
 * `phase === 'ready'`, the metrics panel (which itself renders the vertical-oscillation chart).
 */
export function ResultsView({ analysis, onTryAgain }: ResultsViewProps) {
  const { phase, progress, isPausedMidAnalysis, heuristics, error, start } =
    analysis
  // 'ready'/'error' don't disable the button -- Analyze must stay re-runnable after a
  // completed or failed run, not get stuck permanently disabled with no way forward.
  const analyzeDisabled = phase === 'sampling' || phase === 'processing'
  const analyzeDisabledReason = analyzeDisabled
    ? 'Analysis already in progress'
    : undefined

  return (
    <section className="space-y-6" aria-label="Analysis results">
      <button
        type="button"
        onClick={start}
        disabled={analyzeDisabled}
        title={analyzeDisabledReason}
        className="inline-flex items-center justify-center border-2 border-brand-700 bg-brand-700 px-5 py-2.5 font-sans text-sm font-semibold uppercase tracking-wide text-white transition-colors hover:bg-brand-800 hover:border-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-700"
      >
        {phase === 'ready' || phase === 'error' ? 'Analyze again' : 'Analyze'}
      </button>

      {(phase === 'sampling' || phase === 'processing') && (
        <p role="status">
          {progressLabel(phase, progress)}
          {isPausedMidAnalysis &&
            ' — paused, resume playback to continue analyzing'}
        </p>
      )}

      {phase === 'ready' && <p role="status">Analysis complete.</p>}

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
          <LowConfidenceBanner heuristics={heuristics} />
          <MetricsPanel heuristics={heuristics} />
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

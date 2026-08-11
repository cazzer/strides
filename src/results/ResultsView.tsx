import type { VideoAnalysisState } from './types'
import { MetricsPanel } from './MetricsPanel'

export interface ResultsViewProps {
  analysis: VideoAnalysisState
  /** Gates the Analyze button — analysis and the quality-gate assessment share one detector
   * (see `usePoseDetector`), and while quality assessment is mid-flight it's actively seeking
   * the shared, visible `<video>` element, so starting analysis at the same time would race it
   * for playback control. Quality assessment finishes in well under a second in practice. */
  qualityAssessing: boolean
}

function progressLabel(phase: VideoAnalysisState['phase'], progress: number): string {
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
export function ResultsView({ analysis, qualityAssessing }: ResultsViewProps) {
  const { phase, progress, isPausedMidAnalysis, heuristics, error, start, reset } = analysis
  const analyzeDisabled = qualityAssessing || phase !== 'idle'

  return (
    <section className="results-view" aria-label="Analysis results">
      <button type="button" onClick={start} disabled={analyzeDisabled}>
        Analyze
      </button>

      {(phase === 'sampling' || phase === 'processing') && (
        <p role="status">
          {progressLabel(phase, progress)}
          {isPausedMidAnalysis && ' — paused, resume playback to continue analyzing'}
        </p>
      )}

      {phase === 'error' && error && (
        <div role="alert">
          <p>{error.message}</p>
          <button type="button" onClick={reset}>
            Try again
          </button>
        </div>
      )}

      {phase === 'ready' && heuristics && (
        <div className="results-view__results">
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

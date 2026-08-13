import type { VideoAnalysisState } from './types'
import { MetricsPanel } from './MetricsPanel'

export interface ResultsViewProps {
  analysis: VideoAnalysisState
  /** Called instead of `analysis.reset` directly for "Try again" — the alert this button lives
   * in unmounts the instant it's clicked, so whoever composes this component (`App.tsx`) needs
   * the chance to move focus somewhere stable first, the same fix already applied there and in
   * `WebcamCapture`. */
  onTryAgain: () => void
  /** Called instead of `videoSource.reset` directly for "Choose a different video" — clicking
   * it unmounts this whole component (the video source leaves `'ready'`), taking the focused
   * button with it, so the composer (`App.tsx`) must move focus somewhere stable first. Same
   * contract as `onTryAgain`. */
  onChooseDifferentVideo: () => void
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
export function ResultsView({
  analysis,
  onTryAgain,
  onChooseDifferentVideo,
}: ResultsViewProps) {
  const { phase, progress, isPausedMidAnalysis, heuristics, error, start } =
    analysis
  // A 'done' scale pass includes the measured-but-unfittable graft, where the centimetre
  // metric's value is still null and the panel lists it as not measured — saying a metric "was
  // added" there would be false. Shared with the 'failed' branch: for the reader both outcomes
  // are the same fact (the second look produced no extra metric).
  const scalePassCouldntAdd =
    " A second look at the clip couldn't add the extra metric."
  // 'error' doesn't disable the button -- Analyze must stay re-runnable after a failed run,
  // not get stuck permanently disabled with no way forward. After a *completed* run the
  // button doesn't render at all: analysis is deterministic, so re-running the same clip has
  // nothing new to say -- the forward action is choosing a different video.
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
        <button
          type="button"
          onClick={onChooseDifferentVideo}
          className="inline-flex items-center justify-center border-2 border-black dark:border-white px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide text-black dark:text-white transition-colors hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Choose a different video
        </button>
      </div>

      {(phase === 'sampling' || phase === 'processing') && (
        <p role="status">
          {progressLabel(phase, progress)}
          {isPausedMidAnalysis &&
            ' — paused, resume playback to continue analyzing'}
        </p>
      )}

      {phase === 'ready' && (
        <p role="status">
          Analysis complete.
          {/* The scale pass's only always-visible narrative (and the screen-reader
              announcement path): the hint in the excluded list sits below the fold, and the
              video visibly replays during the pass — this line explains both. */}
          {(analysis.scalePass.status === 'pending' ||
            analysis.scalePass.status === 'running') &&
            ' Measuring one more metric with a second look at the clip…'}
          {analysis.scalePass.status === 'done' &&
            (heuristics && heuristics.verticalOscillationCm.value !== null
              ? ' A second look at the clip added one more metric.'
              : scalePassCouldntAdd)}
          {analysis.scalePass.status === 'failed' && scalePassCouldntAdd}
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
          <MetricsPanel heuristics={heuristics} scalePassStatus={analysis.scalePass.status} />
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

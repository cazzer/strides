import { GuidedResultsView } from '../GuidedResultsView'
import type { GuidedResultsViewProps } from '../GuidedResultsView'

export interface ResultsSummaryProps extends GuidedResultsViewProps {
  /** Back into the tour. Leaves the remembered landing alone: replaying is a one-off. */
  onReplayTour: () => void
  /** Into the classic table, which the session writes to the address as `view=classic`. */
  onOpenClassic: () => void
}

/**
 * The results summary — where a reader lands after skipping or finishing the tour. A STUB
 * (`strides-trn2.2`): it owns the summary's controls, and delegates the body to `GuidedResultsView`
 * until the real summary lands (`strides-trn2.5`), which edits this file only.
 *
 * Same two rules as `RunnerTour`: no completion line of its own (the guided view renders the one the
 * e2e suite and the A/B harness wait on), and exactly one mounted `GuidedResultsView`.
 *
 * "Classic table" is a link-STYLED button, not an `<a href>`: the analysis lives in memory, so
 * following a real link — or opening it in a new tab — would load a page with no results on it.
 */
export function ResultsSummary({ onReplayTour, onOpenClassic, ...guidedProps }: ResultsSummaryProps) {
  return (
    <div className="results-summary space-y-6">
      {/* Where the model runner will stand (`strides-trn2.5`). */}
      <div className="results-runner-slot" aria-hidden="true" />
      <button
        type="button"
        onClick={onReplayTour}
        className="inline-flex items-center justify-center border-2 border-black px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide text-black transition-colors hover:bg-black hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:border-white dark:text-white dark:hover:bg-white dark:hover:text-black"
      >
        Replay tour
      </button>
      <GuidedResultsView {...guidedProps} />
      <footer className="border-t-2 border-black pt-4 dark:border-white">
        <button
          type="button"
          onClick={onOpenClassic}
          className="font-sans text-sm font-semibold text-black underline underline-offset-4 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:text-white dark:hover:text-brand-400"
        >
          Classic table
        </button>
      </footer>
    </div>
  )
}

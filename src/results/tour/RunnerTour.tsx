import { GuidedResultsView } from '../GuidedResultsView'
import type { GuidedResultsViewProps } from '../GuidedResultsView'

export interface RunnerTourProps extends GuidedResultsViewProps {
  /** The reader skipped (or finished) the tour. The session remembers the summary as the landing
   * view and switches to it. */
  onLeaveTour: () => void
}

/**
 * The runner tour — the default results view. A STUB (`strides-trn2.2`): it owns the tour's place
 * in the routing and its way out, and delegates the body to `GuidedResultsView` until the real tour
 * lands (`strides-trn2.3`), which edits this file only.
 *
 * Deliberately renders NO completion line of its own. `GuidedResultsView` already renders the one
 * `role="status"` "Analysis complete." the e2e suite and the A/B harness wait on, and a second match
 * would break Playwright's strict locator in both. Likewise the root is a plain `div`, not a section
 * labelled "Analysis results": the guided view inside it is that section, and there is exactly one.
 *
 * Exactly one `GuidedResultsView` — never a hidden second copy. Evidence canvases are real elements
 * with one parent each, so a second mounted view would silently take them from the first.
 */
export function RunnerTour({ onLeaveTour, ...guidedProps }: RunnerTourProps) {
  return (
    <div className="runner-tour space-y-6">
      {/* Where the model runner will stand (`strides-trn2.3`). Empty and hidden from assistive
          technology until there is something in it to describe. */}
      <div className="results-runner-slot" aria-hidden="true" />
      <button
        type="button"
        onClick={onLeaveTour}
        className="inline-flex items-center justify-center border-2 border-black px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide text-black transition-colors hover:bg-black hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:border-white dark:text-white dark:hover:bg-white dark:hover:text-black"
      >
        Skip to summary
      </button>
      <GuidedResultsView {...guidedProps} />
    </div>
  )
}

import { useId } from 'react'
import type { ResultsViewMode } from './resultsViewMode'

export interface ResultsViewToggleProps {
  mode: ResultsViewMode
  /** Called with the newly chosen mode. Not called when the already-pressed option is pressed
   * again — there is nothing to change, and the composer writes the address on every call. */
  onChange: (mode: ResultsViewMode) => void
}

const OPTIONS: ReadonlyArray<{ mode: ResultsViewMode; label: string }> = [
  { mode: 'classic', label: 'Classic' },
  { mode: 'guide', label: 'Guided' },
]

const BASE =
  'relative inline-flex items-center justify-center border-2 px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide transition-colors focus-visible:z-[2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'
// `z-[1]` lifts the pressed button's border over the overlapped edge its neighbour shares with it;
// `focus-visible:z-[2]` in BASE lifts a focused button's outline over both.
const PRESSED = 'z-[1] border-brand-700 bg-brand-700 text-white'
const UNPRESSED =
  'border-black dark:border-white text-black dark:text-white hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black'

/**
 * Chooses between the classic and guided results views: a two-option segmented control, one native
 * `<button type="button">` per view with `aria-pressed`, so Tab, Enter and Space all work with no
 * key handling of its own.
 *
 * Neither option is styled as the recommended one. Pressed is the brand fill, unpressed the page's
 * ordinary outlined button, the same pair `ResultsView` uses — the fill marks which view is showing,
 * not which is better.
 *
 * Focus stays where the reader put it. The buttons never unmount on a change (only `aria-pressed`
 * flips), so the button just activated keeps focus while the view below it is swapped out.
 */
export function ResultsViewToggle({ mode, onChange }: ResultsViewToggleProps) {
  const hintId = useId()
  return (
    <div className="results-view-toggle flex flex-wrap items-center gap-x-4 gap-y-2">
      <div
        role="group"
        aria-label="Results view: classic or guided"
        aria-describedby={hintId}
        className="flex"
      >
        {OPTIONS.map((option, index) => {
          const pressed = option.mode === mode
          return (
            <button
              key={option.mode}
              type="button"
              aria-pressed={pressed}
              onClick={() => {
                if (!pressed) onChange(option.mode)
              }}
              // The second button's left border overlaps the first's, so the pair reads as one
              // control with a single 2px divider rather than a doubled 4px one.
              className={`${BASE} ${pressed ? PRESSED : UNPRESSED}${index > 0 ? ' -ml-0.5' : ''}`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
      <p id={hintId} className="font-sans text-sm text-neutral-600 dark:text-neutral-400">
        Guided places each measurement beside published research where it exists.
      </p>
    </div>
  )
}

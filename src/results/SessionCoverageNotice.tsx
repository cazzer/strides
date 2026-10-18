import { METRIC_LABELS } from './metricConfidence'
import { joinList } from './guidedGroups'
import type { CommittedView, SessionCoverage } from './sessionCoverage'

export interface SessionCoverageNoticeProps {
  coverage: SessionCoverage
  /** Opens the header's add-a-clip panel. */
  onAddClip: () => void
}

/** How to film each view — the same advice the clip picker gives, so the two never disagree. */
const FILMING_HINT: Record<CommittedView, string> = {
  side: 'Film from the side, across your path.',
  front: 'Film facing you as you run toward the camera.',
}

const VIEW_NAME: Record<CommittedView, string> = { side: 'side', front: 'front' }

/**
 * Says, once and above either results view, which camera view the session is missing and which
 * measurements need it (`strides-pz0u`). Renders nothing when nothing is missing for an angle
 * reason. Not a live region: the session's one announced line is the results view's status.
 */
export function SessionCoverageNotice({ coverage, onAddClip }: SessionCoverageNoticeProps) {
  if (coverage.needs.length === 0) return null
  const single = coverage.needs.length === 1 ? coverage.needs[0].view : null
  return (
    <section
      aria-label="Camera views in this session"
      className="session-coverage space-y-3 border-2 border-black border-l-4 border-l-brand-600 p-4 dark:border-white dark:border-l-brand-400"
    >
      <p className="font-sans text-sm text-neutral-600 dark:text-neutral-400">
        This session has{' '}
        {coverage.present.side && coverage.present.front
          ? 'side and front views'
          : coverage.present.side
            ? 'a side view only'
            : coverage.present.front
              ? 'a front view only'
              : 'no clear side or front view'}
        .
      </p>
      {coverage.needs.map((need) => (
        <p key={need.view} className="font-sans text-sm">
          <span className="font-semibold">
            {need.metrics.length === 1 ? '1 measurement needs' : `${need.metrics.length} measurements need`} a{' '}
            {VIEW_NAME[need.view]}-view clip:
          </span>{' '}
          {joinList(need.metrics.map((id) => METRIC_LABELS[id].toLowerCase()))}. {FILMING_HINT[need.view]}
        </p>
      ))}
      <button
        type="button"
        onClick={onAddClip}
        className="inline-flex items-center justify-center border-2 border-black dark:border-white px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide text-black dark:text-white transition-colors hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        {single ? `Add a ${VIEW_NAME[single]}-view clip` : 'Add a clip'}
      </button>
    </section>
  )
}

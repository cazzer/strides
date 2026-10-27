import type { CitedLine } from '../guidance/feedbackPoints'
import { EVIDENCE_KIND_LABELS, FEEDBACK_SOURCE_TITLES } from './feedbackSources'
import { ExternalLink } from './GuidedMetricCard'

/**
 * One cited feedback line (a why line or a non-point): its text, then how strong the claim is and
 * the source it rests on. Never rendered without its source (add-runner-tour design.md D2).
 */
export function FeedbackLine({ line, className = '' }: { line: CitedLine; className?: string }) {
  return (
    <p className={`font-sans text-sm text-neutral-700 dark:text-neutral-300 ${className}`}>
      {line.text}{' '}
      <span className="font-sans text-xs text-neutral-600 dark:text-neutral-400">
        {EVIDENCE_KIND_LABELS[line.evidence]}
        {' · '}
        <ExternalLink url={line.url}>{FEEDBACK_SOURCE_TITLES[line.url] ?? 'Source'}</ExternalLink>
      </span>
    </p>
  )
}

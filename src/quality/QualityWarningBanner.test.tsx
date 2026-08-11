import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QualityWarningBanner } from './QualityWarningBanner'
import type { QualityCheckResult, VideoQualityAssessment } from './types'

function makeCheck(
  id: QualityCheckResult['id'],
  status: QualityCheckResult['status'],
  message: string | null = null,
): QualityCheckResult {
  return { id, status, value: null, threshold: null, message }
}

function passAssessment(): VideoQualityAssessment {
  return {
    overall: 'pass',
    checks: {
      resolution: makeCheck('resolution', 'pass'),
      frameRate: makeCheck('frameRate', 'pass'),
      confidence: makeCheck('confidence', 'pass'),
    },
  }
}

function warnAssessment(): VideoQualityAssessment {
  return {
    overall: 'warn',
    checks: {
      resolution: makeCheck('resolution', 'fail', 'Resolution is too low.'),
      frameRate: makeCheck('frameRate', 'skipped'),
      confidence: makeCheck('confidence', 'fail', 'Confidence is too low.'),
    },
  }
}

describe('QualityWarningBanner', () => {
  it('renders nothing when not yet ready', () => {
    const { container } = render(
      <QualityWarningBanner
        status="idle"
        assessment={null}
        dismissed={false}
        proceedAnyway={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a status notice while assessing', () => {
    render(
      <QualityWarningBanner
        status="assessing"
        assessment={null}
        dismissed={false}
        proceedAnyway={vi.fn()}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      /checking video quality/i,
    )
  })

  it('renders a status notice when the assessment itself failed, rather than nothing', () => {
    render(
      <QualityWarningBanner
        status="error"
        assessment={null}
        dismissed={false}
        proceedAnyway={vi.fn()}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(/couldn't check/i)
  })

  it('renders nothing when the assessment passes', () => {
    const { container } = render(
      <QualityWarningBanner
        status="ready"
        assessment={passAssessment()}
        dismissed={false}
        proceedAnyway={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when dismissed, even if the assessment warns', () => {
    const { container } = render(
      <QualityWarningBanner
        status="ready"
        assessment={warnAssessment()}
        dismissed={true}
        proceedAnyway={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders an alert with each failed check message when warning', () => {
    render(
      <QualityWarningBanner
        status="ready"
        assessment={warnAssessment()}
        dismissed={false}
        proceedAnyway={vi.fn()}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Resolution is too low.')
    expect(alert).toHaveTextContent('Confidence is too low.')
    // skipped check contributes no message
    expect(alert.textContent).not.toMatch(/frameRate/i)
  })

  it('calls proceedAnyway when the button is activated', () => {
    const proceedAnyway = vi.fn()
    render(
      <QualityWarningBanner
        status="ready"
        assessment={warnAssessment()}
        dismissed={false}
        proceedAnyway={proceedAnyway}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /proceed anyway/i }))
    expect(proceedAnyway).toHaveBeenCalledTimes(1)
  })
})

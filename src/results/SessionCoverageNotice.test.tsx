import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionCoverageNotice } from './SessionCoverageNotice'

describe('SessionCoverageNotice', () => {
  it('renders nothing when no view is needed', () => {
    const { container } = render(
      <SessionCoverageNotice
        coverage={{ present: { side: true, front: false }, needs: [] }}
        onAddClip={() => {}}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('names the missing view, the measurements needing it, and offers to add that clip', () => {
    const onAddClip = vi.fn()
    render(
      <SessionCoverageNotice
        coverage={{
          present: { side: true, front: false },
          needs: [{ view: 'front', metrics: ['stepWidth', 'armSwingAmplitude'] }],
        }}
        onAddClip={onAddClip}
      />,
    )
    const region = screen.getByRole('region', { name: 'Camera views in this session' })
    expect(region).toHaveTextContent('This session has a side view only.')
    expect(region).toHaveTextContent(
      '2 measurements need a front-view clip: step width and arm swing amplitude (wrist up-and-down).',
    )
    // Never a live region: the results view's status is the session's one announced line.
    expect(region.querySelector('[aria-live],[role="status"],[role="alert"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Add a front-view clip' }))
    expect(onAddClip).toHaveBeenCalledTimes(1)
  })

  it('offers a generic add action when both views are missing', () => {
    render(
      <SessionCoverageNotice
        coverage={{
          present: { side: false, front: false },
          needs: [
            { view: 'side', metrics: ['trunkLean'] },
            { view: 'front', metrics: ['stepWidth'] },
          ],
        }}
        onAddClip={() => {}}
      />,
    )
    expect(screen.getByText(/1 measurement needs a side-view clip/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add a clip' })).toBeInTheDocument()
  })
})

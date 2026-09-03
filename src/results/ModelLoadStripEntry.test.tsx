import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { IDLE_MODEL_LOAD_STATE } from '../pose/modelLoadState'
import { ModelLoadStripEntry } from './ModelLoadStripEntry'
import { describeModelLoadStripStatus } from './modelLoadStripStatus'

function loadingStatus(loadedBytes?: number) {
  return describeModelLoadStripStatus({
    primary: {
      phase: 'loading',
      progress:
        loadedBytes === undefined ? null : { loadedBytes, totalBytes: 14_522_593 },
    },
    scalePass: IDLE_MODEL_LOAD_STATE,
  })!
}

function errorStatus() {
  return describeModelLoadStripStatus({
    primary: { phase: 'error', progress: null },
    scalePass: IDLE_MODEL_LOAD_STATE,
  })!
}

describe('ModelLoadStripEntry', () => {
  it('exposes the download as text, not only as a bar', () => {
    render(<ModelLoadStripEntry status={loadingStatus(4_200_000)} />)

    expect(screen.getByText('4.2 MB')).toBeInTheDocument()
    expect(screen.getByText(/downloading the pose model… 4\.2 mb so far\./i)).toBeInTheDocument()
  })

  /**
   * `results-view` allows at most one live region announcing progress for the session, and the
   * active clip's `role="status"` caption holds it. This entry exposes its condition as text and
   * announces nothing — the same rule every non-active clip entry already follows.
   */
  it('is not a live region', () => {
    const { container } = render(<ModelLoadStripEntry status={loadingStatus(4_200_000)} />)

    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('[aria-live]')).toBeNull()
  })

  it('renders no percentage anywhere, at any reading', () => {
    for (const status of [loadingStatus(), loadingStatus(417_083), loadingStatus(4_200_000)]) {
      const { container, unmount } = render(<ModelLoadStripEntry status={status} />)
      expect(container.textContent).not.toContain('%')
      // A determinate bar would encode the fraction as an inline width; there is no honest
      // fraction to encode, so there is no width.
      const bar = container.querySelector('.model-load-entry__frame div[class*="h-full"]')
      expect(bar).not.toBeNull()
      expect((bar as HTMLElement).style.width).toBe('')
      unmount()
    }
  })

  it('shows a word rather than a figure before anything has been measured', () => {
    render(<ModelLoadStripEntry status={loadingStatus()} />)

    expect(screen.getByText('Loading')).toBeInTheDocument()
    expect(screen.getByText('Downloading the pose model…')).toBeInTheDocument()
  })

  it('uses the indeterminate pulse while loading and the hatched treatment on failure', () => {
    const { container: loadingContainer } = render(
      <ModelLoadStripEntry status={loadingStatus(1_000_000)} />,
    )
    expect(loadingContainer.querySelector('.animate-pulse')).not.toBeNull()
    expect(loadingContainer.querySelector('[data-model-load-condition="loading"]')).not.toBeNull()

    const { container: errorContainer } = render(<ModelLoadStripEntry status={errorStatus()} />)
    expect(errorContainer.querySelector('.animate-pulse')).toBeNull()
    expect(errorContainer.querySelector('[data-model-load-condition="error"]')).not.toBeNull()
    const hatched = errorContainer.querySelector<HTMLElement>('[style*="repeating-linear-gradient"]')
    expect(hatched).not.toBeNull()
  })

  it('reports a failure in words, not as work still in progress', () => {
    render(<ModelLoadStripEntry status={errorStatus()} />)

    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(
      screen.getByText(/the pose model could not be downloaded\. reload the page to try again\./i),
    ).toBeInTheDocument()
  })

  /**
   * It hosts no `<video>` and offers nothing to open or remove, so it must add no focusable element
   * to the header — the strip's tab order stays exactly the clips' tab order.
   */
  it('adds nothing focusable to the header', () => {
    const { container } = render(<ModelLoadStripEntry status={loadingStatus(1_000)} />)

    expect(container.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0)
  })

  /**
   * Its own class namespace, so it can never be the first match for the bare
   * `document.querySelector('.clip-strip__frame')` assertions in `ClipStripEntry.test.tsx`.
   */
  it('does not borrow the clip strip class names', () => {
    const { container } = render(<ModelLoadStripEntry status={loadingStatus(1_000)} />)

    expect(container.querySelector('.clip-strip__frame')).toBeNull()
    expect(container.querySelector('.clip-strip__caption')).toBeNull()
    expect(container.querySelector('.model-load-entry__frame')).not.toBeNull()
  })

  /** Same height as a clip entry, so appearing and leaving does not shift `<main>` twice. */
  it('matches a clip entry frame box so the header height does not move', () => {
    const { container } = render(<ModelLoadStripEntry status={loadingStatus(1_000)} />)

    const frame = container.querySelector('.model-load-entry__frame')!
    expect(frame.className).toContain('h-[4.5rem]')
    expect(frame.className).toContain('w-24')
  })
})

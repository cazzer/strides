import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ClipPreviewDialog } from './ClipPreviewDialog'

function renderDialog(overrides: Partial<Parameters<typeof ClipPreviewDialog>[0]> = {}) {
  const props = {
    open: false,
    labelledBy: 'label-1',
    onDismiss: vi.fn(),
    children: (
      <>
        <div data-testid="stage">
          <video data-testid="clip-video" controls />
        </div>
        <p id="label-1">Clip 1 of 1: Analyzed.</p>
      </>
    ),
    ...overrides,
  }
  return { ...render(<ClipPreviewDialog {...props} />), props }
}

describe('ClipPreviewDialog', () => {
  it('is layout-transparent while closed, and a modal dialog while open', () => {
    const { container, rerender, props } = renderDialog({ open: false })
    const surface = container.firstElementChild!

    // `display: contents` generates no box at all, so a closed preview is layout-identical to this
    // component not being in the tree — which is what lets it be mounted unconditionally.
    expect(surface.className).toBe('contents')
    expect(screen.queryByRole('dialog')).toBeNull()

    rerender(<ClipPreviewDialog {...props} open />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBe(surface)
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'label-1')
    expect(dialog).toHaveAccessibleName('Clip 1 of 1: Analyzed.')
  })

  it('keeps the very same child DOM nodes across closed → open → closed', () => {
    // The requirement this component exists for (`results-view`, "Revealing a clip does not change
    // which element analysis holds"): the running analysis and `SkeletonOverlay` both hold
    // `videoRef.current`, so opening the preview must not produce a second element or remount the
    // existing one. Asserted on node identity, not on a selector matching something.
    const { rerender, props } = renderDialog({ open: false })
    const video = screen.getByTestId('clip-video')

    rerender(<ClipPreviewDialog {...props} open />)
    expect(screen.getByTestId('clip-video')).toBe(video)

    rerender(<ClipPreviewDialog {...props} open={false} />)
    expect(screen.getByTestId('clip-video')).toBe(video)
  })

  it('dismisses on Escape and on a backdrop click, but not on a click inside the content', () => {
    const onDismiss = vi.fn()
    renderDialog({ open: true, onDismiss })
    const dialog = screen.getByRole('dialog')

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)

    // The backdrop IS the dialog element, so only a click that lands on it directly is "outside".
    fireEvent.click(screen.getByTestId('stage'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    fireEvent.click(dialog)
    expect(onDismiss).toHaveBeenCalledTimes(2)
  })

  it('offers a Close control, and ignores Escape while closed', () => {
    const onDismiss = vi.fn()
    const { rerender, props } = renderDialog({ open: false, onDismiss })

    expect(screen.queryByRole('button', { name: /close preview/i })).toBeNull()
    fireEvent.keyDown(props.children ? screen.getByTestId('stage') : document.body, {
      key: 'Escape',
    })
    expect(onDismiss).not.toHaveBeenCalled()

    rerender(<ClipPreviewDialog {...props} open />)
    fireEvent.click(screen.getByRole('button', { name: /close preview/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('takes focus on open and cycles Tab within itself', () => {
    const { rerender, props } = renderDialog({ open: false })
    rerender(<ClipPreviewDialog {...props} open />)

    const dialog = screen.getByRole('dialog')
    // Focus lands on the dialog itself, so its label is announced before any control is offered.
    expect(document.activeElement).toBe(dialog)

    const close = screen.getByRole('button', { name: /close preview/i })

    // Shift+Tab from the dialog itself (where focus starts) wraps to the last focusable.
    const backward = fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(backward).toBe(false) // preventDefault: Tab never reaches the page behind the backdrop
    expect(document.activeElement).toBe(close)

    // Forward from the last focusable wraps to the first, which here is the clip's own `<video
    // controls>` — a real tab stop in a browser, but NOT one jsdom models as focusable, so only
    // the preventDefault and the containment are observable here. That the video is in the trap's
    // element set at all is the browser's business; what this asserts is that Tab does not escape.
    close.focus()
    const forward = fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(forward).toBe(false)
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('keeps focus on itself when the clip’s element is inert and nothing else is focusable', () => {
    // Reachable while the clip is mid-analysis: `VideoInputPanel` keeps the element `inert` for
    // the whole window the pipeline owns it, so the video is not a tab stop then.
    render(
      <ClipPreviewDialog open labelledBy="label-2" onDismiss={vi.fn()}>
        <div inert>
          <video controls />
        </div>
        <p id="label-2">Clip 1 of 1: Analyzing… 42%</p>
      </ClipPreviewDialog>,
    )

    const dialog = screen.getByRole('dialog')
    const close = screen.getByRole('button', { name: /close preview/i })
    close.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    // Close is both the first and the last focusable, so Tab stays put rather than escaping.
    expect(document.activeElement).toBe(close)
  })
})

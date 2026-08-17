import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClipPicker } from './ClipPicker'

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * These four moved here verbatim from `VideoInputPanel.test.tsx` when the picker was extracted —
 * same interactions, same accessible names, only the callback they land on changed (`onSource`
 * instead of a `VideoSource`'s own `load`). The names are load-bearing beyond this file:
 * `e2e/multiPersonAcquisition.spec.ts` and `scripts/ab-person-selection.mjs` both drive `Upload`,
 * `input[type=file]`, `Demo 1 …` and `Demo 2 …` by exactly these strings.
 */
describe('ClipPicker', () => {
  it('shows the Record tab by default with tab controls', () => {
    render(<ClipPicker onSource={vi.fn()} />)
    expect(
      screen.getByRole('button', { name: /start recording/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText(/choose a video file/i),
    ).not.toBeInTheDocument()
  })

  it('switches to the Upload tab', () => {
    render(<ClipPicker onSource={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))

    expect(screen.getByLabelText(/choose a video file/i)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /start recording/i }),
    ).not.toBeInTheDocument()
  })

  it('calls onSource with the fetched blob when the demo video button is used', async () => {
    const blob = new Blob(['content'], { type: 'video/mp4' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, blob: () => Promise.resolve(blob) }),
    )

    const onSource = vi.fn()
    render(<ClipPicker onSource={onSource} />)
    fireEvent.click(screen.getByRole('button', { name: /demo 1 \(side view\)/i }))

    await waitFor(() => expect(onSource).toHaveBeenCalledWith(blob))
  })

  it('calls onSource when a file is selected on the Upload tab', () => {
    const onSource = vi.fn()
    render(<ClipPicker onSource={onSource} />)
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))

    const file = new File(['content'], 'run.mp4', { type: 'video/mp4' })
    fireEvent.change(screen.getByLabelText(/choose a video file/i), {
      target: { files: [file] },
    })

    expect(onSource).toHaveBeenCalledWith(file)
  })

  it('calls onSource once per file, so one picker interaction can create several clips', () => {
    const onSource = vi.fn()
    render(<ClipPicker onSource={onSource} />)
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))

    const first = new File(['a'], 'run1.mp4', { type: 'video/mp4' })
    const second = new File(['b'], 'run2.mp4', { type: 'video/mp4' })
    fireEvent.change(screen.getByLabelText(/choose a video file/i), {
      target: { files: [first, second] },
    })

    // The old first-slot picker handed all of these to ONE `useVideoSource`, so three files
    // produced one clip and the last file won. Fanning out per file is what makes
    // "one source, one clip" true for the first clip as well as for clips 2..N.
    expect(onSource).toHaveBeenCalledTimes(2)
    expect(onSource).toHaveBeenNthCalledWith(1, first)
    expect(onSource).toHaveBeenNthCalledWith(2, second)
  })
})

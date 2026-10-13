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
 * `e2e/multiPersonAcquisition.spec.ts` and `scripts/ab-person-selection.mjs` both drive `Upload`
 * and `input[type=file]` by exactly these strings. The demo button is no longer among them: one
 * action loading three clips cannot serve as a per-clip measurement arm, so the harness uploads
 * each bundled clip individually instead.
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

  it('keeps view and capture guidance visible before either entry action', () => {
    render(<ClipPicker onSource={vi.fn()} />)

    const checkGuidance = () => {
      expect(screen.getByText(/whole body, including both feet/i)).toBeInTheDocument()
      expect(screen.getByText(/several unobstructed strides/i)).toBeInTheDocument()
      expect(screen.getByText(/film from the side/i)).toBeInTheDocument()
      expect(screen.getByText(/front view.*step width and arm swing/i)).toBeInTheDocument()
    }

    checkGuidance()
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    checkGuidance()
    expect(screen.getByLabelText(/choose a video file/i)).toBeInTheDocument()
  })

  it('explains local video handling before recording or file selection', () => {
    render(<ClipPicker onSource={vi.fn()} />)

    const checkHandling = () => {
      expect(screen.getByText(/your clip is analyzed in this browser/i)).toBeInTheDocument()
      expect(screen.getByText(/does not upload your video to a server/i)).toBeInTheDocument()
    }

    checkHandling()
    fireEvent.click(screen.getByText(/more about video handling/i))
    expect(screen.getByText(/generated stills remain in this page/i)).toBeInTheDocument()
    expect(screen.getByText(/downloads analysis models and fonts separately/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    checkHandling()
    expect(screen.getByLabelText(/choose a video file/i)).toBeInTheDocument()
  })

  it('offers exactly one demo action, not one per clip', () => {
    render(<ClipPicker onSource={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: /demo/i })).toHaveLength(1)
  })

  it('calls onSource once per bundled demo clip', async () => {
    const blob = new Blob(['content'], { type: 'video/mp4' })
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, blob: () => Promise.resolve(blob) })
    vi.stubGlobal('fetch', fetchMock)

    const onSource = vi.fn()
    render(<ClipPicker onSource={onSource} />)
    fireEvent.click(screen.getByRole('button', { name: /demo \(3 clips\)/i }))

    // One `onSource` per clip is what makes the demo a SESSION rather than a clip: the host
    // creates one clip per call, so three calls are three clips fused into one result.
    await waitFor(() => expect(onSource).toHaveBeenCalledTimes(3))
    expect(onSource).toHaveBeenCalledWith(blob)

    // Three distinct bundled assets, not the same one three times.
    const fetched = fetchMock.mock.calls.map(([url]) => url)
    expect(new Set(fetched).size).toBe(3)
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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DemoVideoButton } from './DemoVideoButton'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DemoVideoButton', () => {
  it('renders a button', () => {
    render(<DemoVideoButton onLoaded={vi.fn()} />)
    expect(
      screen.getByRole('button', { name: /try a demo video/i }),
    ).toBeInTheDocument()
  })

  it('fetches the demo video and calls onLoaded with a blob on success', async () => {
    const blob = new Blob(['content'], { type: 'video/mp4' })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: () => Promise.resolve(blob),
    })
    vi.stubGlobal('fetch', fetchMock)

    const onLoaded = vi.fn()
    render(<DemoVideoButton onLoaded={onLoaded} />)
    fireEvent.click(screen.getByRole('button', { name: /try a demo video/i }))

    await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(blob))
    expect(fetchMock).toHaveBeenCalledWith(
      'https://videos.pexels.com/video-files/8533913/8533913-uhd_3840_2160_25fps.mp4',
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows an alert when the response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    )

    render(<DemoVideoButton onLoaded={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /try a demo video/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't load the demo video/i,
    )
  })

  it('shows an alert when the fetch itself rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    render(<DemoVideoButton onLoaded={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /try a demo video/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't load the demo video/i,
    )
  })

  it('is disabled when the disabled prop is set', () => {
    render(<DemoVideoButton onLoaded={vi.fn()} disabled />)
    expect(screen.getByRole('button', { name: /try a demo video/i })).toBeDisabled()
  })
})

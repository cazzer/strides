import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DemoVideoButton } from './DemoVideoButton'

afterEach(() => {
  vi.unstubAllGlobals()
})

const URLS = ['/a.mp4', '/b.mp4', '/c.mp4'] as const

/** A `fetch` stub that hands back a distinct blob per URL, so emit ORDER is observable. */
function stubFetchPerUrl(blobs: Record<string, Blob>) {
  const fetchMock = vi.fn((url: string) =>
    Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(blobs[url]) }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('DemoVideoButton', () => {
  it('renders a button carrying the given label', () => {
    render(<DemoVideoButton onLoaded={vi.fn()} videoUrls={URLS} label="Demo (3 clips)" />)
    expect(screen.getByRole('button', { name: /demo \(3 clips\)/i })).toBeInTheDocument()
  })

  it('fetches every clip and calls onLoaded once per clip, in order', async () => {
    const blobs = {
      '/a.mp4': new Blob(['a'], { type: 'video/mp4' }),
      '/b.mp4': new Blob(['b'], { type: 'video/mp4' }),
      '/c.mp4': new Blob(['c'], { type: 'video/mp4' }),
    }
    const fetchMock = stubFetchPerUrl(blobs)

    const onLoaded = vi.fn()
    render(<DemoVideoButton onLoaded={onLoaded} videoUrls={URLS} label="Demo" />)
    fireEvent.click(screen.getByRole('button', { name: /^demo$/i }))

    await waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(3))
    // Order is user-visible — the evidence captions name "clip 2 of 3" — so it is pinned, not
    // merely assumed from the fact that all three arrived.
    expect(onLoaded).toHaveBeenNthCalledWith(1, blobs['/a.mp4'])
    expect(onLoaded).toHaveBeenNthCalledWith(2, blobs['/b.mp4'])
    expect(onLoaded).toHaveBeenNthCalledWith(3, blobs['/c.mp4'])
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([...URLS])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('hands over each clip as it arrives rather than after the whole set', async () => {
    // The whole point of fetching sequentially: clip 1 must reach the session while clips 2 and 3
    // are still downloading. Holding the second fetch open makes "already delivered" observable.
    const first = new Blob(['a'], { type: 'video/mp4' })
    let releaseSecond: () => void = () => {}
    const secondBlocked = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url === '/a.mp4'
          ? Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(first) })
          : secondBlocked.then(() => ({
              ok: true,
              status: 200,
              blob: () => Promise.resolve(new Blob(['b'], { type: 'video/mp4' })),
            })),
      ),
    )

    const onLoaded = vi.fn()
    render(
      <DemoVideoButton onLoaded={onLoaded} videoUrls={['/a.mp4', '/b.mp4']} label="Demo" />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^demo$/i }))

    await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(first))
    expect(onLoaded).toHaveBeenCalledTimes(1)

    releaseSecond()
    await waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(2))
  })

  it('keeps the clips already delivered when a later clip fails', async () => {
    const first = new Blob(['a'], { type: 'video/mp4' })
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url === '/a.mp4'
          ? Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(first) })
          : Promise.resolve({ ok: false, status: 500 }),
      ),
    )

    const onLoaded = vi.fn()
    render(
      <DemoVideoButton onLoaded={onLoaded} videoUrls={['/a.mp4', '/b.mp4']} label="Demo" />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^demo$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't load the demo video/i,
    )
    // Clip 1 is a real loaded clip the session is already analyzing. Reporting the failure must
    // not pretend it never arrived.
    expect(onLoaded).toHaveBeenCalledTimes(1)
    expect(onLoaded).toHaveBeenCalledWith(first)
  })

  it('shows an alert when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    render(<DemoVideoButton onLoaded={vi.fn()} videoUrls={URLS} label="Demo" />)
    fireEvent.click(screen.getByRole('button', { name: /^demo$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't load the demo video/i,
    )
  })

  it('shows an alert when the fetch itself rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    render(<DemoVideoButton onLoaded={vi.fn()} videoUrls={URLS} label="Demo" />)
    fireEvent.click(screen.getByRole('button', { name: /^demo$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't load the demo video/i,
    )
  })

  it('is disabled when the disabled prop is set', () => {
    render(<DemoVideoButton onLoaded={vi.fn()} videoUrls={URLS} label="Demo" disabled />)
    expect(screen.getByRole('button', { name: /^demo$/i })).toBeDisabled()
  })
})

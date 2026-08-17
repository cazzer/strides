import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ClipPoster } from '../video/posterFrame'
import { ClipStripEntry } from './ClipStripEntry'
import { describeClipStripStatus } from './clipStripStatus'
import type { ClipStripStatus } from './clipStripStatus'

function samplingStatus(percent = 42): ClipStripStatus {
  return describeClipStripStatus({
    videoStatus: 'ready',
    phase: 'sampling',
    progress: percent / 100,
    isPausedMidAnalysis: false,
    scalePassStatus: 'idle',
    isActiveClip: true,
  })
}

function queuedStatus(): ClipStripStatus {
  return describeClipStripStatus({
    videoStatus: 'ready',
    phase: 'idle',
    progress: 0,
    isPausedMidAnalysis: false,
    scalePassStatus: 'idle',
    isActiveClip: false,
  })
}

function makePoster(): ClipPoster {
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 72
  return { canvas, width: 96, height: 72, timestamp: 1 }
}

function renderEntry(overrides: Partial<Parameters<typeof ClipStripEntry>[0]> = {}) {
  const props = {
    index: 0,
    total: 1,
    status: samplingStatus(),
    poster: null,
    hostsLiveElement: true,
    isActiveClip: true,
    onRemove: vi.fn(),
    children: <div data-testid="video-host" />,
    ...overrides,
  }
  return { ...render(<ClipStripEntry {...props} />), props }
}

describe('ClipStripEntry', () => {
  it('exposes its condition and progress to assistive technology as text, not only as a graphic', () => {
    renderEntry({ index: 1, total: 3, status: samplingStatus(42) })

    // The percentage is visible, and the full sentence — including which clip this is — is
    // available as text. Neither is conveyed by the bar alone.
    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByText(/clip 2 of 3: analyzing… 42%/i)).toBeInTheDocument()
  })

  it('names its activation control after the clip and its condition, and is keyboard reachable', () => {
    renderEntry({ index: 1, total: 2, status: queuedStatus(), isActiveClip: false })

    const button = screen.getByRole('button', {
      name: /clip 2 of 2: queued — waiting for another clip/i,
    })
    expect(button).toBeInTheDocument()
    // A real <button>, so it is in the tab order without a tabindex of its own.
    expect(button.tagName).toBe('BUTTON')
    expect(button).not.toHaveAttribute('tabindex')
  })

  it('announces only for the clip that currently holds the shared detector', () => {
    // design.md D3, "One live region, not N": every entry carries its condition as text, but an
    // N-clip session must not get N live regions announcing over each other.
    const { unmount } = renderEntry({ isActiveClip: true })
    expect(screen.getAllByRole('status')).toHaveLength(1)
    unmount()

    renderEntry({ isActiveClip: false, status: queuedStatus() })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    // Still readable, just not announced.
    expect(screen.getByText(/queued — waiting for another clip/i)).toBeInTheDocument()
  })

  it('tags itself with its condition, for anything that has to tell entries apart', () => {
    const { container } = renderEntry({ status: queuedStatus() })
    expect(container.querySelector('[data-clip-condition="queued"]')).toBeInTheDocument()
  })

  it('shows the poster only when the frame is not hosting the live element', () => {
    const poster = makePoster()

    const concealed = renderEntry({ hostsLiveElement: false, poster })
    expect(concealed.container.querySelector('.clip-strip__poster canvas')).toBe(poster.canvas)
    concealed.unmount()

    // While the clip is being sampled the frame belongs to the real, painting <video>; drawing a
    // still over it would just fight with the thing the sampler is reading.
    const live = renderEntry({ hostsLiveElement: true, poster })
    expect(live.container.querySelector('.clip-strip__poster')).toBeNull()
    expect(screen.getByTestId('video-host')).toBeInTheDocument()
  })

  it('falls back to a neutral placeholder while a clip has no poster yet', () => {
    const { container } = renderEntry({ hostsLiveElement: false, poster: null, index: 2, total: 4 })
    expect(container.querySelector('.clip-strip__poster')).toBeNull()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('always hosts the clip’s element, in both placements — the entry never withholds it', () => {
    // The element must be a permanent child of the entry: only its CSS may change between
    // on-screen and concealed, because remounting it would destroy the node the sampler holds.
    const concealed = renderEntry({ hostsLiveElement: false, poster: makePoster() })
    expect(screen.getByTestId('video-host')).toBeInTheDocument()
    concealed.unmount()

    renderEntry({ hostsLiveElement: true })
    expect(screen.getByTestId('video-host')).toBeInTheDocument()
  })

  it('removes its own clip', () => {
    const onRemove = vi.fn()
    renderEntry({ onRemove })

    fireEvent.click(screen.getByRole('button', { name: /remove clip/i }))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })
})

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EvidenceFrame } from './EvidenceFrame'
import type { ExtractedEvidenceFrame } from '../video/extractFrames'

const frame = {
  canvas: document.createElement('canvas'),
  plan: {
    metric: 'trunkLean',
    label: 'forward lean',
    side: undefined,
    base: { timestamp: 1.25 },
    ghost: null,
    demotion: null,
  },
} as ExtractedEvidenceFrame

describe('EvidenceFrame', () => {
  it('enlarges the same canvas, opens its source action, and returns focus on close', () => {
    const onOpenVideo = vi.fn()
    render(<EvidenceFrame item={frame} clipLabel="clip 2 of 3" onOpenVideo={onOpenVideo} />)
    const trigger = screen.getByRole('button', { name: 'Enlarge evidence image' })
    expect(trigger).toContainElement(frame.canvas)
    fireEvent.click(frame.canvas)
    const dialog = screen.getByRole('dialog')
    expect(dialog.parentElement).toBe(document.body)
    expect(dialog).toContainElement(frame.canvas)
    expect(document.querySelectorAll('canvas')).toHaveLength(1)
    expect(screen.getByText('clip 2 of 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
    expect(trigger).toHaveFocus()
    expect(trigger).toContainElement(frame.canvas)
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: /Open source video at this frame/i }))
    expect(onOpenVideo).toHaveBeenCalledTimes(1)
  })

  it('offers no video action without a source callback', () => {
    render(<EvidenceFrame item={frame} clipLabel="clip 1 of 1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Enlarge evidence image' }))
    expect(screen.queryByRole('button', { name: /Open source video/ })).not.toBeInTheDocument()
  })
})

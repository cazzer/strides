import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StartOverControl } from './StartOverControl'

describe('StartOverControl', () => {
  it('asks before resetting, naming how many clips go', () => {
    const onConfirm = vi.fn()
    render(<StartOverControl onConfirm={onConfirm} clipCount={3} />)

    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('group', { name: 'Remove all 3 clips and start over?' })).toBeInTheDocument()
    // Focus lands on the safe choice.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  })

  it('says "this clip" for a one-clip session', () => {
    render(<StartOverControl onConfirm={() => {}} clipCount={1} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
    expect(screen.getByText('Remove this clip and start over?')).toBeInTheDocument()
  })

  it('resets on confirm', () => {
    const onConfirm = vi.fn()
    render(<StartOverControl onConfirm={onConfirm} clipCount={2} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove and start over' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['Cancel', (cancel: HTMLElement) => fireEvent.click(cancel)],
    ['Escape', (cancel: HTMLElement) => fireEvent.keyDown(cancel, { key: 'Escape' })],
  ])('%s keeps the session and returns focus to Start over', (_label, dismiss) => {
    const onConfirm = vi.fn()
    render(<StartOverControl onConfirm={onConfirm} clipCount={2} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))

    dismiss(screen.getByRole('button', { name: 'Cancel' }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Remove and start over' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Start over' }))
  })
})

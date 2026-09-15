import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ResultsViewToggle } from './ResultsViewToggle'

function buttons() {
  return {
    classic: screen.getByRole('button', { name: 'Classic' }),
    guided: screen.getByRole('button', { name: 'Guided' }),
  }
}

describe('ResultsViewToggle', () => {
  it('is one group whose accessible name identifies both views', () => {
    render(<ResultsViewToggle mode="classic" onChange={() => {}} />)
    const group = screen.getByRole('group')
    expect(group).toHaveAccessibleName(/classic/i)
    expect(group).toHaveAccessibleName(/guided/i)
    const { classic, guided } = buttons()
    expect(group).toContainElement(classic)
    expect(group).toContainElement(guided)
  })

  it('offers exactly two native, non-submitting buttons', () => {
    render(<ResultsViewToggle mode="classic" onChange={() => {}} />)
    const all = screen.getAllByRole('button')
    expect(all).toHaveLength(2)
    for (const button of all) {
      expect(button.tagName).toBe('BUTTON')
      expect(button).toHaveAttribute('type', 'button')
      expect(button).not.toHaveAttribute('tabindex')
    }
  })

  it('marks classic pressed in classic mode', () => {
    render(<ResultsViewToggle mode="classic" onChange={() => {}} />)
    const { classic, guided } = buttons()
    expect(classic).toHaveAttribute('aria-pressed', 'true')
    expect(guided).toHaveAttribute('aria-pressed', 'false')
  })

  it('marks guided pressed in guide mode', () => {
    render(<ResultsViewToggle mode="guide" onChange={() => {}} />)
    const { classic, guided } = buttons()
    expect(classic).toHaveAttribute('aria-pressed', 'false')
    expect(guided).toHaveAttribute('aria-pressed', 'true')
  })

  it('reports the other mode when the unpressed option is activated', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ResultsViewToggle mode="classic" onChange={onChange} />)
    fireEvent.click(buttons().guided)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith('guide')

    rerender(<ResultsViewToggle mode="guide" onChange={onChange} />)
    fireEvent.click(buttons().classic)
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenLastCalledWith('classic')
  })

  it('does not report a change when the already-pressed option is activated again', () => {
    const onChange = vi.fn()
    render(<ResultsViewToggle mode="guide" onChange={onChange} />)
    fireEvent.click(buttons().guided)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps the same button nodes, and focus on the activated one, across a mode change', () => {
    const { rerender } = render(<ResultsViewToggle mode="classic" onChange={() => {}} />)
    const before = buttons()
    before.guided.focus()
    fireEvent.click(before.guided)
    rerender(<ResultsViewToggle mode="guide" onChange={() => {}} />)

    const after = buttons()
    expect(after.guided).toBe(before.guided)
    expect(after.classic).toBe(before.classic)
    expect(document.activeElement).toBe(before.guided)
    expect(before.guided).toHaveAttribute('aria-pressed', 'true')
  })

  it('carries a visible focus style on both options', () => {
    render(<ResultsViewToggle mode="classic" onChange={() => {}} />)
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('focus-visible:outline-2')
      expect(button.className).toContain('focus-visible:outline-brand-600')
    }
  })
})

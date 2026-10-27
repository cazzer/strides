import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ModelRunner } from '../../runner/ModelRunner'
import { bindRunnerParams } from '../../runner/runnerParams'
import { makeHeuristics } from '../__fixtures__/metricResult'

/**
 * The phone tour styles the REAL runner's parts from outside (`RUNNER_CLASS` in `RunnerTour.tsx`)
 * through its `data-runner-part` hooks, so `src/runner` carries no phone code. This pins the hooks
 * and what the phone rules assume of them: one of each; the drawing (the figure's only SVG) inside
 * the stage; every control the runner has inside the control row, so none is left under a panel;
 * and the control row's note as its direct `p` child, which the phone layout moves below the row.
 */
function part(figure: Element, name: string): Element {
  const found = figure.querySelectorAll(`[data-runner-part="${name}"]`)
  expect(found, name).toHaveLength(1)
  return found[0]
}

describe('the runner hooks the phone tour styles', () => {
  it('marks the caption, the stage, the drawing and the control row', () => {
    const { container } = render(
      <ModelRunner
        params={bindRunnerParams(makeHeuristics())}
        camera="wholeBodySide"
        label="Model runner, whole body"
        intro={{ running: true, onSkip: () => {} }}
      />,
    )
    const figure = container.querySelector('figure')!
    expect(part(figure, 'caption').tagName).toBe('FIGCAPTION')

    const stage = part(figure, 'stage')
    const drawing = part(figure, 'drawing')
    expect(drawing.tagName).toBe('svg')
    expect(drawing.parentElement).toBe(stage)
    expect(figure.querySelectorAll('svg')).toHaveLength(1)
    expect(drawing.querySelectorAll('[data-ground]')).toHaveLength(1)

    const controls = part(figure, 'controls')
    expect(controls.contains(screen.getByRole('button', { name: 'Skip intro' }))).toBe(true)
    expect(controls.contains(screen.getByRole('button', { name: 'Pause runner' }))).toBe(true)
    expect([...figure.querySelectorAll('button')].every((button) => controls.contains(button))).toBe(true)
    expect(controls.querySelectorAll(':scope > p')).toHaveLength(1)
  })
})

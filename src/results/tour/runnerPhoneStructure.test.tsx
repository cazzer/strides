import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ModelRunner } from '../../runner/ModelRunner'
import { bindRunnerParams } from '../../runner/runnerParams'
import { makeHeuristics } from '../__fixtures__/metricResult'

/**
 * The phone tour styles the REAL runner's parts from outside (`RUNNER_CLASS` in `RunnerTour.tsx`),
 * through structural selectors on the figure's children, so `src/runner` needs no phone code:
 * `figure > figcaption`, `figure > div:has(> svg)` (the stage), `figure svg` (the drawing, which
 * must be the figure's only SVG) and `figure > div:last-child` (the control row, which must hold
 * Skip intro and Play/Pause). This pins that structure: a runner refactor that moves any of these
 * fails here, not silently on a phone, where the controls would fall under the panels.
 */
describe('the runner structure the phone tour styles', () => {
  it('is a figure of caption, stage (holding the one drawing), and the control row last', () => {
    const { container } = render(
      <ModelRunner
        params={bindRunnerParams(makeHeuristics())}
        camera="wholeBodySide"
        label="Model runner, whole body"
        intro={{ running: true, onSkip: () => {} }}
      />,
    )
    const figure = container.querySelector('figure')!
    const children = [...figure.children]
    expect(children[0].tagName).toBe('FIGCAPTION')
    expect(figure.querySelectorAll('figcaption')).toHaveLength(1)

    const stages = children.filter(
      (child) => child.tagName === 'DIV' && [...child.children].some((grand) => grand.tagName === 'svg'),
    )
    expect(stages).toHaveLength(1)
    expect(figure.querySelectorAll('svg')).toHaveLength(1)

    const controls = figure.lastElementChild!
    expect(controls.tagName).toBe('DIV')
    expect(controls).not.toBe(stages[0])
    const skip = screen.getByRole('button', { name: 'Skip intro' })
    const pause = screen.getByRole('button', { name: 'Pause runner' })
    expect(controls.contains(skip)).toBe(true)
    expect(controls.contains(pause)).toBe(true)
    // Every control the runner has is in that row, so none is left under a phone panel.
    expect([...figure.querySelectorAll('button')].every((button) => controls.contains(button))).toBe(true)
  })
})

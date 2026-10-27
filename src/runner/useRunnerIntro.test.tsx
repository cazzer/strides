import { Profiler, StrictMode, type ReactNode } from 'react'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindOnly } from './__fixtures__/boundParams'
import { ModelRunner, type RunnerOverrides } from './ModelRunner'
import { formatRunnerValue } from './runnerAnnotations'
import { NEUTRAL_RUNNER_PARAMS, runnerParamValues } from './runnerParams'
import { RUNNER_PARAM_IDS, mixValues } from './runnerScene'
import {
  INTRO_FLASH_MS,
  INTRO_MAX_STEP_MS,
  INTRO_MIN_STEP_MS,
  INTRO_TOTAL_MS,
  introOrder,
  introStepMs,
  useRunnerIntro,
  type RunnerIntroKey,
  type UseRunnerIntroOptions,
} from './useRunnerIntro'
import type { BoundRunnerParams, MetricId, RunnerParamId, RunnerParams } from './types'

// cadence, trunkLean, kneeFlexion, overstriding measured; everything else neutral.
const BOUND = bindOnly(['cadence', 'trunkLean', 'kneeFlexion', 'overstriding'])
const MEASURED: RunnerParamId[] = ['cadence', 'torsoPitch', 'peakSwingKneeBend', 'landingOffset']
const NEUTRAL = RUNNER_PARAM_IDS.filter((id) => !MEASURED.includes(id))
const ORDER: MetricId[] = ['kneeFlexion', 'overstriding']
const EXPECTED_ORDER: RunnerParamId[] = ['peakSwingKneeBend', 'landingOffset', 'cadence', 'torsoPitch']
const STEP_MS = introStepMs(MEASURED.length)
const BOUND_VALUES = runnerParamValues(BOUND)

/** A matchMedia mock whose `change` listeners can be fired. */
function mockReducedMotion(initial: boolean) {
  const state = { matches: initial }
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', (media: string) => ({
    get matches() {
      return state.matches
    },
    media,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }))
  return {
    set(matches: boolean) {
      state.matches = matches
      act(() => listeners.forEach((listener) => listener()))
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

/** What ModelRunner draws for these overrides at tween progress `t` (its own composition). */
function drawn(bound: BoundRunnerParams, overrides: RunnerOverrides | undefined, t: number): RunnerParams {
  const base = { ...runnerParamValues(bound), ...overrides?.values } as RunnerParams
  const tween = overrides?.valueTween
  return tween ? mixValues(base, tween.from, tween.to, t) : base
}

function renderIntro(options: Partial<UseRunnerIntroOptions> & { resultKey: RunnerIntroKey }) {
  return renderHook(
    (props: Partial<UseRunnerIntroOptions> & { resultKey: RunnerIntroKey }) =>
      useRunnerIntro({ bound: BOUND, order: ORDER, ...props }),
    { initialProps: options },
  )
}

describe('introOrder and introStepMs', () => {
  it('puts the named focus first, then the other measured parameters in spec order', () => {
    expect(introOrder(BOUND, ORDER)).toEqual(EXPECTED_ORDER)
    // Parameter ids work too; unmeasured, unknown-to-the-model and repeated ids are skipped.
    expect(introOrder(BOUND, ['landingOffset', 'kneeDrive', 'verticalRatio', 'overstriding'])).toEqual([
      'landingOffset',
      'cadence',
      'torsoPitch',
      'peakSwingKneeBend',
    ])
    expect(introOrder(BOUND)).toEqual(MEASURED)
  })

  it('shares about four seconds between the steps, within sane bounds', () => {
    expect(introStepMs(4)).toBe(INTRO_TOTAL_MS / 4)
    expect(introStepMs(1)).toBe(INTRO_MAX_STEP_MS)
    expect(introStepMs(100)).toBe(INTRO_MIN_STEP_MS)
    expect(introStepMs(0)).toBe(0)
  })
})

describe('useRunnerIntro sequence', () => {
  it('applies measured parameters in order, ends exactly at the bound values, never moves a neutral', () => {
    const onDone = vi.fn()
    const { result } = renderIntro({ resultKey: {}, onDone })

    // Before the first step: fully neutral, measured parameters at their neutral constants.
    const start = result.current.overrides
    expect(result.current.running).toBe(true)
    expect(start?.valueTween ?? null).toBeNull()
    for (const id of RUNNER_PARAM_IDS) expect(start?.sources?.[id]).toBe('neutral')
    for (const id of MEASURED) expect(drawn(BOUND, start, 0)[id]).toBe(NEUTRAL_RUNNER_PARAMS[id])
    for (const id of NEUTRAL) expect(drawn(BOUND, start, 0)[id]).toBe(BOUND_VALUES[id])

    let previousEnd = drawn(BOUND, start, 1)
    EXPECTED_ORDER.forEach((id, i) => {
      advance(i === 0 ? 0 : STEP_MS - INTRO_FLASH_MS)
      const step = result.current.overrides
      const tween = step?.valueTween
      expect(tween?.key).toBe(`${i}`)
      expect(tween?.durationMs).toBe(STEP_MS)
      expect(tween?.to).toEqual({ [id]: BOUND_VALUES[id] })
      expect(tween?.from[id]).toBe(NEUTRAL_RUNNER_PARAMS[id])
      for (const applied of EXPECTED_ORDER.slice(0, i)) expect(tween?.from[applied]).toBe(BOUND_VALUES[applied])
      // The source flips as the tween starts; later ones are still neutral.
      EXPECTED_ORDER.forEach((other, j) =>
        expect(step?.sources?.[other]).toBe(j <= i ? 'measured' : 'neutral'),
      )
      const param = BOUND[id]
      if (param.source !== 'measured') throw new Error('fixture')
      expect(step?.flash).toEqual({ paramId: id, text: formatRunnerValue(param.metricId, param.metricValue) })

      // Continuous across the step boundary; the stepping parameter lands exactly on its value.
      expect(drawn(BOUND, step, 0)).toEqual(previousEnd)
      const end = drawn(BOUND, step, 1)
      EXPECTED_ORDER.forEach((other, j) =>
        expect(end[other]).toBe(j <= i ? BOUND_VALUES[other] : NEUTRAL_RUNNER_PARAMS[other]),
      )
      for (const neutral of NEUTRAL) {
        expect(drawn(BOUND, step, 0)[neutral]).toBe(BOUND_VALUES[neutral])
        expect(end[neutral]).toBe(BOUND_VALUES[neutral])
        expect(step?.sources?.[neutral]).toBe('neutral')
      }
      previousEnd = end

      // The flash clears after about half a second; the tween is untouched.
      advance(INTRO_FLASH_MS)
      expect(result.current.overrides?.flash ?? null).toBeNull()
      expect(result.current.overrides?.valueTween).toBe(tween)
      expect(onDone).not.toHaveBeenCalled()
    })

    expect(previousEnd).toEqual(BOUND_VALUES)
    advance(STEP_MS - INTRO_FLASH_MS)
    expect(result.current.overrides).toBeUndefined()
    expect(result.current.running).toBe(false)
    expect(onDone).toHaveBeenCalledTimes(1)
    advance(10_000)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('finishes at once when nothing is measured', () => {
    const onDone = vi.fn()
    const bound = bindOnly([])
    const resultKey = {}
    const { result } = renderHook(() => useRunnerIntro({ bound, resultKey, onDone }))
    advance(0)
    expect(result.current.overrides).toBeUndefined()
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})

describe('useRunnerIntro skip and reduced motion', () => {
  it('skip jumps to the final state and fires onDone once', () => {
    const onDone = vi.fn()
    const { result } = renderIntro({ resultKey: {}, onDone })
    advance(STEP_MS + 10)
    expect(result.current.overrides?.valueTween?.key).toBe('1')
    act(() => result.current.skip())
    expect(result.current.overrides).toBeUndefined()
    expect(result.current.running).toBe(false)
    expect(onDone).toHaveBeenCalledTimes(1)
    act(() => result.current.skip())
    advance(10_000)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never starts under reduced motion: final state at once, onDone once', () => {
    mockReducedMotion(true)
    const onDone = vi.fn()
    const { result } = renderIntro({ resultKey: {}, onDone })
    expect(result.current.overrides).toBeUndefined()
    expect(result.current.running).toBe(false)
    advance(0)
    expect(onDone).toHaveBeenCalledTimes(1)
    advance(10_000)
    expect(result.current.overrides).toBeUndefined()
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('reduced motion switched on mid-intro jumps to the end; switched off, it does not replay', () => {
    const media = mockReducedMotion(false)
    const onDone = vi.fn()
    const { result } = renderIntro({ resultKey: {}, onDone })
    advance(STEP_MS + 10)
    media.set(true)
    expect(result.current.overrides).toBeUndefined()
    advance(0)
    expect(onDone).toHaveBeenCalledTimes(1)
    media.set(false)
    advance(10_000)
    expect(result.current.overrides).toBeUndefined()
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})

describe('useRunnerIntro plays once per result', () => {
  it('a remount with the same result draws the final state and does not fire onDone again', () => {
    const key = {}
    const first = vi.fn()
    const view = renderIntro({ resultKey: key, onDone: first })
    advance(INTRO_TOTAL_MS + 100)
    expect(first).toHaveBeenCalledTimes(1)
    view.unmount()

    const second = vi.fn()
    const again = renderIntro({ resultKey: key, onDone: second })
    expect(again.result.current.overrides).toBeUndefined()
    expect(again.result.current.running).toBe(false)
    advance(10_000)
    expect(second).not.toHaveBeenCalled()
  })

  it('a remount after an unmount mid-intro does not replay either', () => {
    const key = 'result-mid-intro'
    const view = renderIntro({ resultKey: key })
    advance(STEP_MS)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
    const again = renderIntro({ resultKey: key })
    expect(again.result.current.overrides).toBeUndefined()
  })

  it('a new result plays, on a remount or on the same mount', () => {
    const first = renderIntro({ resultKey: 'result-a' })
    advance(INTRO_TOTAL_MS + 100)
    first.unmount()

    const onDone = vi.fn()
    const view = renderIntro({ resultKey: 'result-b', onDone })
    expect(view.result.current.running).toBe(true)
    advance(0)
    expect(view.result.current.overrides?.valueTween?.key).toBe('0')
    advance(INTRO_TOTAL_MS + 100)
    expect(onDone).toHaveBeenCalledTimes(1)

    view.rerender({ resultKey: 'result-c', onDone })
    expect(view.result.current.running).toBe(true)
    expect(view.result.current.overrides?.sources?.cadence).toBe('neutral')
    advance(0)
    expect(view.result.current.overrides?.valueTween?.key).toBe('0')
    advance(INTRO_TOTAL_MS + 100)
    expect(onDone).toHaveBeenCalledTimes(2)
  })

  it('a new result mid-intro restarts from neutral and drops the old timers', () => {
    const onDone = vi.fn()
    const view = renderIntro({ resultKey: {}, onDone })
    advance(2 * STEP_MS + 10)
    expect(view.result.current.overrides?.valueTween?.key).toBe('2')
    view.rerender({ resultKey: {}, onDone })
    expect(view.result.current.overrides?.valueTween ?? null).toBeNull()
    advance(0)
    expect(view.result.current.overrides?.valueTween?.key).toBe('0')
    advance(INTRO_TOTAL_MS + 100)
    // Only the second result finished; the first was abandoned mid-way.
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('still plays under StrictMode, and fires onDone once', () => {
    const onDone = vi.fn()
    const { result } = renderHook(
      () => useRunnerIntro({ bound: BOUND, resultKey: 'result-strict', order: ORDER, onDone }),
      { wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> },
    )
    expect(result.current.running).toBe(true)
    advance(0)
    expect(result.current.overrides?.valueTween?.key).toBe('0')
    expect(result.current.overrides?.sources?.peakSwingKneeBend).toBe('measured')
    advance(INTRO_TOTAL_MS + 100)
    expect(result.current.overrides).toBeUndefined()
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('under StrictMode with reduced motion, fires onDone once', () => {
    mockReducedMotion(true)
    const onDone = vi.fn()
    const resultKey = {}
    renderHook(() => useRunnerIntro({ bound: BOUND, resultKey, onDone }), {
      wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
    })
    advance(100)
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})

function Harness({ resultKey, onDone }: { resultKey: RunnerIntroKey; onDone?: () => void }) {
  const intro = useRunnerIntro({ bound: BOUND, resultKey, order: ORDER, onDone })
  return (
    <ModelRunner
      params={BOUND}
      camera="wholeBodySide"
      label="Runner"
      overrides={intro.overrides}
      intro={{ running: intro.running, onSkip: intro.skip }}
    />
  )
}

function kneeX(): number {
  return Number(document.querySelector('[data-joint="right_knee"]')?.getAttribute('cx'))
}

describe('useRunnerIntro with ModelRunner', () => {
  it('commits once per discrete change, not once per frame', () => {
    const onRender = vi.fn()
    render(
      <Profiler id="intro" onRender={onRender}>
        <Harness resultKey={{}} />
      </Profiler>,
    )
    const mountCommits = onRender.mock.calls.length
    let moves = 0
    let previous = kneeX()
    for (let t = 0; t < INTRO_TOTAL_MS + 200; t += 16) {
      advance(16)
      const now = kneeX()
      if (now !== previous) moves += 1
      previous = now
    }
    // About 30 frames a second drawn for 4 s, against a step, a flash clear and an end per step.
    expect(moves).toBeGreaterThan(100)
    const introCommits = onRender.mock.calls.length - mountCommits
    expect(introCommits).toBeLessThanOrEqual(2 * MEASURED.length + 2)
    expect(document.querySelector('[data-flash]')).toBeNull()
  })

  it('dashes every segment before the first step and draws the measured ones solid after', () => {
    render(<Harness resultKey={{}} />)
    const solid = () =>
      Array.from(document.querySelectorAll('[data-edge]')).filter((el) => !el.hasAttribute('stroke-dasharray'))
    expect(solid()).toHaveLength(0)
    advance(0)
    expect(solid().length).toBeGreaterThan(0)
    const knee = BOUND.peakSwingKneeBend
    if (knee.source !== 'measured') throw new Error('fixture')
    expect(document.querySelector('[data-flash]')?.textContent).toBe(
      formatRunnerValue(knee.metricId, knee.metricValue),
    )
    advance(INTRO_TOTAL_MS + 100)
    expect(solid().length).toBeGreaterThan(0)
  })

  it('shows Skip while running; skipping moves focus to Play/Pause', () => {
    const onDone = vi.fn()
    render(<Harness resultKey={{}} onDone={onDone} />)
    advance(STEP_MS)
    const skip = screen.getByRole('button', { name: 'Skip intro' })
    expect(skip.textContent).toBe('Skip')
    expect(skip.className).toContain('min-h-11')
    act(() => skip.focus())
    fireEvent.click(skip)
    expect(screen.queryByRole('button', { name: 'Skip intro' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Pause runner' }))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('removes Skip when the intro ends, handing focus on if it held it', () => {
    render(<Harness resultKey={{}} />)
    const skip = screen.getByRole('button', { name: 'Skip intro' })
    act(() => skip.focus())
    advance(INTRO_TOTAL_MS + 100)
    expect(screen.queryByRole('button', { name: 'Skip intro' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Pause runner' }))
  })

  it('leaves focus alone when Skip goes away unfocused', () => {
    render(<Harness resultKey={{}} />)
    advance(INTRO_TOTAL_MS + 100)
    expect(screen.queryByRole('button', { name: 'Skip intro' })).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('never shows Skip under reduced motion', () => {
    mockReducedMotion(true)
    render(<Harness resultKey={{}} />)
    expect(screen.queryByRole('button', { name: 'Skip intro' })).toBeNull()
    advance(100)
    expect(screen.queryByRole('button', { name: 'Skip intro' })).toBeNull()
  })
})

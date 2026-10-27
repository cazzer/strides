import { Profiler, StrictMode, useState, type ReactNode } from 'react'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeMetric } from '../results/__fixtures__/metricResult'
import { bindAll, bindOnly } from './__fixtures__/boundParams'
import { ModelRunner, type RunnerFocus, type RunnerOverrides } from './ModelRunner'
import { formatRunnerValue } from './runnerAnnotations'
import { NEUTRAL_RUNNER_PARAMS, runnerParamValues } from './runnerParams'
import { RUNNER_PARAM_IDS, mixValues } from './runnerScene'
import {
  INTRO_FLASH_MIN_REMAINDER_MS,
  INTRO_FLASH_MS,
  INTRO_HOLD_MS,
  INTRO_MAX_STEP_MS,
  INTRO_MIN_STEP_MS,
  INTRO_TOTAL_MS,
  __resetIntroRegistryForTests,
  introOrder,
  introStepMs,
  planIntro,
  useRunnerIntro,
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
/** Long enough for any run here to finish. */
const WHOLE_RUN_MS = INTRO_HOLD_MS + INTRO_TOTAL_MS + 2 * INTRO_MAX_STEP_MS

let keys = 0
function nextKey(): string {
  keys += 1
  return `result-${keys}`
}

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

let visibility: DocumentVisibilityState = 'visible'
function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  __resetIntroRegistryForTests()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
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

type IntroProps = Partial<UseRunnerIntroOptions> & { resultKey: string }

function renderIntro(initialProps: IntroProps, wrapper?: (props: { children: ReactNode }) => ReactNode) {
  return renderHook(
    (props: IntroProps) =>
      useRunnerIntro({ bound: BOUND, order: ORDER, camera: 'wholeBodySide', active: true, ...props }),
    { initialProps, wrapper },
  )
}

function strict({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>
}

describe('introOrder, introStepMs and planIntro', () => {
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

  it('always applies landing before foot strike', () => {
    const bound = bindOnly(['overstriding', 'footStrikePattern', 'trunkLean'])
    expect(introOrder(bound, ['footStrikePattern', 'trunkLean', 'overstriding'])).toEqual([
      'landingOffset',
      'contactShankOffset',
      'torsoPitch',
    ])
    expect(introOrder(bound)).toEqual(['torsoPitch', 'landingOffset', 'contactShankOffset'])
  })

  it('shares about four and a half seconds between the steps, within the step bounds', () => {
    expect(introStepMs(4)).toBe(INTRO_MAX_STEP_MS)
    expect(introStepMs(6)).toBe(INTRO_TOTAL_MS / 6)
    expect(introStepMs(10)).toBe(INTRO_MIN_STEP_MS)
    expect(10 * introStepMs(10)).toBeLessThanOrEqual(INTRO_TOTAL_MS)
    expect(INTRO_MIN_STEP_MS).toBeGreaterThanOrEqual(450)
    expect(introStepMs(0)).toBe(0)
  })

  it('gives lateral parameters no step from a side view, and one from the front', () => {
    const bound = bindOnly(['trunkLean', 'stepWidth', 'swingFootLateralExcursion'])
    const side = planIntro(bound, ['stepWidth'], 0)
    expect(side.steps).toEqual(['torsoPitch'])
    expect(side.deferred).toEqual(['stepWidth', 'swingFootArc'])
    expect(side.stepMs).toBe(INTRO_MAX_STEP_MS)
    const front = planIntro(bound, ['stepWidth'], 90)
    expect(front.steps).toEqual(['stepWidth', 'torsoPitch', 'swingFootArc'])
    expect(front.deferred).toEqual([])
  })
})

describe('useRunnerIntro sequence', () => {
  it('holds neutral, applies measured parameters in order, ends exactly at the bound values, never moves a neutral', () => {
    const onDone = vi.fn()
    const { result } = renderIntro({ resultKey: nextKey(), onDone })

    // The neutral hold: fully dashed, measured parameters at their neutral constants.
    const start = result.current.overrides
    expect(result.current.running).toBe(true)
    expect(start?.valueTween ?? null).toBeNull()
    for (const id of RUNNER_PARAM_IDS) expect(start?.sources?.[id]).toBe('neutral')
    for (const id of MEASURED) expect(drawn(BOUND, start, 0)[id]).toBe(NEUTRAL_RUNNER_PARAMS[id])
    for (const id of NEUTRAL) expect(drawn(BOUND, start, 0)[id]).toBe(BOUND_VALUES[id])
    advance(INTRO_HOLD_MS - 1)
    expect(result.current.overrides).toBe(start)

    let previousEnd = drawn(BOUND, start, 1)
    EXPECTED_ORDER.forEach((id, i) => {
      advance(i === 0 ? 1 : STEP_MS - INTRO_FLASH_MS)
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

  it('holds a side-view lateral parameter neutral with no step, and applies it with the final state', () => {
    const bound = bindOnly(['trunkLean', 'stepWidth'])
    const { result } = renderIntro({ resultKey: nextKey(), bound, order: ['stepWidth'] })
    advance(INTRO_HOLD_MS)
    const step = result.current.overrides
    expect(step?.valueTween?.to).toEqual({ torsoPitch: bound.torsoPitch.value })
    expect(step?.sources?.stepWidth).toBe('neutral')
    expect(drawn(bound, step, 1).stepWidth).toBe(NEUTRAL_RUNNER_PARAMS.stepWidth)
    advance(INTRO_MAX_STEP_MS)
    expect(result.current.overrides).toBeUndefined()
  })

  it('finishes at once, with no hold, when there is nothing to apply', () => {
    for (const bound of [bindOnly([]), bindOnly(['stepWidth'])]) {
      const onDone = vi.fn()
      const { result } = renderIntro({ resultKey: nextKey(), bound, onDone })
      expect(result.current.overrides).toBeUndefined()
      expect(result.current.running).toBe(false)
      advance(0)
      expect(onDone).toHaveBeenCalledTimes(1)
      advance(10_000)
      expect(onDone).toHaveBeenCalledTimes(1)
    }
  })

  it('keeps a flash up for its whole step when it would clear with under 150 ms left', () => {
    const bound = bindAll()
    const plan = planIntro(bound, [], 0)
    expect(plan.stepMs - INTRO_FLASH_MS).toBeLessThan(INTRO_FLASH_MIN_REMAINDER_MS)
    const { result } = renderIntro({ resultKey: nextKey(), bound, order: [] })
    advance(INTRO_HOLD_MS)
    const first = result.current.overrides?.flash
    expect(first?.paramId).toBe(plan.steps[0])
    advance(plan.stepMs - 1)
    expect(result.current.overrides?.flash).toEqual(first)
    advance(1)
    expect(result.current.overrides?.flash?.paramId).toBe(plan.steps[1])
  })

  it('keeps the plan it started with when `bound` changes mid-intro, and ends on the live bound', () => {
    const { result, rerender } = renderIntro({ resultKey: 'graft' })
    advance(INTRO_HOLD_MS + STEP_MS + 10)
    const before = result.current.overrides?.valueTween
    expect(before?.key).toBe('1')
    // The scale pass lands: a new measured parameter, and a changed value for one already planned.
    const grafted = bindOnly(['cadence', 'trunkLean', 'kneeFlexion', 'overstriding', 'armSwingAmplitude'], {
      trunkLean: makeMetric('trunkLean', { value: 9 }),
    })
    rerender({ resultKey: 'graft', bound: grafted })
    expect(result.current.overrides?.valueTween).toBe(before)
    expect(result.current.overrides?.sources?.armSwing).toBe('neutral')
    // Everything is drawn at the snapshot until the end, the newly measured arms included.
    expect(grafted.armSwing.value).not.toBe(BOUND_VALUES.armSwing)
    const drawnArms = () => [0, 1].map((t) => drawn(grafted, result.current.overrides, t).armSwing)
    expect(drawnArms()).toEqual([BOUND_VALUES.armSwing, BOUND_VALUES.armSwing])
    advance(STEP_MS)
    expect(result.current.overrides?.valueTween?.key).toBe('2')
    expect(result.current.overrides?.valueTween?.to).toEqual({ cadence: BOUND_VALUES.cadence })
    expect(drawnArms()).toEqual([BOUND_VALUES.armSwing, BOUND_VALUES.armSwing])
    advance(STEP_MS)
    expect(result.current.overrides?.valueTween?.to).toEqual({ torsoPitch: BOUND_VALUES.torsoPitch })
    expect(drawnArms()).toEqual([BOUND_VALUES.armSwing, BOUND_VALUES.armSwing])
    advance(STEP_MS)
    expect(result.current.overrides).toBeUndefined()
  })
})

describe('useRunnerIntro skip and reduced motion', () => {
  it('skip jumps to the final state and fires onDone once', () => {
    const onDone = vi.fn()
    const { result } = renderIntro({ resultKey: nextKey(), onDone })
    advance(INTRO_HOLD_MS + STEP_MS + 10)
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
    const { result } = renderIntro({ resultKey: nextKey(), onDone })
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
    const { result } = renderIntro({ resultKey: nextKey(), onDone })
    advance(INTRO_HOLD_MS + STEP_MS + 10)
    media.set(true)
    expect(result.current.overrides).toBeUndefined()
    advance(0)
    expect(onDone).toHaveBeenCalledTimes(1)
    media.set(false)
    advance(10_000)
    expect(result.current.overrides).toBeUndefined()
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('a reduced-motion flip off, on and off again resumes the current step where it was', () => {
    const media = mockReducedMotion(false)
    const { result } = renderIntro({ resultKey: nextKey() })
    advance(INTRO_HOLD_MS + STEP_MS + 300)
    expect(result.current.overrides?.valueTween?.key).toBe('1')
    media.set(true)
    media.set(false)
    expect(result.current.overrides?.valueTween?.key).toBe('1')
    // Step 2 is due one step after step 1 actually began, not one step after the flip.
    advance(STEP_MS - 300 - 1)
    expect(result.current.overrides?.valueTween?.key).toBe('1')
    advance(1)
    expect(result.current.overrides?.valueTween?.key).toBe('2')
  })
})

describe('useRunnerIntro plays once per result, once seen', () => {
  it('a remount with the same result draws the final state and does not fire onDone again', () => {
    const key = nextKey()
    const first = vi.fn()
    const view = renderIntro({ resultKey: key, onDone: first })
    advance(WHOLE_RUN_MS)
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
    const key = nextKey()
    const view = renderIntro({ resultKey: key })
    advance(INTRO_HOLD_MS + STEP_MS)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(renderIntro({ resultKey: key }).result.current.overrides).toBeUndefined()
  })

  it('never seen: holds neutral, is not marked played, and a later mount plays', () => {
    const key = nextKey()
    const view = renderIntro({ resultKey: key, active: false })
    advance(10_000)
    expect(view.result.current.running).toBe(true)
    expect(view.result.current.overrides?.valueTween ?? null).toBeNull()
    view.unmount()

    const again = renderIntro({ resultKey: key })
    advance(INTRO_HOLD_MS)
    expect(again.result.current.overrides?.valueTween?.key).toBe('0')
  })

  it('starts the hold when it becomes seen; leaving during the hold restarts it', () => {
    const key = nextKey()
    const view = renderIntro({ resultKey: key, active: false })
    advance(1000)
    view.rerender({ resultKey: key, active: true })
    advance(INTRO_HOLD_MS - 100)
    view.rerender({ resultKey: key, active: false })
    advance(1000)
    expect(view.result.current.overrides?.valueTween ?? null).toBeNull()
    view.rerender({ resultKey: key, active: true })
    advance(INTRO_HOLD_MS - 1)
    expect(view.result.current.overrides?.valueTween ?? null).toBeNull()
    advance(1)
    expect(view.result.current.overrides?.valueTween?.key).toBe('0')
    // Once started, it carries on while unseen.
    view.rerender({ resultKey: key, active: false })
    advance(STEP_MS)
    expect(view.result.current.overrides?.valueTween?.key).toBe('1')
  })

  it('a new result plays, on a remount or on the same mount', () => {
    const first = renderIntro({ resultKey: 'result-a' })
    advance(WHOLE_RUN_MS)
    first.unmount()

    const onDone = vi.fn()
    const view = renderIntro({ resultKey: 'result-b', onDone })
    expect(view.result.current.running).toBe(true)
    advance(INTRO_HOLD_MS)
    expect(view.result.current.overrides?.valueTween?.key).toBe('0')
    advance(WHOLE_RUN_MS)
    expect(onDone).toHaveBeenCalledTimes(1)

    view.rerender({ resultKey: 'result-c', onDone })
    expect(view.result.current.running).toBe(true)
    expect(view.result.current.overrides?.sources?.cadence).toBe('neutral')
    advance(INTRO_HOLD_MS)
    expect(view.result.current.overrides?.valueTween?.key).toBe('0')
    advance(WHOLE_RUN_MS)
    expect(onDone).toHaveBeenCalledTimes(2)
  })

  it('a new result mid-intro restarts from neutral and drops the old timers', () => {
    const onDone = vi.fn()
    const view = renderIntro({ resultKey: nextKey(), onDone })
    advance(INTRO_HOLD_MS + 2 * STEP_MS + 10)
    expect(view.result.current.overrides?.valueTween?.key).toBe('2')
    view.rerender({ resultKey: nextKey(), onDone })
    expect(view.result.current.overrides?.valueTween ?? null).toBeNull()
    advance(INTRO_HOLD_MS)
    expect(view.result.current.overrides?.valueTween?.key).toBe('0')
    advance(WHOLE_RUN_MS)
    // Only the second result finished; the first was abandoned mid-way.
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('still plays under StrictMode, and fires onDone once', () => {
    const onDone = vi.fn()
    const { result } = renderIntro({ resultKey: nextKey(), onDone }, strict)
    expect(result.current.running).toBe(true)
    advance(INTRO_HOLD_MS)
    expect(result.current.overrides?.valueTween?.key).toBe('0')
    expect(result.current.overrides?.sources?.peakSwingKneeBend).toBe('measured')
    advance(WHOLE_RUN_MS)
    expect(result.current.overrides).toBeUndefined()
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('under StrictMode with reduced motion, fires onDone once', () => {
    mockReducedMotion(true)
    const onDone = vi.fn()
    renderIntro({ resultKey: nextKey(), onDone }, strict)
    advance(100)
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})

function Harness({
  resultKey,
  onDone,
  focus,
}: {
  resultKey: string
  onDone?: () => void
  focus?: RunnerFocus
}) {
  const [active, setActive] = useState(false)
  const intro = useRunnerIntro({
    bound: BOUND,
    resultKey,
    order: ORDER,
    camera: 'wholeBodySide',
    active,
    onDone,
  })
  return (
    <ModelRunner
      params={BOUND}
      camera="wholeBodySide"
      focus={focus}
      label="Runner"
      overrides={intro.overrides}
      intro={{ running: intro.running, onSkip: intro.skip }}
      onActiveChange={setActive}
    />
  )
}

function kneeX(): number {
  return Number(document.querySelector('[data-joint="right_knee"]')?.getAttribute('cx'))
}

function legend(): string {
  return document.querySelector('figure p[aria-hidden="true"]')?.textContent ?? ''
}

describe('useRunnerIntro with ModelRunner', () => {
  it('commits once per discrete change, not once per frame', () => {
    const onRender = vi.fn()
    render(
      <Profiler id="intro" onRender={onRender}>
        <Harness resultKey={nextKey()} />
      </Profiler>,
    )
    const mountCommits = onRender.mock.calls.length
    let moves = 0
    let previous = kneeX()
    for (let t = 0; t < WHOLE_RUN_MS; t += 16) {
      advance(16)
      const now = kneeX()
      if (now !== previous) moves += 1
      previous = now
    }
    expect(moves).toBeGreaterThan(100)
    const introCommits = onRender.mock.calls.length - mountCommits
    // A step and a flash clearing per step, and the end.
    expect(introCommits).toBeLessThanOrEqual(2 * MEASURED.length + 1)
    expect(document.querySelector('[data-flash]')).toBeNull()
  })

  it('reports whether it is seen, and false on unmount', () => {
    const onActiveChange = vi.fn()
    const { unmount } = render(
      <ModelRunner params={BOUND} camera="wholeBodySide" label="Runner" onActiveChange={onActiveChange} />,
    )
    expect(onActiveChange).toHaveBeenLastCalledWith(true)
    setVisibility('hidden')
    expect(onActiveChange).toHaveBeenLastCalledWith(false)
    setVisibility('visible')
    expect(onActiveChange).toHaveBeenLastCalledWith(true)
    const calls = onActiveChange.mock.calls.length
    unmount()
    expect(onActiveChange).toHaveBeenCalledTimes(calls + 1)
    expect(onActiveChange).toHaveBeenLastCalledWith(false)
  })

  it('does not start while the tab is hidden', () => {
    visibility = 'hidden'
    render(<Harness resultKey={nextKey()} />)
    advance(5000)
    expect(document.querySelector('[data-flash]')).toBeNull()
    setVisibility('visible')
    advance(INTRO_HOLD_MS)
    expect(document.querySelector('[data-flash]')).not.toBeNull()
  })

  it('dashes everything through the hold, reads "not applied yet", then draws measured parts solid', () => {
    render(<Harness resultKey={nextKey()} />)
    const solid = () =>
      Array.from(document.querySelectorAll('[data-edge]')).filter((el) => !el.hasAttribute('stroke-dasharray'))
    expect(solid()).toHaveLength(0)
    expect(legend()).toBe('Dashed: not applied yet')
    advance(INTRO_HOLD_MS - 1)
    expect(solid()).toHaveLength(0)
    advance(1)
    expect(solid().length).toBeGreaterThan(0)
    const knee = BOUND.peakSwingKneeBend
    if (knee.source !== 'measured') throw new Error('fixture')
    expect(document.querySelector('[data-flash]')?.textContent).toBe(
      formatRunnerValue(knee.metricId, knee.metricValue),
    )
    advance(WHOLE_RUN_MS)
    expect(legend()).toBe('Dashed: not measured')
  })

  it('hides a tweening parameter’s annotation, and keeps its flash still while the figure runs', () => {
    render(<Harness resultKey={nextKey()} focus={{ metricIds: ['kneeFlexion'] }} />)
    expect(document.querySelector('[data-annotation="peakSwingKneeBend"]')).toBeNull()
    advance(INTRO_HOLD_MS)
    expect(document.querySelector('[data-annotation="peakSwingKneeBend"]')).toBeNull()
    const flash = document.querySelector('[data-flash]')
    const at = () => `${flash?.getAttribute('x')},${flash?.getAttribute('y')}`
    const first = at()
    const knee = kneeX()
    advance(300)
    expect(kneeX()).not.toBe(knee)
    expect(at()).toBe(first)
    advance(STEP_MS)
    expect(document.querySelector('[data-annotation="peakSwingKneeBend"]')).not.toBeNull()
  })

  it('shows "Skip intro" while running; skipping moves focus to Play/Pause', () => {
    const onDone = vi.fn()
    render(<Harness resultKey={nextKey()} onDone={onDone} />)
    advance(INTRO_HOLD_MS + STEP_MS)
    const skip = screen.getByRole('button', { name: 'Skip intro' })
    expect(skip.textContent).toBe('Skip intro')
    expect(skip.className).toContain('min-h-11')
    act(() => skip.focus())
    fireEvent.click(skip)
    expect(screen.queryByRole('button', { name: 'Skip intro' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Pause runner' }))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('Pause mid-intro skips it and holds the final, still figure', () => {
    const onDone = vi.fn()
    render(<Harness resultKey={nextKey()} onDone={onDone} />)
    advance(INTRO_HOLD_MS + STEP_MS)
    fireEvent.click(screen.getByRole('button', { name: 'Pause runner' }))
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Skip intro' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Play runner' })).toBeTruthy()
    expect(document.querySelector('[data-flash]')).toBeNull()
    const still = kneeX()
    advance(2000)
    expect(kneeX()).toBe(still)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('removes Skip when the intro ends, handing focus on if it held it', () => {
    render(<Harness resultKey={nextKey()} />)
    act(() => screen.getByRole('button', { name: 'Skip intro' }).focus())
    advance(WHOLE_RUN_MS)
    expect(screen.queryByRole('button', { name: 'Skip intro' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Pause runner' }))
  })

  it('leaves focus alone when Skip goes away unfocused', () => {
    render(<Harness resultKey={nextKey()} />)
    advance(WHOLE_RUN_MS)
    expect(screen.queryByRole('button', { name: 'Skip intro' })).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('never shows Skip under reduced motion', () => {
    mockReducedMotion(true)
    render(<Harness resultKey={nextKey()} />)
    expect(screen.queryByRole('button', { name: 'Skip intro' })).toBeNull()
    expect(legend()).not.toBe('Dashed: not applied yet')
    advance(100)
    expect(screen.queryByRole('button', { name: 'Skip intro' })).toBeNull()
  })
})

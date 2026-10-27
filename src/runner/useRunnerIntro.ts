/**
 * The "adopt your gait" intro beat (`openspec/changes/add-model-runner`, requirement on the
 * intro): the runner starts fully neutral, then each measured parameter is applied in turn, in
 * focus order, over about four seconds. Each one tweens from its neutral constant to its bound
 * value while its part turns solid and its value flashes beside it.
 *
 * **One React commit per discrete change, never per frame.** The hook only sequences steps with
 * `setTimeout`; the motion inside a step is `overrides.valueTween`, which ModelRunner's own loop
 * interpolates. A run of n parameters commits about 2n + 2 times (a step and its flash clearing,
 * plus the start and the end), however many frames it draws.
 *
 * **Plays once per result.** A module-level registry remembers which results have started their
 * intro. A remount with the same `resultKey` draws the final state at once and does NOT fire
 * `onDone` again: the caller already heard it for this result (or unmounted mid-intro and stopped
 * listening). A new key plays. The key is marked when the first step actually begins (a 0 ms
 * timer), not when the effect runs, so StrictMode's simulated unmount, which clears that timer,
 * never marks a key and then skips the intro on the real mount.
 *
 * **Known transient.** Neutral parameters are drawn at their bound values throughout, and those
 * may have been fitted around the measured contact parameters (`realizeParams`). Until a measured
 * landing is applied, a just-applied foot strike can therefore draw off its own label. Accepted:
 * it lasts one step at most and the final state is exact.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RunnerOverrides } from './ModelRunner'
import { formatRunnerValue } from './runnerAnnotations'
import { NEUTRAL_RUNNER_PARAMS, paramForMetric } from './runnerParams'
import { RUNNER_PARAM_IDS, type RunnerSource } from './runnerScene'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'
import type { BoundRunnerParams, MetricId, RunnerParamId, RunnerParams } from './types'

/** The whole intro's target length; each step gets an equal share, clamped below. */
export const INTRO_TOTAL_MS = 4000
export const INTRO_MIN_STEP_MS = 300
export const INTRO_MAX_STEP_MS = 1000
/** How long an applied value's label stays up (cut short by the next step). */
export const INTRO_FLASH_MS = 500

/** The fused result's identity: the result object itself, or a string id for it. */
export type RunnerIntroKey = object | string

const playedObjects = new WeakSet<object>()
const playedStrings = new Set<string>()

function hasPlayed(key: RunnerIntroKey): boolean {
  return typeof key === 'string' ? playedStrings.has(key) : playedObjects.has(key)
}

function markPlayed(key: RunnerIntroKey): void {
  if (typeof key === 'string') playedStrings.add(key)
  else playedObjects.add(key)
}

export function introStepMs(count: number): number {
  if (count <= 0) return 0
  return Math.min(INTRO_MAX_STEP_MS, Math.max(INTRO_MIN_STEP_MS, INTRO_TOTAL_MS / count))
}

function isRunnerParamId(id: MetricId | RunnerParamId): id is RunnerParamId {
  return (RUNNER_PARAM_IDS as readonly string[]).includes(id)
}

/**
 * The measured parameters in application order: those `order` names (metric ids mapped through
 * `paramForMetric`), then every other measured one in `RUNNER_PARAM_SPECS` order.
 */
export function introOrder(
  bound: BoundRunnerParams,
  order: readonly (MetricId | RunnerParamId)[] = [],
): RunnerParamId[] {
  const params: RunnerParamId[] = []
  const add = (id: RunnerParamId | null) => {
    if (id !== null && bound[id].source === 'measured' && !params.includes(id)) params.push(id)
  }
  for (const id of order) add(isRunnerParamId(id) ? id : paramForMetric(id))
  for (const id of RUNNER_PARAM_IDS) add(id)
  return params
}

/**
 * The overrides at `step` (-1: before the first). Parameters before `step` are applied; `step`
 * itself is tweening in; later ones hold their neutral constants and draw neutral.
 */
export function introOverrides(
  bound: BoundRunnerParams,
  params: readonly RunnerParamId[],
  step: number,
  stepMs: number,
): RunnerOverrides {
  const values: Partial<Record<RunnerParamId, number>> = {}
  params.forEach((id, i) => {
    if (i >= step) values[id] = NEUTRAL_RUNNER_PARAMS[id]
  })
  const sources = Object.fromEntries(
    RUNNER_PARAM_IDS.map((id): [RunnerParamId, RunnerSource] => {
      const i = params.indexOf(id)
      return [id, i !== -1 && i <= step ? 'measured' : 'neutral']
    }),
  ) as Record<RunnerParamId, RunnerSource>
  const id = params[step]
  if (step < 0 || id === undefined) return { values, sources, valueTween: null, flash: null }
  const from: Partial<Record<RunnerParamId, number>> = { [id]: NEUTRAL_RUNNER_PARAMS[id] }
  for (const applied of params.slice(0, step)) from[applied] = bound[applied].value
  const param = bound[id]
  return {
    values,
    sources,
    valueTween: {
      from: from as Partial<RunnerParams>,
      to: { [id]: param.value } as Partial<RunnerParams>,
      durationMs: stepMs,
      key: `${step}`,
    },
    flash:
      param.source === 'measured'
        ? { paramId: id, text: formatRunnerValue(param.metricId, param.metricValue) }
        : null,
  }
}

export interface UseRunnerIntroOptions {
  bound: BoundRunnerParams
  /**
   * The fused result identity. A new key plays the intro; a key already played does not. An
   * object key must be stable across renders (the result object itself, not a fresh literal):
   * every new identity is a new result and restarts the intro.
   */
  resultKey: RunnerIntroKey
  /** Focus-area metric ids or parameter ids, applied first and in this order. */
  order?: readonly (MetricId | RunnerParamId)[]
  /** Fires once per played result: on completion, on skip, or at once under reduced motion. */
  onDone?: () => void
}

export interface RunnerIntro {
  /** Pass to ModelRunner's `overrides`; undefined once finished (exactly `bound` is drawn). */
  overrides: RunnerOverrides | undefined
  running: boolean
  /** Jump to the final state. A no-op once finished. */
  skip: () => void
}

interface IntroState {
  key: RunnerIntroKey
  /** -1 before the first step; `done` once finished. */
  step: number
  flashOn: boolean
  done: boolean
}

function initialState(key: RunnerIntroKey): IntroState {
  const done = hasPlayed(key)
  return { key, step: -1, flashOn: false, done }
}

export function useRunnerIntro({
  bound,
  resultKey,
  order,
  onDone,
}: UseRunnerIntroOptions): RunnerIntro {
  const reduced = usePrefersReducedMotion()
  const [stored, setStored] = useState<IntroState>(() => initialState(resultKey))
  let state = stored
  if (stored.key !== resultKey) {
    // A new result: start over from its own initial state (React's "reset on prop change").
    state = initialState(resultKey)
    setStored(state)
  }

  const params = useMemo(() => introOrder(bound, order), [bound, order])
  const stepMs = introStepMs(params.length)
  const finished = state.done || reduced

  const onDoneRef = useRef(onDone)
  const planRef = useRef({ count: params.length, stepMs })
  // Which key `onDone` last fired for: StrictMode re-runs effects, and skip can race the end.
  const firedForRef = useRef<RunnerIntroKey | null>(null)
  useLayoutEffect(() => {
    onDoneRef.current = onDone
    planRef.current = { count: params.length, stepMs }
  })

  const finish = useCallback((key: RunnerIntroKey) => {
    markPlayed(key)
    setStored((s) => (s.key === key && !s.done ? { ...s, done: true, flashOn: false } : s))
    if (firedForRef.current === key) return
    firedForRef.current = key
    onDoneRef.current?.()
  }, [])

  useEffect(() => {
    if (state.done) return
    const key = resultKey
    if (reduced) {
      // Deferred like every other state change here, so it never sets state inside the effect.
      const id = setTimeout(() => finish(key), 0)
      return () => clearTimeout(id)
    }
    const { count, stepMs: ms } = planRef.current
    const timers: ReturnType<typeof setTimeout>[] = []
    const at = (delay: number, run: () => void) => timers.push(setTimeout(run, delay))
    const update = (next: Partial<IntroState>) =>
      setStored((s) => (s.key === key && !s.done ? { ...s, ...next } : s))
    for (let i = 0; i < count; i++) {
      at(i * ms, () => {
        if (i === 0) markPlayed(key)
        update({ step: i, flashOn: true })
      })
      if (INTRO_FLASH_MS < ms) at(i * ms + INTRO_FLASH_MS, () => update({ flashOn: false }))
    }
    at(count * ms, () => finish(key))
    return () => timers.forEach(clearTimeout)
  }, [resultKey, reduced, state.done, finish])

  const skip = useCallback(() => {
    if (!finished) finish(resultKey)
  }, [finished, finish, resultKey])

  const base = useMemo(
    () => introOverrides(bound, params, state.step, stepMs),
    [bound, params, state.step, stepMs],
  )
  const overrides = useMemo<RunnerOverrides | undefined>(() => {
    if (finished) return undefined
    return state.flashOn ? base : { ...base, flash: null }
  }, [finished, base, state.flashOn])

  return { overrides, running: !finished, skip }
}

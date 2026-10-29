/**
 * The "adopt your gait" intro beat (`openspec/changes/add-model-runner`, requirement on the
 * intro): the runner holds fully neutral for a moment, then each measured parameter is applied in
 * turn, in focus order, over about four and a half seconds. Each one tweens from its neutral
 * constant to its bound value while its part turns solid and its value flashes beside it.
 *
 * **One React commit per discrete change, never per frame.** The hook only sequences steps with
 * `setTimeout`, each chained from the previous step's actual start; the motion inside a step is
 * `overrides.valueTween`, which ModelRunner's own loop interpolates. A run of n steps commits
 * about 2n + 2 times however many frames it draws.
 *
 * **Starts only when seen.** The neutral hold, and with it the intro, begins only once `active`
 * (ModelRunner's `onActiveChange`: tab visible and figure on screen) is true; until then the
 * figure holds the neutral start. Leaving the screen during the hold restarts the hold. Once the
 * first step has begun the timers keep running while inactive: the renderer's value tween is
 * wall-clock too, so on return the figure is wherever the sequence has got to.
 *
 * **Plays once per result.** A module-level registry remembers which `resultKey`s have begun
 * their first step. A remount with a played key draws the final state at once and does not fire
 * `onDone`. The key is marked from the hold's timer, not from the effect, so StrictMode's
 * simulated unmount (which clears that timer) never marks a key and then skips the intro.
 *
 * **The plan is a snapshot.** The order, the step length and the bound values are captured when
 * the first step begins, so a `bound` that changes mid-intro (the scale-pass graft) cannot shift
 * step indices, and every parameter is drawn at its snapshot value until the end. The final
 * state (no overrides) draws the live `bound`. A plan with no steps (nothing measured that the
 * camera can show) finishes at once, with no hold.
 *
 * **Known transient.** Mid-intro the drawn values mix bound values and neutral constants, a
 * combination `realizeParams` never resolved; `poseAt` resolves contact-leg conflicts in its
 * default order (landing, then foot strike, then thigh peak). So an applied foot strike or thigh
 * peak can draw slightly off its label until the stronger contact parameters sharing its leg are
 * applied. Landing is always applied before foot strike, which removes the foot-strike case when
 * both are measured; the thigh-peak case remains. The final state is exact.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { resolveCamera } from './camera'
import type { RunnerOverrides } from './ModelRunner'
import { formatRunnerValue } from './runnerAnnotations'
import { NEUTRAL_RUNNER_PARAMS, paramForMetric, runnerParamValues } from './runnerParams'
import { RUNNER_PARAM_IDS, type RunnerSource } from './runnerScene'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'
import type {
  BoundRunnerParams,
  CameraPreset,
  CameraState,
  MetricId,
  RunnerParamId,
  RunnerParams,
} from './types'

/** The steps' combined target length; each step gets an equal share, clamped below. */
export const INTRO_TOTAL_MS = 4500
/** Ten visible steps (a front view) still fit `INTRO_TOTAL_MS`. */
export const INTRO_MIN_STEP_MS = 450
export const INTRO_MAX_STEP_MS = 1000
/** How long an applied value's label stays up (cut short by the next step). */
export const INTRO_FLASH_MS = 500
/** The fully neutral figure is held this long before the first step. */
export const INTRO_HOLD_MS = 500
/**
 * A flash that would clear with less than this left of its step stays up for the whole step
 * instead, so it never blinks off just before the next one.
 */
export const INTRO_FLASH_MIN_REMAINDER_MS = 150
/** Below this |sin yaw| a lateral parameter's change cannot be seen, so it gets no step. */
export const LATERAL_VISIBLE_SIN = 0.5
const LATERAL_PARAMS: readonly RunnerParamId[] = ['stepWidth', 'swingFootArc']
/**
 * Parameters with nothing to see while the intro runs: the stride moves no joint (it is drawn only
 * as vertical ratio's bracket, at a stop), so a step for it would tween nothing. Applied with the
 * final state, like a lateral parameter a side view cannot show.
 */
const UNSEEN_PARAMS: readonly RunnerParamId[] = ['strideLength']

const played = new Set<string>()

/** Forget every played result (tests only). */
export function __resetIntroRegistryForTests(): void {
  played.clear()
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
 * `paramForMetric`), then every other measured one in `RUNNER_PARAM_SPECS` order. Landing always
 * goes before foot strike (the stronger contact parameter first; see the transient above).
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
  const landing = params.indexOf('landingOffset')
  const strike = params.indexOf('contactShankOffset')
  if (landing > strike && strike !== -1) {
    params.splice(landing, 1)
    params.splice(strike, 0, 'landingOffset')
  }
  return params
}

/** What one run applies, captured when its first step begins. */
export interface IntroPlan {
  /** One step each, in order. */
  steps: RunnerParamId[]
  /** Measured, but invisible from this camera: held neutral, applied with the final state. */
  deferred: RunnerParamId[]
  values: RunnerParams
  flashes: Partial<Record<RunnerParamId, string>>
  stepMs: number
}

export function planIntro(
  bound: BoundRunnerParams,
  order: readonly (MetricId | RunnerParamId)[],
  cameraYawDeg: number,
): IntroPlan {
  const lateralVisible = Math.abs(Math.sin((cameraYawDeg * Math.PI) / 180)) >= LATERAL_VISIBLE_SIN
  const all = introOrder(bound, order)
  const steps = all.filter(
    (id) => !UNSEEN_PARAMS.includes(id) && (lateralVisible || !LATERAL_PARAMS.includes(id)),
  )
  const flashes: Partial<Record<RunnerParamId, string>> = {}
  for (const id of steps) {
    const param = bound[id]
    if (param.source === 'measured') flashes[id] = formatRunnerValue(param.metricId, param.metricValue)
  }
  return {
    steps,
    deferred: all.filter((id) => !steps.includes(id)),
    values: runnerParamValues(bound),
    flashes,
    stepMs: introStepMs(steps.length),
  }
}

/**
 * The overrides at `step` (-1: the neutral hold). Steps before `step` are applied; `step` itself
 * tweens in; later and deferred ones hold their neutral constants and draw neutral.
 */
export function introOverrides(plan: IntroPlan, step: number): RunnerOverrides {
  // Every parameter at its snapshot value, so a result updated mid-intro draws nothing new until
  // the end; then the steps and deferred parameters on top.
  const values: Partial<Record<RunnerParamId, number>> = { ...plan.values }
  plan.steps.forEach((id, i) => {
    values[id] = i < step ? plan.values[id] : NEUTRAL_RUNNER_PARAMS[id]
  })
  for (const id of plan.deferred) values[id] = NEUTRAL_RUNNER_PARAMS[id]
  const sources = Object.fromEntries(
    RUNNER_PARAM_IDS.map((id): [RunnerParamId, RunnerSource] => {
      const i = plan.steps.indexOf(id)
      return [id, i !== -1 && i <= step ? 'measured' : 'neutral']
    }),
  ) as Record<RunnerParamId, RunnerSource>
  const id = plan.steps[step]
  if (step < 0 || id === undefined) return { values, sources, valueTween: null, flash: null }
  const from: Partial<Record<RunnerParamId, number>> = { [id]: NEUTRAL_RUNNER_PARAMS[id] }
  for (const applied of plan.steps.slice(0, step)) from[applied] = plan.values[applied]
  const text = plan.flashes[id]
  return {
    values,
    sources,
    valueTween: { from, to: { [id]: plan.values[id] }, durationMs: plan.stepMs, key: `${step}` },
    flash: text === undefined ? null : { paramId: id, text },
  }
}

export interface UseRunnerIntroOptions {
  bound: BoundRunnerParams
  /**
   * The analysis run or session id. A new id plays the intro; one already played does not. Not
   * the fused result object: that is rebuilt on every session render and again when the scale
   * pass lands, which would restart the intro.
   */
  resultKey: string
  /** Focus-area metric ids or parameter ids, applied first and in this order. */
  order?: readonly (MetricId | RunnerParamId)[]
  /**
   * The runner's camera, the same one passed to ModelRunner (lateral parameters get no step from
   * a side view). Required, so the two can never silently disagree.
   */
  camera: CameraPreset | CameraState
  /** Whether the runner is seen (ModelRunner's `onActiveChange`). Nothing starts until it is. */
  active: boolean
  /**
   * A one-shot side effect, fired once per played result: on completion, on skip (including
   * Pause), or at once under reduced motion. It does not fire on a remount that skips the replay,
   * so never derive UI from it; use `running`.
   */
  onDone?: () => void
}

export interface RunnerIntro {
  /** Pass to ModelRunner's `overrides`; undefined once finished (exactly `bound` is drawn). */
  overrides: RunnerOverrides | undefined
  /** The source of truth for intro UI: true from mount until finished, skipped or never played. */
  running: boolean
  /** Jump to the final state. A no-op once finished. */
  skip: () => void
}

interface IntroState {
  key: string
  /** -1 during the neutral hold. */
  step: number
  flashOn: boolean
  done: boolean
  plan: IntroPlan | null
}

/** Where the running sequence is, kept outside React so a re-armed effect resumes from it. */
interface IntroProgress {
  key: string
  step: number
  plan: IntroPlan
  /** `performance.now()` when `step` actually began; the next step is chained from it. */
  startedAt: number
}

function initialState(key: string): IntroState {
  return { key, step: -1, flashOn: false, done: played.has(key), plan: null }
}

export function useRunnerIntro({
  bound,
  resultKey,
  order,
  camera,
  active,
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

  const orderKey = (order ?? []).join(',')
  const yaw = resolveCamera(camera).yawDeg
  const livePlan = useMemo(
    () => planIntro(bound, orderKey ? (orderKey.split(',') as (MetricId | RunnerParamId)[]) : [], yaw),
    [bound, orderKey, yaw],
  )
  // Nothing to apply (no measured parameter the camera can show): finished at once, no hold.
  const nothingToPlay = state.step === -1 && livePlan.steps.length === 0
  const finished = state.done || reduced || nothingToPlay

  const onDoneRef = useRef(onDone)
  const livePlanRef = useRef(livePlan)
  // The key onDone last fired for on this mount. Skip (or Pause) and a pending end or
  // reduced-motion timer can both reach `finish` before the commit that clears the timers.
  const firedForRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    onDoneRef.current = onDone
    livePlanRef.current = livePlan
  })

  const finish = useCallback((key: string) => {
    played.add(key)
    setStored((s) => (s.key === key && !s.done ? { ...s, done: true, flashOn: false } : s))
    if (firedForRef.current === key) return
    firedForRef.current = key
    onDoneRef.current?.()
  }, [])

  // Only the hold waits for the runner to be seen; once a step has begun it no longer matters.
  const holdReady = state.step !== -1 || active
  const progressRef = useRef<IntroProgress | null>(null)
  const { done, step, flashOn, plan } = state
  useEffect(() => {
    if (done) return
    const key = resultKey
    // Every state change here is deferred to a timer, so none is set inside the effect.
    if (reduced || nothingToPlay) {
      const id = setTimeout(() => finish(key), 0)
      return () => clearTimeout(id)
    }
    if (!holdReady) return
    // Each step arms the next from its own actual start, inside the timer callbacks, so the chain
    // never waits on a React commit.
    const timers: ReturnType<typeof setTimeout>[] = []
    const after = (delay: number, run: () => void) =>
      timers.push(setTimeout(run, Math.max(0, delay)))
    const arm = (k: number, steps: IntroPlan, elapsed: number) => {
      const flashClears = steps.stepMs - INTRO_FLASH_MS >= INTRO_FLASH_MIN_REMAINDER_MS
      if (flashClears && elapsed < INTRO_FLASH_MS) {
        after(INTRO_FLASH_MS - elapsed, () =>
          setStored((s) => (s.key === key && s.step === k && s.flashOn ? { ...s, flashOn: false } : s)),
        )
      }
      after(steps.stepMs - elapsed, () => {
        if (k + 1 < steps.steps.length) begin(k + 1, steps)
        else finish(key)
      })
    }
    const begin = (k: number, steps: IntroPlan) => {
      progressRef.current = { key, step: k, plan: steps, startedAt: performance.now() }
      setStored((s) => (s.key === key && !s.done ? { ...s, step: k, flashOn: true, plan: steps } : s))
      arm(k, steps, 0)
    }
    const progress = progressRef.current
    if (progress && progress.key === key) {
      // Re-armed mid-run (a reduced-motion flip): resume the current step where it is.
      arm(progress.step, progress.plan, performance.now() - progress.startedAt)
    } else {
      after(INTRO_HOLD_MS, () => {
        played.add(key)
        const snapshot = livePlanRef.current
        if (snapshot.steps.length === 0) finish(key)
        else begin(0, snapshot)
      })
    }
    return () => timers.forEach(clearTimeout)
  }, [resultKey, reduced, nothingToPlay, done, holdReady, finish])

  const skip = useCallback(() => {
    if (!finished) finish(resultKey)
  }, [finished, finish, resultKey])

  const shownPlan = plan ?? livePlan
  const base = useMemo(() => introOverrides(shownPlan, step), [shownPlan, step])
  const overrides = useMemo<RunnerOverrides | undefined>(() => {
    if (finished) return undefined
    return flashOn ? base : { ...base, flash: null }
  }, [finished, base, flashOn])

  return { overrides, running: !finished, skip }
}

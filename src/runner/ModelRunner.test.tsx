import { Profiler, StrictMode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeMetric } from '../results/__fixtures__/metricResult'
import { SKELETON_EDGES } from '../results/skeletonGeometry'
import { COMMON_KEYPOINT_NAMES, type KeypointName } from '../pose/types'
import { bindAll, bindOnly } from './__fixtures__/boundParams'
import { CAMERA_PRESETS, projectPose } from './camera'
import { GAIT_PHASES, poseAt } from './gaitModel'
import { ModelRunner, RUNNER_CAPTION, type ModelRunnerProps } from './ModelRunner'
import { runnerParamValues } from './runnerParams'
import { RUNNER_PARAM_IDS, edgeKey } from './runnerScene'
import type { CameraState } from './types'

const LABEL = 'Wireframe runner'
const HEAD_EDGES = new Set(
  SKELETON_EDGES.filter(([a, b]) => [a, b].some((j) => j === 'nose' || j.endsWith('_ear'))).map(
    edgeKey,
  ),
)

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  readonly callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    FakeIntersectionObserver.instances.push(this)
  }
  observe() {}
  disconnect() {}
  unobserve() {}
}

function setOnScreen(isIntersecting: boolean) {
  act(() => {
    for (const observer of FakeIntersectionObserver.instances) {
      observer.callback(
        [{ isIntersecting } as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver,
      )
    }
  })
}

let visibility: DocumentVisibilityState = 'visible'
function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

function setReducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches,
    media,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function props(overrides: Partial<ModelRunnerProps> = {}): ModelRunnerProps {
  return { params: bindAll(), camera: 'wholeBodySide', label: LABEL, ...overrides }
}

function setup(overrides: Partial<ModelRunnerProps> = {}) {
  const view = render(<ModelRunner {...props(overrides)} />)
  return {
    ...view,
    rerenderWith: (next: Partial<ModelRunnerProps>) =>
      view.rerender(<ModelRunner {...props({ ...overrides, ...next })} />),
  }
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function joint(name: KeypointName): { cx: number; cy: number } {
  const el = document.querySelector(`[data-joint="${name}"]`)
  if (!el) throw new Error(`no joint ${name}`)
  return { cx: Number(el.getAttribute('cx')), cy: Number(el.getAttribute('cy')) }
}

function jointCx(name: KeypointName = 'right_knee'): string | null {
  return document.querySelector(`[data-joint="${name}"]`)?.getAttribute('cx') ?? null
}

function dashedEdges(): string[] {
  return Array.from(document.querySelectorAll('[data-edge]'))
    .filter((el) => el.hasAttribute('stroke-dasharray'))
    .map((el) => el.getAttribute('data-edge') as string)
    .sort()
}

function expectPose(phase: number, camera: CameraState | 'wholeBodySide', values = runnerParamValues(bindAll())) {
  const projected = projectPose(poseAt(phase, values), camera)
  for (const [j, name] of COMMON_KEYPOINT_NAMES.entries()) {
    expect(joint(name).cx).toBeCloseTo(projected[j].x, 3)
    expect(joint(name).cy).toBeCloseTo(projected[j].y, 3)
  }
}

/** Counts how many 16 ms steps over `ms` moved the knee; returns the counts and largest step. */
function sampleFrames(ms: number): { draws: number; maxStep: number } {
  let previous = Number(jointCx())
  let draws = 0
  let maxStep = 0
  for (let t = 0; t < ms; t += 16) {
    advance(16)
    const now = Number(jointCx())
    if (now !== previous) {
      draws += 1
      maxStep = Math.max(maxStep, Math.abs(now - previous))
    }
    previous = now
  }
  return { draws, maxStep }
}

describe('ModelRunner drawing', () => {
  it('dashes neutral segments and draws measured ones solid', () => {
    const { rerenderWith } = setup({ params: bindOnly(['kneeDrive']) })
    const thighs = ['left_hip-left_knee', 'right_hip-right_knee']
    expect(dashedEdges()).toEqual(SKELETON_EDGES.map(edgeKey).filter((k) => !thighs.includes(k)).sort())
    for (const thigh of thighs) {
      expect(document.querySelector(`[data-edge="${thigh}"]`)?.getAttribute('data-style')).toBe('measured')
    }

    rerenderWith({ params: bindAll() })
    expect(dashedEdges()).toEqual([...HEAD_EDGES].sort())

    rerenderWith({
      params: bindAll(),
      overrides: { sources: Object.fromEntries(RUNNER_PARAM_IDS.map((id) => [id, 'neutral'])) },
    })
    expect(dashedEdges()).toEqual(SKELETON_EDGES.map(edgeKey).sort())
  })

  it('accents and annotates a measured focus area with its metric’s value', () => {
    const { container, rerenderWith } = setup({ focus: { metricIds: ['trunkLean'] } })
    expect(container.querySelector('[data-edge="left_shoulder-left_hip"]')?.getAttribute('data-style')).toBe('focus')
    expect(container.querySelector('[data-edge="left_hip-left_knee"]')?.getAttribute('data-style')).toBe('measured')
    const annotation = container.querySelector('[data-annotation="torsoPitch"]')
    expect(annotation?.getAttribute('data-kind')).toBe('angleArc')
    expect(annotation?.querySelector('text')?.textContent).toBe('5.0°')
    for (const path of annotation?.querySelectorAll('path') ?? []) {
      expect(path.getAttribute('d')).toMatch(/^M-?\d/)
    }

    rerenderWith({ focus: { metricIds: ['verticalRatio', 'stepWidthCm'] } })
    expect(container.querySelector('[data-annotation]')).toBeNull()

    rerenderWith({ params: bindOnly(['cadence']), focus: { metricIds: ['trunkLean'] } })
    expect(container.querySelector('[data-annotation]')).toBeNull()

    rerenderWith({ focus: { metricIds: ['trunkLean', 'verticalOscillation'], annotation: 'bracket' } })
    expect(Array.from(container.querySelectorAll('[data-annotation]'), (el) => el.getAttribute('data-annotation'))).toEqual(['pelvisBounce'])
  })

  it('marks a clamped focus value as drawn at a limit', () => {
    const params = bindAll({
      overstriding: makeMetric('overstriding', { value: 0.05 }),
      footStrikePattern: makeMetric('footStrikePattern', { value: 0.1 }),
    })
    const { container } = setup({ params, camera: 'footSide', focus: { metricIds: ['footStrikePattern'] } })
    const lines = container.querySelectorAll('[data-annotation="contactShankOffset"] text tspan')
    expect(Array.from(lines, (line) => line.textContent)).toEqual(['Heel strike (proxy)', 'drawn at limit'])
    for (const line of lines) expect(line.getAttribute('x')).not.toBeNull()
    expect(container.querySelector('p.sr-only')?.textContent).toContain(
      'drawn at a limit of the figure, not at the measured value',
    )
  })

  it('renders a flash label and draws override values, returning exactly to the bound ones', () => {
    setReducedMotion(true)
    const { container, rerenderWith } = setup()
    const before = jointCx('right_shoulder')
    rerenderWith({ overrides: { values: { torsoPitch: 25 }, flash: { paramId: 'torsoPitch', text: '25.0°' } } })
    expect(jointCx('right_shoulder')).not.toBe(before)
    expect(container.querySelector('[data-flash]')?.textContent).toBe('25.0°')
    expect(container.querySelector('[data-flash]')?.getAttribute('x')).not.toBeNull()
    rerenderWith({ overrides: undefined })
    expect(jointCx('right_shoulder')).toBe(before)
    expect(container.querySelector('[data-flash]')).toBeNull()
  })
})

describe('ModelRunner accessibility', () => {
  it('hides the drawing, names the figure, captions it honestly and lists what was measured', () => {
    const { container } = setup({ params: bindOnly(['cadence', 'trunkLean']), focus: { metricIds: ['trunkLean'] } })
    expect(screen.getByRole('figure', { name: LABEL })).toBeInTheDocument()
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('figcaption')?.textContent).toBe(RUNNER_CAPTION)
    expect(RUNNER_CAPTION).toBe('Model built from your numbers')
    const text = container.querySelector('p.sr-only')?.textContent ?? ''
    expect(text).toMatch(/^Measured from your clip: Cadence, Trunk lean\. /)
    expect(text).toContain('Shown: Trunk lean 5.0°.')
    expect(container.textContent).not.toMatch(/reference|ideal|your body/i)
  })

  it('shows the pause control outside the hidden drawing at every width', () => {
    setup()
    const button = screen.getByRole('button', { name: 'Pause runner' })
    expect(button.closest('[aria-hidden="true"]')).toBeNull()
    expect(button.className).not.toMatch(/(^|\s)(\w+:)?(hidden|sr-only|invisible)(\s|$)/)
    expect(button.textContent).toBe('Pause')
  })
})

describe('ModelRunner animation loop', () => {
  it('draws at most thirty frames a second without re-rendering React', () => {
    const onRender = vi.fn()
    render(
      <Profiler id="runner" onRender={onRender}>
        <ModelRunner {...props()} />
      </Profiler>,
    )
    const renders = onRender.mock.calls.length
    const { draws } = sampleFrames(1000)
    expect(draws).toBeGreaterThanOrEqual(28)
    expect(draws).toBeLessThanOrEqual(30)
    expect(onRender.mock.calls.length).toBe(renders)
  })

  it('stops while the tab is hidden and resumes without a jump', () => {
    setup()
    const { maxStep } = sampleFrames(500)
    setVisibility('hidden')
    expect(vi.getTimerCount()).toBe(0)
    const frozen = jointCx()
    advance(2000)
    expect(jointCx()).toBe(frozen)
    setVisibility('visible')
    const { maxStep: resumedStep } = sampleFrames(200)
    expect(jointCx()).not.toBe(frozen)
    expect(resumedStep).toBeLessThanOrEqual(maxStep * 1.05)
  })

  it('stops while scrolled offscreen and resumes', () => {
    setup()
    advance(300)
    setOnScreen(false)
    expect(vi.getTimerCount()).toBe(0)
    const frozen = jointCx()
    advance(2000)
    expect(jointCx()).toBe(frozen)
    setOnScreen(true)
    advance(200)
    expect(jointCx()).not.toBe(frozen)
  })

  it('keeps the figure continuous when cadence changes mid-run', () => {
    const { rerenderWith } = setup()
    const { maxStep } = sampleFrames(400)
    const before = jointCx()
    rerenderWith({ params: bindAll({ cadence: makeMetric('cadence', { value: 150 }) }) })
    expect(jointCx()).toBe(before)
    const { maxStep: after } = sampleFrames(400)
    expect(after).toBeLessThanOrEqual(maxStep)
  })

  it('runs one loop under StrictMode', () => {
    render(
      <StrictMode>
        <ModelRunner {...props()} />
      </StrictMode>,
    )
    expect(vi.getTimerCount()).toBe(1)
    const before = jointCx()
    advance(200)
    expect(jointCx()).not.toBe(before)
    expect(vi.getTimerCount()).toBe(1)
  })
})

describe('ModelRunner pause control', () => {
  it('freezes the pose and keeps the choice across focus and camera changes', () => {
    const side = CAMERA_PRESETS.wholeBodySide
    const closer: CameraState = { ...side, zoom: 1.6, target: { x: 0.2, y: 1.2, z: 0 } }
    const { rerenderWith } = setup({ camera: side })
    advance(300)
    fireEvent.click(screen.getByRole('button', { name: 'Pause runner' }))
    expect(vi.getTimerCount()).toBe(0)
    const paused = joint('left_ankle')
    advance(1000)
    expect(joint('left_ankle')).toEqual(paused)

    rerenderWith({ camera: side, focus: { metricIds: ['kneeDrive'] } })
    expect(screen.getByRole('button', { name: 'Play runner' })).toBeInTheDocument()
    expect(joint('left_ankle')).toEqual(paused)

    rerenderWith({ camera: closer, focus: { metricIds: ['trunkLean'] } })
    expect(screen.getByRole('button', { name: 'Play runner' })).toBeInTheDocument()
    advance(1000)
    expect(vi.getTimerCount()).toBe(0)
    // Same yaw, so the move is affine: the frozen pose, reprojected through the new camera.
    const worldX = paused.cx / side.zoom + side.target.x
    const worldY = -paused.cy / side.zoom + side.target.y
    expect(joint('left_ankle').cx).toBeCloseTo(closer.zoom * (worldX - closer.target.x), 3)
    expect(joint('left_ankle').cy).toBeCloseTo(-closer.zoom * (worldY - closer.target.y), 3)

    const reprojected = joint('left_ankle')
    fireEvent.click(screen.getByRole('button', { name: 'Play runner' }))
    advance(200)
    expect(joint('left_ankle')).not.toEqual(reprojected)
  })

  it('tweens a camera change over about 600 ms', () => {
    const side = CAMERA_PRESETS.wholeBodySide
    const { rerenderWith } = setup({ camera: side })
    fireEvent.click(screen.getByRole('button', { name: 'Pause runner' }))
    const from = joint('right_ankle')
    rerenderWith({ camera: 'feetFront' })
    expect(joint('right_ankle')).toEqual(from)
    advance(300)
    const mid = joint('right_ankle')
    const to = projectPose(poseAt(GAIT_PHASES.midStance, runnerParamValues(bindAll())), 'feetFront')[
      COMMON_KEYPOINT_NAMES.indexOf('right_ankle')
    ]
    expect(mid.cy).toBeGreaterThan(Math.min(from.cy, to.y))
    expect(mid.cy).toBeLessThan(Math.max(from.cy, to.y))
    advance(400)
    expectPose(GAIT_PHASES.midStance, CAMERA_PRESETS.feetFront)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('ModelRunner under reduced motion', () => {
  it('holds a still mid-stance pose, cuts the camera, and plays on request', () => {
    setReducedMotion(true)
    const { rerenderWith } = setup()
    expect(screen.getByRole('button', { name: 'Play runner' })).toBeInTheDocument()
    expectPose(GAIT_PHASES.midStance, 'wholeBodySide')
    expect(vi.getTimerCount()).toBe(0)
    advance(1000)
    expectPose(GAIT_PHASES.midStance, 'wholeBodySide')

    rerenderWith({ camera: 'feetFront' })
    expectPose(GAIT_PHASES.midStance, CAMERA_PRESETS.feetFront)
    expect(vi.getTimerCount()).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Play runner' }))
    const before = joint('right_ankle')
    advance(200)
    expect(joint('right_ankle')).not.toEqual(before)
    rerenderWith({ camera: 'legsSide', focus: { metricIds: ['kneeFlexion'] } })
    expect(screen.getByRole('button', { name: 'Pause runner' })).toBeInTheDocument()
  })
})

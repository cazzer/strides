import { Profiler, StrictMode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeMetric } from '../results/__fixtures__/metricResult'
import { SKELETON_EDGES } from '../results/skeletonGeometry'
import { COMMON_KEYPOINT_NAMES, type KeypointName } from '../pose/types'
import { bindAll, bindOnly } from './__fixtures__/boundParams'
import { CAMERA_PRESETS, projectPoint, projectPose } from './camera'
import { GAIT_PHASES, GROUND_Y, poseAt } from './gaitModel'
import { ModelRunner, RUNNER_CAPTION, type ModelRunnerProps } from './ModelRunner'
import { phaseForLeg } from './runnerAnnotations'
import { runnerParamValues } from './runnerParams'
import { FAR_OPACITY, RUNNER_PARAM_IDS, UNFOCUSED_OPACITY, edgeKey } from './runnerScene'
import type { CameraPreset, CameraState, RunnerParams } from './types'

const LABEL = 'Wireframe runner'
const HEAD_EDGES = new Set(
  SKELETON_EDGES.filter(([a, b]) => [a, b].some((j) => j === 'nose' || j.endsWith('_ear'))).map(
    edgeKey,
  ),
)
const VALUES = runnerParamValues(bindAll())

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  readonly callback: IntersectionObserverCallback
  disconnect = vi.fn()
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    FakeIntersectionObserver.instances.push(this)
  }
  observe() {}
  unobserve() {}
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  disconnect = vi.fn()
  constructor() {
    FakeResizeObserver.instances.push(this)
  }
  observe() {}
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
  FakeIntersectionObserver.instances = []
  FakeResizeObserver.instances = []
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

function expectPose(
  phase: number,
  camera: CameraState | CameraPreset,
  values: RunnerParams = VALUES,
) {
  const projected = projectPose(poseAt(phase, values), camera)
  for (const [j, name] of COMMON_KEYPOINT_NAMES.entries()) {
    expect(joint(name).cx).toBeCloseTo(projected[j].x, 3)
    expect(joint(name).cy).toBeCloseTo(projected[j].y, 3)
  }
}

/** First and last points of a path's `d`. */
function pathEnds(d: string | null): { x: number; y: number }[] {
  const points = [...(d ?? '').matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }))
  return [points[0], points[points.length - 1]]
}

/** Counts how many 16 ms steps over `ms` moved `name`; returns the count and largest step. */
function sampleFrames(ms: number, name: KeypointName = 'right_knee'): { draws: number; maxStep: number } {
  let previous = joint(name)
  let draws = 0
  let maxStep = 0
  for (let t = 0; t < ms; t += 16) {
    advance(16)
    const now = joint(name)
    const step = Math.hypot(now.cx - previous.cx, now.cy - previous.cy)
    if (step > 0) {
      draws += 1
      maxStep = Math.max(maxStep, step)
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

  it('dims far measured parts no further than 0.75, never dims neutral dashes, and recedes the unfocused parts', () => {
    const { container, rerenderWith } = setup({ params: bindOnly(['kneeDrive', 'kneeFlexion']) })
    const opacity = (edge: string) =>
      container.querySelector(`[data-edge="${edge}"]`)?.getAttribute('opacity') ?? null
    expect(opacity('left_hip-left_knee')).toBe(String(FAR_OPACITY))
    expect(opacity('right_hip-right_knee')).toBeNull()
    expect(opacity('left_shoulder-left_elbow')).toBeNull()
    expect(Number(FAR_OPACITY)).toBeGreaterThanOrEqual(0.75)

    rerenderWith({ params: bindAll(), focus: { metricIds: ['kneeDrive'] } })
    expect(opacity('right_hip-right_knee')).toBeNull()
    expect(container.querySelector('[data-edge="right_hip-right_knee"]')?.getAttribute('data-style')).toBe('focus')
    expect(opacity('right_knee-right_ankle')).toBe(String(UNFOCUSED_OPACITY))
    expect(opacity('left_ear-nose')).toBeNull()
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
    expect(annotation?.querySelector('[data-role="fill"]')?.getAttribute('d')).toMatch(/Z$/)

    rerenderWith({ focus: { metricIds: ['verticalRatio', 'stepWidthCm'] } })
    expect(container.querySelector('[data-annotation]')).toBeNull()

    rerenderWith({ params: bindOnly(['cadence']), focus: { metricIds: ['trunkLean'] } })
    expect(container.querySelector('[data-annotation]')).toBeNull()

    rerenderWith({ focus: { metricIds: ['trunkLean', 'verticalOscillation'], annotation: 'bracket' } })
    expect(Array.from(container.querySelectorAll('[data-annotation]'), (el) => el.getAttribute('data-annotation'))).toEqual(['pelvisBounce'])
  })

  it('marks a clamped focus value as shown approximately', () => {
    const params = bindAll({
      overstriding: makeMetric('overstriding', { value: 0.05 }),
      footStrikePattern: makeMetric('footStrikePattern', { value: 0.1 }),
    })
    const { container } = setup({ params, camera: 'footSide', focus: { metricIds: ['footStrikePattern'] } })
    const lines = container.querySelectorAll('[data-annotation="contactShankOffset"] text tspan')
    expect(Array.from(lines, (line) => line.textContent)).toEqual(['Heel strike (proxy)', 'shown approximately'])
    for (const line of lines) expect(line.getAttribute('x')).not.toBeNull()
    expect(container.querySelector('p.sr-only')?.textContent).toContain(
      'drawn at a limit of the figure, not at the measured value',
    )
  })

  it('holds the still frame at the focus’s key phase, so the annotated joint is the live joint', () => {
    mockReducedMotion(true)
    const { container, rerenderWith } = setup({ camera: 'legsSide', focus: { metricIds: ['kneeDrive'] } })
    const held = phaseForLeg('right', GAIT_PHASES.peakThigh)
    expectPose(held, 'legsSide')
    // The arc's wedge starts at its centre: the live near hip.
    const [centre] = pathEnds(container.querySelector('[data-annotation="peakThighAngle"] [data-role="fill"]')?.getAttribute('d') ?? null)
    expect(centre.x).toBeCloseTo(joint('right_hip').cx, 3)
    expect(centre.y).toBeCloseTo(joint('right_hip').cy, 3)

    rerenderWith({ camera: 'footSide', focus: { metricIds: ['overstriding'] } })
    expectPose(phaseForLeg('right', GAIT_PHASES.leftContact), 'footSide')
    const [, end] = pathEnds(container.querySelector('[data-annotation="landingOffset"] [data-role="mark"]')?.getAttribute('d') ?? null)
    expect(end.x).toBeCloseTo(joint('right_ankle').cx, 3)

    rerenderWith({ camera: 'wholeBodySide', focus: { metricIds: ['trunkLean'] } })
    expectPose(GAIT_PHASES.midStance, 'wholeBodySide')
  })

  it('renders a flash label and draws static override values, returning exactly to the bound ones', () => {
    mockReducedMotion(true)
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

  it('draws the ground at y = 0, where the stance foot stands', () => {
    const { container } = setup()
    const y = Number(container.querySelector('[data-ground]')?.getAttribute('y1'))
    const expected = projectPoint(
      { x: CAMERA_PRESETS.wholeBodySide.target.x, y: GROUND_Y, z: 0 },
      'wholeBodySide',
    ).y
    expect(y).toBeCloseTo(expected, 3)
  })

  it('shows the dashed legend only when a dashed part is in frame', () => {
    const { container, rerenderWith } = setup()
    const legend = () => container.querySelector('figure p[aria-hidden="true"]')?.textContent
    expect(legend()).toBe('Dashed: not measured')
    rerenderWith({ camera: 'feetFront' })
    expect(legend()).toBe('')
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
    expect(button.textContent).toContain('Pause')
    expect(button.querySelector('[aria-hidden="true"]')?.textContent).toBe('❚❚')
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

  it('keeps the figure continuous when cadence or rate changes mid-run', () => {
    const { rerenderWith } = setup()
    const { maxStep } = sampleFrames(400)
    const before = jointCx()
    rerenderWith({ params: bindAll({ cadence: makeMetric('cadence', { value: 150 }) }) })
    expect(jointCx()).toBe(before)
    const { maxStep: after } = sampleFrames(400)
    expect(after).toBeLessThanOrEqual(maxStep)
    rerenderWith({ params: bindAll({ cadence: makeMetric('cadence', { value: 150 }) }), playbackRate: 2 })
    expect(vi.getTimerCount()).toBe(1)
    const { maxStep: faster } = sampleFrames(400)
    expect(faster).toBeLessThanOrEqual(maxStep * 2.1)
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

  it('leaves no frame pending and disconnects its observers on unmount', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const { unmount } = setup()
    advance(100)
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(FakeIntersectionObserver.instances.every((o) => o.disconnect.mock.calls.length > 0)).toBe(true)
    expect(FakeResizeObserver.instances.length).toBeGreaterThan(0)
    expect(FakeResizeObserver.instances.every((o) => o.disconnect.mock.calls.length > 0)).toBe(true)
  })
})

describe('ModelRunner value tween (the intro seam)', () => {
  it('interpolates in the loop with no React commits, ending exactly at `to`', () => {
    const onRender = vi.fn()
    const tree = (overrides?: ModelRunnerProps['overrides']) => (
      <Profiler id="runner" onRender={onRender}>
        <ModelRunner {...props({ overrides })} />
      </Profiler>
    )
    const { rerender } = render(tree())
    fireEvent.click(screen.getByRole('button', { name: 'Pause runner' }))
    const tween = { from: { torsoPitch: 0 }, to: { torsoPitch: 20 }, durationMs: 1000, key: 'intro-1' }
    rerender(tree({ valueTween: tween }))
    const renders = onRender.mock.calls.length
    expectPose(GAIT_PHASES.midStance, 'wholeBodySide', { ...VALUES, torsoPitch: 0 })
    expect(vi.getTimerCount()).toBe(1)
    const { maxStep } = sampleFrames(1100, 'right_shoulder')
    expect(onRender.mock.calls.length).toBe(renders)
    // 20° over ~30 frames: no step bigger than a couple of degrees' worth of shoulder travel.
    expect(maxStep).toBeLessThan(0.06)
    expectPose(GAIT_PHASES.midStance, 'wholeBodySide', { ...VALUES, torsoPitch: 20 })
    expect(vi.getTimerCount()).toBe(0)
    // The same key again does not restart it; removing it returns to the bound values.
    rerender(tree({ valueTween: { ...tween } }))
    expectPose(GAIT_PHASES.midStance, 'wholeBodySide', { ...VALUES, torsoPitch: 20 })
    rerender(tree())
    expectPose(GAIT_PHASES.midStance, 'wholeBodySide')
  })

  it('keeps figure marks on the figure while a leg tween changes its standing height', () => {
    const { rerenderWith } = setup({ focus: { metricIds: ['trunkLean'] } })
    fireEvent.click(screen.getByRole('button', { name: 'Pause runner' }))
    rerenderWith({
      overrides: {
        valueTween: { from: { stepWidth: -1.5 }, to: { stepWidth: VALUES.stepWidth }, durationMs: 1000, key: 'lift' },
      },
    })
    const hipMidY = () => (joint('left_hip').cy + joint('right_hip').cy) / 2
    const arcCentreY = () => {
      const fill = document.querySelector('[data-annotation="torsoPitch"] path[data-role="fill"]')
      return pathEnds(fill?.getAttribute('d') ?? null)[0].y
    }
    const before = hipMidY()
    advance(400)
    // The step-width tween moves the hips (the figure stands taller or shorter) and the lean arc,
    // hung from hip-mid, moves with them.
    expect(Math.abs(hipMidY() - before)).toBeGreaterThan(0.01)
    expect(arcCentreY()).toBeCloseTo(hipMidY(), 2)
    advance(800)
    expect(arcCentreY()).toBeCloseTo(hipMidY(), 2)
  })

  it('jumps to the end under reduced motion', () => {
    mockReducedMotion(true)
    setup({
      overrides: { valueTween: { from: { torsoPitch: 0 }, to: { torsoPitch: 20 }, durationMs: 1000, key: 1 } },
    })
    expectPose(GAIT_PHASES.midStance, 'wholeBodySide', { ...VALUES, torsoPitch: 20 })
    expect(vi.getTimerCount()).toBe(0)
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

    // A focus with no key phase leaves the held phase alone: the frozen pose stays put.
    rerenderWith({ camera: side, focus: { metricIds: ['trunkLean'] } })
    expect(screen.getByRole('button', { name: 'Play runner' })).toBeInTheDocument()
    expect(joint('left_ankle')).toEqual(paused)

    // A keyed focus moves the still figure to its key phase; the choice stays.
    rerenderWith({ camera: side, focus: { metricIds: ['kneeDrive'] } })
    expect(screen.getByRole('button', { name: 'Play runner' })).toBeInTheDocument()
    const held = phaseForLeg('right', GAIT_PHASES.peakThigh)
    expectPose(held, side)

    rerenderWith({ camera: closer, focus: { metricIds: ['kneeDrive'] } })
    expect(screen.getByRole('button', { name: 'Play runner' })).toBeInTheDocument()
    advance(1000)
    expect(vi.getTimerCount()).toBe(0)
    expectPose(held, closer)

    const reprojected = joint('left_ankle')
    fireEvent.click(screen.getByRole('button', { name: 'Play runner' }))
    advance(200)
    expect(joint('left_ankle')).not.toEqual(reprojected)
  })

  it('tweens a camera change over about 600 ms', () => {
    const { rerenderWith } = setup({ camera: 'wholeBodySide' })
    fireEvent.click(screen.getByRole('button', { name: 'Pause runner' }))
    const from = joint('right_ankle')
    rerenderWith({ camera: 'feetFront' })
    expect(joint('right_ankle')).toEqual(from)
    advance(300)
    const mid = joint('right_ankle')
    const to = projectPose(poseAt(GAIT_PHASES.midStance, VALUES), 'feetFront')[
      COMMON_KEYPOINT_NAMES.indexOf('right_ankle')
    ]
    expect(mid.cy).toBeGreaterThan(Math.min(from.cy, to.y))
    expect(mid.cy).toBeLessThan(Math.max(from.cy, to.y))
    advance(400)
    expectPose(GAIT_PHASES.midStance, CAMERA_PRESETS.feetFront)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retargets mid-tween from where the camera is, without a jump', () => {
    const { rerenderWith } = setup({ camera: 'wholeBodySide' })
    fireEvent.click(screen.getByRole('button', { name: 'Pause runner' }))
    rerenderWith({ camera: 'feetFront' })
    const { maxStep } = sampleFrames(304, 'right_ankle')
    const before = joint('right_ankle')
    rerenderWith({ camera: 'torsoSide' })
    expect(joint('right_ankle')).toEqual(before)
    const { maxStep: retargeted } = sampleFrames(800, 'right_ankle')
    expect(retargeted).toBeLessThan(Math.max(maxStep * 3, 0.5))
    expectPose(GAIT_PHASES.midStance, 'torsoSide')
  })
})

describe('ModelRunner under reduced motion', () => {
  it('holds a still mid-stance pose, cuts the camera, and plays on request', () => {
    mockReducedMotion(true)
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

  it('switching reduced motion on live stops and returns to the still frame', () => {
    const media = mockReducedMotion(false)
    setup({ focus: { metricIds: ['overstriding'] } })
    expect(screen.getByRole('button', { name: 'Pause runner' })).toBeInTheDocument()
    advance(500)
    media.set(true)
    expect(screen.getByRole('button', { name: 'Play runner' })).toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
    expectPose(phaseForLeg('right', GAIT_PHASES.leftContact), 'wholeBodySide')
    media.set(false)
    expect(screen.getByRole('button', { name: 'Pause runner' })).toBeInTheDocument()
  })
})

describe('ModelRunner review round 2', () => {
  it('shows a still figure only the marks at its held phase, and every mark while playing', () => {
    mockReducedMotion(true)
    const { container } = setup({ camera: 'legsSide', focus: { metricIds: ['kneeDrive', 'kneeFlexion'] } })
    expect(container.querySelector('[data-annotation="peakThighAngle"] [data-role="mark"]')).not.toBeNull()
    expect(container.querySelector('[data-annotation="peakSwingKneeBend"] [data-role="mark"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Play runner' }))
    expect(container.querySelector('[data-annotation="peakSwingKneeBend"] [data-role="mark"]')).not.toBeNull()
    // The value stays in the text alternative while the mark is hidden.
    expect(container.querySelector('p.sr-only')?.textContent).toContain('Knee flexion 110.0°')
  })

  it('keeps the held phase when a paused camera turns from side to front', () => {
    const { rerenderWith } = setup({ camera: 'footSide', focus: { metricIds: ['overstriding'] } })
    fireEvent.click(screen.getByRole('button', { name: 'Pause runner' }))
    const held = phaseForLeg('right', GAIT_PHASES.leftContact)
    rerenderWith({ camera: 'footSide', focus: { metricIds: ['stepWidth'] } })
    expectPose(held, 'footSide')
    rerenderWith({ camera: 'feetFront', focus: { metricIds: ['stepWidth'] } })
    advance(1000)
    expectPose(held, 'feetFront')
  })

  it('treats a zero-length value tween as finished', () => {
    const { rerenderWith } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Pause runner' }))
    rerenderWith({
      overrides: { valueTween: { from: { torsoPitch: 0 }, to: { torsoPitch: 20 }, durationMs: 0, key: 'z' } },
    })
    expectPose(GAIT_PHASES.midStance, 'wholeBodySide', { ...VALUES, torsoPitch: 20 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('runs a value tween on wall-clock time: hidden past its end, it resumes at `to`', () => {
    const { rerenderWith } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Pause runner' }))
    const tween = { from: { torsoPitch: 0 }, to: { torsoPitch: 20 }, durationMs: 1000, key: 'w' }
    rerenderWith({ overrides: { valueTween: tween } })
    advance(300)
    setVisibility('hidden')
    expect(vi.getTimerCount()).toBe(0)
    advance(2000)
    setVisibility('visible')
    expectPose(GAIT_PHASES.midStance, 'wholeBodySide', { ...VALUES, torsoPitch: 20 })
    advance(100)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('runs a value tween and a camera tween together to both ends', () => {
    const { rerenderWith } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Pause runner' }))
    rerenderWith({
      camera: 'torsoSide',
      overrides: { valueTween: { from: { torsoPitch: 0 }, to: { torsoPitch: 20 }, durationMs: 900, key: 'c' } },
    })
    const { maxStep } = sampleFrames(1000, 'right_shoulder')
    expect(maxStep).toBeLessThan(0.15)
    expectPose(GAIT_PHASES.midStance, 'torsoSide', { ...VALUES, torsoPitch: 20 })
    expect(vi.getTimerCount()).toBe(0)
  })
})

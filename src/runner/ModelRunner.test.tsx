import { Profiler, StrictMode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeMetric, makeVerticalOscillation } from '../results/__fixtures__/metricResult'
import { SKELETON_EDGES } from '../results/skeletonGeometry'
import { COMMON_KEYPOINT_NAMES, type KeypointName } from '../pose/types'
import { bindAll, bindOnly } from './__fixtures__/boundParams'
import {
  CAMERA_PRESETS,
  LANDING_CONTACT_HOLD_MS,
  LANDING_PHASE_WINDOW,
  landingCamera,
  projectPoint,
  projectPose,
  drawingFrame,
  strideCamera,
  wholeBodyCamera,
} from './camera'
import { GAIT_PHASES, GROUND_Y, cyclesPerSecond, pelvisHeight, poseAt } from './gaitModel'
import {
  MAX_PLATE_SIDE_IN_FRAME_WIDTHS,
  fitFootagePlate,
  plateSideInFrameWidths,
  type PlateTransform,
} from './footagePlate'
import {
  ModelRunner,
  PLATE_LEGEND,
  PLATE_LEGEND_FLIPPED,
  RUNNER_CAPTION,
  type ModelRunnerProps,
  type RunnerFocus,
  type RunnerFootage,
} from './ModelRunner'
import { BEAT_DECAY_CYCLES, formatRunnerValue, phaseForLeg, strideLabelLineCount } from './runnerAnnotations'
import { runnerParamValues } from './runnerParams'
import {
  FAR_OPACITY,
  FRAME_MS,
  LABEL_LINE_HEIGHT,
  RUNNER_PARAM_IDS,
  RUNNER_PX,
  UNFOCUSED_OPACITY,
  clampLabelX,
  edgeKey,
  strideFramePad,
  usableBottom,
  wholeBodyFramePad,
} from './runnerScene'
import type { CameraPreset, CameraState, ProjectedJoint, RunnerParams } from './types'

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
  readonly targets: Element[] = []
  readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback = () => {}) {
    this.callback = callback
    FakeResizeObserver.instances.push(this)
  }
  observe(target: Element) {
    this.targets.push(target)
  }
  unobserve() {}
}

/** Delivers a content box to the observers watching the runner's drawing (or another part). */
function resizeDrawing(width: number, height: number, part = 'drawing') {
  act(() => {
    for (const observer of FakeResizeObserver.instances) {
      if (!observer.targets.some((t) => t.matches(`[data-runner-part="${part}"]`))) continue
      observer.callback(
        [{ contentRect: { width, height } } as ResizeObserverEntry],
        observer as unknown as ResizeObserver,
      )
    }
  })
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

/** A matchMedia mock whose `change` listeners can be fired. Only the reduced-motion query (and
 * forced colours, when asked) matches. */
function mockReducedMotion(initial: boolean, { forcedColors = false } = {}) {
  const state = { matches: initial }
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', (media: string) => ({
    get matches() {
      if (media.includes('forced-colors')) return forcedColors
      return media.includes('reduced-motion') ? state.matches : false
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

    rerenderWith({ focus: { metricIds: ['stepWidthCm'] } })
    expect(container.querySelector('[data-annotation]')).toBeNull()

    rerenderWith({ params: bindOnly(['cadence']), focus: { metricIds: ['trunkLean'] } })
    expect(container.querySelector('[data-annotation]')).toBeNull()

    rerenderWith({ focus: { metricIds: ['trunkLean', 'verticalOscillation'], annotation: 'bracket' } })
    expect(Array.from(container.querySelectorAll('[data-annotation]'), (el) => el.getAttribute('data-annotation'))).toEqual(['pelvisBounce'])
  })

  it('draws vertical ratio as one stride and the magnified bounce, labelled with its value and the factor', () => {
    const { container } = setup({
      camera: 'strideSide',
      focus: { metricIds: ['verticalRatio', 'verticalOscillation'] },
    })
    // The bounce's own true-scale bracket gives way to the inset when the bounce does not head the focus.
    expect(Array.from(container.querySelectorAll('[data-annotation]'), (el) => el.getAttribute('data-annotation'))).toEqual([
      'strideLength',
    ])
    const annotation = container.querySelector('[data-annotation="strideLength"]')!
    const label = annotation.querySelector('text[data-label-index]')!
    expect(Array.from(label.querySelectorAll('tspan'), (line) => line.textContent)).toEqual([
      '4.00%',
      'bounce ÷ stride',
    ])
    const tags = annotation.querySelectorAll('text[data-tag-index]')
    expect(Array.from(tags, (tag) => tag.textContent)).toEqual(['hip bounce ×10', 'stride'])
    for (const tag of tags) expect(tag.querySelector('tspan')?.getAttribute('x')).not.toBeNull()
    for (const path of annotation.querySelectorAll('path')) expect(path.getAttribute('d')).toMatch(/^M-?\d/)
  })

  it('keeps the bounce’s own bracket beside the inset when the bounce heads the focus', () => {
    // A cadence-less rhythm stop: the centimetre bounce is the headline, vertical ratio secondary.
    const { container } = setup({
      camera: 'strideSide',
      focus: { metricIds: ['verticalOscillationCm', 'verticalRatio'] },
    })
    expect(Array.from(container.querySelectorAll('[data-annotation]'), (el) => el.getAttribute('data-annotation'))).toEqual([
      'pelvisBounce',
      'strideLength',
    ])
    expect(container.querySelector('[data-annotation="pelvisBounce"] text')?.textContent).toBe(
      '15.0%of torso length',
    )
  })

  it('marks a clamped focus value as shown approximately', () => {
    const params = bindAll({
      overstriding: makeMetric('overstriding', { value: 0.05 }),
      footStrikePattern: makeMetric('footStrikePattern', { value: 0.1 }),
    })
    const { container } = setup({ params, camera: 'footSide', focus: { metricIds: ['footStrikePattern'] } })
    const lines = container.querySelectorAll('[data-annotation="contactShankOffset"] text tspan')
    expect(Array.from(lines, (line) => line.textContent)).toEqual(['Heel first (estimate)', 'shown approximately'])
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

describe('ModelRunner landing camera', () => {
  const LANDING_FOCUS = { metricIds: ['overstriding', 'footStrikePattern'] } as const
  const GRID = 600
  const TRACKED: KeypointName[] = ['left_ankle', 'right_ankle', 'right_knee', 'left_knee']

  /** The cycle phase whose pose, seen through `camera`, best matches the drawn tracked joints. */
  function drawnPhase(camera: CameraState, values: RunnerParams = VALUES): number {
    const drawn = TRACKED.map(joint)
    let best = 0
    let bestError = Infinity
    for (let i = 0; i < GRID; i += 1) {
      const projected = projectPose(poseAt(i / GRID, values), camera)
      const error = TRACKED.reduce((sum, name, k) => {
        const p = projected[COMMON_KEYPOINT_NAMES.indexOf(name)]
        return sum + Math.hypot(p.x - drawn[k].cx, p.y - drawn[k].cy)
      }, 0)
      if (error < bestError) {
        bestError = error
        best = i / GRID
      }
    }
    // The grid's spacing against the swing foot's speed: a mismatched phase errs by a whole unit.
    expect(bestError).toBeLessThan(0.1)
    return best
  }

  const inWindow = (phase: number) =>
    phase >= LANDING_PHASE_WINDOW.start - 2 / GRID &&
    phase <= LANDING_PHASE_WINDOW.start + LANDING_PHASE_WINDOW.length + 2 / GRID

  it('tweens to the landing frame of the drawn values, and plays only the window around contact', () => {
    const { rerenderWith } = setup({ camera: 'legsSide', playbackRate: 0.4 })
    rerenderWith({ camera: 'landingSide', focus: LANDING_FOCUS })
    advance(700)
    const camera = landingCamera(VALUES)
    // Played on into the window (no jump on entry); then it stays there.
    advance(2000)
    const seen: number[] = []
    for (let i = 0; i < 40; i += 1) {
      advance(100)
      seen.push(drawnPhase(camera))
    }
    for (const phase of seen) expect(inWindow(phase), String(phase)).toBe(true)
    expect(Math.min(...seen)).toBeLessThan(0.45)
    expect(Math.max(...seen)).toBeGreaterThan(0.55)
  })

  /** Whether every drawn joint is the contact pose's, through the landing camera. */
  function atContact(camera: CameraState): boolean {
    const projected = projectPose(poseAt(GAIT_PHASES.rightContact, VALUES), camera)
    return COMMON_KEYPOINT_NAMES.every(
      (name, j) =>
        Math.abs(joint(name).cx - projected[j].x) < 1e-3 && Math.abs(joint(name).cy - projected[j].y) < 1e-3,
    )
  }

  it('rests on the exact contact frame for the hold once per loop, within the thirty-frame cap', () => {
    setup({ camera: 'landingSide', focus: LANDING_FOCUS, playbackRate: 0.4 })
    const camera = landingCamera(VALUES)
    // Leave the mount's contact frame first, so every stretch counted below is a hold.
    advance(200)
    expect(atContact(camera)).toBe(false)
    const stretches: number[] = []
    let run = 0
    let previous = joint('right_ankle')
    let draws = 0
    for (let t = 0; t < 4000; t += 16) {
      advance(16)
      const now = joint('right_ankle')
      if (now.cx !== previous.cx || now.cy !== previous.cy) draws += 1
      previous = now
      if (atContact(camera)) run += 16
      else if (run > 0) {
        stretches.push(run)
        run = 0
      }
    }
    // About one loop a second (0.25 of a cycle at 0.4× plus both holds): one contact rest each.
    expect(stretches.length).toBeGreaterThanOrEqual(3)
    expect(stretches.length).toBeLessThanOrEqual(5)
    for (const ms of stretches) {
      expect(ms).toBeGreaterThanOrEqual(LANDING_CONTACT_HOLD_MS - 2 * FRAME_MS)
      expect(ms).toBeLessThanOrEqual(LANDING_CONTACT_HOLD_MS + 2 * FRAME_MS)
    }
    expect(draws).toBeLessThanOrEqual(4 * 30)
  })

  it('pausing on the landing camera stands the figure at the contact, so the marks meet it', () => {
    const { container } = setup({ camera: 'landingSide', focus: LANDING_FOCUS, playbackRate: 0.4 })
    const camera = landingCamera(VALUES)
    let phase = drawnPhase(camera)
    for (let i = 0; i < 120 && !(phase > 0.38 && phase < 0.43); i += 1) {
      advance(16)
      phase = drawnPhase(camera)
    }
    expect(phase).toBeGreaterThan(0.38)
    expect(phase).toBeLessThan(0.43)
    fireEvent.click(screen.getByRole('button', { name: 'Pause runner' }))
    expect(vi.getTimerCount()).toBe(0)
    expectPose(GAIT_PHASES.rightContact, camera)
    const guides = container.querySelectorAll('[data-annotation="landingOffset"] [data-role="guide"]')
    const [ankleTop] = pathEnds(guides[1].getAttribute('d'))
    expect(ankleTop.x).toBeCloseTo(joint('right_ankle').cx, 3)
    expect(ankleTop.y).toBeCloseTo(joint('right_ankle').cy, 3)
    // Playing again starts from the contact.
    fireEvent.click(screen.getByRole('button', { name: 'Play runner' }))
    advance(100)
    expect(inWindow(drawnPhase(camera))).toBe(true)
  })

  it('enters the window from outside by playing on: every frame steps forward a little', () => {
    // A knee-flexion focus holds its own key phase (0.12), outside the landing window.
    setup({ camera: 'landingSide', focus: { metricIds: ['kneeFlexion'] }, playbackRate: 0.4 })
    const camera = landingCamera(VALUES)
    // The loop's first frame only sets its clock.
    advance(FRAME_MS + 1)
    let previous = drawnPhase(camera)
    expect(inWindow(previous)).toBe(false)
    const seen = [previous]
    for (let i = 0; i < 30; i += 1) {
      advance(FRAME_MS + 1)
      const phase = drawnPhase(camera)
      const step = (phase - previous + 1) % 1
      expect(step, `${previous} → ${phase}`).toBeGreaterThan(0)
      expect(step, `${previous} → ${phase}`).toBeLessThan(0.03)
      seen.push(phase)
      previous = phase
      // Up to the contact hold, which is the next thing that stops it.
      if (phase > GAIT_PHASES.rightContact - 0.05) break
    }
    expect(Math.min(...seen)).toBeLessThan(LANDING_PHASE_WINDOW.start)
    expect(Math.max(...seen)).toBeGreaterThan(LANDING_PHASE_WINDOW.start)
  })

  it('enters the window by playing on, and leaving it runs the whole cycle again without a jump', () => {
    const { rerenderWith } = setup({ camera: 'landingSide', playbackRate: 0.4 })
    const camera = landingCamera(VALUES)
    // Held at contact on the first frame: inside the window.
    expect(drawnPhase(camera)).toBeCloseTo(GAIT_PHASES.rightContact, 2)
    advance(1500)
    expect(inWindow(drawnPhase(camera))).toBe(true)

    rerenderWith({ camera: CAMERA_PRESETS.legsSide, playbackRate: 0.4 })
    advance(700)
    let previous = drawnPhase(CAMERA_PRESETS.legsSide)
    const seen: number[] = []
    for (let i = 0; i < 40; i += 1) {
      advance(100)
      const phase = drawnPhase(CAMERA_PRESETS.legsSide)
      const step = (phase - previous + 1) % 1
      expect(step, `${previous} → ${phase}`).toBeLessThan(0.1)
      seen.push(phase)
      previous = phase
    }
    expect(seen.some((phase) => !inWindow(phase))).toBe(true)
  })

  it('reframes when a bound value moves the contact, tweening like any camera change', () => {
    const { rerenderWith } = setup({ camera: 'landingSide', focus: LANDING_FOCUS })
    fireEvent.click(screen.getByRole('button', { name: 'Pause runner' }))
    const big = bindAll({ overstriding: makeMetric('overstriding', { value: 0.6 }) })
    const bigValues = runnerParamValues(big)
    expect(bigValues.landingOffset).not.toBe(VALUES.landingOffset)
    rerenderWith({ params: big })
    expect(vi.getTimerCount()).toBe(1)
    advance(700)
    expectPose(GAIT_PHASES.rightContact, landingCamera(bigValues), bigValues)
    expect(vi.getTimerCount()).toBe(0)
  })

  for (const focus of [LANDING_FOCUS, { metricIds: ['trunkLean'] } as const, undefined]) {
    it(`under reduced motion holds the contact with the near foot on the ground (focus ${focus?.metricIds.join('+') ?? 'none'})`, () => {
      mockReducedMotion(true)
      const { container } = setup({ camera: 'landingSide', focus })
      const camera = landingCamera(VALUES)
      expectPose(GAIT_PHASES.rightContact, camera)
      expect(vi.getTimerCount()).toBe(0)
      const pose = poseAt(GAIT_PHASES.rightContact, VALUES)
      const lowest = Math.min(
        ...(['right_ankle', 'right_heel', 'right_foot_index'] as const).map(
          (name) => pose[COMMON_KEYPOINT_NAMES.indexOf(name)].y,
        ),
      )
      expect(Math.abs(lowest - GROUND_Y)).toBeLessThan(1e-9)
      const groundY = Number(container.querySelector('[data-ground]')?.getAttribute('y1'))
      const drawnLowest = Math.max(
        ...(['right_ankle', 'right_heel', 'right_foot_index'] as const).map((name) => joint(name).cy),
      )
      expect(drawnLowest).toBeCloseTo(groundY, 3)
      advance(1000)
      expectPose(GAIT_PHASES.rightContact, camera)
    })
  }

  it('draws the landing marks on the live leg: guides meet hip-mid and the ankle, the labels stacked as one block', () => {
    mockReducedMotion(true)
    const { container } = setup({ camera: 'landingSide', focus: LANDING_FOCUS })
    const hip = {
      x: (joint('left_hip').cx + joint('right_hip').cx) / 2,
      y: (joint('left_hip').cy + joint('right_hip').cy) / 2,
    }
    const guides = container.querySelectorAll('[data-annotation="landingOffset"] [data-role="guide"]')
    const [hipTop] = pathEnds(guides[0].getAttribute('d'))
    expect(hipTop.x).toBeCloseTo(hip.x, 3)
    expect(hipTop.y).toBeCloseTo(hip.y, 3)
    const [ankleTop] = pathEnds(guides[1].getAttribute('d'))
    expect(ankleTop.x).toBeCloseTo(joint('right_ankle').cx, 3)
    expect(ankleTop.y).toBeCloseTo(joint('right_ankle').cy, 3)
    const [, strikeEnd] = pathEnds(
      container.querySelector('[data-annotation="contactShankOffset"] [data-role="mark"]')?.getAttribute('d') ?? null,
    )
    expect(strikeEnd.x).toBeCloseTo(joint('right_ankle').cx, 3)
    expect(strikeEnd.y).toBeCloseTo(joint('right_ankle').cy, 3)
    // The foot strike's block sits a whole line pitch below the overstride's last line, on the
    // same centre (the overstride's, kept inside the frame by the usual label clamp).
    const spans = (id: string) =>
      Array.from(container.querySelectorAll<SVGTSpanElement>(`[data-annotation="${id}"] text tspan`))
    const overstride = spans('landingOffset')
    const strike = spans('contactShankOffset')
    const y = (span: SVGTSpanElement) => Number(span.getAttribute('y'))
    const pitch = (RUNNER_PX.label / 100) * LABEL_LINE_HEIGHT
    expect(y(strike[0])).toBeGreaterThanOrEqual(y(overstride[overstride.length - 1]) + pitch - 1e-3)
    const [start, end] = pathEnds(
      container.querySelector('[data-annotation="landingOffset"] [data-role="mark"]')?.getAttribute('d') ?? null,
    )
    const centre = (start.x + end.x) / 2
    const font = RUNNER_PX.label / 100
    for (const block of [overstride, strike]) {
      const chars = Math.max(...block.map((span) => (span.textContent ?? '').length))
      expect(Number(block[0].getAttribute('x'))).toBeCloseTo(clampLabelX(centre, 'middle', chars, font), 3)
    }
  })
})

describe('ModelRunner cadence beat', () => {
  const RHYTHM: ModelRunnerProps['focus'] = { metricIds: ['cadence'] }
  const UNIT = 1 / 100
  const AT_180 = bindAll({ cadence: makeMetric('cadence', { value: 180 }) })

  function rings(): { opacity: number; r: number; cx: number; cy: number }[] {
    return Array.from(document.querySelectorAll('circle[data-pulse]'), (el) => ({
      opacity: Number(el.getAttribute('opacity')),
      r: Number(el.getAttribute('r')),
      cx: Number(el.getAttribute('cx')),
      cy: Number(el.getAttribute('cy')),
    }))
  }

  function beat(): Element {
    const el = document.querySelector('[data-annotation="cadence"]')
    if (!el) throw new Error('no cadence annotation')
    return el
  }

  function ringRadius(opacity: number): number {
    return (RUNNER_PX.beatRingMin + (RUNNER_PX.beatRingMax - RUNNER_PX.beatRingMin) * opacity) * UNIT
  }

  it('flashes a ring and the tick at each foot as it lands, largest at contact, with no React commit per frame', () => {
    const onRender = vi.fn()
    render(
      <Profiler id="runner" onRender={onRender}>
        <ModelRunner {...props({ params: AT_180, focus: RHYTHM })} />
      </Profiler>,
    )
    expect(beat().getAttribute('data-kind')).toBe('beat')
    expect(beat().querySelector('text')?.textContent).toBe('180 steps/min')
    const guides = beat().querySelectorAll('[data-role="guide"]')
    expect(guides).toHaveLength(2)
    expect(rings()).toHaveLength(2)
    const renders = onRender.mock.calls.length
    const groundY = projectPoint({ x: 0, y: GROUND_Y, z: 0 }, CAMERA_PRESETS.wholeBodySide).y
    let peak = 0
    let gone = false
    let previous = rings()
    for (let t = 0; t < 2000; t += 16) {
      advance(16)
      const now = rings()
      for (const [i, ring] of now.entries()) {
        // Largest and opaque at contact, shrinking as it fades: 15 px down to 6 px.
        expect(ring.r).toBeCloseTo(ringRadius(ring.opacity), 3)
        expect(ring.cy).toBeCloseTo(groundY, 3)
        if (ring.opacity < previous[i].opacity) expect(ring.r).toBeLessThanOrEqual(previous[i].r)
        // The foot's tick flashes in the accent with its ring, along the tick itself.
        const tick = document.querySelector(`path[data-pulse-tick="0:${i}"]`)
        expect(Number(tick?.getAttribute('opacity'))).toBe(ring.opacity)
        expect(tick?.getAttribute('d')).toBe(guides[i].getAttribute('d'))
        peak = Math.max(peak, ring.opacity)
        if (ring.opacity === 0) gone = true
      }
      previous = now
    }
    expect(peak).toBeGreaterThan(0.6)
    expect(gone).toBe(true)
    expect(onRender.mock.calls.length).toBe(renders)
  })

  it('centres each strong ring on the contact point, under the landing foot', () => {
    setup({ params: AT_180, focus: RHYTHM })
    const camera = CAMERA_PRESETS.wholeBodySide
    // Which foot point lands first, and how far it slides back while the ring is above 0.5
    // (u ≤ 1 − √0.5 of the decay): the tolerance for "under the foot".
    const window = BEAT_DECAY_CYCLES * (1 - Math.SQRT1_2)
    const feet = (['left', 'right'] as const).map((side) => {
      const contact = phaseForLeg(side, GAIT_PHASES.leftContact)
      const pose = poseAt(contact, VALUES)
      const at = (name: KeypointName) => pose[COMMON_KEYPOINT_NAMES.indexOf(name)]
      const name: KeypointName =
        at(`${side}_foot_index`).y < at(`${side}_heel`).y ? `${side}_foot_index` : `${side}_heel`
      const x0 = projectPoint(at(name), camera).x
      let slide = 0
      for (let k = 0; k <= 50; k += 1) {
        const p = poseAt(contact + (window * k) / 50, VALUES)[COMMON_KEYPOINT_NAMES.indexOf(name)]
        slide = Math.max(slide, Math.abs(projectPoint(p, camera).x - x0))
      }
      return { name, x0, slide }
    })
    let strong = 0
    for (let t = 0; t < 1500; t += 16) {
      advance(16)
      for (const [i, ring] of rings().entries()) {
        expect(ring.cx).toBeCloseTo(feet[i].x0, 3)
        if (ring.opacity < 0.5) continue
        strong += 1
        const foot = joint(feet[i].name)
        expect(Math.abs(foot.cy - ring.cy)).toBeLessThan(0.02)
        expect(Math.abs(foot.cx - ring.cx)).toBeLessThanOrEqual(feet[i].slide + 1e-3)
      }
    }
    expect(strong).toBeGreaterThan(0)
    // The 0.30 stance slides the foot back a little faster than the 0.38 one did (0.208 here).
    expect(Math.max(...feet.map((f) => f.slide))).toBeLessThan(0.25)
  })

  /** Ring onsets (opacity rising) per ring through the real loop over `ms`. */
  function countOnsets(ms: number): number {
    let previous = rings().map((r) => r.opacity)
    let onsets = 0
    for (let t = 0; t < ms; t += 16) {
      advance(16)
      const now = rings().map((r) => r.opacity)
      onsets += now.filter((o, i) => o > previous[i] + 1e-6).length
      previous = now
    }
    return onsets
  }

  it('beats 30 ± 1 times in 10 s at 180 steps/min, and 12 ± 1 at 0.4×, keeping the label', () => {
    const fast = setup({ params: AT_180, focus: RHYTHM })
    expect(Math.abs(countOnsets(10_000) - 30)).toBeLessThanOrEqual(1)
    fast.unmount()
    setup({ params: AT_180, focus: RHYTHM, playbackRate: 0.4 })
    expect(beat().querySelector('text')?.textContent).toBe('180 steps/min')
    expect(Math.abs(countOnsets(10_000) - 12)).toBeLessThanOrEqual(1)
  })

  it('under reduced motion holds the near foot planted on the ticks, never a ring, no frame pending', () => {
    mockReducedMotion(true)
    setup({ focus: RHYTHM })
    expectPose(phaseForLeg('right', GAIT_PHASES.leftContact), 'wholeBodySide')
    expect(beat().querySelector('text')?.textContent).toMatch(/steps\/min$/)
    const ticks = beat().querySelectorAll('[data-role="guide"]')
    expect(ticks).toHaveLength(2)
    const planted = Math.max(joint('right_heel').cy, joint('right_foot_index').cy)
    const lowest = joint('right_heel').cy >= joint('right_foot_index').cy ? joint('right_heel') : joint('right_foot_index')
    for (const tick of ticks) {
      const [top] = pathEnds(tick.getAttribute('d'))
      expect(top.x).toBeCloseTo(lowest.cx, 3)
      expect(top.y).toBeCloseTo(planted, 3)
    }
    expect(rings()).toHaveLength(0)
    expect(document.querySelector('[data-pulse-tick]')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    // The reader may play the figure; the ring stays off while reduced motion is preferred.
    fireEvent.click(screen.getByRole('button', { name: 'Play runner' }))
    advance(500)
    expect(rings()).toHaveLength(0)
  })

  it('shows no ring while paused', () => {
    setup({ focus: RHYTHM })
    expect(rings()).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Pause runner' }))
    expect(rings()).toHaveLength(0)
    expect(document.querySelector('[data-pulse-tick]')).toBeNull()
    expect(beat().querySelectorAll('[data-role="guide"]')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Play runner' }))
    expect(rings()).toHaveLength(2)
  })

  it('shows no ring on the landing camera, whose contact hold would freeze it', () => {
    setup({ camera: 'landingSide', focus: RHYTHM })
    expect(screen.getByRole('button', { name: 'Pause runner' })).toBeInTheDocument()
    advance(500)
    expect(beat().querySelector('text')?.textContent).toMatch(/steps\/min$/)
    expect(beat().querySelectorAll('[data-role="guide"]')).toHaveLength(2)
    expect(rings()).toHaveLength(0)
    expect(document.querySelector('[data-pulse-tick]')).toBeNull()
  })

  it('keeps the ring small, at least 2 px thick, and never red (WCAG 2.3.1)', () => {
    expect(RUNNER_PX.beatRingMax).toBeGreaterThanOrEqual(14)
    expect(RUNNER_PX.beatRingStroke).toBeGreaterThanOrEqual(2)
    setup({ focus: RHYTHM })
    for (let t = 0; t < 1000; t += 16) {
      advance(16)
      for (const ring of rings()) expect(ring.r).toBeLessThanOrEqual(16 * UNIT + 1e-9)
    }
    for (const el of document.querySelectorAll('circle[data-pulse], path[data-pulse-tick]')) {
      expect(el.getAttribute('class')).not.toMatch(/red|rose|pink|orange/)
      expect(el.getAttribute('class')).toContain('forced-colors:stroke-[color:Highlight]')
      expect(el.getAttribute('fill')).toBe('none')
    }
    for (const el of document.querySelectorAll('circle[data-pulse]')) {
      expect(Number(el.getAttribute('stroke-width'))).toBeCloseTo(RUNNER_PX.beatRingStroke * UNIT, 6)
    }
  })

  it('keeps the ticks on the ground while a tween changes the figure’s height; the head label rides it', () => {
    // A wide frame, so the head label is never held at the frame's top edge.
    const camera: CameraState = { yawDeg: 0, pitchDeg: 0, zoom: 0.8, target: { x: 0, y: 1.8, z: 0 } }
    // The neutral bounce sits near the bounce that stands the figure lowest, so take whichever
    // candidate moves the standing height more, up or down.
    const heightChange = (params: RunnerParams) => Math.abs(pelvisHeight(params) - pelvisHeight(VALUES))
    const shifted = [VALUES.pelvisBounce + 0.1, VALUES.pelvisBounce - 0.05]
      .map((pelvisBounce) => ({ ...VALUES, pelvisBounce }))
      .sort((a, b) => heightChange(b) - heightChange(a))[0]
    expect(heightChange(shifted)).toBeGreaterThan(1e-3)
    const { rerenderWith, container } = setup({ camera, focus: RHYTHM })
    fireEvent.click(screen.getByRole('button', { name: 'Pause runner' }))
    const tick = () =>
      container.querySelector('[data-annotation="cadence"] [data-role="guide"]')?.getAttribute('d')
    const labelY = () => Number(container.querySelector('[data-annotation="cadence"] tspan')?.getAttribute('y'))
    const tickBefore = tick()
    const labelBefore = labelY()
    rerenderWith({
      camera,
      focus: RHYTHM,
      overrides: {
        valueTween: {
          from: { pelvisBounce: shifted.pelvisBounce },
          to: { pelvisBounce: shifted.pelvisBounce },
          durationMs: 10_000,
          key: 'shifted',
        },
      },
    })
    advance(100)
    expect(tick()).toBe(tickBefore)
    const drop = (pelvisHeight(VALUES) - pelvisHeight(shifted)) * camera.zoom
    expect(labelY() - labelBefore).toBeCloseTo(drop, 3)
  })
})

describe('ModelRunner still figure stands on the ground', () => {
  // The park-side-landscape demo's overstride: past the pin's declared domain, so mid-stance the
  // stance foot gives way below the ground (gaitModel D15).
  const BIG = bindAll({ overstriding: makeMetric('overstriding', { value: 0.512 }) })
  const BIG_VALUES = runnerParamValues(BIG)
  const FEET: KeypointName[] = COMMON_KEYPOINT_NAMES.filter((name) => /ankle|heel|foot_index/.test(name))
  const lowestFootCy = () => Math.max(...FEET.map((name) => joint(name).cy))
  const groundY = () => Number(document.querySelector('[data-ground]')?.getAttribute('y1'))

  it('lifts the held knee-flexion frame onto the ground, the knee mark with it, and drops the lift on play', () => {
    mockReducedMotion(true)
    const held = phaseForLeg('right', GAIT_PHASES.peakSwingKneeBend)
    const pose = poseAt(held, BIG_VALUES)
    const sink = GROUND_Y - Math.min(...FEET.map((name) => pose[COMMON_KEYPOINT_NAMES.indexOf(name)].y))
    expect(sink).toBeGreaterThan(0.03)
    setup({ params: BIG, camera: 'legsSide', focus: { metricIds: ['kneeFlexion'] } })
    expect(lowestFootCy()).toBeCloseTo(groundY(), 3)
    const lifted = projectPose(pose.map((j) => ({ ...j, y: j.y + sink })), 'legsSide')
    for (const [j, name] of COMMON_KEYPOINT_NAMES.entries()) {
      expect(joint(name).cx).toBeCloseTo(lifted[j].x, 3)
      expect(joint(name).cy).toBeCloseTo(lifted[j].y, 3)
    }
    const label = () => Number(document.querySelector('[data-annotation="peakSwingKneeBend"] tspan')?.getAttribute('y'))
    const labelStill = label()
    const kneeStill = joint('right_knee').cy
    // Playing again draws the same phase unlifted, a snap down; the knee mark rides the figure.
    fireEvent.click(screen.getByRole('button', { name: 'Play runner' }))
    expectPose(held, 'legsSide', BIG_VALUES)
    const drop = joint('right_knee').cy - kneeStill
    expect(drop).toBeGreaterThan(0)
    expect(label() - labelStill).toBeCloseTo(drop, 3)
  })

  it('lifts a figure paused mid-stance while its ground ticks stay on the ground', () => {
    // A wide frame, so the head label is never held at the frame's top edge.
    const camera: CameraState = { yawDeg: 0, pitchDeg: 0, zoom: 0.8, target: { x: 0, y: 1.8, z: 0 } }
    setup({ params: BIG, camera, focus: { metricIds: ['cadence'] } })
    const scale = projectPoint({ x: 0, y: 0, z: 0 }, camera).y - projectPoint({ x: 0, y: 1, z: 0 }, camera).y
    let sunk = 0
    for (let i = 0; i < 200 && sunk < 0.03 * scale; i += 1) {
      advance(16)
      sunk = lowestFootCy() - groundY()
    }
    expect(sunk).toBeGreaterThan(0.03 * scale)
    const ticks = () =>
      Array.from(document.querySelectorAll('[data-annotation="cadence"] [data-role="guide"]'), (el) =>
        el.getAttribute('d'),
      )
    const ticksPlaying = ticks()
    const label = () => Number(document.querySelector('[data-annotation="cadence"] tspan')?.getAttribute('y'))
    const labelPlaying = label()
    const playing = COMMON_KEYPOINT_NAMES.map(joint)
    fireEvent.click(screen.getByRole('button', { name: 'Pause runner' }))
    expect(lowestFootCy()).toBeCloseTo(groundY(), 3)
    // One rigid lift: every joint rises by the same amount and none moves sideways.
    const rise = joint('right_knee').cy - playing[COMMON_KEYPOINT_NAMES.indexOf('right_knee')].cy
    expect(rise).toBeLessThan(-0.02 * scale)
    COMMON_KEYPOINT_NAMES.forEach((name, j) => {
      expect(joint(name).cx).toBeCloseTo(playing[j].cx, 3)
      expect(joint(name).cy - playing[j].cy).toBeCloseTo(rise, 3)
    })
    expect(ticks()).toEqual(ticksPlaying)
    // The cadence label hangs off the head, so it rides the lift.
    expect(label() - labelPlaying).toBeCloseTo(rise, 3)
  })
})

describe('ModelRunner footage plate', () => {
  /** `toBlob` held until the test resolves it, as the browser's encode is asynchronous. */
  let pendingBlobs: BlobCallback[] = []
  let urls = 0
  let revoked: string[] = []
  beforeEach(() => {
    pendingBlobs = []
    urls = 0
    revoked = []
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback) => {
      pendingBlobs.push(callback)
    })
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:plate-${(urls += 1)}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
      revoked.push(url)
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function resolveBlobs() {
    act(() => {
      for (const callback of pendingBlobs.splice(0)) callback(new Blob(['png']))
    })
  }

  const KNEES_FOCUS: RunnerFocus = { metricIds: ['kneeFlexion'] }
  const NOTE = 'Faint behind the still model: your clip’s knee flexion evidence image.'

  function footage(overrides: Partial<RunnerFootage> = {}): RunnerFootage {
    return {
      metric: 'kneeFlexion',
      image: document.createElement('canvas'),
      note: NOTE,
      measuredSide: 'right',
      mirror: false,
      points: [
        { name: 'right_hip', u: 0.5, v: 0.35 },
        { name: 'right_knee', u: 0.58, v: 0.6 },
        { name: 'right_ankle', u: 0.45, v: 0.82 },
      ],
      ...overrides,
    }
  }

  const plate = () => document.querySelector('image[data-footage-plate]')
  const shown = () => plate()?.hasAttribute('data-shown') ?? false
  const note = () => document.querySelector('p.sr-only')?.textContent ?? ''
  const legendLine = () => document.querySelector('[data-plate-legend]')?.textContent ?? null

  /** The pose as the renderer drew it, read back off the joints. */
  function drawnJoints(): ProjectedJoint[] {
    return COMMON_KEYPOINT_NAMES.map((name) => ({ name, x: joint(name).cx, y: joint(name).cy, depth: 0 }))
  }

  function matrixOf(el: Element | null): number[] {
    const match = /^matrix\((.*)\)$/.exec(el?.getAttribute('transform') ?? '')
    return match ? match[1].split(' ').map(Number) : []
  }

  it('shows a still figure’s footage at 0.26 behind it, placed by the hip-anchored fit over the drawn joints', () => {
    mockReducedMotion(true)
    const source = footage()
    const { container } = setup({ camera: 'legsSide', focus: KNEES_FOCUS, footage: source })
    expect(plate()).toBeNull()
    resolveBlobs()
    const el = plate()
    expect(el).not.toBeNull()
    expect(el?.getAttribute('href')).toBe('blob:plate-1')
    // The first child of the drawing, under the ground and the figure.
    expect(container.querySelector('svg')?.firstElementChild).toBe(el)
    expect(el?.getAttribute('class')).toContain('data-[shown]:opacity-[0.26]')
    // Greyscale, and faded in on its first appearance too.
    expect(el?.getAttribute('class')).toContain('grayscale')
    expect(el?.getAttribute('class')).toContain('starting:opacity-0!')
    expect(shown()).toBe(true)
    expect(legendLine()).toBe(PLATE_LEGEND)
    // The legend line sits in the hidden legend, beside the dashed-part note.
    expect(document.querySelector('[data-plate-legend]')?.closest('[aria-hidden="true"]')).not.toBeNull()
    expectPose(phaseForLeg('right', GAIT_PHASES.peakSwingKneeBend), 'legsSide')
    const fit = fitFootagePlate(source, drawnJoints(), 'right') as PlateTransform
    const [a, b, c, d, e, f] = matrixOf(el)
    expect([b, c]).toEqual([0, 0])
    expect(a).toBeCloseTo(fit.a, 3)
    expect(d).toBeCloseTo(fit.d, 3)
    expect(a).toBe(d)
    expect(e).toBeCloseTo(fit.e, 3)
    expect(f).toBeCloseTo(fit.f, 3)
    expect(note()).toContain(NOTE)
  })

  it('mirrors a right-to-left clip', () => {
    mockReducedMotion(true)
    setup({ camera: 'legsSide', focus: KNEES_FOCUS, footage: footage({ mirror: true }) })
    resolveBlobs()
    const [a, , , d] = matrixOf(plate())
    expect(a).toBeLessThan(0)
    expect(a).toBeCloseTo(-d, 4)
    expect(legendLine()).toBe(`${PLATE_LEGEND}${PLATE_LEGEND_FLIPPED}`)
  })

  it('refuses a placement that magnifies the image past the clutter cap: no plate, no words', () => {
    mockReducedMotion(true)
    // A leg spanning a few hundredths of the image: the fit would blow it up many frame widths.
    const tiny = footage({
      points: [
        { name: 'right_hip', u: 0.5, v: 0.5 },
        { name: 'right_knee', u: 0.52, v: 0.53 },
        { name: 'right_ankle', u: 0.51, v: 0.56 },
      ],
    })
    setup({ camera: 'legsSide', focus: KNEES_FOCUS, footage: tiny })
    resolveBlobs()
    const fit = fitFootagePlate(tiny, drawnJoints(), 'right') as PlateTransform
    expect(plateSideInFrameWidths(fit)).toBeGreaterThan(MAX_PLATE_SIDE_IN_FRAME_WIDTHS)
    expect(shown()).toBe(false)
    expect(legendLine()).toBeNull()
    expect(note()).not.toContain(NOTE)
  })

  it('names no photo under forced colours, where the plate is not drawn', () => {
    mockReducedMotion(true, { forcedColors: true })
    setup({ camera: 'legsSide', focus: KNEES_FOCUS, footage: footage() })
    resolveBlobs()
    expect(plate()?.getAttribute('class')).toContain('forced-colors:hidden')
    expect(shown()).toBe(false)
    expect(legendLine()).toBeNull()
    expect(note()).not.toContain(NOTE)
  })

  it('hides on Play, in place, and drops the note; shows again on Pause', () => {
    mockReducedMotion(true)
    setup({ camera: 'legsSide', focus: KNEES_FOCUS, footage: footage() })
    resolveBlobs()
    const transform = plate()?.getAttribute('transform')
    fireEvent.click(screen.getByRole('button', { name: 'Play runner' }))
    expect(plate()).not.toBeNull()
    expect(shown()).toBe(false)
    expect(note()).not.toContain(NOTE)
    expect(legendLine()).toBeNull()
    advance(500)
    expect(plate()?.getAttribute('transform')).toBe(transform)
    fireEvent.click(screen.getByRole('button', { name: 'Pause runner' }))
    // The same canvas is not copied again.
    expect(pendingBlobs).toHaveLength(0)
    expect(shown()).toBe(true)
    expect(note()).toContain(NOTE)
  })

  it('copies nothing while the figure plays, and shows once paused and copied', () => {
    setup({ camera: 'legsSide', focus: KNEES_FOCUS, footage: footage() })
    expect(pendingBlobs).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Pause runner' }))
    expect(plate()).toBeNull()
    expect(note()).not.toContain(NOTE)
    resolveBlobs()
    expect(shown()).toBe(true)
  })

  it('stays hidden while the camera tweens, and shows where it comes to rest', () => {
    const source = footage()
    const { rerenderWith } = setup({ camera: 'legsSide', focus: KNEES_FOCUS, footage: source })
    fireEvent.click(screen.getByRole('button', { name: 'Pause runner' }))
    resolveBlobs()
    expect(shown()).toBe(true)
    const closer: CameraState = { ...CAMERA_PRESETS.legsSide, zoom: 1.8 }
    rerenderWith({ camera: closer })
    advance(100)
    expect(shown()).toBe(false)
    advance(1000)
    expect(shown()).toBe(true)
    const fit = fitFootagePlate(source, drawnJoints(), 'right') as PlateTransform
    expect(matrixOf(plate())[0]).toBeCloseTo(fit.a, 3)
  })

  it('never shows when the footage metric is keyed to another phase than the one held', () => {
    mockReducedMotion(true)
    setup({ camera: 'legsSide', focus: KNEES_FOCUS, footage: footage({ metric: 'kneeDrive' }) })
    resolveBlobs()
    expect(plate()).not.toBeNull()
    expect(shown()).toBe(false)
    expect(note()).not.toContain(NOTE)
  })

  it('shows nothing without footage, and nothing when the canvas cannot be read back', () => {
    mockReducedMotion(true)
    const { rerenderWith } = setup({ camera: 'legsSide', focus: KNEES_FOCUS })
    expect(pendingBlobs).toHaveLength(0)
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(() => {
      throw new DOMException('tainted', 'SecurityError')
    })
    rerenderWith({ footage: footage() })
    expect(plate()).toBeNull()
    expect(note()).not.toContain(NOTE)
  })

  it('drops and revokes the copy when the canvas changes, and on unmount', () => {
    mockReducedMotion(true)
    const { rerenderWith, unmount } = setup({ camera: 'legsSide', focus: KNEES_FOCUS, footage: footage() })
    resolveBlobs()
    rerenderWith({ footage: footage() })
    expect(plate()).toBeNull()
    expect(revoked).toEqual(['blob:plate-1'])
    resolveBlobs()
    expect(plate()?.getAttribute('href')).toBe('blob:plate-2')
    unmount()
    expect(revoked).toEqual(['blob:plate-1', 'blob:plate-2'])
  })
})

describe('ModelRunner pause with a limb focus', () => {
  it('stands a figure paused mid-cycle at its knee-flexion key phase', () => {
    setup({ camera: 'legsSide', focus: { metricIds: ['kneeFlexion'] } })
    const held = phaseForLeg('right', GAIT_PHASES.peakSwingKneeBend)
    advance(16)
    advance(300)
    const before = jointCx('right_ankle')
    fireEvent.click(screen.getByRole('button', { name: 'Pause runner' }))
    expect(jointCx('right_ankle')).not.toBe(before)
    expectPose(held, 'legsSide')
    // The knee arc lies on the knee it is about.
    const [centre] = pathEnds(
      document.querySelector('[data-annotation="peakSwingKneeBend"] [data-role="fill"]')?.getAttribute('d') ?? null,
    )
    expect(centre.x).toBeCloseTo(joint('right_knee').cx, 3)
    expect(centre.y).toBeCloseTo(joint('right_knee').cy, 3)
  })

  it('leaves a cadence focus paused where it is', () => {
    setup({ camera: 'wholeBodySide', focus: { metricIds: ['cadence'] } })
    advance(16)
    advance(300)
    const before = jointCx('right_ankle')
    fireEvent.click(screen.getByRole('button', { name: 'Pause runner' }))
    expect(jointCx('right_ankle')).toBe(before)
  })
})

describe('ModelRunner knee flexion, read as a bend from straight (strides-trn2.11)', () => {
  const KNEES: RunnerFocus = { metricIds: ['kneeFlexion'] }
  const held = phaseForLeg('right', GAIT_PHASES.peakSwingKneeBend)
  const style = (edge: string) => document.querySelector(`[data-edge="${edge}"]`)?.getAttribute('data-style')

  it('accents the measured leg’s thigh and shank only; the other leg keeps the figure’s own style', () => {
    setup({ camera: 'legsSide', focus: KNEES })
    expect(style('right_hip-right_knee')).toBe('focus')
    expect(style('right_knee-right_ankle')).toBe('focus')
    expect(style('left_hip-left_knee')).toBe('measured')
    expect(style('left_knee-left_ankle')).toBe('measured')
    expect(document.querySelectorAll('[data-edge][data-style="focus"]')).toHaveLength(2)
  })

  it('accents knee drive’s thigh alone, on the measured leg', () => {
    setup({ camera: 'legsSide', focus: { metricIds: ['kneeDrive'] } })
    expect(style('right_hip-right_knee')).toBe('focus')
    expect(style('right_knee-right_ankle')).toBe('measured')
    expect(style('left_hip-left_knee')).toBe('measured')
    expect(document.querySelectorAll('[data-edge][data-style="focus"]')).toHaveLength(1)
  })

  it('never accents a dashed thigh: with every thigh setting neutral, the thigh stays neutral', () => {
    setup({ params: bindOnly(['kneeFlexion']), camera: 'legsSide', focus: KNEES })
    expect(style('right_hip-right_knee')).toBe('neutral')
    expect(style('right_knee-right_ankle')).toBe('focus')
  })

  it('draws the straight-leg line dashed along the thigh and labels the value as a bend', () => {
    setup({ camera: 'legsSide', focus: KNEES })
    fireEvent.click(screen.getByRole('button', { name: 'Pause runner' }))
    expectPose(held, 'legsSide')
    const reference = document.querySelector('[data-annotation="peakSwingKneeBend"] [data-role="reference"]')
    expect(reference).not.toBeNull()
    expect(reference?.getAttribute('stroke-dasharray')).toBeTruthy()
    const [from, to] = pathEnds(reference?.getAttribute('d') ?? null)
    const hip = joint('right_hip')
    const knee = joint('right_knee')
    expect(from.x).toBeCloseTo(knee.cx, 3)
    expect(from.y).toBeCloseTo(knee.cy, 3)
    // Straight on from the thigh: hip, knee and the line's end are collinear, the end past the knee.
    const cross = (knee.cx - hip.cx) * (to.y - hip.cy) - (knee.cy - hip.cy) * (to.x - hip.cx)
    expect(cross).toBeCloseTo(0, 3)
    expect(Math.hypot(to.x - hip.cx, to.y - hip.cy)).toBeGreaterThan(
      Math.hypot(knee.cx - hip.cx, knee.cy - hip.cy),
    )
    const knees = bindAll().peakSwingKneeBend
    if (knees.source !== 'measured') throw new Error('knee flexion should be measured')
    const label = document.querySelector('[data-annotation="peakSwingKneeBend"] text')?.textContent
    expect(label).toBe(`${formatRunnerValue('kneeFlexion', knees.metricValue)} bend`)
  })

  it('rests on the peak bend for the dwell once a cycle while playing, within the thirty-frame cap', () => {
    setup({ camera: 'legsSide', focus: KNEES, playbackRate: 0.4, keyPhaseDwellMs: 500 })
    const projected = projectPose(poseAt(held, VALUES), 'legsSide')
    const atPeak = () =>
      COMMON_KEYPOINT_NAMES.every(
        (name, j) =>
          Math.abs(joint(name).cx - projected[j].x) < 1e-3 && Math.abs(joint(name).cy - projected[j].y) < 1e-3,
      )
    // Leave the mount's held frame first, so every stretch counted below is a rest.
    advance(200)
    expect(atPeak()).toBe(false)
    const stretches: number[] = []
    let run = 0
    let draws = 0
    let previous = joint('right_ankle')
    for (let t = 0; t < 6000; t += 16) {
      advance(16)
      const now = joint('right_ankle')
      if (now.cx !== previous.cx || now.cy !== previous.cy) draws += 1
      previous = now
      if (atPeak()) run += 16
      else if (run > 0) {
        stretches.push(run)
        run = 0
      }
    }
    // One cycle at 0.4× plus its rest: one rest per cycle.
    const cycleMs = 1000 / (cyclesPerSecond(VALUES) * 0.4) + 500
    expect(stretches.length).toBeGreaterThanOrEqual(Math.floor(5800 / cycleMs) - 1)
    expect(stretches.length).toBeLessThanOrEqual(Math.ceil(5800 / cycleMs))
    for (const ms of stretches) {
      expect(ms).toBeGreaterThanOrEqual(500 - 2 * FRAME_MS)
      expect(ms).toBeLessThanOrEqual(500 + 2 * FRAME_MS)
    }
    expect(draws).toBeLessThanOrEqual(6 * 30)
  })

  it('never rests without a dwell', () => {
    setup({ camera: 'legsSide', focus: KNEES, playbackRate: 0.4 })
    advance(16)
    let previous = joint('right_ankle')
    for (let t = 0; t < 3000; t += 100) {
      advance(100)
      const now = joint('right_ankle')
      expect(now.cx !== previous.cx || now.cy !== previous.cy).toBe(true)
      previous = now
    }
  })
})

describe('ModelRunner frames its cameras on the measured drawing (strides-trn2.11)', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  })
  const drawing = () => document.querySelector('[data-runner-part="drawing"]') as SVGSVGElement
  const groundY = () => Number(document.querySelector('[data-ground]')?.getAttribute('y1'))
  const legendShown = () => screen.queryByText('Dashed: not measured') !== null
  const STRIDE_FOCUS: RunnerFocus = { metricIds: ['cadence', 'verticalRatio'] }

  it('frames the stride view on a wide drawing, and the dashed legend still names the dashed head it shows', () => {
    mockReducedMotion(true)
    // The demo's stride: hip bounce 15.4% of torso over vertical ratio 2.46%, 6.26 torso lengths.
    const bound = bindAll({
      verticalOscillation: makeVerticalOscillation({ value: 0.154 }),
      verticalRatio: makeMetric('verticalRatio', { value: 0.0246 }),
    })
    const values = runnerParamValues(bound)
    setup({ params: bound, camera: 'strideSide', focus: STRIDE_FOCUS })
    // A drawing far wider than 3:4 (a landscape stage): the stride view fills it, and the whole
    // figure, its dashed head included, lies beyond the viewBox's left edge.
    resizeDrawing(700, 584, 'stage')
    resizeDrawing(700, 300)
    if (bound.strideLength.source !== 'measured') throw new Error('stride should be measured')
    // The runner rounds the measured frame to hundredths (4.667 → 4.67).
    const frame = { ...drawingFrame(700, 300), halfWidth: 4.67 }
    const camera = strideCamera(values, bound.strideLength.metricValue, {
      frame,
      pad: strideFramePad({ unitsPerPx: 1 / 146, headLabel: true, bounceLabel: false, strideLabelLines: 2 }),
      headLabel: true,
      bounceBracket: false,
    })
    expectPose(phaseForLeg('right', GAIT_PHASES.leftContact), camera, values)
    const dashedXs = Array.from(document.querySelectorAll('line[data-edge][data-style="neutral"]')).flatMap(
      (line) => [Number(line.getAttribute('x1')), Number(line.getAttribute('x2'))],
    )
    expect(dashedXs.length).toBeGreaterThan(0)
    expect(Math.max(...dashedXs)).toBeLessThan(-1.5)
    expect(Math.min(...dashedXs)).toBeGreaterThan(-frame.halfWidth)
    expect(legendShown()).toBe(true)
  })

  it('cuts to the whole-body frame on the first measurement, above the clear bottom the page states', () => {
    const onCameraRest = vi.fn()
    setup({ camera: 'wholeBodySide', onCameraRest })
    const preset = groundY()
    drawing().style.setProperty('--runner-clear-bottom', '0.15')
    resizeDrawing(390, 338)
    const frame = drawingFrame(390, 338, 0.15)
    expect(frame.clearBottom).toBe(0.15)
    const pad = wholeBodyFramePad({ unitsPerPx: 1 / 100, headLabel: false, beat: false, groundLabelLines: 0 })
    const framed = projectPoint({ x: 0, y: GROUND_Y, z: 0 }, wholeBodyCamera(VALUES, { frame, pad, headLabel: false })).y
    // At once, with no tween: the reader never sees the preset zoom out.
    expect(groundY()).toBeCloseTo(framed, 4)
    expect(groundY()).not.toBeCloseTo(preset, 2)
    expect(groundY()).toBeLessThanOrEqual(usableBottom(frame))
    expect(onCameraRest).toHaveBeenLastCalledWith('wholeBodySide')
  })

  it('tweens a later reframe and reports when the camera comes to rest', () => {
    const onCameraRest = vi.fn()
    setup({ camera: 'wholeBodySide', onCameraRest })
    resizeDrawing(390, 338)
    onCameraRest.mockClear()
    resizeDrawing(300, 600)
    const pad = wholeBodyFramePad({ unitsPerPx: 1 / 100, headLabel: false, beat: false, groundLabelLines: 0 })
    const target = projectPoint(
      { x: 0, y: GROUND_Y, z: 0 },
      wholeBodyCamera(VALUES, { frame: drawingFrame(300, 600), pad, headLabel: false }),
    ).y
    advance(16)
    advance(200)
    expect(groundY()).not.toBeCloseTo(target, 3)
    expect(onCameraRest).not.toHaveBeenCalled()
    advance(600)
    expect(groundY()).toBeCloseTo(target, 4)
    expect(onCameraRest).toHaveBeenCalledWith('wholeBodySide')
  })

  it('keeps one stride camera whether or not vertical ratio is in the focus, for a label shown approximately', () => {
    mockReducedMotion(true)
    // A bounce of half a torso length: its ×10 inset is capped, so vertical ratio's label has three lines.
    const params = bindAll({
      verticalOscillation: makeVerticalOscillation({ value: 0.5 }),
      verticalRatio: makeMetric('verticalRatio', { value: 0.08 }),
    })
    expect(strideLabelLineCount(params, runnerParamValues(params))).toBe(3)
    const { rerenderWith } = setup({ params, camera: 'strideSide', focus: { metricIds: ['cadence'] } })
    resizeDrawing(400, 400)
    const before = joint('nose')
    rerenderWith({ focus: STRIDE_FOCUS })
    expect(document.querySelector('[data-annotation="strideLength"] text')?.querySelectorAll('tspan')).toHaveLength(3)
    expect(joint('nose')).toEqual(before)
  })
})

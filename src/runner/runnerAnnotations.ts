/**
 * Value annotations for the model runner's focus area: an angle arc, a vertical bracket or a
 * horizontal offset, built as world-space polylines on a fixed key-phase pose so the renderer can
 * project them through the live camera every frame.
 *
 * **The geometry is the drawn value, exactly; the label is the metric's own value.** An arc sweeps
 * the parameter's drawn angle and a bracket or offset spans its drawn length, so the mark always
 * agrees with the figure. The label prints `metricValue`, the number the metric reported, and says
 * "drawn at limit" when the figure could not draw it (`clamped`). Pure: no React, no DOM.
 */
import { formatGuidedValue } from '../results/formatGuidedValue'
import type { MetricResult } from '../heuristics/types'
import { COMMON_KEYPOINT_NAMES, type KeypointName } from '../pose/types'
import { GAIT_PHASES, MODEL_PROPORTIONS, PELVIS_HEIGHT, poseAt } from './gaitModel'
import type { RunnerSources } from './runnerScene'
import type {
  BoundRunnerParams,
  Joint3D,
  RunnerMetricId,
  RunnerParamId,
  RunnerParams,
  Vec3,
} from './types'

export type AnnotationKind = 'angleArc' | 'bracket' | 'offset'

/** Each parameter's natural annotation. Cadence moves no geometry, so it has none. */
export const PARAM_ANNOTATION_KIND: Readonly<Record<RunnerParamId, AnnotationKind | null>> = {
  cadence: null,
  pelvisBounce: 'bracket',
  torsoPitch: 'angleArc',
  armSwing: 'bracket',
  peakThighAngle: 'angleArc',
  peakSwingKneeBend: 'angleArc',
  landingOffset: 'offset',
  contactShankOffset: 'offset',
  stepWidth: 'offset',
  swingFootArc: 'offset',
}

/** Each binding metric's `unit`, as its producing module in `src/heuristics/` reports it. */
export const RUNNER_METRIC_UNITS: Readonly<Record<RunnerMetricId, MetricResult['unit']>> = {
  cadence: 'stepsPerMinute',
  verticalOscillation: 'ratio',
  verticalOscillationCm: 'centimeters',
  trunkLean: 'degrees',
  armSwingAmplitude: 'ratio',
  kneeDrive: 'degrees',
  kneeFlexion: 'degrees',
  overstriding: 'ratio',
  footStrikePattern: 'ratio',
  stepWidth: 'percent',
  swingFootLateralExcursion: 'percent',
}

/** A metric's value as the guided cards print it (foot strike as its class). */
export function formatRunnerValue(metricId: RunnerMetricId, metricValue: number): string {
  return formatGuidedValue({ metric: metricId, value: metricValue, unit: RUNNER_METRIC_UNITS[metricId] })
}

export const CLAMPED_LABEL_SUFFIX = ' · drawn at limit'
const CLAMPED_LINE = 'drawn at limit'
const TORSO_UNIT = ' of torso length'

/**
 * The label as drawn, one entry per line: a "% of torso length" value breaks before its unit and
 * a clamp note takes its own line, so no label is wider than a phone-width frame can hold.
 */
export function labelLines(value: string, clamped: boolean): string[] {
  const lines = value.endsWith(TORSO_UNIT)
    ? [value.slice(0, -TORSO_UNIT.length), TORSO_UNIT.trim()]
    : [value]
  return clamped ? [...lines, CLAMPED_LINE] : lines
}

/** Which side of its projected anchor a label's block sits on. */
export type LabelSide = 'above' | 'below' | 'left' | 'right'

export interface RunnerAnnotationLabel {
  /** The whole label on one line. */
  text: string
  /** The label as drawn, one entry per line. */
  lines: readonly string[]
  /** World point the label hangs off. */
  anchor: Vec3
  side: LabelSide
}

type LabelPlacement = Pick<RunnerAnnotationLabel, 'anchor' | 'side'>

export interface RunnerAnnotation {
  paramId: RunnerParamId
  kind: AnnotationKind
  /** The value marks (arc, bracket and its ticks, offset line), drawn in the focus accent. */
  marks: readonly (readonly Vec3[])[]
  /** Reference rays and extension lines, drawn thin and solid. */
  guides: readonly (readonly Vec3[])[]
  label: RunnerAnnotationLabel
  clamped: boolean
}

export type RunnerSide = 'left' | 'right'

export interface AnnotationInput {
  bound: BoundRunnerParams
  /** What the figure draws (the bound values, or a ps19.3 mid-tween override). */
  values: RunnerParams
  sources: RunnerSources
  focusParams: readonly RunnerParamId[]
  /** Keep only annotations of this kind. Absent: every focus parameter's natural kind. */
  kind?: AnnotationKind
  /** The leg and arm nearer the camera, which carry the per-limb annotations. */
  nearSide: RunnerSide
}

const DEG = Math.PI / 180
const JOINT_INDEX = new Map(COMMON_KEYPOINT_NAMES.map((name, index) => [name, index]))

function joint(pose: readonly Joint3D[], name: KeypointName): Vec3 {
  const { x, y, z } = pose[JOINT_INDEX.get(name) as number]
  return { x, y, z }
}

function sideJoint(pose: readonly Joint3D[], side: RunnerSide, part: string): Vec3 {
  return joint(pose, `${side}_${part}` as KeypointName)
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
}

function fract(value: number): number {
  return value - Math.floor(value)
}

/** The cycle phase at which `side`'s leg is at its own leg phase `q`. */
function phaseForLeg(side: RunnerSide, q: number): number {
  return side === 'left' ? q : fract(q - 0.5)
}

/**
 * A point in the sagittal plane through `centre`, at `alphaDeg` from the DOWN vertical with
 * forward (+x, direction of travel) positive, `length` away.
 */
function ray(centre: Vec3, alphaDeg: number, length: number): Vec3 {
  return {
    x: centre.x + length * Math.sin(alphaDeg * DEG),
    y: centre.y - length * Math.cos(alphaDeg * DEG),
    z: centre.z,
  }
}

function arc(centre: Vec3, fromDeg: number, toDeg: number, radius: number): Vec3[] {
  const steps = Math.max(2, Math.ceil(Math.abs(toDeg - fromDeg) / 3))
  return Array.from({ length: steps + 1 }, (_, i) =>
    ray(centre, fromDeg + ((toDeg - fromDeg) * i) / steps, radius),
  )
}

/** Short end ticks across a vertical span, `half` either side. */
function verticalBracket(x: number, z: number, low: number, high: number, half: number) {
  return [
    [
      { x, y: low, z },
      { x, y: high, z },
    ],
    [
      { x: x - half, y: high, z },
      { x: x + half, y: high, z },
    ],
    [
      { x: x - half, y: low, z },
      { x: x + half, y: low, z },
    ],
  ]
}

const BRACKET_TICK_HALF = 0.03
const EXTENSION_OVERHANG = 0.04
const ARM_SAMPLES = 240

interface Built {
  marks: Vec3[][]
  guides: Vec3[][]
  label: LabelPlacement
}

type Builder = (value: number, values: RunnerParams, near: RunnerSide) => Built

const BUILDERS: Readonly<Record<Exclude<RunnerParamId, 'cadence'>, Builder>> = {
  torsoPitch(value, values) {
    const pose = poseAt(GAIT_PHASES.midStance, values)
    const hip = midpoint(joint(pose, 'left_hip'), joint(pose, 'right_hip'))
    const radius = 0.45
    const length = 0.85
    // Beside the vertical reference ray, on the side the torso does not lean to.
    const label: LabelPlacement = {
      anchor: ray(hip, 180, radius * 0.8),
      side: value >= 0 ? 'left' : 'right',
    }
    return {
      marks: [arc(hip, 180, 180 - value, radius)],
      guides: [
        [hip, ray(hip, 180, length)],
        [hip, ray(hip, 180 - value, length)],
      ],
      label,
    }
  },
  peakThighAngle(value, values, near) {
    const pose = poseAt(phaseForLeg(near, GAIT_PHASES.peakThigh), values)
    const hip = sideJoint(pose, near, 'hip')
    const radius = 0.35
    const length = MODEL_PROPORTIONS.thigh
    // At the arc's end on the thigh ray, outside the wedge.
    const label: LabelPlacement = {
      anchor: ray(hip, value, radius),
      side: value >= 0 ? 'right' : 'left',
    }
    return {
      marks: [arc(hip, 0, value, radius)],
      guides: [
        [hip, ray(hip, 0, length)],
        [hip, ray(hip, value, length)],
      ],
      label,
    }
  },
  peakSwingKneeBend(value, values, near) {
    const pose = poseAt(phaseForLeg(near, GAIT_PHASES.peakSwingKneeBend), values)
    const hip = sideJoint(pose, near, 'hip')
    const knee = sideJoint(pose, near, 'knee')
    // The thigh's own side-view direction: the continuation ray then lies exactly along it.
    const thighDeg = Math.atan2(knee.x - hip.x, -(knee.y - hip.y)) / DEG
    const shankDeg = thighDeg - value
    const radius = 0.3
    // At the arc's start on the thigh's continuation, on the side the shank does not fold to.
    const label: LabelPlacement = {
      anchor: ray(knee, thighDeg, radius),
      side: value >= 0 ? 'right' : 'left',
    }
    return {
      marks: [arc(knee, thighDeg, shankDeg, radius)],
      guides: [
        [hip, knee, ray(knee, thighDeg, 0.45)],
        [knee, ray(knee, shankDeg, MODEL_PROPORTIONS.shank)],
      ],
      label,
    }
  },
  pelvisBounce(value) {
    const x = -0.45
    const low = PELVIS_HEIGHT - value / 2
    const high = PELVIS_HEIGHT + value / 2
    return {
      marks: verticalBracket(x, 0, low, high, BRACKET_TICK_HALF),
      guides: [],
      label: { anchor: { x, y: PELVIS_HEIGHT, z: 0 }, side: 'left' },
    }
  },
  armSwing(value, values, near) {
    // The bracket spans the wrist's drop range below the shoulder, hung from the mid-stance
    // shoulder height. Its LENGTH is the drawn value exactly; its top is located by sampling.
    let highest = -Infinity
    let reach = -Infinity
    for (let i = 0; i < ARM_SAMPLES; i += 1) {
      const pose = poseAt(i / ARM_SAMPLES, values)
      const wrist = sideJoint(pose, near, 'wrist')
      highest = Math.max(highest, wrist.y - sideJoint(pose, near, 'shoulder').y)
      reach = Math.max(reach, wrist.x)
    }
    const shoulder = sideJoint(poseAt(GAIT_PHASES.midStance, values), near, 'shoulder')
    const x = reach + 0.15
    const high = shoulder.y + highest
    const low = high - value
    return {
      marks: verticalBracket(x, shoulder.z, low, high, BRACKET_TICK_HALF),
      guides: [],
      label: { anchor: { x, y: low, z: shoulder.z }, side: 'below' },
    }
  },
  landingOffset(_value, values, near) {
    const pose = poseAt(phaseForLeg(near, GAIT_PHASES.leftContact), values)
    const hip = midpoint(joint(pose, 'left_hip'), joint(pose, 'right_hip'))
    const ankle = sideJoint(pose, near, 'ankle')
    const y = -0.05
    const z = ankle.z
    const start = { x: hip.x, y, z }
    const end = { x: ankle.x, y, z }
    return {
      marks: [[start, end]],
      guides: [
        // The contact leg the offset is read from, then the two extension lines.
        [sideJoint(pose, near, 'hip'), sideJoint(pose, near, 'knee'), ankle],
        [
          { x: hip.x, y: hip.y, z },
          { x: hip.x, y: y - EXTENSION_OVERHANG, z },
        ],
        [ankle, { x: ankle.x, y: y - EXTENSION_OVERHANG, z }],
      ],
      label: { anchor: midpoint(start, end), side: 'below' },
    }
  },
  contactShankOffset(_value, values, near) {
    const pose = poseAt(phaseForLeg(near, GAIT_PHASES.leftContact), values)
    const knee = sideJoint(pose, near, 'knee')
    const ankle = sideJoint(pose, near, 'ankle')
    const y = (knee.y + ankle.y) / 2
    const z = ankle.z
    const start = { x: knee.x, y, z }
    const end = { x: ankle.x, y, z }
    return {
      marks: [[start, end]],
      guides: [
        [knee, ankle],
        [knee, { x: knee.x, y: y - EXTENSION_OVERHANG, z }],
        [ankle, { x: ankle.x, y: y + EXTENSION_OVERHANG, z }],
      ],
      label: { anchor: { x: Math.max(knee.x, ankle.x), y, z }, side: 'right' },
    }
  },
  stepWidth(_value, values, near) {
    const pose = poseAt(phaseForLeg(near, GAIT_PHASES.leftContact), values)
    const ankle = sideJoint(pose, near, 'ankle')
    const y = -0.06
    const start = { x: ankle.x, y, z: 0 }
    const end = { x: ankle.x, y, z: ankle.z }
    return {
      marks: [[start, end]],
      guides: [
        [
          { x: ankle.x, y: y - EXTENSION_OVERHANG, z: 0 },
          { x: ankle.x, y: 0.5, z: 0 },
        ],
        [ankle, { x: ankle.x, y: y - EXTENSION_OVERHANG, z: ankle.z }],
      ],
      label: { anchor: midpoint(start, end), side: 'below' },
    }
  },
  swingFootArc(value, values, near) {
    // Mid-arc, the ankle is at its widest; the span ends there and reaches back inward by the
    // drawn range. Its position is illustrative, its length exact.
    const pose = poseAt(phaseForLeg(near, 2 / 3), values)
    const ankle = sideJoint(pose, near, 'ankle')
    const outward = near === 'left' ? -1 : 1
    const width = value * MODEL_PROPORTIONS.hipWidth
    const start = { x: ankle.x, y: ankle.y, z: ankle.z - outward * width }
    const end = { ...ankle }
    const tick = (p: Vec3) => [
      { ...p, y: p.y - EXTENSION_OVERHANG },
      { ...p, y: p.y + EXTENSION_OVERHANG },
    ]
    return {
      marks: [[start, end], tick(start), tick(end)],
      guides: [],
      label: { anchor: midpoint(start, end), side: 'above' },
    }
  },
}

/**
 * The annotations for the measured focus parameters, in focus order. A neutral focus parameter
 * gets none (there is no measurement to annotate), nor does cadence, nor does a parameter whose
 * kind the `kind` filter excludes.
 */
export function buildAnnotations({
  bound,
  values,
  sources,
  focusParams,
  kind,
  nearSide,
}: AnnotationInput): RunnerAnnotation[] {
  const annotations: RunnerAnnotation[] = []
  for (const paramId of focusParams) {
    const param = bound[paramId]
    const natural = PARAM_ANNOTATION_KIND[paramId]
    if (paramId === 'cadence' || natural === null) continue
    if (param.source !== 'measured' || sources[paramId] !== 'measured') continue
    if (kind !== undefined && natural !== kind) continue
    const built = BUILDERS[paramId](values[paramId], values, nearSide)
    const value = formatRunnerValue(param.metricId, param.metricValue)
    annotations.push({
      paramId,
      kind: natural,
      marks: built.marks,
      guides: built.guides,
      label: {
        text: value + (param.clamped ? CLAMPED_LABEL_SUFFIX : ''),
        lines: labelLines(value, param.clamped),
        ...built.label,
      },
      clamped: param.clamped,
    })
  }
  return annotations
}

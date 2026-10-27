/**
 * Value annotations for the model runner's focus area: an angle arc, a vertical bracket or a
 * horizontal offset, built as world-space polylines so the renderer can project them through the
 * live camera every frame.
 *
 * **The geometry is the drawn value, exactly; the label is the metric's own value.** An arc sweeps
 * the parameter's drawn angle and a bracket or offset spans its drawn length, so the mark always
 * agrees with the figure. The label prints `metricValue`, the number the metric reported, and says
 * "shown approximately" when the figure could not draw it (`clamped`).
 *
 * **Annotations hang off the live figure, never a second one.** Each limb parameter is annotated
 * on the pose its metric reads (its key phase), and the renderer's still frame holds the first
 * annotated parameter's key phase, so that limb lies exactly on its mark. No limb-shaped guide is
 * drawn: a ghost leg beside the runner would read as a target pose. Guides are reference rays,
 * plumb lines from the joints a metric reads, and extension ticks only. Pure: no React, no DOM.
 *
 * **Cadence moves no geometry, so it is drawn as time: a footfall beat.** Its label sits above the
 * head and a ring pulses out from each foot's contact point at that foot's contact phase, so the
 * rings beat exactly as often as the figure's feet land (`beatEnvelope`).
 */
import { classifyFootStrike, type FootStrikeClass } from '../heuristics/footStrikePattern'
import { formatGuidedValue } from '../results/formatGuidedValue'
import { DEFAULT_HEURISTICS_CONFIG, type MetricResult } from '../heuristics/types'
import { COMMON_KEYPOINT_NAMES, type KeypointName } from '../pose/types'
import { GAIT_PHASES, GROUND_Y, MODEL_PROPORTIONS, pelvisHeight, poseAt } from './gaitModel'
import type { RunnerSources } from './runnerScene'
import type {
  BoundRunnerParams,
  Joint3D,
  RunnerMetricId,
  RunnerParamId,
  RunnerParams,
  Vec3,
} from './types'

export type AnnotationKind = 'angleArc' | 'bracket' | 'offset' | 'beat'

/** Each parameter's natural annotation. Cadence moves no geometry: it beats at the footfalls. */
export const PARAM_ANNOTATION_KIND: Readonly<Record<RunnerParamId, AnnotationKind | null>> = {
  cadence: 'beat',
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

/**
 * The LEG phase at which each limb parameter is read, so its annotation is drawn on the pose the
 * metric measures. The rest (torso, bounce, arms) read the same at any phase and are drawn at the
 * held phase.
 */
export const KEY_LEG_PHASE: Readonly<Record<RunnerParamId, number | null>> = {
  /** A footfall: a still figure holds the near foot planted on its beat tick. */
  cadence: GAIT_PHASES.leftContact,
  pelvisBounce: null,
  torsoPitch: null,
  armSwing: null,
  peakThighAngle: GAIT_PHASES.peakThigh,
  peakSwingKneeBend: GAIT_PHASES.peakSwingKneeBend,
  landingOffset: GAIT_PHASES.leftContact,
  contactShankOffset: GAIT_PHASES.leftContact,
  stepWidth: GAIT_PHASES.leftContact,
  /** Mid-arc: the swing-foot bump peaks halfway through its window. */
  swingFootArc: (GAIT_PHASES.swingArcStart + GAIT_PHASES.swingArcEnd) / 2,
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

/**
 * The runner's foot-strike wording: which part of the foot touches first, as an estimate (the
 * metric is a 2D proxy). The cards keep their own wording (`formatGuidedValue`); the class is the
 * same, from the same call.
 */
const FOOT_STRIKE_RUNNER_LABELS: Readonly<Record<FootStrikeClass, string>> = {
  heel: 'Heel first',
  midfoot: 'Midfoot first',
  forefoot: 'Forefoot first',
}

/**
 * A metric's value as the guided cards print it, except foot strike, which names its class as
 * the part of the foot that lands first ("Heel first (estimate)").
 */
export function formatRunnerValue(metricId: RunnerMetricId, metricValue: number): string {
  if (metricId === 'footStrikePattern') {
    const cls = classifyFootStrike(metricValue, DEFAULT_HEURISTICS_CONFIG.footStrikeMidfootBandRatio)
    return `${FOOT_STRIKE_RUNNER_LABELS[cls]} (estimate)`
  }
  return formatGuidedValue({ metric: metricId, value: metricValue, unit: RUNNER_METRIC_UNITS[metricId] })
}

const CLAMPED_LINE = 'shown approximately'
export const CLAMPED_LABEL_SUFFIX = ` · ${CLAMPED_LINE}`
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
  /**
   * Line pitches the block sits further out on `side`: a label stacked under the earlier labels
   * of the ground lane (`planAnnotations`). Absent: not stacked.
   */
  offsetLines?: number
}

type LabelPlacement = Pick<RunnerAnnotationLabel, 'anchor' | 'side'>

/** One footfall of the cadence beat: a ring that pulses out from `centre` at cycle phase `phase`. */
export interface BeatPulse {
  /** The cycle phase at which this foot lands. */
  phase: number
  /** The foot's contact point on the ground (world space). */
  centre: Vec3
}

export interface RunnerAnnotation {
  paramId: RunnerParamId
  kind: AnnotationKind
  /** The value marks (arc, bracket and its ticks, offset line), drawn in the focus accent. */
  marks: readonly (readonly Vec3[])[]
  /** Closed areas behind an arc (its wedge), drawn as a faint accent fill. */
  fills: readonly (readonly Vec3[])[]
  /** Short reference rays and extension ticks, drawn thin and solid. Never limb-shaped. */
  guides: readonly (readonly Vec3[])[]
  label: RunnerAnnotationLabel
  clamped: boolean
  /** The leg (or arm) the annotation sits on. */
  side: RunnerSide
  /**
   * The cycle phase the mark is built at, for a limb parameter; null for one that reads the same
   * at any phase (torso, bounce, arms). A still figure shows a limb mark only at this phase.
   */
  keyPhase: number | null
  /**
   * A beat's footfalls, one per foot (cadence only). The renderer pulses them only while the
   * figure plays and motion is allowed; still, the beat is its label and ground ticks.
   */
  pulses?: readonly BeatPulse[]
}

export type RunnerSide = 'left' | 'right'

export interface AnnotationInput {
  bound: BoundRunnerParams
  /** What the figure draws without a value tween (the bound values plus any static override). */
  values: RunnerParams
  sources: RunnerSources
  focusParams: readonly RunnerParamId[]
  /** Keep only annotations of this kind. Absent: every focus parameter's natural kind. */
  kind?: AnnotationKind
  /** The target camera's yaw: picks the near limb in a side view, the stance leg in a front one. */
  cameraYawDeg: number
  /**
   * The still frame without a keyed focus. Absent: mid-stance. The landing camera passes the near
   * leg's contact, so its still frame shows the landing whatever the focus.
   */
  heldPhaseWithoutKey?: number
}

export interface AnnotationPlan {
  /**
   * The phase the still frame holds (reduced motion, paused, first frame): the first annotated
   * focus parameter's key phase, so that limb lies exactly on its mark; mid-stance without one.
   */
  heldPhase: number
  annotations: RunnerAnnotation[]
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
export function phaseForLeg(side: RunnerSide, q: number): number {
  return side === 'left' ? fract(q) : fract(q - 0.5)
}

export function circularDistance(a: number, b: number): number {
  const d = fract(a - b)
  return Math.min(d, 1 - d)
}

/** The leg in the first (stance) half of its own cycle at `phase`. */
function stanceSide(phase: number): RunnerSide {
  return fract(phase) < 0.5 ? 'left' : 'right'
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

function verticalTick(x: number, y: number, z: number, half: number): Vec3[] {
  return [
    { x, y: y - half, z },
    { x, y: y + half, z },
  ]
}

const BRACKET_TICK_HALF = 0.03
const EXTENSION_OVERHANG = 0.04
/** Reference rays reach just past their arc. */
const RAY_OVERHANG = 0.12
const ARM_SAMPLES = 240

interface Built {
  marks: Vec3[][]
  fills: Vec3[][]
  guides: Vec3[][]
  label: LabelPlacement
  pulses?: BeatPulse[]
}

/** Above the head, clear of the figure's top. */
const HEAD_CLEARANCE = 0.25

/** Just above the head of `pose`: where cadence, which has no part of its own, is labelled. */
export function headTopAnchor(pose: readonly Joint3D[]): Vec3 {
  const nose = joint(pose, 'nose')
  const top = Math.max(nose.y, joint(pose, 'left_ear').y, joint(pose, 'right_ear').y)
  return { x: nose.x, y: top + HEAD_CLEARANCE, z: nose.z }
}

/** The ground point under `side`'s first contact: the lower of its heel and toe, at that foot's contact. */
function contactPoint(values: RunnerParams, side: RunnerSide): Vec3 {
  const pose = poseAt(phaseForLeg(side, GAIT_PHASES.leftContact), values)
  const heel = sideJoint(pose, side, 'heel')
  const toe = sideJoint(pose, side, 'foot_index')
  const first = toe.y < heel.y ? toe : heel
  return { x: first.x, y: GROUND_Y, z: first.z }
}

/** How far below the ground a footfall's tick reaches. Each tick is its pulse's guide, in order. */
const BEAT_TICK_DEPTH = 0.08

/** How much of a cycle a footfall's ring takes to fade out. */
export const BEAT_DECAY_CYCLES = 0.25

/**
 * A footfall ring's strength at cycle `phase` for a foot landing at `pulsePhase`: 1 at the
 * contact, easing to 0 over `BEAT_DECAY_CYCLES` (quadratically), and 0 until the next contact.
 * The renderer draws the ring largest and opaque at contact, shrinking as it fades, and flashes
 * the foot's tick in the accent at the same strength.
 */
export function beatEnvelope(phase: number, pulsePhase: number): number {
  const u = fract(phase - pulsePhase) / BEAT_DECAY_CYCLES
  return u >= 1 ? 0 : (1 - u) ** 2
}

interface BuildContext {
  side: RunnerSide
  /** The phase this annotation is drawn at: its key phase, or the held phase. */
  phase: number
}

type Builder = (value: number, values: RunnerParams, ctx: BuildContext) => Built

function angleArc(centre: Vec3, fromDeg: number, toDeg: number, radius: number) {
  const points = arc(centre, fromDeg, toDeg, radius)
  return {
    marks: [points],
    fills: [[centre, ...points]],
    guides: [
      [centre, ray(centre, fromDeg, radius + RAY_OVERHANG)],
      [centre, ray(centre, toDeg, radius + RAY_OVERHANG)],
    ],
  }
}

const BUILDERS: Readonly<Record<RunnerParamId, Builder>> = {
  cadence(_value, values, { phase }) {
    // One pulse per footfall: two per cycle, so the rings beat at the drawn cadence exactly.
    const pulses = (['left', 'right'] as const).map((side) => ({
      phase: phaseForLeg(side, GAIT_PHASES.leftContact),
      centre: contactPoint(values, side),
    }))
    return {
      marks: [],
      fills: [],
      guides: pulses.map(({ centre }) => [centre, { ...centre, y: GROUND_Y - BEAT_TICK_DEPTH }]),
      label: { anchor: headTopAnchor(poseAt(phase, values)), side: 'above' },
      pulses,
    }
  },
  torsoPitch(value, values, { phase }) {
    const pose = poseAt(phase, values)
    const hip = midpoint(joint(pose, 'left_hip'), joint(pose, 'right_hip'))
    const radius = 0.6
    return {
      ...angleArc(hip, 180, 180 - value, radius),
      // Beside the vertical reference ray, on the side the torso does not lean to.
      label: { anchor: ray(hip, 180, radius * 0.75), side: value >= 0 ? 'left' : 'right' },
    }
  },
  peakThighAngle(value, values, { side, phase }) {
    const hip = sideJoint(poseAt(phase, values), side, 'hip')
    const radius = 0.35
    return {
      ...angleArc(hip, 0, value, radius),
      // At the arc's end on the thigh, outside the wedge.
      label: { anchor: ray(hip, value, radius), side: value >= 0 ? 'right' : 'left' },
    }
  },
  peakSwingKneeBend(value, values, { side, phase }) {
    const pose = poseAt(phase, values)
    const hip = sideJoint(pose, side, 'hip')
    const knee = sideJoint(pose, side, 'knee')
    // The thigh's own side-view direction: the continuation ray then lies exactly along it.
    const thighDeg = Math.atan2(knee.x - hip.x, -(knee.y - hip.y)) / DEG
    const radius = 0.3
    return {
      ...angleArc(knee, thighDeg, thighDeg - value, radius),
      // At the arc's start on the thigh's continuation, on the side the shank does not fold to.
      label: { anchor: ray(knee, thighDeg, radius), side: value >= 0 ? 'right' : 'left' },
    }
  },
  pelvisBounce(value, values) {
    // Hip-mid's height runs exactly pelvisHeight ± bounce / 2 over the cycle.
    const x = -0.4
    const centre = pelvisHeight(values)
    const low = centre - value / 2
    const high = centre + value / 2
    return {
      marks: verticalBracket(x, 0, low, high, BRACKET_TICK_HALF),
      fills: [],
      guides: [],
      label: { anchor: { x, y: centre, z: 0 }, side: 'left' },
    }
  },
  armSwing(value, values, { side, phase }) {
    // The bracket spans the wrist's travel below the shoulder, hung from the held shoulder. Its
    // LENGTH is the drawn value exactly; its top is located by sampling the cycle.
    let highest = -Infinity
    let reach = -Infinity
    for (let i = 0; i < ARM_SAMPLES; i += 1) {
      const pose = poseAt(i / ARM_SAMPLES, values)
      const wrist = sideJoint(pose, side, 'wrist')
      highest = Math.max(highest, wrist.y - sideJoint(pose, side, 'shoulder').y)
      reach = Math.max(reach, wrist.x)
    }
    const shoulder = sideJoint(poseAt(phase, values), side, 'shoulder')
    const x = reach + 0.15
    const high = shoulder.y + highest
    const low = high - value
    return {
      marks: verticalBracket(x, shoulder.z, low, high, BRACKET_TICK_HALF),
      fills: [],
      guides: [],
      label: { anchor: { x, y: low, z: shoulder.z }, side: 'below' },
    }
  },
  landingOffset(_value, values, { side, phase }) {
    const pose = poseAt(phase, values)
    const hip = midpoint(joint(pose, 'left_hip'), joint(pose, 'right_hip'))
    const ankle = sideJoint(pose, side, 'ankle')
    const y = GROUND_Y - 0.05
    const z = ankle.z
    const start = { x: hip.x, y, z }
    const end = { x: ankle.x, y, z }
    return {
      marks: [[start, end]],
      fills: [],
      guides: [
        // The metric's two points, dropped to the mark: a plumb from hip-mid, and one from the
        // contact ankle (the metric reads the ankle, not the heel).
        [
          { x: hip.x, y: hip.y, z },
          { x: hip.x, y: y - EXTENSION_OVERHANG, z },
        ],
        [
          { x: ankle.x, y: ankle.y, z },
          { x: ankle.x, y: y - EXTENSION_OVERHANG, z },
        ],
      ],
      label: { anchor: midpoint(start, end), side: 'below' },
    }
  },
  contactShankOffset(_value, values, { side, phase }) {
    const pose = poseAt(phase, values)
    const knee = sideJoint(pose, side, 'knee')
    const ankle = sideJoint(pose, side, 'ankle')
    const heel = sideJoint(pose, side, 'heel')
    const toe = sideJoint(pose, side, 'foot_index')
    // The metric reads ankle.x − knee.x: the mark runs at ankle height from under the knee (a
    // plumb drops to it) to the ankle itself.
    const y = ankle.y
    const z = ankle.z
    const start = { x: knee.x, y, z }
    const end = { x: ankle.x, y, z }
    return {
      marks: [[start, end]],
      fills: [],
      guides: [
        [knee, { x: knee.x, y: y - EXTENSION_OVERHANG, z: knee.z }],
        verticalTick(ankle.x, y, z, 0.06),
      ],
      // Under the point the foot lands on: the heel heel-down, the toe on a forefoot strike.
      label: { anchor: toe.y < heel.y ? toe : heel, side: 'below' },
    }
  },
  stepWidth(_value, values, { side, phase }) {
    const pose = poseAt(phase, values)
    const ankle = sideJoint(pose, side, 'ankle')
    const hip = midpoint(joint(pose, 'left_hip'), joint(pose, 'right_hip'))
    const y = GROUND_Y - 0.06
    const start = { x: ankle.x, y, z: 0 }
    const end = { x: ankle.x, y, z: ankle.z }
    const bottom = y - EXTENSION_OVERHANG
    return {
      marks: [[start, end]],
      fills: [],
      guides: [
        // The midline, a plumb from hip-mid down past the mark.
        [
          { x: hip.x, y: hip.y, z: 0 },
          { x: hip.x, y: bottom, z: 0 },
        ],
        // A tick from the ground under each foot. The model is symmetric, so the other foot
        // plants at the mirror of this one; a planted ankle stands right above its tick.
        ...([1, -1] as const).map((s) => [
          { x: ankle.x, y: GROUND_Y, z: s * ankle.z },
          { x: ankle.x, y: bottom, z: s * ankle.z },
        ]),
      ],
      label: { anchor: midpoint(start, end), side: 'below' },
    }
  },
  swingFootArc(value, values, { side, phase }) {
    // Mid-arc, the ankle is at its widest; the span ends there and reaches back inward by the
    // drawn range. Its position is illustrative, its length exact.
    const ankle = sideJoint(poseAt(phase, values), side, 'ankle')
    const outward = side === 'left' ? -1 : 1
    const width = value * MODEL_PROPORTIONS.hipWidth
    const start = { x: ankle.x, y: ankle.y, z: ankle.z - outward * width }
    const end = { ...ankle }
    return {
      marks: [
        [start, end],
        verticalTick(start.x, start.y, start.z, EXTENSION_OVERHANG),
        verticalTick(end.x, end.y, end.z, EXTENSION_OVERHANG),
      ],
      fills: [],
      guides: [],
      label: { anchor: midpoint(start, end), side: 'above' },
    }
  },
}

/** Tolerance for "the figure is at this mark's key phase". */
const KEY_PHASE_TOLERANCE = 1e-6

/**
 * Whether a mark is drawn on a still figure held at `heldPhase`: a limb mark only when the figure
 * is at its key phase (otherwise it would float off the figure); the others always. While the
 * figure plays every mark is drawn, since the live limb passes through each key phase.
 */
export function shownWhileStill(annotation: RunnerAnnotation, heldPhase: number): boolean {
  return (
    annotation.keyPhase === null ||
    circularDistance(annotation.keyPhase, heldPhase) < KEY_PHASE_TOLERANCE
  )
}

/**
 * The held phase and the annotations for the measured focus parameters, in focus order. A
 * neutral focus parameter gets none (there is no measurement to annotate), nor does a parameter
 * whose kind the `kind` filter excludes.
 *
 * The held phase is always taken on the leg a side view would call near (cos yaw >= 0: right),
 * front views included, so a camera change never moves the held phase by half a stride. Side
 * views annotate the near limbs; front views (|cos yaw| < 0.5) put each limb mark on the leg that
 * is at its key phase nearest the held phase (the held leg for the first), arms on the stance side.
 */
export function planAnnotations({
  bound,
  values,
  sources,
  focusParams,
  kind,
  cameraYawDeg,
  heldPhaseWithoutKey,
}: AnnotationInput): AnnotationPlan {
  const eligible = focusParams.filter((paramId) => {
    const natural = PARAM_ANNOTATION_KIND[paramId]
    return (
      natural !== null &&
      bound[paramId].source === 'measured' &&
      sources[paramId] === 'measured' &&
      (kind === undefined || natural === kind)
    )
  })
  const cosYaw = Math.cos(cameraYawDeg * DEG)
  const frontal = Math.abs(cosYaw) < 0.5
  const near: RunnerSide = cosYaw >= 0 ? 'right' : 'left'
  const keyed = eligible.find((paramId) => KEY_LEG_PHASE[paramId] !== null)
  const heldPhase =
    keyed === undefined
      ? (heldPhaseWithoutKey ?? GAIT_PHASES.midStance)
      : phaseForLeg(near, KEY_LEG_PHASE[keyed] as number)
  const sideFor = (paramId: RunnerParamId): RunnerSide => {
    if (!frontal) return near
    const q = KEY_LEG_PHASE[paramId]
    if (q === null) return stanceSide(heldPhase)
    return circularDistance(phaseForLeg('left', q), heldPhase) <=
      circularDistance(phaseForLeg('right', q), heldPhase)
      ? 'left'
      : 'right'
  }

  const annotations = eligible.flatMap((paramId): RunnerAnnotation[] => {
    const param = bound[paramId]
    if (param.source !== 'measured') return []
    const side = sideFor(paramId)
    const q = KEY_LEG_PHASE[paramId]
    const phase = q === null ? heldPhase : phaseForLeg(side, q)
    const built = BUILDERS[paramId](values[paramId], values, { side, phase })
    const value = formatRunnerValue(param.metricId, param.metricValue)
    const annotation: RunnerAnnotation = {
      paramId,
      kind: PARAM_ANNOTATION_KIND[paramId] as AnnotationKind,
      marks: built.marks,
      fills: built.fills,
      guides: built.guides,
      label: {
        text: value + (param.clamped ? CLAMPED_LABEL_SUFFIX : ''),
        lines: labelLines(value, param.clamped),
        ...built.label,
      },
      clamped: param.clamped,
      side,
      keyPhase: q === null ? null : phase,
      ...(built.pulses ? { pulses: built.pulses } : {}),
    }
    return [annotation]
  })
  return { heldPhase, annotations: stackGroundLane(annotations) }
}

/** A label hanging below a point on or under the ground sits in the ground lane. */
function inGroundLane(label: RunnerAnnotationLabel): boolean {
  return label.side === 'below' && label.anchor.y <= GROUND_Y + GROUND_LANE_TOLERANCE
}

const GROUND_LANE_TOLERANCE = 1e-9

/**
 * Two or more ground-lane labels (overstride under its mark, foot strike under the heel) would
 * print over each other: they stack in focus order as one block, centred under the first one's
 * anchor at the lane's lowest anchor height, each below the lines of the ones before it and half a
 * line clear of them. A lone
 * ground-lane label keeps its own anchor.
 */
/** Extra gap between stacked labels, in lines, so the second never reads as the first's tail. */
export const STACK_GAP_LINES = 0.5

function stackGroundLane(annotations: RunnerAnnotation[]): RunnerAnnotation[] {
  const lane = annotations.filter((a) => inGroundLane(a.label))
  if (lane.length < 2) return annotations
  const laneX = lane[0].label.anchor.x
  const laneY = Math.min(...lane.map((a) => a.label.anchor.y))
  let offsetLines = 0
  return annotations.map((a) => {
    if (!inGroundLane(a.label)) return a
    const label = { ...a.label, anchor: { ...a.label.anchor, x: laneX, y: laneY }, offsetLines }
    offsetLines += a.label.lines.length + STACK_GAP_LINES
    return { ...a, label }
  })
}

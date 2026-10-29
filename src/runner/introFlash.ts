/**
 * Where the intro's value flash goes (ps19.3). It is anchored on a world point per parameter,
 * taken from the still-frame pose when its step starts, so it never chases the stride; it is then
 * kept clear of every visible annotation label and inside the frame.
 */
import { projectPoint } from './camera'
import { GROUND_Y, poseAt } from './gaitModel'
import { headTopAnchor } from './runnerAnnotations'
import {
  LABEL_CHAR_WIDTH_EM,
  LABEL_LINE_HEIGHT,
  VIEW_HALF_HEIGHT,
  clampLabelX,
  type LabelAlign,
} from './runnerScene'
import type { KeypointName } from '../pose/types'
import type { CameraState, Joint3D, RunnerParamId, RunnerParams, Vec3 } from './types'

function at(pose: readonly Joint3D[], name: KeypointName): Vec3 {
  const joint = pose.find((j) => j.name === name)
  if (!joint) throw new Error(`no joint ${name}`)
  return { x: joint.x, y: joint.y, z: joint.z }
}

function mid(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
}

/**
 * The world point a parameter's flash sits beside: the near ankle (foot strike, swing arc), the
 * ground under the hip (landing), the hip (bounce, step width, stride), the torso midpoint (lean),
 * the near shoulder (arms), the near knee (thigh, knee bend), and just above the head (cadence,
 * which has no part of its own). Taken from the pose at `heldPhase`, so it does not move with the
 * stride; "near" is the leg a side view shows nearer, as for the held phase. The stride never
 * flashes (the intro gives it no step), but every parameter has an anchor.
 */
export function flashAnchor(
  paramId: RunnerParamId,
  values: RunnerParams,
  heldPhase: number,
  cameraYawDeg: number,
): Vec3 {
  const pose = poseAt(heldPhase, values)
  const near = Math.cos((cameraYawDeg * Math.PI) / 180) >= 0 ? 'right' : 'left'
  const hip = mid(at(pose, 'left_hip'), at(pose, 'right_hip'))
  const shoulder = mid(at(pose, 'left_shoulder'), at(pose, 'right_shoulder'))
  switch (paramId) {
    case 'cadence':
      return headTopAnchor(pose)
    case 'pelvisBounce':
    case 'stepWidth':
    case 'strideLength':
      return hip
    case 'torsoPitch':
      return mid(hip, shoulder)
    case 'armSwing':
      return at(pose, `${near}_shoulder`)
    case 'peakThighAngle':
    case 'peakSwingKneeBend':
      return at(pose, `${near}_knee`)
    case 'landingOffset':
      return { x: hip.x, y: GROUND_Y, z: hip.z }
    case 'contactShankOffset':
    case 'swingFootArc':
      return at(pose, `${near}_ankle`)
  }
}

/**
 * How the flash aligns to its anchor: the lean flash goes on the torso's back side (text ending
 * at the anchor) so it never sits on the arms swinging in front; every other flash starts there.
 */
export function flashAlign(paramId: RunnerParamId, camera: CameraState): 'start' | 'end' {
  if (paramId !== 'torsoPitch') return 'start'
  const ahead = projectPoint({ x: 1, y: 0, z: 0 }, camera).x - projectPoint({ x: 0, y: 0, z: 0 }, camera).x
  return ahead >= 0 ? 'end' : 'start'
}

/** A text block's box in viewBox units (y down). */
export interface LabelBox {
  left: number
  right: number
  top: number
  bottom: number
}

export function labelBox(
  x: number,
  align: LabelAlign,
  ys: readonly number[],
  chars: number,
  fontUnits: number,
): LabelBox {
  const width = chars * fontUnits * LABEL_CHAR_WIDTH_EM
  const left = align === 'start' ? x : align === 'middle' ? x - width / 2 : x - width
  const half = (fontUnits * LABEL_LINE_HEIGHT) / 2
  return { left, right: left + width, top: Math.min(...ys) - half, bottom: Math.max(...ys) + half }
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/** The bounding box of projected path points (an annotation mark or guide). */
export function pointsBox(points: readonly { x: number; y: number }[]): LabelBox | null {
  if (points.length === 0) return null
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
}

/**
 * The flash's position (vertically centred): `gapUnits` beyond the projected anchor on the side
 * `align` gives ('start': right of it, 'end': left of it), inside the frame, and moved below (or,
 * at the frame's foot, above) any box it would cover, with half a line of clearance.
 */
export function placeFlash(
  point: { x: number; y: number },
  align: 'start' | 'end',
  chars: number,
  fontUnits: number,
  gapUnits: number,
  avoid: readonly LabelBox[],
): { x: number; y: number } {
  const lineHeight = fontUnits * LABEL_LINE_HEIGHT
  const limit = VIEW_HALF_HEIGHT - lineHeight / 2
  const clampY = (y: number) => Math.min(limit, Math.max(-limit, y))
  const x = clampLabelX(point.x + (align === 'start' ? gapUnits : -gapUnits), align, chars, fontUnits)
  let y = clampY(point.y)
  const pad = lineHeight / 2
  for (let attempt = 0; attempt <= avoid.length; attempt++) {
    const box = labelBox(x, align, [y], chars, fontUnits)
    const hit = avoid.find((other) => overlaps(box, other))
    if (!hit) break
    const below = hit.bottom + pad + lineHeight / 2
    y = below <= limit ? below : clampY(hit.top - pad - lineHeight / 2)
  }
  return { x, y }
}

import { describe, expect, it } from 'vitest'
import type { KeypointName } from '../pose/types'
import { projectPose } from './camera'
import { poseAt } from './gaitModel'
import { NEUTRAL_RUNNER_PARAMS } from './runnerParams'
import { VIEW_HALF_WIDTH } from './runnerScene'

/**
 * The arms stop's camera (`armsQuarter`, strides-eiil.4): seen 15° off the side, the sagittal arm
 * swing must read fore-and-aft, never as arms crossing the body's midline.
 */
describe('armsQuarter: the arm swing reads fore-and-aft, never as arms crossing the midline', () => {
  type Point = { x: number; y: number }

  function insideQuad(p: Point, quad: readonly Point[]): boolean {
    let inside = false
    for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
      const a = quad[i]
      const b = quad[j]
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
    }
    return inside
  }

  function segmentDistance(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)))
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
  }

  /** Distance from `p` to the quad's outline, viewBox units: negative inside. */
  function outlineGap(p: Point, quad: readonly Point[]): number {
    const distance = Math.min(...quad.map((a, i) => segmentDistance(p, a, quad[(i + 1) % quad.length])))
    return insideQuad(p, quad) ? -distance : distance
  }

  const PHASES = Array.from({ length: 400 }, (_, i) => i / 400)
  // A front reading and a pinned side reading (above v* ≈ 0.523), at the neutral and a backward lean.
  const CASES = [0.335, 0.5627].flatMap((armSwing) => [4, -15].map((torsoPitch) => ({ armSwing, torsoPitch })))

  /** The near (right) elbow's and the far wrist's closest approach to the projected shoulder–hip quad. */
  function approaches(armSwing: number, torsoPitch: number) {
    const params = { ...NEUTRAL_RUNNER_PARAMS, armSwing, torsoPitch }
    let backswing = Infinity
    let forwardSwing = Infinity
    let farWrist = Infinity
    for (const phase of PHASES) {
      const world = poseAt(phase, params)
      const at = (name: KeypointName) => world.find((j) => j.name === name)!
      const shoulder = at('right_shoulder')
      const hip = at('right_hip')
      const elbow = at('right_elbow')
      // Which side of the sagittal shoulder→hip line the near elbow is on: > 0 is forward of it.
      const forward =
        (hip.x - shoulder.x) * (elbow.y - shoulder.y) - (hip.y - shoulder.y) * (elbow.x - shoulder.x) > 0
      const screen = projectPose(world, 'armsQuarter')
      const on = (name: KeypointName) => screen.find((j) => j.name === name)!
      const torso = [on('right_shoulder'), on('left_shoulder'), on('left_hip'), on('right_hip')]
      const elbowGap = outlineGap(on('right_elbow'), torso)
      if (forward) forwardSwing = Math.min(forwardSwing, elbowGap)
      else backswing = Math.min(backswing, elbowGap)
      farWrist = Math.min(farWrist, outlineGap(on('left_wrist'), torso))
    }
    return { backswing, forwardSwing, farWrist }
  }

  it('sits on the runner’s right, so the right arm is the near one', () => {
    const screen = projectPose(poseAt(0, NEUTRAL_RUNNER_PARAMS), 'armsQuarter')
    const depth = (name: KeypointName) => screen.find((j) => j.name === name)!.depth
    expect(depth('right_shoulder')).toBeGreaterThan(depth('left_shoulder'))
  })

  it('keeps the near elbow’s backswing outside the torso outline', () => {
    for (const { armSwing, torsoPitch } of CASES) {
      expect(approaches(armSwing, torsoPitch).backswing, `${armSwing} @ ${torsoPitch}°`).toBeGreaterThan(0)
    }
  })

  it('lets the near elbow’s forward swing overlap the chest by at most 0.15', () => {
    // The arm swings at the near shoulder's depth, so seen off the side its forward swing is drawn
    // over the chest, in front of it by depth order (runnerScene.test.ts). At 45° it reached 0.30.
    for (const { armSwing, torsoPitch } of CASES) {
      expect(approaches(armSwing, torsoPitch).forwardSwing, `${armSwing} @ ${torsoPitch}°`).toBeGreaterThanOrEqual(
        -0.15,
      )
    }
  })

  it('keeps the far wrist outside the torso outline', () => {
    // Except the pinned swing at a −15° (backward) lean: its wrist hangs straight under a shoulder
    // the hips have moved ahead of, so it lies inside the far half of the outline at ANY yaw off the
    // side (−0.07 at 10°, −0.10 at 15°, −0.13 at 20°). That is the lean's geometry, not the camera.
    for (const { armSwing, torsoPitch } of CASES.filter((c) => !(c.armSwing > 0.523 && c.torsoPitch < 0))) {
      expect(approaches(armSwing, torsoPitch).farWrist, `${armSwing} @ ${torsoPitch}°`).toBeGreaterThan(0)
    }
  })

  it('frames both arms over the whole cycle within the narrowest stage’s width', () => {
    for (const armSwing of [0.335, 0.5627]) {
      for (const phase of PHASES) {
        for (const j of projectPose(poseAt(phase, { ...NEUTRAL_RUNNER_PARAMS, armSwing }), 'armsQuarter')) {
          if (!/shoulder|elbow|wrist/.test(j.name)) continue
          expect(Math.abs(j.x), `${armSwing} ${j.name} ${phase}`).toBeLessThan(VIEW_HALF_WIDTH)
        }
      }
    }
  })
})

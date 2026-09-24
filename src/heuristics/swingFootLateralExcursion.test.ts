import { describe, expect, it } from 'vitest'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { computeSwingFootLateralExcursion } from './swingFootLateralExcursion'
import { computeStepWidth } from './stepWidth'
import { detectFootstrikes } from './footstrikes'
import { DEFAULT_HEURISTICS_CONFIG } from './types'

function gait(view: 'front' | 'side'): RobustPoseFrame[] {
  return generateSyntheticGait({
    durationSec: 4,
    fps: 60,
    cadenceStepsPerMin: 170,
    strideAmplitudePx: 80,
    verticalBouncePx: 20,
    trunkLeanDeg: 5,
    view,
  })
}

function withFootPath(frames: RobustPoseFrame[], amplitude: number): RobustPoseFrame[] {
  return frames.map((frame, index) => {
    const knees = Object.fromEntries(
      frame.keypoints.filter((point) => point.name.endsWith('_knee')).map((point) => [point.name, point.x]),
    )
    const hips = frame.keypoints.filter((point) => point.name.endsWith('_hip'))
    const hipWidth = Math.abs(hips[0].x! - hips[1].x!)
    const offset = amplitude * Math.sin(index * 0.3)
    return {
      ...frame,
      keypoints: frame.keypoints.map((point) => {
        if (point.name !== 'left_ankle' && point.name !== 'right_ankle') return point
        const kneeName = point.name === 'left_ankle' ? 'left_knee' : 'right_knee'
        return { ...point, x: knees[kneeName]! + hipWidth * offset }
      }),
    }
  })
}

describe('computeSwingFootLateralExcursion', () => {
  it('measures sideways ankle travel during complete swings, independent of a constant foot placement', () => {
    const baseline = computeSwingFootLateralExcursion(withFootPath(gait('front'), 0), 'front')
    const moving = computeSwingFootLateralExcursion(withFootPath(gait('front'), 0.3), 'front')

    expect(baseline.value).toBe(0)
    expect(moving.value).not.toBeNull()
    expect(moving.value!).toBeGreaterThan(0.1)
    expect(moving.sampleSize).toBeGreaterThan(0)
    expect(moving.viewFit).toBe('primary')
    expect(moving.unit).toBe('percent')
    expect(moving.exemplars?.[0]).toMatchObject({ kind: 'swingFootLateralRange' })
    expect(moving.exemplars?.[0].pairedTimestamp).toBeDefined()
    expect(moving.exemplars).toHaveLength(2)
  })

  it('reports the same excursion after a horizontal mirror, as for a rear recording', () => {
    const front = withFootPath(gait('front'), 0.3)
    const mirrored = front.map((frame) => ({
      ...frame,
      keypoints: frame.keypoints.map((point) => ({
        ...point,
        x: point.x === null ? null : 1000 - point.x,
      })),
    }))
    const frontResult = computeSwingFootLateralExcursion(front, 'front')
    const rearResult = computeSwingFootLateralExcursion(mirrored, 'front')

    expect(frontResult.value).not.toBeNull()
    expect(rearResult.value).toBeCloseTo(frontResult.value!, 10)
    expect(rearResult.sampleSize).toBe(frontResult.sampleSize)
    expect(rearResult.viewFit).toBe('primary')
  })

  it('measures the swing path independently of step width at footstrike', () => {
    const baseline = withFootPath(gait('front'), 0)
    const strikes = detectFootstrikes(baseline, DEFAULT_HEURISTICS_CONFIG)
    const swingSideByFrame = new Map<number, 'left' | 'right'>()
    for (let strikeIndex = 1; strikeIndex < strikes.length; strikeIndex += 1) {
      const start = strikes[strikeIndex - 1]
      const end = strikes[strikeIndex]
      if (start.side === end.side) continue
      const guard = end.timestamp - (end.timestamp - start.timestamp) / 3
      for (let index = start.frameIndex + 1; index < end.frameIndex; index += 1) {
        if (baseline[index].timestamp < guard) swingSideByFrame.set(index, end.side)
      }
    }
    const swingChanged = baseline.map((frame, index) => {
      const side = swingSideByFrame.get(index)
      if (side === undefined) return frame
      const knee = frame.keypoints.find((point) => point.name === `${side}_knee`)!
      const leftHip = frame.keypoints.find((point) => point.name === 'left_hip')!
      const rightHip = frame.keypoints.find((point) => point.name === 'right_hip')!
      const hipWidth = Math.abs(leftHip.x! - rightHip.x!)
      return {
        ...frame,
        keypoints: frame.keypoints.map((point) => point.name === `${side}_ankle`
          ? { ...point, x: knee.x! + 0.3 * hipWidth * Math.sin(index * 0.3) }
          : point),
      }
    })

    expect(detectFootstrikes(swingChanged, DEFAULT_HEURISTICS_CONFIG).map((strike) => strike.frameIndex))
      .toEqual(strikes.map((strike) => strike.frameIndex))
    expect(computeStepWidth(swingChanged, 'front').value)
      .toBe(computeStepWidth(baseline, 'front').value)
    expect(computeSwingFootLateralExcursion(baseline, 'front').value).toBe(0)
    expect(computeSwingFootLateralExcursion(swingChanged, 'front').value).toBeGreaterThan(0.1)

    const strikeSideByFrame = new Map(strikes.map((strike) => [strike.frameIndex, strike.side]))
    const strikeChanged = baseline.map((frame, index) => {
      const side = strikeSideByFrame.get(index)
      if (side === undefined) return frame
      const hipMid = (
        frame.keypoints.find((point) => point.name === 'left_hip')!.x! +
        frame.keypoints.find((point) => point.name === 'right_hip')!.x!
      ) / 2
      return {
        ...frame,
        keypoints: frame.keypoints.map((point) => point.name === `${side}_ankle`
          ? { ...point, x: point.x! + (point.x! < hipMid ? -30 : 30) }
          : point),
      }
    })
    expect(detectFootstrikes(strikeChanged, DEFAULT_HEURISTICS_CONFIG).map((strike) => strike.frameIndex))
      .toEqual(strikes.map((strike) => strike.frameIndex))
    expect(computeStepWidth(strikeChanged, 'front').value)
      .toBeGreaterThan(computeStepWidth(baseline, 'front').value!)
    expect(computeSwingFootLateralExcursion(strikeChanged, 'front').value).toBe(0)
  })

  it('gates a side view as unsuitable', () => {
    const result = computeSwingFootLateralExcursion(withFootPath(gait('front'), 0.3), 'side')
    expect(result.viewFit).toBe('unsuitable')
    expect(result.caveat).toContain('not reliable from a side view')
  })

  it('returns null when the interior knee track is unavailable', () => {
    const frames = gait('front').map((frame) => ({
      ...frame,
      keypoints: frame.keypoints.map((point) =>
        point.name.endsWith('_knee')
          ? { ...point, x: null, y: null, status: 'unrecoverable' as const }
          : point,
      ),
    }))
    const result = computeSwingFootLateralExcursion(frames, 'front')
    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.sampleSize).toBe(0)
  })

  it('excludes an interpolated extreme exactly as if that point were missing', () => {
    const frames = withFootPath(gait('front'), 0.3)
    const strikes = detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG)
    const index = Math.floor((strikes[0].frameIndex + strikes[1].frameIndex) / 2)
    const ankleName = `${strikes[1].side}_ankle`
    const change = (status: 'interpolated' | 'unrecoverable') => frames.map((frame, i) =>
      i !== index ? frame : {
        ...frame,
        keypoints: frame.keypoints.map((point) => point.name !== ankleName ? point : {
          ...point,
          x: status === 'interpolated' ? 10000 : null,
          y: status === 'interpolated' ? point.y : null,
          status,
        }),
      },
    )
    const interpolated = computeSwingFootLateralExcursion(change('interpolated'), 'front')
    const missing = computeSwingFootLateralExcursion(change('unrecoverable'), 'front')
    expect(interpolated.value).toBe(missing.value)
    expect(interpolated.frameCoverage).toBe(missing.frameCoverage)
  })

  it('reports a guarded range at ordinary 30 fps, but abstains when fewer than six direct samples remain', () => {
    const frames = withFootPath(gait('front'), 0.3)
    const at30Fps = frames.filter((_, index) => index % 2 === 0)
    const at15Fps = frames.filter((_, index) => index % 4 === 0)
    const measured = computeSwingFootLateralExcursion(at30Fps, 'front')
    const result = computeSwingFootLateralExcursion(at15Fps, 'front')
    expect(measured.value).not.toBeNull()
    expect(measured.sampleSize).toBeGreaterThan(0)
    expect(result.value).toBeNull()
    expect(result.sampleSize).toBe(0)
  })

  it('one directly detected extreme cannot control either trimmed quantile', () => {
    const frames = withFootPath(gait('front'), 0)
    const strikes = detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG)
    const start = strikes[0]
    const end = strikes[1]
    const index = start.frameIndex + 2
    const contaminated = frames.map((frame, i) => i !== index ? frame : {
      ...frame,
      keypoints: frame.keypoints.map((point) => point.name === `${end.side}_ankle`
        ? { ...point, x: point.x! + 500 }
        : point),
    })
    const result = computeSwingFootLateralExcursion(contaminated, 'front')
    expect(result.value).toBe(0)
  })

  it('does not let late-contact or stance frames supply the swing range', () => {
    const frames = withFootPath(gait('front'), 0)
    const strikes = detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG)
    const contaminated = frames.map((frame, index) => {
      const lateWindow = strikes.slice(1).find((end, strikeIndex) => {
        const start = strikes[strikeIndex]
        const guard = end.timestamp - (end.timestamp - start.timestamp) / 3
        return start.side !== end.side &&
          index > start.frameIndex && index < end.frameIndex &&
          frame.timestamp >= guard
      })
      if (lateWindow === undefined) return frame
      const ankleName = `${lateWindow.side}_ankle`
      return {
        ...frame,
        keypoints: frame.keypoints.map((point) =>
          point.name === ankleName ? { ...point, x: point.x! + 500 } : point,
        ),
      }
    })
    const result = computeSwingFootLateralExcursion(contaminated, 'front')
    expect(result.sampleSize).toBeGreaterThan(0)
    expect(result.value).toBe(0)
    expect(result.exemplars).toBeUndefined()
  })

  it('discards a detected opposite-side interval spanning three steps after two missed strikes', () => {
    const frames = withFootPath(gait('front'), 0.3)
    const originalStrikes = detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG)
    const missingTimes = [originalStrikes[3].timestamp, originalStrikes[4].timestamp]
    const withMissingStrikes = frames.filter((frame) =>
      missingTimes.every((time) => Math.abs(frame.timestamp - time) > 0.06),
    )
    const remainingStrikes = detectFootstrikes(withMissingStrikes, DEFAULT_HEURISTICS_CONFIG)
    const intervals = remainingStrikes.slice(1).map((end, index) => ({
      start: remainingStrikes[index], end,
    })).filter(({ start, end }) => start.side !== end.side)
    const expectedStep = 60 / 170
    const oneStepCeiling = (2 * expectedStep) / 1.15
    expect(intervals.some(({ start, end }) => end.timestamp - start.timestamp > 2 * expectedStep))
      .toBe(true)
    const validSingleSteps = intervals.filter(({ start, end }) =>
      end.timestamp - start.timestamp < oneStepCeiling,
    ).length
    const result = computeSwingFootLateralExcursion(withMissingStrikes, 'front')
    expect(result.sampleSize).toBe(validSingleSteps)
  })

  it('treats a tiny positive hip width like an unresolvable denominator', () => {
    const frames = withFootPath(gait('front'), 0.3)
    const strikes = detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG)
    const index = Math.floor((strikes[0].frameIndex + strikes[1].frameIndex) / 2)
    const change = (tiny: boolean) => frames.map((frame, i) => i !== index ? frame : {
      ...frame,
      keypoints: frame.keypoints.map((point) => point.name !== 'right_hip' ? point : {
        ...point,
        x: tiny ? frame.keypoints.find((keypoint) => keypoint.name === 'left_hip')!.x! + 1 : null,
        y: tiny ? point.y : null,
        status: tiny ? point.status : 'unrecoverable' as const,
      }),
    })
    const tiny = computeSwingFootLateralExcursion(change(true), 'front')
    const missing = computeSwingFootLateralExcursion(change(false), 'front')
    expect(tiny.value).toBe(missing.value)
    expect(tiny.frameCoverage).toBe(missing.frameCoverage)
  })

  it('rejects a collapsed hip-width frame and prices rejected windows in confidence', () => {
    const frames = withFootPath(gait('front'), 0.3)
    const clean = computeSwingFootLateralExcursion(frames, 'front')
    const degraded = frames.map((frame, index) => ({
      ...frame,
      keypoints: frame.keypoints.map((point) => {
        if (index > frames.length / 2 && point.name.endsWith('_knee')) {
          return { ...point, x: null, y: null, status: 'unrecoverable' as const }
        }
        if (index === 30 && point.name === 'right_hip') {
          const leftHip = frame.keypoints.find((keypoint) => keypoint.name === 'left_hip')!
          return { ...point, x: leftHip.x }
        }
        return point
      }),
    }))
    const result = computeSwingFootLateralExcursion(degraded, 'front')
    expect(result.value).not.toBeNull()
    expect(result.sampleSize).toBeLessThan(clean.sampleSize)
    expect(result.frameCoverage).toBeLessThan(clean.frameCoverage)
    expect(result.confidence).toBeLessThan(clean.confidence)
  })
})

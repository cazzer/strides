import { describe, expect, it } from 'vitest'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import {
  OUTLINE_CHECKING_CAVEAT,
  clampOutlineCrop,
  cropRectFor,
  measureFrameOutline,
  measureSideOutline,
  outlineFirstMaskRow,
  planSwingFootOutline,
  rowRuns,
  summarizeSwingFootOutline,
} from './swingFootOutline'
import type { OutlineAgreementPoints, OutlineMaskRuns } from './swingFootOutline'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type {
  OutlineSideMarks,
  SwingFootOutlineFrameMeasurement,
  SwingFootOutlineFramePlan,
  SwingFootOutlinePlan,
  SwingFootOutlineWindowPlan,
} from './types'

// A synthetic front-view lower body in a 400 × 800 crop at the source origin. Hip width 60 px,
// hip-mid x 200; the left leg is image-right (outward = +x), the right leg image-left.
const W = 400
const H = 800
const HW = 60
const KNEE_Y = 450
const L = 150 // thigh length (knee.y − hip.y)

type Predicate = (x: number, y: number) => boolean

function maskFrom(predicate: Predicate, width = W, height = H, firstRow = 0): OutlineMaskRuns {
  const rows: number[][] = []
  const row = new Float32Array(width)
  for (let y = firstRow; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) row[x] = predicate(x, y) ? 1 : 0
    rows.push(rowRuns(row, 0, width))
  }
  return { originX: 0, originY: 0, width, height, firstRow, rows }
}

const rect = (x0: number, x1: number, y0: number, y1: number): Predicate =>
  (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1
const union = (...parts: Predicate[]): Predicate => (x, y) => parts.some((p) => p(x, y))

// Torso joins both thighs; each shank hangs inside its own thigh's outer edge.
const torso = rect(150, 250, 150, 300)
const leftThigh = rect(215, 250, 280, 450) // outer edge x = 250
const leftShank = rect(220, 245, 450, 620)
const rightThigh = rect(150, 185, 280, 450) // outer edge x = 150
const rightShank = rect(155, 180, 450, 620)
const body = union(torso, leftThigh, leftShank, rightThigh, rightShank)

/** A foot bar flicked `frac` hip widths past the thigh edge, connected to the leg, at knee +
 * [0.45L, 0.60L] — the spike's injection. */
function flick(side: 'left' | 'right', frac: number): Predicate {
  const top = Math.round(KNEE_Y + 0.45 * L)
  const bottom = Math.round(KNEE_Y + 0.6 * L)
  const reach = Math.round(frac * HW)
  return side === 'left' ? rect(230, 250 + reach, top, bottom) : rect(150 - reach, 170, top, bottom)
}

function framePlan(overrides: Partial<SwingFootOutlineFramePlan> = {}): SwingFootOutlineFramePlan {
  return {
    timestamp: 1,
    sides: ['left', 'right'],
    crop: { x: 0, y: 0, width: W, height: H },
    keypoints: {
      left_hip: { x: 230, y: 300, interpolated: false },
      right_hip: { x: 170, y: 300, interpolated: false },
      left_knee: { x: 235, y: KNEE_Y, interpolated: false },
      right_knee: { x: 165, y: KNEE_Y, interpolated: false },
    },
    quality: { left: 1, right: 1 },
    ...overrides,
  }
}

function agreeing(frame: SwingFootOutlineFramePlan, dx = 0): OutlineAgreementPoints {
  const k = frame.keypoints
  return {
    left_hip: { x: k.left_hip!.x + dx, y: k.left_hip!.y },
    right_hip: { x: k.right_hip!.x + dx, y: k.right_hip!.y },
    left_knee: { x: k.left_knee!.x + dx, y: k.left_knee!.y },
    right_knee: { x: k.right_knee!.x + dx, y: k.right_knee!.y },
  }
}

function measure(predicate: Predicate, side: 'left' | 'right', frame = framePlan()) {
  return measureSideOutline(maskFrom(predicate), agreeing(frame), frame, side, HW)
}

function mirrorFrame(frame: SwingFootOutlineFramePlan): SwingFootOutlineFramePlan {
  const flip = <T extends { x: number } | null>(p: T): T => (p === null ? p : { ...p, x: W - 1 - p.x })
  const k = frame.keypoints
  return {
    ...frame,
    keypoints: {
      left_hip: flip(k.left_hip),
      right_hip: flip(k.right_hip),
      left_knee: flip(k.left_knee),
      right_knee: flip(k.right_knee),
    },
  }
}

describe('measureSideOutline', () => {
  it('reads a leg whose lower half stays inside the thigh outline as protrusion 0', () => {
    for (const side of ['left', 'right'] as const) {
      const m = measure(body, side)
      expect(m.ok).toBe(true)
      if (!m.ok) continue
      expect(m.protrusion).toBe(0)
      expect(m.residual).toBeCloseTo(-5 / HW, 10)
    }
  })

  it.each([0.05, 0.1, 0.2, 0.3])('reads an injected %s HW connected foot flick at its size', (frac) => {
    for (const side of ['left', 'right'] as const) {
      const m = measure(union(body, flick(side, frac)), side)
      expect(m.ok).toBe(true)
      if (m.ok) expect(Math.abs(m.protrusion - frac)).toBeLessThanOrEqual(0.01)
    }
  })

  it('agrees under a horizontal mirror and under a left/right label swap', () => {
    const predicate = union(body, flick('left', 0.2))
    const direct = measure(predicate, 'left')
    const mirrored = measureSideOutline(
      maskFrom((x, y) => predicate(W - 1 - x, y)),
      agreeing(mirrorFrame(framePlan())),
      mirrorFrame(framePlan()),
      'left',
      HW,
    )
    // A rear view swaps which label the image-right leg carries.
    const swapped = framePlan({
      keypoints: {
        left_hip: framePlan().keypoints.right_hip,
        right_hip: framePlan().keypoints.left_hip,
        left_knee: framePlan().keypoints.right_knee,
        right_knee: framePlan().keypoints.left_knee,
      },
    })
    const relabelled = measureSideOutline(maskFrom(predicate), agreeing(swapped), swapped, 'right', HW)
    expect(direct.ok && mirrored.ok && relabelled.ok).toBe(true)
    if (direct.ok && mirrored.ok && relabelled.ok) {
      expect(mirrored.protrusion).toBeCloseTo(direct.protrusion, 10)
      expect(relabelled.protrusion).toBeCloseTo(direct.protrusion, 10)
      expect(direct.protrusion).toBeCloseTo(0.2, 2)
    }
  })

  it('abstains when MediaPipe sits more than 0.5 HW from MoveNet, or has no pose', () => {
    const frame = framePlan()
    expect(measureSideOutline(maskFrom(body), agreeing(frame, 0.51 * HW), frame, 'left', HW))
      .toEqual({ ok: false, reason: 'mask-untrusted' })
    expect(measureSideOutline(maskFrom(body), agreeing(frame, 0.49 * HW), frame, 'left', HW).ok).toBe(true)
    expect(measureSideOutline(maskFrom(body), null, frame, 'left', HW))
      .toEqual({ ok: false, reason: 'mask-untrusted' })
    expect(measureSideOutline(null, agreeing(frame), frame, 'left', HW)).toEqual({ ok: false, reason: 'no-mask' })
  })

  it('does not count the knee contour between the knee and knee + 0.3L', () => {
    const kneeBulge = rect(215, 262, KNEE_Y - 5, Math.ceil(KNEE_Y + 0.3 * L) - 1)
    const m = measure(union(body, kneeBulge), 'left')
    expect(m.ok && m.protrusion).toBe(0)
  })

  it('ignores a disconnected bystander blob past the thigh edge', () => {
    const bystander = rect(300, 340, 500, 600)
    const m = measure(union(body, bystander), 'left')
    expect(m.ok && m.protrusion).toBe(0)
  })

  it('reads a lower leg hidden behind the thigh (no swing-side lower pixel) as 0, outermost null', () => {
    const hidden = union(torso, leftThigh, rightThigh, rightShank)
    const m = measure(hidden, 'left')
    expect(m.ok).toBe(true)
    if (m.ok) {
      expect(m.residual).toBeNull()
      expect(m.protrusion).toBe(0)
      expect(m.marks.outermost).toBeNull()
    }
  })

  it('applies the MoveNet gates: interpolated knee, hip floor, thigh band', () => {
    const frame = framePlan()
    const interpolated = framePlan({
      keypoints: { ...frame.keypoints, left_knee: { ...frame.keypoints.left_knee!, interpolated: true } },
    })
    expect(measure(body, 'left', interpolated)).toEqual({ ok: false, reason: 'kp-interpolated' })
    expect(measureSideOutline(maskFrom(body), agreeing(frame), frame, 'left', 2.1 * HW))
      .toEqual({ ok: false, reason: 'hip-floor' })
    expect(measure(union(torso, rightThigh), 'left')).toEqual({ ok: false, reason: 'thigh-band' })
  })

  it('carries marks in source pixels and a contour of at most 64 points', () => {
    const m = measure(union(body, flick('left', 0.2)), 'left')
    expect(m.ok).toBe(true)
    if (!m.ok) return
    expect(m.marks.thighEdge[0].x).toBe(250)
    expect(m.marks.outermost).toEqual({ x: 262, y: Math.round(KNEE_Y + 0.45 * L) })
    expect(m.marks.contour.length).toBeLessThanOrEqual(64)
    expect(m.marks.midlineX).toBe(200)
  })

  it('reads the same from a run mask stored only from the first thigh-band row, at a crop offset', () => {
    const frame = framePlan()
    const first = outlineFirstMaskRow(frame, 0)
    expect(first).toBe(Math.round(KNEE_Y - 0.4 * L))
    const predicate = union(body, flick('left', 0.1))
    const full = measureSideOutline(maskFrom(predicate), agreeing(frame), frame, 'left', HW)
    const partial = measureSideOutline(maskFrom(predicate, W, H, first), agreeing(frame), frame, 'left', HW)
    expect(partial).toEqual(full)
    // Same mask, cropped at origin (100, 50): source coordinates are unchanged.
    const offset = maskFrom((x, y) => predicate(x + 100, y + 50), W - 100, H - 50)
    const shifted = measureSideOutline({ ...offset, originX: 100, originY: 50 }, agreeing(frame), frame, 'left', HW)
    expect(shifted).toEqual(full)
  })
})

describe('cropRectFor / clampOutlineCrop', () => {
  it('is 7 × 12 hip widths centred on hip-mid with a 60 px hip-width floor', () => {
    const narrow = framePlan({
      keypoints: { ...framePlan().keypoints, left_hip: { x: 867.05, y: 1864.18, interpolated: false }, right_hip: { x: 814.24, y: 1865.5, interpolated: false } },
    })
    // The spike's frame n000: HW 52.8 → 60 → 420 × 720 at (631, 1505).
    expect(cropRectFor(narrow)).toEqual({ x: 631, y: 1505, width: 420, height: 720 })
    expect(cropRectFor(framePlan())).toEqual({ x: 200 - 210, y: 300 - 360, width: 420, height: 720 })
    expect(cropRectFor(framePlan({ keypoints: { ...framePlan().keypoints, left_hip: null } }))).toBeNull()
  })

  it('clamps to the frame', () => {
    expect(clampOutlineCrop({ x: -10, y: -60, width: 420, height: 720 }, 400, 600)).toEqual({ x: 0, y: 0, width: 400, height: 600 })
    expect(clampOutlineCrop({ x: 500, y: 0, width: 20, height: 20 }, 400, 600)).toBeNull()
  })
})

function window(side: 'left' | 'right', strike: number, swing: number[], stance: number[], inClip = true): SwingFootOutlineWindowPlan {
  return {
    side,
    strikeTimestamp: strike,
    swingStart: swing[0],
    swingEnd: swing[swing.length - 1],
    stanceStart: strike,
    stanceEnd: stance[stance.length - 1],
    inClip,
    swingTimestamps: swing,
    stanceTimestamps: stance,
  }
}

const range = (start: number, count: number) => Array.from({ length: count }, (_, k) => start + k)
const marks: OutlineSideMarks = {
  thighEdge: [{ x: 0, y: 0 }, { x: 0, y: 1 }],
  contour: [],
  outermost: null,
  midlineX: 0,
}

function plan(windows: SwingFootOutlineWindowPlan[]): SwingFootOutlinePlan {
  const timestamps = [...new Set(windows.flatMap((w) => [...w.swingTimestamps, ...w.stanceTimestamps]))].sort((a, b) => a - b)
  return {
    viewFit: { fit: 'primary', multiplier: 1 },
    periodSeconds: 0.33,
    hipWidthMedianPx: HW,
    lastFrameTimestamp: 1000,
    windows,
    frames: timestamps.map((timestamp) => framePlan({ timestamp })),
  }
}

/** Every listed (timestamp, side) measured ok with the given protrusion. */
function measured(entries: Array<[number[], 'left' | 'right', number]>): SwingFootOutlineFrameMeasurement[] {
  const byT = new Map<number, SwingFootOutlineFrameMeasurement>()
  for (const [timestamps, side, protrusion] of entries) {
    for (const t of timestamps) {
      const m = byT.get(t) ?? { timestamp: t, mediaPipeDisagreement: 0, sides: {} }
      m.sides[side] = { ok: true, residual: protrusion === 0 ? -0.1 : protrusion, protrusion, marks }
      byT.set(t, m)
    }
  }
  return [...byT.values()]
}

describe('summarizeSwingFootOutline', () => {
  const fourWindows = [
    window('left', 0, range(100, 10), range(0, 4)),
    window('right', 10, range(200, 10), range(10, 4)),
    window('left', 20, range(300, 10), range(20, 4)),
    window('right', 30, range(400, 10), range(30, 4)),
  ]

  it('reports 0 with counts when every swing stays inside the floor', () => {
    const p = plan(fourWindows)
    const result = summarizeSwingFootOutline(p, measured([
      ...fourWindows.map((w): [number[], 'left' | 'right', number] => [w.swingTimestamps, w.side, 0]),
      ...fourWindows.map((w): [number[], 'left' | 'right', number] => [w.stanceTimestamps, w.side, 0]),
    ]), DEFAULT_HEURISTICS_CONFIG)
    expect(result.value).toBe(0)
    expect(result.outline).toMatchObject({ floor: 0, usableCount: 4, insideCount: 4, outsideCount: 0, stanceFrames: 16 })
    expect(result.caveat).toBe("No sideways foot travel past your leg's outline in all 4 swings.")
    expect(result.sampleSize).toBe(4)
    expect(result.confidence).toBe(1)
    expect(result.frameCoverage).toBe(1)
    expect(result.exemplars?.[0]).toMatchObject({ kind: 'swingFootOutline', side: 'left' })
    expect(result.exemplars?.[0].outlineMarks).toBeDefined()
    expect(result.exemplars?.[0].alternates).toHaveLength(3)
  })

  it('reports the larger side above the floor, keeping the raw value on the reading', () => {
    const p = plan(fourWindows)
    const result = summarizeSwingFootOutline(p, measured([
      [fourWindows[0].swingTimestamps, 'left', 0.05],
      [fourWindows[2].swingTimestamps, 'left', 0.05],
      [fourWindows[1].swingTimestamps, 'right', 0.123],
      [fourWindows[3].swingTimestamps, 'right', 0.123],
      ...fourWindows.map((w): [number[], 'left' | 'right', number] => [w.stanceTimestamps, w.side, 0.01]),
    ]), DEFAULT_HEURISTICS_CONFIG)
    expect(result.value).toBeCloseTo(0.123, 10)
    expect(result.outline).toMatchObject({ reportedSide: 'right', outsideCount: 4, perSide: { left: 0.05, right: 0.123 } })
    // Counts the reported foot's swings only, and shows the floor the value cleared.
    expect(result.caveat).toBe(
      "Your right foot stuck out past its leg's outline by 12.3% of hip width in 2 of 2 right-foot swings, above this clip's noise floor of 1.0%.",
    )
    expect(result.exemplars?.[0].side).toBe('right')
  })

  it('names the remainder when a 0 hides a window that went past the floor', () => {
    const p = plan(fourWindows)
    const result = summarizeSwingFootOutline(p, measured([
      [fourWindows[0].swingTimestamps, 'left', 0],
      [fourWindows[2].swingTimestamps, 'left', 0],
      // One right window above the 0.15 floor, one inside: the right median (0.1) stays inside.
      [fourWindows[1].swingTimestamps, 'right', 0.2],
      [fourWindows[3].swingTimestamps, 'right', 0],
      ...fourWindows.map((w): [number[], 'left' | 'right', number] => [w.stanceTimestamps, w.side, 0.15]),
    ]), DEFAULT_HEURISTICS_CONFIG)
    expect(result.value).toBe(0)
    expect(result.outline).toMatchObject({ insideCount: 3, outsideCount: 1, usableCount: 4 })
    expect(result.caveat).toBe(
      "No sideways foot travel past your leg's outline in 3 of 4 swings; the other one went only slightly past it, not on most swings of either foot.",
    )
  })

  it('counts only the reported foot in the stuck-out sentence', () => {
    const p = plan(fourWindows)
    const result = summarizeSwingFootOutline(p, measured([
      [fourWindows[0].swingTimestamps, 'left', 0.3],
      [fourWindows[2].swingTimestamps, 'left', 0.1],
      [fourWindows[1].swingTimestamps, 'right', 0.05],
      [fourWindows[3].swingTimestamps, 'right', 0],
      ...fourWindows.map((w): [number[], 'left' | 'right', number] => [w.stanceTimestamps, w.side, 0.02]),
    ]), DEFAULT_HEURISTICS_CONFIG)
    expect(result.value).toBeCloseTo(0.2, 10)
    expect(result.caveat).toBe(
      "Your left foot stuck out past its leg's outline by 20.0% of hip width in 2 of 2 left-foot swings, above this clip's noise floor of 2.0%.",
    )
  })

  it('maps a reading inside the floor to exactly 0', () => {
    const p = plan(fourWindows)
    const result = summarizeSwingFootOutline(p, measured([
      ...fourWindows.map((w): [number[], 'left' | 'right', number] => [w.swingTimestamps, w.side, 0.02]),
      ...fourWindows.map((w): [number[], 'left' | 'right', number] => [w.stanceTimestamps, w.side, 0.03]),
    ]), DEFAULT_HEURISTICS_CONFIG)
    expect(result.value).toBe(0)
    expect(result.outline?.protrusion).toBeCloseTo(0.02, 10)
  })

  it('needs 6 good frames covering 70% of a window, inside the clip', () => {
    const w = [
      window('left', 0, range(100, 10), range(0, 6)),
      window('right', 10, range(200, 10), range(10, 6)),
      window('left', 20, range(300, 10), range(20, 6), false),
    ]
    const result = summarizeSwingFootOutline(plan(w), measured([
      [range(100, 7), 'left', 0], // 7/10: usable
      [range(200, 6), 'right', 0], // 6/10 < 70%: not usable
      [range(300, 10), 'left', 0], // ends past the clip
      [range(0, 6), 'left', 0],
    ]), DEFAULT_HEURISTICS_CONFIG)
    expect(result.outline?.windows.map((x) => x.usable)).toEqual([true, false, false])
    expect(result.outline?.usableCount).toBe(1)
    expect(result.frameCoverage).toBeCloseTo(13 / 20, 10)
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.confidence).toBeLessThan(1)
  })

  it('returns null with no floor below 6 stance frames, and null with no usable window', () => {
    const noFloor = summarizeSwingFootOutline(plan(fourWindows), measured([
      ...fourWindows.map((w): [number[], 'left' | 'right', number] => [w.swingTimestamps, w.side, 0]),
      [range(0, 5), 'left', 0],
    ]), DEFAULT_HEURISTICS_CONFIG)
    expect(noFloor.value).toBeNull()
    expect(noFloor.confidence).toBe(0)
    expect(noFloor.outline?.floor).toBeNull()
    const noWindow = summarizeSwingFootOutline(plan(fourWindows), measured([[range(0, 10), 'left', 0]]), DEFAULT_HEURISTICS_CONFIG)
    expect(noWindow.value).toBeNull()
    expect(noWindow.outline?.usableCount).toBe(0)
    expect(noWindow.caveat).toBe('No early swing had enough clear outline frames to check sideways foot travel.')
  })
})

describe('planSwingFootOutline', () => {
  const gait = (durationSec = 4) => generateSyntheticGait({
    durationSec,
    fps: 60,
    cadenceStepsPerMin: 170,
    strideAmplitudePx: 80,
    verticalBouncePx: 20,
    trunkLeanDeg: 5,
    view: 'front',
  })

  it('abstains with no plan from a side or ambiguous view', () => {
    for (const view of ['side', 'ambiguous'] as const) {
      const result = planSwingFootOutline(gait(), view, DEFAULT_HEURISTICS_CONFIG)
      expect(result.value).toBeNull()
      expect(result.outlinePlan).toBeNull()
      expect(result.viewFit).toBe('unsuitable')
      expect(result.caveat).toMatch(/not reliable from/)
    }
  })

  it('plans early-swing and stance frames on a front clip, with a checking placeholder', () => {
    const frames = gait()
    const result = planSwingFootOutline(frames, 'front', DEFAULT_HEURISTICS_CONFIG)
    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).toBe(OUTLINE_CHECKING_CAVEAT)
    const p = result.outlinePlan!
    expect(p).not.toBeNull()
    const T = p.periodSeconds
    for (const w of p.windows) {
      expect(w.swingStart).toBeCloseTo(w.strikeTimestamp + T / 2, 10)
      expect(w.swingEnd).toBeCloseTo(w.strikeTimestamp + (5 * T) / 4, 10)
      expect(w.stanceEnd).toBeCloseTo(w.strikeTimestamp + T / 4, 10)
    }
    const planned = new Set(p.frames.map((f) => f.timestamp))
    const last = frames[frames.length - 1].timestamp
    for (const w of p.windows) {
      expect(w.inClip).toBe(w.swingEnd <= last + 1e-6)
      // Swing frames of a window past the clip end are never segmented on its account.
      if (!w.inClip) continue
      for (const t of w.swingTimestamps) expect(planned.has(t)).toBe(true)
    }
    expect(p.windows.some((w) => !w.inClip)).toBe(true)
    const sorted = [...p.frames.map((f) => f.timestamp)].sort((a, b) => a - b)
    expect(p.frames.map((f) => f.timestamp)).toEqual(sorted)
  })

  it('measureFrameOutline measures every planned side of the frame', () => {
    const frame = framePlan()
    const m = measureFrameOutline(frame, maskFrom(body), agreeing(frame), HW)
    expect(Object.keys(m.sides).sort()).toEqual(['left', 'right'])
    expect(m.mediaPipeDisagreement).toBe(0)
  })
})

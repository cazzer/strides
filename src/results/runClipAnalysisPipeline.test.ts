import { describe, expect, it, vi, beforeEach } from 'vitest'
import { COMMON_KEYPOINT_NAMES } from '../pose/types'
import type {
  PoseSample,
  RobustKeypoint,
  RobustPoseFrame,
} from '../pose/robustness/types'
import type { FormHeuristicsResult } from '../heuristics/types'
import { DEFAULT_SAMPLING_ROBUSTNESS_CONFIG } from './samplingRobustnessConfig'
import type { SamplingRobustnessConfig } from './samplingRobustnessConfig'

const { applyRobustnessMock, computeFormHeuristicsMock } = vi.hoisted(() => ({
  applyRobustnessMock: vi.fn(),
  computeFormHeuristicsMock: vi.fn(),
}))

vi.mock('../pose/robustness/interpolate', () => ({
  applyRobustness: applyRobustnessMock,
}))

vi.mock('../heuristics/index', () => ({
  computeFormHeuristics: computeFormHeuristicsMock,
}))

import { runClipAnalysisPipeline } from './runClipAnalysisPipeline'

const FRAME_SIZE = { width: 1920, height: 1080 }

// The person-selection stage ships opt-in (default `enabled: false`), so tests that exercise it
// switch it on -- exactly the shape of the `window` override an eval harness sets.
const SELECTING = {
  ...DEFAULT_SAMPLING_ROBUSTNESS_CONFIG,
  personSelection: {
    ...DEFAULT_SAMPLING_ROBUSTNESS_CONFIG.personSelection,
    enabled: true,
  },
}

/** A detected sample whose bbox is a `side`x`side` square with its top-left at (`x`, `y`). */
function detected(timestamp: number, x: number, y: number, side: number): PoseSample {
  const corners = [
    [x, y],
    [x + side, y],
    [x, y + side],
    [x + side, y + side],
  ]
  return {
    timestamp,
    frame: {
      timestamp,
      keypoints: COMMON_KEYPOINT_NAMES.map((name, i) => {
        // Four confident torso/limb points spanning the square (clears the default
        // minConfidentKeypoints of 4); everything else present but below confidence.
        const corner = corners[i]
        return corner
          ? { name, x: corner[0], y: corner[1], score: 0.9 }
          : { name, x, y, score: 0 }
      }),
    },
  }
}

function makeFakeKeypoints(): RobustKeypoint[] {
  return COMMON_KEYPOINT_NAMES.map((name) => ({
    name,
    status: 'detected',
    x: 1,
    y: 1,
    score: 0.9,
  }))
}

// At least presenceMinConsecutiveFrames (3, default) frames, all present, so
// trimToPresenceWindow (real, not mocked) is a no-op on this fixture.
const FAKE_ROBUST_FRAMES: RobustPoseFrame[] = [
  { timestamp: 0, keypoints: makeFakeKeypoints(), source: 'detected', pixelsPerMeter: null },
  { timestamp: 0.1, keypoints: makeFakeKeypoints(), source: 'detected', pixelsPerMeter: null },
  { timestamp: 0.2, keypoints: makeFakeKeypoints(), source: 'detected', pixelsPerMeter: null },
]

const FAKE_HEURISTICS: FormHeuristicsResult = {
  view: {
    view: 'side',
    confidence: 1,
    diagnostics: { bilateralSpreadRatio: null, sagittalExcursionRatio: null, frameCoverage: 1 },
  },
  verticalOscillation: {
    metric: 'verticalOscillation',
    value: 0.1,
    unit: 'ratio',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
    series: [],
    fit: null,
  },
  verticalRatio: {
    metric: 'verticalRatio',
    value: 0.08,
    unit: 'percent',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
  },
  verticalOscillationCm: {
    metric: 'verticalOscillationCm',
    value: null,
    unit: 'centimeters',
    confidence: 0,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 0,
    sampleSize: 0,
    caveat: 'No real-world scale could be measured for this clip.',
    calibration: null,
  },
  trunkLean: {
    metric: 'trunkLean',
    value: 5,
    unit: 'degrees',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
  },
  overstriding: {
    metric: 'overstriding',
    value: 0.1,
    unit: 'ratio',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
  },
  cadence: {
    metric: 'cadence',
    value: 170,
    unit: 'stepsPerMinute',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
  },
  kneeFlexion: {
    metric: 'kneeFlexion',
    value: 110,
    unit: 'degrees',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
  },
  armSwingSymmetry: {
    metric: 'armSwingSymmetry',
    value: 0.9,
    unit: 'percent',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
  },
  footStrikePattern: {
    metric: 'footStrikePattern',
    value: 0.01,
    unit: 'ratio',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: 'Approximated from ankle position relative to the knee at footstrike.',
  },
  stepWidth: {
    metric: 'stepWidth',
    value: 0.15,
    unit: 'percent',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
  },
  stepWidthCm: {
    metric: 'stepWidthCm',
    value: null,
    unit: 'centimeters',
    confidence: 0,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 0,
    sampleSize: 0,
    caveat: "No real-world scale could be measured for this clip, so step width can't be reported in centimetres.",
  },
}

beforeEach(() => {
  applyRobustnessMock.mockReset()
  computeFormHeuristicsMock.mockReset()
  applyRobustnessMock.mockReturnValue(FAKE_ROBUST_FRAMES)
  computeFormHeuristicsMock.mockReturnValue(FAKE_HEURISTICS)
})

describe('runClipAnalysisPipeline', () => {
  it('sorts samples by timestamp before calling applyRobustness', () => {
    const outOfOrder = [
      { timestamp: 0.3, frame: null },
      { timestamp: 0.1, frame: null },
      { timestamp: 0.2, frame: null },
    ]

    // Deliberately the SHIPPED default (person selection off), so the sort stays covered on the
    // path every real run takes. Switching this to the selecting config would buy nothing anyway:
    // these samples are all `frame: null`, so selection short-circuits on 'no-detections'.
    runClipAnalysisPipeline(outOfOrder, DEFAULT_SAMPLING_ROBUSTNESS_CONFIG, 'playback', FRAME_SIZE)

    expect(applyRobustnessMock).toHaveBeenCalledWith(
      [
        { timestamp: 0.1, frame: null },
        { timestamp: 0.2, frame: null },
        { timestamp: 0.3, frame: null },
      ],
      DEFAULT_SAMPLING_ROBUSTNESS_CONFIG.robustness,
    )
  })

  it('calls computeFormHeuristics with the (real, unmocked) presence-trimmed robustness output', () => {
    runClipAnalysisPipeline([{ timestamp: 0, frame: null }], DEFAULT_SAMPLING_ROBUSTNESS_CONFIG, 'playback', FRAME_SIZE)

    // FAKE_ROBUST_FRAMES is a no-op under the real trimToPresenceWindow (every frame present,
    // at least presenceMinConsecutiveFrames long), so heuristics receives it unchanged.
    expect(computeFormHeuristicsMock).toHaveBeenCalledWith(FAKE_ROBUST_FRAMES)
  })

  it('returns the untrimmed robustFrames, the computed heuristics, and diagnostics derived from them', () => {
    const samples = [{ timestamp: 0, frame: null }]
    const result = runClipAnalysisPipeline(samples, DEFAULT_SAMPLING_ROBUSTNESS_CONFIG, 'playback', FRAME_SIZE)

    expect(result.robustFrames).toBe(FAKE_ROBUST_FRAMES)
    expect(result.heuristics).toBe(FAKE_HEURISTICS)
    expect(result.diagnostics.sampling.totalSamples).toBe(1)
    expect(result.diagnostics.metrics.trunkLean.value).toBe(5)
    // MoveNet-shaped fixture: no scale calibration measured, so the key is absent entirely.
    expect('scaleCalibration' in result.diagnostics).toBe(false)
  })

  it('trims to the presence window before computing heuristics, when robustness output has dead time', () => {
    const emptyKeypoints: RobustKeypoint[] = COMMON_KEYPOINT_NAMES.map((name) => ({
      name,
      status: 'unrecoverable',
      x: null,
      y: null,
      score: 0,
    }))
    const deadFrame: RobustPoseFrame = {
      timestamp: -0.1,
      keypoints: emptyKeypoints,
      source: 'missing',
      pixelsPerMeter: null,
    }
    applyRobustnessMock.mockReturnValue([deadFrame, ...FAKE_ROBUST_FRAMES])

    runClipAnalysisPipeline([{ timestamp: 0, frame: null }], DEFAULT_SAMPLING_ROBUSTNESS_CONFIG, 'playback', FRAME_SIZE)

    // The dead (subject-absent) frame is excluded from what heuristics sees, even though it's
    // included in applyRobustness's own output.
    expect(computeFormHeuristicsMock).toHaveBeenCalledWith(FAKE_ROBUST_FRAMES)
  })

  describe('retroactive person selection', () => {
    // A near-field subject (300px box) for ~0.3s, then a far-field bystander (60px box) on the
    // far side of the frame -- the shape of the repro clip, compressed.
    const TWO_PEOPLE: PoseSample[] = [
      detected(0, 100, 100, 300),
      detected(0.1, 110, 100, 300),
      detected(0.2, 120, 100, 300),
      detected(0.3, 1500, 700, 60),
      detected(0.4, 1505, 700, 60),
    ]

    it('runs after the sort, so applyRobustness receives the SELECTED samples in timestamp order', () => {
      const outOfOrder = [TWO_PEOPLE[3], TWO_PEOPLE[0], TWO_PEOPLE[4], TWO_PEOPLE[1], TWO_PEOPLE[2]]

      runClipAnalysisPipeline(outOfOrder, SELECTING, 'playback', FRAME_SIZE)

      const passed = applyRobustnessMock.mock.calls[0][0] as PoseSample[]
      expect(passed.map((s) => s.timestamp)).toEqual([0, 0.1, 0.2, 0.3, 0.4])
      // The bystander's two frames are nulled; the subject's three survive by reference.
      expect(passed.slice(0, 3)).toEqual([TWO_PEOPLE[0], TWO_PEOPLE[1], TWO_PEOPLE[2]])
      expect(passed[3]).toEqual({ timestamp: 0.3, frame: null })
      expect(passed[4]).toEqual({ timestamp: 0.4, frame: null })
    })

    it('reports detectedFrames post-selection and detectedSamplesIn pre-selection', () => {
      const result = runClipAnalysisPipeline(TWO_PEOPLE, SELECTING, 'playback', FRAME_SIZE)

      expect(result.diagnostics.personSelection.status).toBe('selected')
      expect(result.diagnostics.personSelection.detectedSamplesIn).toBe(5)
      expect(result.diagnostics.sampling.detectedFrames).toBe(3)
      expect(result.diagnostics.sampling.totalSamples).toBe(5)
    })

    it('with personSelection disabled, the whole result deep-equals a run computed without the stage', () => {
      // The kill switch has to be a true no-op, not merely "close enough" -- this is the A/B
      // baseline every future measurement of this stage is compared against, and the revert path
      // now that the stage ships ON.
      const disabled: SamplingRobustnessConfig = {
        ...DEFAULT_SAMPLING_ROBUSTNESS_CONFIG,
        personSelection: {
          ...DEFAULT_SAMPLING_ROBUSTNESS_CONFIG.personSelection,
          enabled: false,
        },
      }

      // An input-SENSITIVE stub, for this test only. The shared fixture is a constant, so
      // comparing the pipeline's robustness output against a hand-rolled baseline's would pass
      // whatever either call received. One robust frame per input sample, carrying whether that
      // sample still had a detection, makes the comparison below actually depend on the samples
      // each call was handed.
      applyRobustnessMock.mockImplementation((samples: PoseSample[]) =>
        samples.map((sample) => ({
          timestamp: sample.timestamp,
          keypoints: makeFakeKeypoints(),
          source: sample.frame === null ? 'missing' : 'detected',
          pixelsPerMeter: null,
        })),
      )

      const withStage = runClipAnalysisPipeline(TWO_PEOPLE, disabled, 'playback', FRAME_SIZE)
      // Snapshot what the PIPELINE passed BEFORE the hand-rolled baseline call below appends its
      // own entry to the same mock. Clearing the mock first (or re-reading calls[0] afterwards)
      // would make the assertion read back its own argument and pass unconditionally.
      const pipelinePassed = applyRobustnessMock.mock.calls[0][0] as PoseSample[]

      // The independently-computed baseline: exactly what the pipeline did before this stage
      // existed -- sort, then straight into robustness -- reproduced here by hand.
      const sorted = [...TWO_PEOPLE].sort((a, b) => a.timestamp - b.timestamp)
      const robustFrames = applyRobustnessMock(sorted, disabled.robustness) as RobustPoseFrame[]

      expect(pipelinePassed).toEqual(sorted)
      expect(withStage.robustFrames).toEqual(robustFrames)
      expect(withStage.diagnostics.sampling).toEqual({
        totalSamples: 5,
        detectedFrames: 5,
        missingFrames: 0,
        path: 'playback',
      })
      expect(withStage.diagnostics.personSelection).toEqual({
        status: 'skipped',
        skipReason: 'disabled',
        minBoundingBoxAreaPx: 0,
        totalSamples: 5,
        detectedSamplesIn: 5,
        detectedSamplesOut: 5,
        rejectedBelowFloor: 0,
        rejectedOtherSegment: 0,
        segmentCount: 0,
        bridgedCuts: 0,
        segments: [],
        separationRatio: null,
      })
    })

    it('every sample the stage rejected reaches robustness as a null frame, never another pose', () => {
      runClipAnalysisPipeline(TWO_PEOPLE, SELECTING, 'playback', FRAME_SIZE)

      const passed = applyRobustnessMock.mock.calls[0][0] as PoseSample[]
      for (const sample of passed) {
        // Either it is one of the originals by reference, or its frame is null. Nothing in
        // between -- a substituted pose would be interpolated across with no identity check.
        expect(TWO_PEOPLE.includes(sample) || sample.frame === null).toBe(true)
      }
    })
  })
})

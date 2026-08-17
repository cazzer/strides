import { StrictMode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFrame } from '../heuristics/__fixtures__/testFrames'
import type {
  FormHeuristicsResult,
  MetricExemplar,
  MetricId,
  MetricResult,
  VerticalOscillationCmResult,
  VerticalOscillationResult,
} from '../heuristics/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { VideoSource } from '../video/types'
import type { ClipEvidence, ClipEvidenceInput } from '../video/extractFrames'
import type { ClipEvidencePlan, MetricEvidencePlan } from './evidenceFrames'
import type { ClipSession } from './multiClipAnalysis'

const { extractSessionEvidenceMock } = vi.hoisted(() => ({
  extractSessionEvidenceMock: vi.fn(),
}))

// Only the impure half is mocked. Planning, the tier gate and the crop math all run for real
// here — those are exactly the structure/gating this component composes, and jsdom has no canvas
// to run the drawing half against (`src/test/canvasTestUtils.ts`: the `canvas` npm package is
// refused by policy). Pixels are #68's problem.
vi.mock('../video/extractFrames', () => ({
  extractSessionEvidence: extractSessionEvidenceMock,
}))

import { EVIDENCE_SECTION_ID_PREFIX, EvidenceGallery } from './EvidenceGallery'

const HIP_SEED = ['left_hip', 'right_hip']

/** 11 frames on a 0.1 s grid (snap tolerance 0.05 s), the subject's 100x100 hip box travelling
 * 40 px per sample — motion matters, because two identical crop boxes demote a pair by design. */
function sampledFrames(): RobustPoseFrame[] {
  return Array.from({ length: 11 }, (_, i) =>
    buildFrame(
      { left_hip: { x: 500 + i * 40, y: 440 }, right_hip: { x: 600 + i * 40, y: 540 } },
      Number((i * 0.1).toFixed(2)),
    ),
  )
}

const FRAMES = sampledFrames()

function pairExemplar(overrides: Partial<MetricExemplar> = {}): MetricExemplar {
  return {
    kind: 'trunkLeanRange',
    timestamp: 0.2,
    pairedTimestamp: 0.6,
    quality: 0.9,
    label: 'Most forward trunk lean, ghosted against the most upright frame',
    cropKeypoints: [...HIP_SEED] as MetricExemplar['cropKeypoints'],
    ...overrides,
  }
}

function singleExemplar(overrides: Partial<MetricExemplar> = {}): MetricExemplar {
  return {
    kind: 'footStrike',
    timestamp: 0.4,
    side: 'left',
    quality: 0.8,
    label: 'heel-like footstrike, left foot',
    cropKeypoints: [...HIP_SEED] as MetricExemplar['cropKeypoints'],
    ...overrides,
  }
}

function metricResult(metric: MetricId, overrides: Partial<MetricResult> = {}): MetricResult {
  return {
    metric,
    value: 1,
    unit: 'ratio',
    confidence: 0.9,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 8,
    caveat: null,
    ...overrides,
  }
}

function heuristicsResult(
  overrides: Partial<Record<MetricId, Partial<MetricResult>>> = {},
): FormHeuristicsResult {
  const of = (metric: MetricId) => metricResult(metric, overrides[metric])
  return {
    view: {
      view: 'side',
      confidence: 1,
      diagnostics: {
        bilateralSpreadRatio: 0.1,
        sagittalExcursionRatio: 1,
        frameCoverage: 1,
      },
    },
    verticalOscillation: {
      ...of('verticalOscillation'),
      metric: 'verticalOscillation',
      series: [],
      fit: null,
    } as VerticalOscillationResult,
    verticalRatio: of('verticalRatio'),
    verticalOscillationCm: {
      ...of('verticalOscillationCm'),
      metric: 'verticalOscillationCm',
      calibration: null,
    } as VerticalOscillationCmResult,
    trunkLean: of('trunkLean'),
    overstriding: of('overstriding'),
    cadence: of('cadence'),
    kneeFlexion: of('kneeFlexion'),
    armSwingSymmetry: of('armSwingSymmetry'),
    footStrikePattern: of('footStrikePattern'),
    stepWidth: of('stepWidth'),
    stepWidthCm: of('stepWidthCm'),
  }
}

function makeClip(clipId: string, heuristics: FormHeuristicsResult): ClipSession {
  const videoSource = {
    videoRef: { current: null },
    status: 'ready',
    metadata: { durationSec: 1.1, width: 1920, height: 1080, frameRate: null },
    error: null,
    sourceBlob: new Blob(['clip-bytes']),
    load: vi.fn(),
    reset: vi.fn(),
  } as unknown as VideoSource
  return {
    clipId,
    videoSource,
    analysis: {
      phase: 'ready',
      progress: 1,
      isPausedMidAnalysis: false,
      robustFrames: FRAMES,
      heuristics,
      diagnostics: null,
      scalePass: { status: 'skipped', reason: 'disabled', diagnostics: null },
      error: null,
      start: vi.fn(),
      reset: vi.fn(),
    },
  }
}

function allFromClipZero(): Record<MetricId, number> {
  const ids: MetricId[] = [
    'verticalOscillation',
    'verticalRatio',
    'verticalOscillationCm',
    'trunkLean',
    'overstriding',
    'cadence',
    'kneeFlexion',
    'armSwingSymmetry',
    'footStrikePattern',
    'stepWidth',
    'stepWidthCm',
  ]
  return Object.fromEntries(ids.map((id) => [id, 0])) as Record<MetricId, number>
}

/** Turns a real plan into extraction output, so the mock only ever fakes the pixels. */
function extractedFromPlan(
  plan: ClipEvidencePlan,
  failing: ReadonlySet<MetricId>,
): ClipEvidence {
  const evidence = {} as ClipEvidence
  for (const [metric, entry] of Object.entries(plan) as Array<
    [MetricId, MetricEvidencePlan]
  >) {
    if (entry.status !== 'planned') {
      evidence[metric] = entry
    } else if (failing.has(metric)) {
      evidence[metric] = { status: 'no-evidence', reason: 'extraction-failed' }
    } else {
      evidence[metric] = {
        status: 'extracted',
        items: entry.items.map((item) => ({
          plan: item,
          canvas: document.createElement('canvas'),
        })),
      }
    }
  }
  return evidence
}

function extractsEverything(failing: ReadonlySet<MetricId> = new Set()) {
  return (clips: ClipEvidenceInput[]) =>
    Promise.resolve(clips.map((clip) => extractedFromPlan(clip.plan, failing)))
}

/** `console.log`'s recorded calls. Read off the spied function rather than a typed handle —
 * `vi.spyOn`'s return type erases the argument tuple, which is the only part this file uses. */
function logCalls(): unknown[][] {
  return (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls
}

function logPrefixes(): string[] {
  return logCalls().map((call) => String(call[0]))
}

function coverageLines(): unknown[] {
  return logCalls()
    .filter((call) => String(call[0]).startsWith('[evidence-coverage]'))
    .map((call) => JSON.parse(String(call[1])) as unknown)
}

beforeEach(() => {
  extractSessionEvidenceMock.mockImplementation(extractsEverything())
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  extractSessionEvidenceMock.mockReset()
})

describe('EvidenceGallery — what renders', () => {
  it('renders a section only for the metrics that produced imagery', async () => {
    const clips = [
      makeClip(
        'a',
        heuristicsResult({
          trunkLean: { exemplars: [pairExemplar()] },
          footStrikePattern: { exemplars: [singleExemplar()] },
        }),
      ),
    ]
    render(<EvidenceGallery clips={clips} sourceIndices={allFromClipZero()} />)

    await screen.findByRole('heading', { name: 'Trunk lean' })
    expect(screen.getByRole('heading', { name: 'Foot strike pattern' })).toBeInTheDocument()
    // Emitted nothing, so it has no section — and no placeholder standing in for one.
    expect(screen.queryByRole('heading', { name: 'Overstriding' })).not.toBeInTheDocument()
    expect(document.getElementById(`${EVIDENCE_SECTION_ID_PREFIX}trunkLean`)).not.toBeNull()
    expect(document.getElementById(`${EVIDENCE_SECTION_ID_PREFIX}overstriding`)).toBeNull()
  })

  it('spans both columns of the two-column <main> it mounts as a third child of', async () => {
    const clips = [makeClip('a', heuristicsResult({ trunkLean: { exemplars: [pairExemplar()] } }))]
    render(<EvidenceGallery clips={clips} sourceIndices={allFromClipZero()} />)

    const gallery = await screen.findByRole('region', { name: 'What the analysis looked at' })
    // Without this the gallery lands in column 1 of row 2 and the imagery renders at half width.
    expect(gallery.className).toContain('lg:col-span-2')
  })

  it('renders nothing at all when no metric has evidence', async () => {
    const clips = [makeClip('a', heuristicsResult())]
    const { container } = render(
      <EvidenceGallery clips={clips} sourceIndices={allFromClipZero()} />,
    )
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    // Nothing was planned, so no decoder was ever opened.
    expect(extractSessionEvidenceMock).not.toHaveBeenCalled()
  })

  it('gives a tier-3 metric no section even though it emitted exemplars (design D10)', async () => {
    const clips = [
      makeClip(
        'a',
        heuristicsResult({
          trunkLean: { exemplars: [pairExemplar()] },
          // Structurally unmeasurable: no card, so nothing for a picture to explain.
          kneeFlexion: { value: null, confidence: 0, exemplars: [pairExemplar()] },
          overstriding: { viewFit: 'unsuitable', exemplars: [pairExemplar()] },
        }),
      ),
    ]
    render(<EvidenceGallery clips={clips} sourceIndices={allFromClipZero()} />)

    await screen.findByRole('heading', { name: 'Trunk lean' })
    expect(screen.queryByRole('heading', { name: 'Knee flexion' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Overstriding' })).not.toBeInTheDocument()
  })

  it('drops a metric whose extraction failed, with no placeholder in its place', async () => {
    extractSessionEvidenceMock.mockImplementation(
      extractsEverything(new Set<MetricId>(['footStrikePattern'])),
    )
    const clips = [
      makeClip(
        'a',
        heuristicsResult({
          trunkLean: { exemplars: [pairExemplar()] },
          footStrikePattern: { exemplars: [singleExemplar()] },
        }),
      ),
    ]
    render(<EvidenceGallery clips={clips} sourceIndices={allFromClipZero()} />)

    await screen.findByRole('heading', { name: 'Trunk lean' })
    expect(screen.queryByRole('heading', { name: 'Foot strike pattern' })).not.toBeInTheDocument()
  })

  it('shows a status line while extraction is in flight, and no sections yet', async () => {
    let release: (value: ClipEvidence[]) => void = () => {}
    extractSessionEvidenceMock.mockImplementation(
      (clips: ClipEvidenceInput[]) =>
        new Promise<ClipEvidence[]>((resolve) => {
          release = () => resolve(clips.map((clip) => extractedFromPlan(clip.plan, new Set())))
        }),
    )
    const clips = [makeClip('a', heuristicsResult({ trunkLean: { exemplars: [pairExemplar()] } }))]
    render(<EvidenceGallery clips={clips} sourceIndices={allFromClipZero()} />)

    await screen.findByRole('status')
    expect(screen.queryByRole('heading', { name: 'Trunk lean' })).not.toBeInTheDocument()
    release([])
    await screen.findByRole('heading', { name: 'Trunk lean' })
  })
})

describe('EvidenceGallery — captions and alt text', () => {
  it('says a ghosted image is one runner at two instants, never two people', async () => {
    const clips = [makeClip('a', heuristicsResult({ trunkLean: { exemplars: [pairExemplar()] } }))]
    render(<EvidenceGallery clips={clips} sourceIndices={allFromClipZero()} />)

    const section = await screen.findByRole('region', { name: 'Trunk lean' })
    const caption = within(section).getByText(/most forward trunk lean/i)
    expect(caption).toHaveTextContent(
      'The two overlapping positions are the same runner at two instants of the same run, blended into one image — not two people.',
    )
    // The instants are named, so a reader (and #68's ffmpeg cross-check) can find them.
    expect(caption).toHaveTextContent('0.20 s and 0.60 s into the clip.')
  })

  it('describes a single-instant image as a single frame', async () => {
    const clips = [
      makeClip('a', heuristicsResult({ footStrikePattern: { exemplars: [singleExemplar()] } })),
    ]
    render(<EvidenceGallery clips={clips} sourceIndices={allFromClipZero()} />)

    const section = await screen.findByRole('region', { name: 'Foot strike pattern' })
    expect(within(section).getByText(/heel-like footstrike, left foot/i)).toHaveTextContent(
      'A single frame, 0.40 s into the clip.',
    )
  })

  it('gives each image alt text naming the metric, the side and what the image is', async () => {
    const clips = [
      makeClip(
        'a',
        heuristicsResult({
          trunkLean: { exemplars: [pairExemplar()] },
          footStrikePattern: { exemplars: [singleExemplar()] },
        }),
      ),
    ]
    render(<EvidenceGallery clips={clips} sourceIndices={allFromClipZero()} />)

    await screen.findByRole('heading', { name: 'Trunk lean' })
    expect(
      screen.getByRole('img', {
        name: /^Trunk lean: Most forward trunk lean.*Two frames of the same runner blended into one image\.$/,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('img', {
        name: /^Foot strike pattern \(left side\): heel-like footstrike.*A single frame from the clip\.$/,
      }),
    ).toBeInTheDocument()
  })

  it('parents the extractor’s own canvas rather than re-encoding it', async () => {
    const clips = [makeClip('a', heuristicsResult({ trunkLean: { exemplars: [pairExemplar()] } }))]
    render(<EvidenceGallery clips={clips} sourceIndices={allFromClipZero()} />)

    const section = await screen.findByRole('region', { name: 'Trunk lean' })
    expect(section.querySelectorAll('canvas')).toHaveLength(1)
  })
})

describe('EvidenceGallery — clip provenance', () => {
  it('names the winning clip when the session holds more than one', async () => {
    const clips = [
      makeClip('a', heuristicsResult({ trunkLean: { exemplars: [pairExemplar()] } })),
      makeClip('b', heuristicsResult({ trunkLean: { exemplars: [pairExemplar()] } })),
    ]
    render(
      <EvidenceGallery
        clips={clips}
        sourceIndices={{ ...allFromClipZero(), trunkLean: 1 }}
      />,
    )

    const section = await screen.findByRole('region', { name: 'Trunk lean' })
    expect(within(section).getByText('From clip 2 of 2.')).toBeInTheDocument()
  })

  it('says nothing about clips in a single-clip session', async () => {
    const clips = [makeClip('a', heuristicsResult({ trunkLean: { exemplars: [pairExemplar()] } }))]
    render(<EvidenceGallery clips={clips} sourceIndices={allFromClipZero()} />)

    const section = await screen.findByRole('region', { name: 'Trunk lean' })
    expect(within(section).queryByText(/from clip/i)).not.toBeInTheDocument()
  })
})

describe('EvidenceGallery — extraction lifecycle', () => {
  it('extracts once per clip and not again on re-render', async () => {
    const clips = [makeClip('a', heuristicsResult({ trunkLean: { exemplars: [pairExemplar()] } }))]
    const view = render(<EvidenceGallery clips={clips} sourceIndices={allFromClipZero()} />)
    await screen.findByRole('heading', { name: 'Trunk lean' })

    // A fresh array of the SAME sessions, exactly what the session component hands down on every
    // one of its renders.
    view.rerender(<EvidenceGallery clips={[...clips]} sourceIndices={allFromClipZero()} />)
    view.rerender(<EvidenceGallery clips={[...clips]} sourceIndices={allFromClipZero()} />)
    expect(extractSessionEvidenceMock).toHaveBeenCalledTimes(1)
  })

  it('only re-extracts the clip that changed when a second clip joins', async () => {
    const clipA = makeClip('a', heuristicsResult({ trunkLean: { exemplars: [pairExemplar()] } }))
    const view = render(<EvidenceGallery clips={[clipA]} sourceIndices={allFromClipZero()} />)
    await screen.findByRole('heading', { name: 'Trunk lean' })

    const clipB = makeClip('b', heuristicsResult({ trunkLean: { exemplars: [pairExemplar()] } }))
    view.rerender(
      <EvidenceGallery clips={[clipA, clipB]} sourceIndices={allFromClipZero()} />,
    )
    await waitFor(() => expect(extractSessionEvidenceMock).toHaveBeenCalledTimes(2))
    // Second batch carries only the new clip; clip A is served from the cache.
    expect(extractSessionEvidenceMock.mock.calls[1][0]).toHaveLength(1)
  })

  it('still settles under StrictMode, which the app actually mounts under', async () => {
    const clips = [makeClip('a', heuristicsResult({ trunkLean: { exemplars: [pairExemplar()] } }))]
    render(
      <StrictMode>
        <EvidenceGallery clips={clips} sourceIndices={allFromClipZero()} />
      </StrictMode>,
    )

    // React's dev-only mount → cleanup → mount cycle invalidates the first pass's extraction; the
    // second pass has to actually re-run it rather than sit on the invalidated one.
    await screen.findByRole('heading', { name: 'Trunk lean' })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    // And the run still reports exactly once, not once per StrictMode pass.
    expect(coverageLines()).toHaveLength(1)
  })

  it('retains nothing when it unmounts mid-extraction', async () => {
    let release: (value: ClipEvidence[]) => void = () => {}
    extractSessionEvidenceMock.mockImplementation(
      (clips: ClipEvidenceInput[]) =>
        new Promise<ClipEvidence[]>((resolve) => {
          release = () => resolve(clips.map((clip) => extractedFromPlan(clip.plan, new Set())))
        }),
    )
    const clips = [makeClip('a', heuristicsResult({ trunkLean: { exemplars: [pairExemplar()] } }))]
    const view = render(<EvidenceGallery clips={clips} sourceIndices={allFromClipZero()} />)
    await screen.findByRole('status')

    view.unmount()
    release([])
    await Promise.resolve()

    expect(document.querySelectorAll('canvas')).toHaveLength(0)
    expect(document.body.textContent).not.toContain('Trunk lean')
  })

  it('drops the adopted canvas from the DOM on unmount', async () => {
    const clips = [makeClip('a', heuristicsResult({ trunkLean: { exemplars: [pairExemplar()] } }))]
    const view = render(<EvidenceGallery clips={clips} sourceIndices={allFromClipZero()} />)
    await screen.findByRole('heading', { name: 'Trunk lean' })
    expect(document.querySelectorAll('canvas')).toHaveLength(1)

    view.unmount()
    expect(document.querySelectorAll('canvas')).toHaveLength(0)
  })
})

describe('EvidenceGallery — reporting up to the metric cards', () => {
  it('reports exactly the metrics that produced imagery', async () => {
    const onChange = vi.fn()
    const clips = [
      makeClip(
        'a',
        heuristicsResult({
          trunkLean: { exemplars: [pairExemplar()] },
          footStrikePattern: { exemplars: [singleExemplar()] },
          // Tier 3 and therefore never eligible, exemplars or not.
          kneeFlexion: { value: null, confidence: 0, exemplars: [pairExemplar()] },
        }),
      ),
    ]
    render(
      <EvidenceGallery
        clips={clips}
        sourceIndices={allFromClipZero()}
        onEvidenceMetricsChange={onChange}
      />,
    )

    await screen.findByRole('heading', { name: 'Trunk lean' })
    const reported = onChange.mock.calls.at(-1)?.[0] as ReadonlySet<MetricId>
    expect([...reported].sort()).toEqual(['footStrikePattern', 'trunkLean'])
  })

  it('does not report again when nothing changed', async () => {
    const onChange = vi.fn()
    const clips = [makeClip('a', heuristicsResult({ trunkLean: { exemplars: [pairExemplar()] } }))]
    const view = render(
      <EvidenceGallery
        clips={clips}
        sourceIndices={allFromClipZero()}
        onEvidenceMetricsChange={onChange}
      />,
    )
    await screen.findByRole('heading', { name: 'Trunk lean' })
    const calls = onChange.mock.calls.length

    view.rerender(
      <EvidenceGallery
        clips={[...clips]}
        sourceIndices={allFromClipZero()}
        onEvidenceMetricsChange={onChange}
      />,
    )
    expect(onChange).toHaveBeenCalledTimes(calls)
  })
})

describe('EvidenceGallery — the [evidence-coverage] console line', () => {
  it('emits once per run, after extraction has settled, and parses on its own', async () => {
    const clips = [
      makeClip(
        'a',
        heuristicsResult({
          trunkLean: { exemplars: [pairExemplar()] },
          footStrikePattern: { exemplars: [singleExemplar()] },
        }),
      ),
    ]
    render(<EvidenceGallery clips={clips} sourceIndices={allFromClipZero()} />)
    await screen.findByRole('heading', { name: 'Trunk lean' })

    const lines = coverageLines()
    expect(lines).toHaveLength(1)
    const payload = lines[0] as {
      clips: Array<{
        clipIndex: number
        frameCount: number
        metrics: Record<string, { status: string; reason: string | null; exemplars: unknown[] }>
      }>
      sourceIndices: Record<string, number>
    }
    expect(payload.clips).toHaveLength(1)
    expect(payload.clips[0]).toMatchObject({ clipIndex: 0, frameCount: FRAMES.length })
    expect(payload.clips[0].metrics.trunkLean).toMatchObject({
      status: 'planned',
      reason: null,
    })
    expect(payload.clips[0].metrics.trunkLean.exemplars).toHaveLength(1)
    expect(payload.sourceIndices.trunkLean).toBe(0)
  })

  it('is its own prefix, never a rider on [analysis-diagnostics]', async () => {
    const clips = [makeClip('a', heuristicsResult({ trunkLean: { exemplars: [pairExemplar()] } }))]
    render(<EvidenceGallery clips={clips} sourceIndices={allFromClipZero()} />)
    await screen.findByRole('heading', { name: 'Trunk lean' })

    const prefixes = logPrefixes()
    expect(prefixes).toContain('[evidence-coverage]')
    expect(prefixes.some((prefix) => prefix.startsWith('[analysis-diagnostics'))).toBe(false)
    // No sub-prefixed sibling: exclusive matching on `[evidence-coverage]` must stay sufficient.
    expect(prefixes.some((prefix) => prefix.startsWith('[evidence-coverage:'))).toBe(false)
  })

  it('carries nothing image-shaped and no metric values', async () => {
    const clips = [makeClip('a', heuristicsResult({ trunkLean: { exemplars: [pairExemplar()] } }))]
    render(<EvidenceGallery clips={clips} sourceIndices={allFromClipZero()} />)
    await screen.findByRole('heading', { name: 'Trunk lean' })

    const raw = logCalls().find((call) => String(call[0]) === '[evidence-coverage]')?.[1] as string
    expect(raw).not.toMatch(/canvas|blob:|data:|ImageBitmap/i)
    const metric = (JSON.parse(raw) as { clips: Array<{ metrics: Record<string, object> }> })
      .clips[0].metrics.trunkLean
    expect(metric).not.toHaveProperty('value')
    expect(metric).not.toHaveProperty('confidence')
  })

  it('reports an extraction failure as a settled verdict, not a pending state', async () => {
    extractSessionEvidenceMock.mockImplementation(
      extractsEverything(new Set<MetricId>(['trunkLean'])),
    )
    const clips = [
      makeClip(
        'a',
        heuristicsResult({
          trunkLean: { exemplars: [pairExemplar()] },
          footStrikePattern: { exemplars: [singleExemplar()] },
        }),
      ),
    ]
    render(<EvidenceGallery clips={clips} sourceIndices={allFromClipZero()} />)
    await screen.findByRole('heading', { name: 'Foot strike pattern' })

    const payload = coverageLines()[0] as {
      clips: Array<{ metrics: Record<string, { status: string; reason: string | null }> }>
    }
    expect(payload.clips[0].metrics.trunkLean).toMatchObject({
      status: 'no-evidence',
      reason: 'extraction-failed',
    })
    // The reasons the pure planner produced still reach the line verbatim.
    expect(payload.clips[0].metrics.cadence.reason).toBe('not-emitted')
    expect(payload.clips[0].metrics.overstriding.reason).toBe('all-gated-out')
  })
})

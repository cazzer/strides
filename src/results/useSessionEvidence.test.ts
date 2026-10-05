import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MetricId } from '../heuristics/types'
import type {
  ClipEvidence,
  ClipEvidenceInput,
  EvidenceExtractionOptions,
  MetricEvidence,
} from '../video/extractFrames'
import type { ClipEvidencePlan } from './evidenceFrames'
import type { ClipSession } from './multiClipAnalysis'
import { useSessionEvidence } from './useSessionEvidence'

/**
 * The hook's own contract, exercised without a DOM decoder: what makes it re-extract, what makes it
 * reuse, and what it leaves on screen while it works.
 *
 * `planClipEvidence` is mocked because the reuse decision is now ABOUT the plan — driving it
 * through real heuristics would test the planner's sensitivity to a graft rather than this hook's
 * response to a plan that did or did not move. `summarizeEvidenceCoverage` is stubbed for the same
 * reason the extractor is: the DEV-only coverage line is not what these tests are about.
 */

/** Which plan the mocked planner returns, keyed by the marker stamped on the fake heuristics. */
const plansByHeuristics = new Map<string, () => ClipEvidencePlan>()

vi.mock('./evidenceFrames', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./evidenceFrames')>()
  return {
    ...actual,
    planClipEvidence: vi.fn((heuristics: { __id: string }) => {
      const build = plansByHeuristics.get(heuristics.__id)
      if (build === undefined) throw new Error(`no plan registered for ${heuristics.__id}`)
      return build()
    }),
    summarizeEvidenceCoverage: vi.fn(() => ({})),
  }
})

/** Resolvers for extractions started but not yet finished, so a test can observe the in-flight
 * state before letting the pass settle. */
let pending: Array<(evidence: ClipEvidence[]) => void> = []
/** Every batch the hook handed the extractor, with the options it passed alongside. */
let calls: Array<{ batch: ClipEvidenceInput[]; options: EvidenceExtractionOptions }> = []

/**
 * Plays the real extractor's merge contract: every planned metric the batch says the hook already
 * holds comes back as that very object, in plan key order, and only the rest are taken from what the
 * test resolves with. A test therefore supplies evidence for exactly the metrics a decoder would
 * have produced, and a reused one it forgot cannot sneak in through the resolution.
 */
function mergeLikeTheExtractor(input: ClipEvidenceInput, produced: ClipEvidence): ClipEvidence {
  const merged = {} as ClipEvidence
  for (const metric of Object.keys(input.plan) as MetricId[]) {
    const entry = input.plan[metric]
    merged[metric] =
      entry.status === 'planned'
        ? (input.reuse?.[metric] ?? produced[metric])
        : entry
  }
  return merged
}

const extractSessionEvidence = vi.fn(
  (batch: ClipEvidenceInput[], options: EvidenceExtractionOptions) =>
    new Promise<ClipEvidence[]>((resolve) => {
      calls.push({ batch, options })
      pending.push((evidence) =>
        resolve(batch.map((input, i) => mergeLikeTheExtractor(input, evidence[i]))),
      )
    }),
)

vi.mock('../video/extractFrames', () => ({
  extractSessionEvidence: (...args: unknown[]) =>
    (extractSessionEvidence as unknown as (...a: unknown[]) => Promise<ClipEvidence[]>)(...args),
}))

const SOURCE_INDICES = { cadence: 0, trunkLean: 0 } as unknown as Record<MetricId, number>

/** A plan with one planned metric. Rebuilt on every call, as the real planner does, so a reuse can
 * only come from structural comparison and never from a shared reference. */
function planWithQuality(quality: number): () => ClipEvidencePlan {
  return () =>
    ({
      cadence: {
        status: 'planned',
        items: [{ metric: 'cadence', kind: 'bounceCycle', quality }],
      },
    }) as unknown as ClipEvidencePlan
}

/** Two planned metrics, each with its own quality, so a graft can move one and leave the other. */
function twoMetricPlan(cadence: number, trunkLean: number): () => ClipEvidencePlan {
  return () =>
    ({
      cadence: {
        status: 'planned',
        items: [{ metric: 'cadence', kind: 'bounceCycle', quality: cadence }],
      },
      trunkLean: {
        status: 'planned',
        items: [{ metric: 'trunkLean', kind: 'trunkLeanRange', quality: trunkLean }],
      },
    }) as unknown as ClipEvidencePlan
}

function metricWithCanvas(metric: MetricId, canvas: HTMLCanvasElement): MetricEvidence {
  return {
    status: 'extracted',
    items: [{ plan: { metric }, canvas }],
  } as unknown as MetricEvidence
}

function canvasOf(
  state: ReturnType<typeof useSessionEvidence>,
  metric: MetricId,
): HTMLCanvasElement | undefined {
  if (state.status === 'idle') return undefined
  return state.sections.find((section) => section.metric === metric)?.items[0].canvas
}

function evidenceWithCanvas(canvas: HTMLCanvasElement): ClipEvidence {
  return {
    cadence: { status: 'extracted', items: [{ plan: { metric: 'cadence' }, canvas }] },
  } as unknown as ClipEvidence
}

function makeClip(clipId: string, heuristicsId: string, sourceBlob: Blob): ClipSession {
  return {
    clipId,
    videoSource: { sourceBlob, metadata: { width: 100, height: 100 } },
    analysis: {
      heuristics: { __id: heuristicsId },
      robustFrames: [],
      scalePass: { status: 'pending', diagnostics: null },
    },
    poster: null,
  } as unknown as ClipSession
}

describe('useSessionEvidence', () => {
  beforeEach(() => {
    pending = []
    calls = []
    plansByHeuristics.clear()
    extractSessionEvidence.mockClear()
  })

  it('reuses a clip whose plan is unchanged, opening no decoder for it', async () => {
    const blob = new Blob(['a'])
    const canvas = {} as HTMLCanvasElement
    plansByHeuristics.set('primary', planWithQuality(0.5))
    // The graft's shape: a NEW heuristics object that leaves the plan structurally identical.
    plansByHeuristics.set('grafted', planWithQuality(0.5))

    const { result, rerender } = renderHook(
      ({ clips }: { clips: ClipSession[] }) => useSessionEvidence(clips, SOURCE_INDICES),
      { initialProps: { clips: [makeClip('c1', 'primary', blob)] } },
    )

    expect(extractSessionEvidence).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.shift()?.([evidenceWithCanvas(canvas)])
    })
    await waitFor(() => expect(result.current.status).toBe('settled'))

    rerender({ clips: [makeClip('c1', 'grafted', blob)] })

    // No second decoder, and the run settles synchronously from cache rather than passing through
    // an extracting state at all.
    expect(extractSessionEvidence).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('settled')
    expect(result.current.status === 'settled' && result.current.sections[0].items[0].canvas).toBe(
      canvas,
    )
  })

  it('keeps the previous sections rendered while a changed plan re-extracts', async () => {
    const blob = new Blob(['a'])
    const first = {} as HTMLCanvasElement
    const second = {} as HTMLCanvasElement
    plansByHeuristics.set('primary', planWithQuality(0.5))
    plansByHeuristics.set('grafted', planWithQuality(0.9))

    const { result, rerender } = renderHook(
      ({ clips }: { clips: ClipSession[] }) => useSessionEvidence(clips, SOURCE_INDICES),
      { initialProps: { clips: [makeClip('c1', 'primary', blob)] } },
    )
    await act(async () => {
      pending.shift()?.([evidenceWithCanvas(first)])
    })
    await waitFor(() => expect(result.current.status).toBe('settled'))

    rerender({ clips: [makeClip('c1', 'grafted', blob)] })

    // The plan moved, so a second pass is genuinely required — and the imagery stays up for it.
    expect(extractSessionEvidence).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('extracting')
    expect(result.current.status === 'extracting' && result.current.sections[0].items[0].canvas).toBe(
      first,
    )

    await act(async () => {
      pending.shift()?.([evidenceWithCanvas(second)])
    })
    await waitFor(() => expect(result.current.status).toBe('settled'))
    expect(result.current.status === 'settled' && result.current.sections[0].items[0].canvas).toBe(
      second,
    )
  })

  it('withholds old clip evidence when a metric winner changes during re-extraction', async () => {
    const firstBlob = new Blob(['first'])
    const secondBlob = new Blob(['second'])
    const firstCanvas = {} as HTMLCanvasElement
    const secondCanvas = {} as HTMLCanvasElement
    const updatedCanvas = {} as HTMLCanvasElement
    plansByHeuristics.set('first', planWithQuality(0.5))
    plansByHeuristics.set('second', planWithQuality(0.5))
    plansByHeuristics.set('second-grafted', planWithQuality(0.9))
    const firstWinner = { ...SOURCE_INDICES, cadence: 0 }
    const secondWinner = { ...SOURCE_INDICES, cadence: 1 }

    const { result, rerender } = renderHook(
      ({ clips, indices }: { clips: ClipSession[]; indices: Record<MetricId, number> }) =>
        useSessionEvidence(clips, indices),
      { initialProps: {
        clips: [makeClip('c1', 'first', firstBlob), makeClip('c2', 'second', secondBlob)],
        indices: firstWinner,
      } },
    )
    await act(async () => {
      pending.shift()?.([evidenceWithCanvas(firstCanvas), evidenceWithCanvas(secondCanvas)])
    })
    await waitFor(() => expect(result.current.status).toBe('settled'))
    expect(result.current.status === 'settled' && result.current.sections[0].clipIndex).toBe(0)

    rerender({
      clips: [makeClip('c1', 'first', firstBlob), makeClip('c2', 'second-grafted', secondBlob)],
      indices: secondWinner,
    })
    expect(result.current.status).toBe('extracting')
    expect(result.current.status === 'extracting' && result.current.sections).toEqual([])
    expect(result.current.status === 'extracting' && result.current.pending).toEqual(['cadence'])

    await act(async () => {
      pending.shift()?.([evidenceWithCanvas(updatedCanvas)])
    })
    await waitFor(() => expect(result.current.status).toBe('settled'))
    expect(result.current.status === 'settled' && result.current.sections[0].clipIndex).toBe(1)
    expect(result.current.status === 'settled' && result.current.sections[0].items[0].canvas).toBe(updatedCanvas)
  })

  it('switches to cached evidence when only the winning source index changes', async () => {
    const clips = [
      makeClip('c1', 'first', new Blob(['first'])),
      makeClip('c2', 'second', new Blob(['second'])),
    ]
    plansByHeuristics.set('first', planWithQuality(0.5))
    plansByHeuristics.set('second', planWithQuality(0.5))
    const firstWinner = { ...SOURCE_INDICES, cadence: 0 }
    const secondWinner = { ...SOURCE_INDICES, cadence: 1 }
    const { result, rerender } = renderHook(
      ({ indices }: { indices: Record<MetricId, number> }) => useSessionEvidence(clips, indices),
      { initialProps: { indices: firstWinner } },
    )
    await act(async () => {
      pending.shift()?.([
        evidenceWithCanvas({} as HTMLCanvasElement),
        evidenceWithCanvas({} as HTMLCanvasElement),
      ])
    })
    await waitFor(() => expect(result.current.status).toBe('settled'))
    rerender({ indices: secondWinner })
    expect(extractSessionEvidence).toHaveBeenCalledTimes(1)
    expect(result.current.status === 'settled' && result.current.sections[0].clipIndex).toBe(1)
  })

  it('names every planned metric as pending on a first extraction', () => {
    plansByHeuristics.set('primary', planWithQuality(0.5))

    const { result } = renderHook(
      ({ clips }: { clips: ClipSession[] }) => useSessionEvidence(clips, SOURCE_INDICES),
      { initialProps: { clips: [makeClip('c1', 'primary', new Blob(['a']))] } },
    )

    // Nothing is on screen yet, so the one planned metric is the one a card should be told is
    // coming. Without this a card that will have a picture is indistinguishable from one that
    // never will, for the whole length of the decode.
    expect(result.current.status).toBe('extracting')
    expect(result.current.status === 'extracting' && result.current.pending).toEqual(['cadence'])
  })

  it('does not report a metric as pending while its previous image is still on screen', async () => {
    const blob = new Blob(['a'])
    plansByHeuristics.set('primary', planWithQuality(0.5))
    plansByHeuristics.set('grafted', planWithQuality(0.9))

    const { result, rerender } = renderHook(
      ({ clips }: { clips: ClipSession[] }) => useSessionEvidence(clips, SOURCE_INDICES),
      { initialProps: { clips: [makeClip('c1', 'primary', blob)] } },
    )
    await act(async () => {
      pending.shift()?.([evidenceWithCanvas({} as HTMLCanvasElement)])
    })
    await waitFor(() => expect(result.current.status).toBe('settled'))

    rerender({ clips: [makeClip('c1', 'grafted', blob)] })

    // The re-extraction carries the old image forward, so covering it with a placeholder would
    // replace a correct picture with a spinner.
    expect(result.current.status).toBe('extracting')
    expect(result.current.status === 'extracting' && result.current.pending).toEqual([])
  })

  it('does not carry sections forward when the clip set changes', async () => {
    const blob = new Blob(['a'])
    plansByHeuristics.set('primary', planWithQuality(0.5))
    plansByHeuristics.set('second', planWithQuality(0.7))

    const { result, rerender } = renderHook(
      ({ clips }: { clips: ClipSession[] }) => useSessionEvidence(clips, SOURCE_INDICES),
      { initialProps: { clips: [makeClip('c1', 'primary', blob)] } },
    )
    await act(async () => {
      pending.shift()?.([evidenceWithCanvas({} as HTMLCanvasElement)])
    })
    await waitFor(() => expect(result.current.status).toBe('settled'))

    // A section's clipIndex addresses a position in this list, so the old indices no longer mean
    // what they meant. Withholding is the honest outcome, not a stale attribution.
    rerender({
      clips: [makeClip('c1', 'primary', blob), makeClip('c2', 'second', new Blob(['b']))],
    })

    expect(result.current.status).toBe('extracting')
    expect(result.current.status === 'extracting' && result.current.sections).toEqual([])
    // Nothing carried means everything planned is pending, so the cards say "being prepared"
    // rather than going blank for the length of the re-decode.
    expect(result.current.status === 'extracting' && result.current.pending).toEqual(['cadence'])
  })

  it('re-extracts when the source blob changes even though the plan is identical', async () => {
    plansByHeuristics.set('primary', planWithQuality(0.5))

    const { result, rerender } = renderHook(
      ({ clips }: { clips: ClipSession[] }) => useSessionEvidence(clips, SOURCE_INDICES),
      { initialProps: { clips: [makeClip('c1', 'primary', new Blob(['a']))] } },
    )
    await act(async () => {
      pending.shift()?.([evidenceWithCanvas({} as HTMLCanvasElement)])
    })
    await waitFor(() => expect(result.current.status).toBe('settled'))

    // Same plan, different pixels: the plan alone is not the reuse key.
    rerender({ clips: [makeClip('c1', 'primary', new Blob(['b']))] })

    expect(extractSessionEvidence).toHaveBeenCalledTimes(2)
  })

  describe('per-metric re-extraction (strides-zm8)', () => {
    it('re-decodes only the metric whose plan moved, reusing the rest by reference', async () => {
      const blob = new Blob(['a'])
      const cadence = {} as HTMLCanvasElement
      const leanBefore = {} as HTMLCanvasElement
      const leanAfter = {} as HTMLCanvasElement
      plansByHeuristics.set('primary', twoMetricPlan(0.5, 0.5))
      // The graft's shape: one metric's plan moves, the other's is carried through unchanged.
      plansByHeuristics.set('grafted', twoMetricPlan(0.5, 0.9))

      const { result, rerender } = renderHook(
        ({ clips }: { clips: ClipSession[] }) => useSessionEvidence(clips, SOURCE_INDICES),
        { initialProps: { clips: [makeClip('c1', 'primary', blob)] } },
      )
      await act(async () => {
        pending.shift()?.([
          {
            cadence: metricWithCanvas('cadence', cadence),
            trunkLean: metricWithCanvas('trunkLean', leanBefore),
          } as ClipEvidence,
        ])
      })
      await waitFor(() => expect(result.current.status).toBe('settled'))

      rerender({ clips: [makeClip('c1', 'grafted', blob)] })

      // A decoder IS needed — for trunkLean only. cadence rides along as held evidence.
      expect(extractSessionEvidence).toHaveBeenCalledTimes(2)
      const second = calls[1].batch[0]
      expect(Object.keys(second.reuse ?? {})).toEqual(['cadence'])
      const held = second.reuse?.cadence
      expect(held?.status === 'extracted' && held.items[0].canvas).toBe(cadence)

      await act(async () => {
        pending.shift()?.([{ trunkLean: metricWithCanvas('trunkLean', leanAfter) } as ClipEvidence])
      })
      await waitFor(() => expect(result.current.status).toBe('settled'))
      // The same canvas ELEMENT for the unchanged metric, a new one for the moved metric, and the
      // sections still in plan order — exactly what a full re-extraction would have settled to.
      expect(canvasOf(result.current, 'cadence')).toBe(cadence)
      expect(canvasOf(result.current, 'trunkLean')).toBe(leanAfter)
      expect(
        result.current.status === 'settled' && result.current.sections.map((s) => s.metric),
      ).toEqual(['cadence', 'trunkLean'])
    })

    it('keeps the metrics a superseded pass finished, and drops the rest of it', async () => {
      const blob = new Blob(['a'])
      const cadence = {} as HTMLCanvasElement
      const lateLean = {} as HTMLCanvasElement
      const lateCadence = {} as HTMLCanvasElement
      const leanAfter = {} as HTMLCanvasElement
      plansByHeuristics.set('primary', twoMetricPlan(0.5, 0.5))
      plansByHeuristics.set('grafted', twoMetricPlan(0.5, 0.9))

      const { result, rerender } = renderHook(
        ({ clips }: { clips: ClipSession[] }) => useSessionEvidence(clips, SOURCE_INDICES),
        { initialProps: { clips: [makeClip('c1', 'primary', blob)] } },
      )
      // The first pass finishes cadence and is still decoding trunkLean when the graft lands —
      // the shape of every single-clip run, where the scale pass beats the primary extraction.
      const first = calls[0]
      first.batch[0].onMetricExtracted?.('cadence', metricWithCanvas('cadence', cadence))

      rerender({ clips: [makeClip('c1', 'grafted', blob)] })

      // Superseded passes are abandoned, not merely ignored.
      expect(first.options.signal?.aborted).toBe(true)
      // The superseding pass is handed cadence's finished image instead of a seek for it.
      const second = calls[1].batch[0]
      expect(Object.keys(second.reuse ?? {})).toEqual(['cadence'])

      // The abandoned pass resolves late, whatever it resolves with: none of it lands.
      await act(async () => {
        pending.shift()?.([
          {
            cadence: metricWithCanvas('cadence', lateCadence),
            trunkLean: metricWithCanvas('trunkLean', lateLean),
          } as ClipEvidence,
        ])
      })
      expect(result.current.status).toBe('extracting')
      expect(canvasOf(result.current, 'trunkLean')).toBeUndefined()

      await act(async () => {
        pending.shift()?.([{ trunkLean: metricWithCanvas('trunkLean', leanAfter) } as ClipEvidence])
      })
      await waitFor(() => expect(result.current.status).toBe('settled'))
      expect(canvasOf(result.current, 'cadence')).toBe(cadence)
      expect(canvasOf(result.current, 'trunkLean')).toBe(leanAfter)
    })

    it('does not reuse a finished metric whose own plan moved', async () => {
      const blob = new Blob(['a'])
      plansByHeuristics.set('primary', twoMetricPlan(0.5, 0.5))
      plansByHeuristics.set('grafted', twoMetricPlan(0.5, 0.9))

      const { rerender } = renderHook(
        ({ clips }: { clips: ClipSession[] }) => useSessionEvidence(clips, SOURCE_INDICES),
        { initialProps: { clips: [makeClip('c1', 'primary', blob)] } },
      )
      calls[0].batch[0].onMetricExtracted?.(
        'trunkLean',
        metricWithCanvas('trunkLean', {} as HTMLCanvasElement),
      )

      rerender({ clips: [makeClip('c1', 'grafted', blob)] })

      // trunkLean was finished — for a plan entry nothing asks for any more.
      expect(calls[1].batch[0].reuse).toEqual({})
    })

    it('ignores a metric reported by a pass after it was superseded', async () => {
      const blob = new Blob(['a'])
      plansByHeuristics.set('primary', twoMetricPlan(0.5, 0.5))
      plansByHeuristics.set('grafted', twoMetricPlan(0.5, 0.9))
      plansByHeuristics.set('regrafted', twoMetricPlan(0.5, 0.7))

      const { rerender } = renderHook(
        ({ clips }: { clips: ClipSession[] }) => useSessionEvidence(clips, SOURCE_INDICES),
        { initialProps: { clips: [makeClip('c1', 'primary', blob)] } },
      )
      rerender({ clips: [makeClip('c1', 'grafted', blob)] })
      // A report that arrives after the pass was let go of — whatever the extractor did to get
      // here, the hook must not take it: a released run writes nothing.
      calls[0].batch[0].onMetricExtracted?.(
        'cadence',
        metricWithCanvas('cadence', {} as HTMLCanvasElement),
      )

      rerender({ clips: [makeClip('c1', 'regrafted', blob)] })

      expect(calls[2].batch[0].reuse).toEqual({})
    })

    it('opens no decoder when a superseded pass already finished everything the new plan needs', async () => {
      const blob = new Blob(['a'])
      const cadence = {} as HTMLCanvasElement
      const lean = {} as HTMLCanvasElement
      plansByHeuristics.set('primary', twoMetricPlan(0.5, 0.5))
      plansByHeuristics.set('grafted', twoMetricPlan(0.5, 0.5))

      const { result, rerender } = renderHook(
        ({ clips }: { clips: ClipSession[] }) => useSessionEvidence(clips, SOURCE_INDICES),
        { initialProps: { clips: [makeClip('c1', 'primary', blob)] } },
      )
      calls[0].batch[0].onMetricExtracted?.('cadence', metricWithCanvas('cadence', cadence))
      calls[0].batch[0].onMetricExtracted?.('trunkLean', metricWithCanvas('trunkLean', lean))

      rerender({ clips: [makeClip('c1', 'grafted', blob)] })

      expect(extractSessionEvidence).toHaveBeenCalledTimes(1)
      expect(result.current.status).toBe('settled')
      expect(canvasOf(result.current, 'cadence')).toBe(cadence)
      expect(canvasOf(result.current, 'trunkLean')).toBe(lean)
    })
  })
})

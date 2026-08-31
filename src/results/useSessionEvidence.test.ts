import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MetricId } from '../heuristics/types'
import type { ClipEvidence } from '../video/extractFrames'
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
const extractSessionEvidence = vi.fn(
  () =>
    new Promise<ClipEvidence[]>((resolve) => {
      pending.push(resolve)
    }),
)

vi.mock('../video/extractFrames', () => ({
  extractSessionEvidence: (...args: unknown[]) =>
    (extractSessionEvidence as unknown as (...a: unknown[]) => Promise<ClipEvidence[]>)(...args),
}))

const SOURCE_INDICES = { cadence: 0 } as unknown as Record<MetricId, number>

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
})

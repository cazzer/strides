import { vi } from 'vitest'
import type { ScalePassStatus } from '../../guidance/types'
import { makeHeuristics } from '../../results/__fixtures__/metricResult'
import type { ClipSession } from '../../results/multiClipAnalysis'
import type { AnalysisDiagnostics } from '../../results/analysisDiagnostics'

/** A finished clip session, just deep enough for the storage UI. */
export function finishedClip(
  id: string,
  options: { scalePass?: ScalePassStatus; outlinePass?: ScalePassStatus; bytes?: number; name?: string } = {},
): ClipSession {
  const source = new File([new Uint8Array(options.bytes ?? 2048)], options.name ?? `${id}.mp4`, { type: 'video/mp4' })
  return {
    clipId: id,
    poster: null,
    videoSource: {
      videoRef: { current: null },
      status: 'ready',
      metadata: { durationSec: 3, width: 1920, height: 1080, frameRate: null },
      error: null,
      sourceBlob: source,
      load: vi.fn(),
      reset: vi.fn(),
    },
    analysis: {
      phase: 'ready',
      progress: 1,
      isPausedMidAnalysis: false,
      robustFrames: [],
      heuristics: makeHeuristics(),
      diagnostics: { sampling: { path: 'sequential' } } as unknown as AnalysisDiagnostics,
      scalePass: { status: options.scalePass ?? 'done', diagnostics: null },
      outlinePass: { status: options.outlinePass ?? 'skipped' },
      error: null,
      primarySamplingPath: 'sequential',
      start: vi.fn(),
      reset: vi.fn(),
    },
  }
}

import { useCallback, useEffect, useState } from 'react'
import { CAMERA_TWEEN_MS } from '../../runner/runnerScene'

/**
 * Where a stop that opens on the whole figure before its stride view stands:
 * - `whole`: the area's own camera with the headline alone, through the arrival tween and a beat;
 * - `easing`: the camera eases out to the stride view, still with the headline alone;
 * - `drawn`: the stride view with every mark (vertical ratio's stride and inset).
 */
export type StrideOpeningPhase = 'whole' | 'easing' | 'drawn'

/** How long the whole figure holds after the arrival tween before the camera eases out, ms. */
export const STRIDE_OPENING_BEAT_MS = 1500
/**
 * How long `easing` waits for the runner to report its camera at rest on the stride view before it
 * draws the marks anyway (a runner that never reports, or a dropped report), ms.
 */
export const STRIDE_OPENING_REST_FALLBACK_MS = 2 * CAMERA_TWEEN_MS

/** The camera the opening eases out to; the runner names it in `onCameraRest`. */
const STRIDE_CAMERA = 'strideSide'

interface OpeningState {
  key: string | null
  phase: StrideOpeningPhase
}

function startPhase(key: string | null, reducedMotion: boolean): StrideOpeningPhase {
  return key === null || reducedMotion ? 'drawn' : 'whole'
}

export interface StrideOpening {
  phase: StrideOpeningPhase
  /** Hand to the runner's `onCameraRest`: the camera resting on the stride view ends `easing`. */
  onCameraRest: (camera: string) => void
}

/**
 * The opening sequence of a stop whose stride view frames a stride several figures long: the reader
 * first sees the headline on the whole figure, then the camera eases out to the stride, and only
 * once the runner reports it at rest do the stride's marks draw, so they never appear clipped by a
 * camera still on its way (a timer stands in if no report comes). `key` names the stop while it
 * opens this way (null: it does not, or no stop is shown); a new key starts the sequence again.
 * Under reduced motion it is `drawn` at once (the stride view, cut), and stays so if reduced motion
 * is switched off at the same stop.
 */
export function useStrideOpening(key: string | null, reducedMotion: boolean): StrideOpening {
  const [state, setState] = useState<OpeningState>(() => ({ key, phase: startPhase(key, reducedMotion) }))
  let { phase } = state
  if (state.key !== key || (reducedMotion && phase !== 'drawn')) {
    phase = startPhase(key, reducedMotion)
    if (state.key === key) phase = 'drawn'
    setState({ key, phase })
  }

  useEffect(() => {
    if (key === null || phase === 'drawn') return
    const next: StrideOpeningPhase = phase === 'whole' ? 'easing' : 'drawn'
    const delay = phase === 'whole' ? CAMERA_TWEEN_MS + STRIDE_OPENING_BEAT_MS : STRIDE_OPENING_REST_FALLBACK_MS
    const timer = setTimeout(() => {
      setState((s) => (s.key === key && s.phase === phase ? { key, phase: next } : s))
    }, delay)
    return () => clearTimeout(timer)
  }, [key, phase])

  const onCameraRest = useCallback((camera: string) => {
    if (camera !== STRIDE_CAMERA) return
    setState((s) => (s.phase === 'easing' ? { ...s, phase: 'drawn' } : s))
  }, [])

  return { phase, onCameraRest }
}

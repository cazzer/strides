import { useEffect, useState } from 'react'
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

interface OpeningState {
  key: string | null
  phase: StrideOpeningPhase
}

function startPhase(key: string | null, reducedMotion: boolean): StrideOpeningPhase {
  return key === null || reducedMotion ? 'drawn' : 'whole'
}

/**
 * The opening sequence of a stop whose stride view frames a stride several figures long: the reader
 * first sees the headline on the whole figure, then the camera eases out to the stride, and only
 * once it rests do the stride's marks draw, so they never appear clipped by a camera still on its
 * way. `key` names the stop while it opens this way (null: it does not, or no stop is shown); a new
 * key starts the sequence again. Under reduced motion it is always `drawn`: the stride view at once,
 * cut, never tweened.
 */
export function useStrideOpening(key: string | null, reducedMotion: boolean): StrideOpeningPhase {
  const [state, setState] = useState<OpeningState>(() => ({ key, phase: startPhase(key, reducedMotion) }))
  let { phase } = state
  if (state.key !== key) {
    phase = startPhase(key, reducedMotion)
    setState({ key, phase })
  }
  const current = reducedMotion ? 'drawn' : phase

  useEffect(() => {
    if (key === null || current === 'drawn') return
    const next: StrideOpeningPhase = current === 'whole' ? 'easing' : 'drawn'
    const delay = current === 'whole' ? CAMERA_TWEEN_MS + STRIDE_OPENING_BEAT_MS : CAMERA_TWEEN_MS
    const timer = setTimeout(() => {
      setState((s) => (s.key === key ? { key, phase: next } : s))
    }, delay)
    return () => clearTimeout(timer)
  }, [key, current])

  return current
}

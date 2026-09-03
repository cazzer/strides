import { useSyncExternalStore } from 'react'
import type { ModelLoadState } from './modelLoadState'
import {
  getScalePassDetectorLoadState,
  subscribeToScalePassDetectorLoad,
} from './scalePassDetector'

/**
 * Reads the scale-pass detector's model-load state into the render tree.
 *
 * Lives in its own file, apart from `scalePassDetector.ts`, on purpose: that module must import no
 * rendering library, because the one thing this observation channel must not do is turn a
 * module-cached, page-lifetime singleton into a component-lifetime resource (`strides-utn.1`,
 * design.md D3). Keeping React on this side of the boundary makes that mechanical rather than a
 * convention someone has to remember.
 *
 * `useSyncExternalStore` rather than a `useState` + `useEffect` pair: the state can move before this
 * hook ever subscribes (an analysis run may already have requested the detector), and
 * `useSyncExternalStore` reads the current snapshot on every render rather than only on
 * transitions it happened to be listening for.
 */
export function useScalePassDetectorLoad(): ModelLoadState {
  return useSyncExternalStore(
    subscribeToScalePassDetectorLoad,
    getScalePassDetectorLoadState,
    // Server snapshot: this app never renders on a server, but React demands the third argument
    // under any non-browser render, and the accessor is a plain module read that works anywhere.
    getScalePassDetectorLoadState,
  )
}

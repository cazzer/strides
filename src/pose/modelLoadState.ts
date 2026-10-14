/**
 * The one shape both detector owners publish their model-load progress through — the primary
 * detector hook (`usePoseDetector`) and the module-cached scale-pass accessor
 * (`scalePassDetector`). They fetch different models at different moments (MoveNet's weights at
 * app mount; MediaPipe's WASM plus a 9.4 MB `.task` only once a first clip reaches `'ready'`), so
 * they cannot share one state object — but they can share one vocabulary, which is what lets the
 * header render either of them without knowing which is which.
 *
 * `strides-utn.1`. This module is the wire only: nothing here fetches, caches, or renders.
 */

/**
 * `'idle'` exists for the scale pass, not for the primary detector: the scale-pass detector is
 * lazy and is genuinely idle until an analysis run asks for it, while `usePoseDetector` creates on
 * mount and is therefore `'loading'` from its first render (see `PoseDetectorStatus`, which narrows
 * this union rather than restating it).
 */
export type ModelLoadPhase = 'idle' | 'loading' | 'ready' | 'error'

/** A determinate byte reading. Only ever present when a real total is known. */
export interface ModelLoadProgress {
  loadedBytes: number
  totalBytes: number
}

export interface ModelLoadState {
  phase: ModelLoadPhase
  /**
   * `null` means INDETERMINATE — "this download is in flight and nobody can say how far along it
   * is" — and never zero, never a placeholder, and never a figure to render a percentage from.
   * That distinction is load-bearing rather than fussy: at least one asset in this pipeline is
   * structurally uninstrumentable (MediaPipe's `FilesetResolver` exposes no WASM progress hook at
   * all, and tfjs's own `LoadOptions.onProgress` is a fraction of FILES, not bytes), so a shape
   * that forced a number would force the UI to invent one.
   */
  progress: ModelLoadProgress | null
}

/** Both owners' states together, as the application header receives them. */
export interface ModelLoadStates {
  /** The shared primary detector every clip's analysis runs against. */
  primary: ModelLoadState
  /** The background scale pass's dedicated, module-cached MediaPipe detector. */
  scalePass: ModelLoadState
}

/**
 * Shared frozen constant, not a fresh object per read: it is the scale-pass channel's snapshot
 * before anything has requested a detector, and `useSyncExternalStore` re-renders forever if its
 * `getSnapshot` hands back a new identity each call.
 */
export const IDLE_MODEL_LOAD_STATE: ModelLoadState = Object.freeze({
  phase: 'idle',
  progress: null,
})

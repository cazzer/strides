import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision'

/**
 * Dynamic-valgus-proxy probe (GitHub #47, scope-corrected — see CLAUDE.md's "Dynamic valgus
 * proxy investigation" section). Mirrors `mediapipePoseLandmarker.ts`'s integration pattern for
 * a different Task class within the same already-integrated `@mediapipe/tasks-vision` package —
 * `ImageSegmenter` rather than `PoseLandmarker` — so there's no reason for the WASM runtime
 * version to diverge between the two.
 *
 * This file is never wired into the shipped app: it exists purely to be manually spliced into
 * `sampleClip.ts`'s `onFrame` callback for a driven-by-hand live probe (see CLAUDE.md), then left
 * in place as the spike's prototype artifact once the splice itself is reverted.
 */
const WASM_BASE_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'

/**
 * MediaPipe's stock binary foreground/background "selfie" segmenter. Deliberately NOT
 * self-hosted the way `mediapipePoseLandmarker.ts`'s pose model is: that file protects a shipped
 * metric's byte-identical model against the hosted `latest` tag drifting; this is a throwaway
 * single-session probe with no shipped output to protect, so fetching the float16 variant
 * straight from Google's hosted bucket's `latest` tag is the right amount of ceremony. Chosen
 * over a multiclass segmenter per the architecture note in #47: in a tight leg crop, foreground
 * ≈ the leg/shoe blob, sidestepping the ambiguous multiclass-category question entirely.
 */
const MODEL_ASSET_PATH =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'

export interface SegmentationMask {
  /** Row-major, one byte per pixel. For this specific model (binary 2-class `selfie_segmenter`)
   * expected to be background/foreground category indices — verified live rather than assumed,
   * see CLAUDE.md's write-up for what was actually observed. Callers should treat this as an
   * opaque per-pixel value and use an explicit `isForeground` predicate rather than hardcoding a
   * threshold, in case the encoding turns out to differ from what's documented here. */
  categories: Uint8Array
  width: number
  height: number
}

export interface ExperimentalImageSegmenter {
  /** The category labels this model's mask indices resolve to (e.g. `['background',
   * 'foreground']`) — logged once by the probe for verification, not otherwise consumed. */
  labels: string[]
  /**
   * `image` must already be cropped/resized to the region of interest — the segmenter has no
   * concept of a crop, it segments whatever pixels it's given. `timestampMs` must be strictly
   * increasing across calls on one instance (MediaPipe's VIDEO running-mode requirement, same
   * constraint `mediapipePoseLandmarker.ts` documents). This probe doesn't need that backend's
   * restart-remap trick — not because the constraint doesn't apply here too, but because the
   * probe's driving harness disables the background scale pass (see CLAUDE.md) specifically so
   * this segmenter is only ever driven by one uninterrupted forward clip playback.
   */
  segment(image: HTMLCanvasElement, timestampMs: number): SegmentationMask | null
  dispose(): void
}

export async function createExperimentalImageSegmenter(): Promise<ExperimentalImageSegmenter> {
  const wasmFileset = await FilesetResolver.forVisionTasks(WASM_BASE_PATH)
  const segmenter = await ImageSegmenter.createFromOptions(wasmFileset, {
    baseOptions: { modelAssetPath: MODEL_ASSET_PATH, delegate: 'GPU' },
    runningMode: 'VIDEO',
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  })

  return {
    labels: segmenter.getLabels(),
    segment(image, timestampMs) {
      const result = segmenter.segmentForVideo(image, timestampMs)
      const categoryMask = result.categoryMask
      if (!categoryMask) {
        result.close()
        return null
      }
      // `.slice()`: detach from whatever buffer `getAsUint8Array()` handed back before
      // `result.close()` frees the underlying WASM/GPU resources it came from.
      const categories = categoryMask.getAsUint8Array().slice()
      const { width, height } = categoryMask
      result.close()
      return { categories, width, height }
    },
    dispose(): void {
      segmenter.close()
    },
  }
}

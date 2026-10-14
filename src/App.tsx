import { useEffect, useMemo } from 'react'
import type { ModelLoadStates } from './pose/modelLoadState'
import { usePoseDetector } from './pose/usePoseDetector'
import { useScalePassDetectorLoad } from './pose/useScalePassDetectorLoad'
import { resolvePoseDetectorConfig } from './pose/poseBackendConfig'
import { prefetchScalePassAssets } from './pose/scalePassAssetPrefetch'
import { resolveScalePassConfig } from './results/scalePassConfig'
import { MultiClipVideoSession } from './results/MultiClipVideoSession'

/**
 * The whole page is one clip session, header included.
 *
 * The header used to live here, but the clip strip inside it hosts each clip's real, painting
 * `<video>` while that clip is being analysed (`strides-kyu.13` — concealing it costs ~20-24% of
 * the sampled frames on the playback path), and those elements are owned by the component that
 * owns the clip list. Splitting the header off from the clips would mean either portalling into a
 * target that is `null` on the first render, or positioning elements over separately-rendered
 * entries — both of which fail silently by leaving the element concealed. So the header moved down
 * with the clips, and what is left here is the one thing genuinely above the session: the shared
 * pose detector.
 *
 * ### Why the model-load states are read here
 *
 * Two independent, differently-timed model downloads back this page — MoveNet's weights at mount,
 * and MediaPipe's WASM plus a 9.4 MB `.task` only once a first clip reaches `'ready'`. This
 * component is the one place above the session that can see both, so it reads both and hands them
 * down together (`strides-utn.1`). `usePoseDetector`'s status used to be destructured away and
 * dropped here, which is why nothing in the product ever mentioned a download in progress.
 */
export function App() {
  const poseDetector = usePoseDetector()
  const scalePassLoad = useScalePassDetectorLoad()

  // Once the primary detector's own models are in, pull the scale pass's MediaPipe assets into the
  // HTTP cache on idle, so they are not first requested mid-analysis. Bytes only — see
  // scalePassAssetPrefetch.ts. A MediaPipe primary already loads those assets itself.
  useEffect(() => {
    if (poseDetector.status !== 'ready') return
    if (!resolveScalePassConfig().enabled) return
    if (resolvePoseDetectorConfig().backend === 'mediapipePoseLandmarker') return
    if (typeof requestIdleCallback === 'function') {
      const handle = requestIdleCallback(prefetchScalePassAssets, { timeout: 2000 })
      return () => cancelIdleCallback(handle)
    }
    const handle = setTimeout(prefetchScalePassAssets, 0)
    return () => clearTimeout(handle)
  }, [poseDetector.status])

  // Memoised because `App` re-renders on every phase transition of either owner, and a fresh object
  // identity per render is a cost this repo has already paid for once downstream (see
  // `sameClipSession` in MultiClipVideoSession). Both members are themselves stable between
  // transitions, so this settles as soon as the loads do.
  const modelLoad = useMemo<ModelLoadStates>(
    () => ({ primary: poseDetector.load, scalePass: scalePassLoad }),
    [poseDetector.load, scalePassLoad],
  )

  return <MultiClipVideoSession detector={poseDetector.detector} modelLoad={modelLoad} />
}

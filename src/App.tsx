import { usePoseDetector } from './pose/usePoseDetector'
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
 */
export function App() {
  const poseDetector = usePoseDetector()

  return <MultiClipVideoSession detector={poseDetector.detector} />
}

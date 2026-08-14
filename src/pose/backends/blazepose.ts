import * as tf from '@tensorflow/tfjs-core'
import * as poseDetection from '@tensorflow-models/pose-detection'
import type { PoseDetector, PoseFrameSource } from '../detector'
import type { PoseFrame } from '../types'
import { toPoseFrame } from './common'

/**
 * `runtime: 'tfjs'`, not `'mediapipe'` — the mediapipe runtime needs the real `@mediapipe/pose`
 * package (WASM assets, non-bundler-friendly build), which this app deliberately stubs out at
 * build time (see `backends/__shims__/mediapipe-pose.ts`) because nothing was meant to use it.
 * The tfjs runtime gets BlazePose on the same plain-TFJS path MoveNet already uses.
 */
export async function createBlazePoseDetector(): Promise<PoseDetector> {
  await tf.setBackend('webgl')
  await tf.ready()

  const rawDetector = await poseDetection.createDetector(
    poseDetection.SupportedModels.BlazePose,
    { runtime: 'tfjs', modelType: 'full' },
  )

  return {
    async estimatePose(source: PoseFrameSource): Promise<PoseFrame | null> {
      const poses = await rawDetector.estimatePoses(source.image)
      if (poses.length === 0) return null
      return toPoseFrame(poses[0].keypoints, source.timestampSec)
    },
    dispose(): void {
      rawDetector.dispose()
    },
  }
}

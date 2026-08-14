import * as tf from '@tensorflow/tfjs-core'
import * as poseDetection from '@tensorflow-models/pose-detection'
import type { PoseDetector, PoseFrameSource } from '../detector'
import type { PoseFrame } from '../types'
import { toPoseFrame } from './common'

/**
 * No modelConfig passed — the library defaults to `MOBILENET_V1_CONFIG`
 * (`posenet/constants.js`), same MobileNetV1/stride-16 preset TF's own examples use. PoseNet is
 * MoveNet's older, superseded predecessor (see GitHub issue #26) — this backend exists for a
 * lower-bound comparison, not as an accuracy candidate, so no reason to hand-tune its config.
 */
export async function createPoseNetDetector(): Promise<PoseDetector> {
  await tf.setBackend('webgl')
  await tf.ready()

  const rawDetector = await poseDetection.createDetector(
    poseDetection.SupportedModels.PoseNet,
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

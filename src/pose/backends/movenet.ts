import '@tensorflow/tfjs-backend-webgl'
import * as tf from '@tensorflow/tfjs-core'
import * as poseDetection from '@tensorflow-models/pose-detection'
import type { PoseDetector } from '../detector'
import type { PoseFrame } from '../types'
import { toPoseFrame } from './common'

export async function createMoveNetDetector(): Promise<PoseDetector> {
  await tf.setBackend('webgl')
  await tf.ready()

  const rawDetector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING },
  )

  return {
    async estimatePose(video: HTMLVideoElement): Promise<PoseFrame | null> {
      const poses = await rawDetector.estimatePoses(video)
      if (poses.length === 0) return null
      return toPoseFrame(poses[0].keypoints, video.currentTime)
    },
    dispose(): void {
      rawDetector.dispose()
    },
  }
}

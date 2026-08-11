import { QualityWarningBanner } from './quality/QualityWarningBanner'
import { useVideoQualityGate } from './quality/useVideoQualityGate'
import { usePoseDetector } from './pose/usePoseDetector'
import { useVideoSource } from './video/useVideoSource'
import { VideoInputPanel } from './video/VideoInputPanel'
import { ResultsView } from './results/ResultsView'
import { SkeletonOverlay } from './results/SkeletonOverlay'
import { useVideoAnalysis } from './results/useVideoAnalysis'

export function App() {
  const videoSource = useVideoSource()
  // One shared detector for both the quality gate and the analysis pipeline — paying MoveNet's
  // WebGL/model-load cost twice (quality-gate-then-analyze happens on every session) is a
  // guaranteed, avoidable cost, not a hypothetical one.
  const poseDetector = usePoseDetector()
  const qualityGate = useVideoQualityGate(videoSource, poseDetector.detector)
  const analysis = useVideoAnalysis(videoSource, poseDetector.detector)

  // "Proceed anyway" unmounts the alert that currently holds focus — without
  // this, focus silently drops to <body>, disorienting keyboard/screen-reader
  // users (the same bug class already fixed once in WebcamCapture on #4).
  // The video element is a stable, already-visible next target.
  const handleProceedAnyway = () => {
    qualityGate.proceedAnyway()
    videoSource.videoRef.current?.focus()
  }

  return (
    <main>
      <h1>Strides</h1>
      <p>Browser-based running form analysis.</p>
      <VideoInputPanel videoSource={videoSource}>
        {analysis.phase === 'ready' && analysis.robustFrames && videoSource.metadata && (
          <SkeletonOverlay
            videoRef={videoSource.videoRef}
            frames={analysis.robustFrames}
            metadata={videoSource.metadata}
          />
        )}
      </VideoInputPanel>
      {videoSource.status === 'ready' && (
        <QualityWarningBanner
          status={qualityGate.status}
          assessment={qualityGate.assessment}
          dismissed={qualityGate.dismissed}
          proceedAnyway={handleProceedAnyway}
        />
      )}
      {videoSource.status === 'ready' && (
        <ResultsView
          analysis={analysis}
          qualityAssessing={qualityGate.status === 'assessing'}
        />
      )}
    </main>
  )
}

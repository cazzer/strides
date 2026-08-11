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
  const qualityGate = useVideoQualityGate(
    videoSource,
    poseDetector.detector,
    poseDetector.status,
  )
  const analysis = useVideoAnalysis(videoSource, poseDetector.detector)

  // "Proceed anyway" unmounts the alert that currently holds focus — without
  // this, focus silently drops to <body>, disorienting keyboard/screen-reader
  // users (the same bug class already fixed once in WebcamCapture on #4).
  // The video element is a stable, already-visible next target.
  const handleProceedAnyway = () => {
    qualityGate.proceedAnyway()
    videoSource.videoRef.current?.focus()
  }

  // Same fix, same reason: "Try again" unmounts the alert that holds focus when the
  // analysis error clears.
  const handleTryAgain = () => {
    analysis.reset()
    videoSource.videoRef.current?.focus()
  }

  return (
    <>
      <header className="sticky top-0 z-10 border-b-2 border-black dark:border-white bg-white dark:bg-black px-4 sm:px-6 py-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">Strides</h1>
        <p className="font-sans text-sm text-neutral-600 dark:text-neutral-400">
          Browser-based running form analysis.
        </p>
      </header>
      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-10 space-y-8">
        <VideoInputPanel videoSource={videoSource}>
          {analysis.phase === 'ready' &&
            analysis.robustFrames &&
            videoSource.metadata && (
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
            onTryAgain={handleTryAgain}
          />
        )}
      </main>
    </>
  )
}

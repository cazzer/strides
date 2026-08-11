import { usePoseDetector } from './pose/usePoseDetector'
import { useVideoSource } from './video/useVideoSource'
import { VideoInputPanel } from './video/VideoInputPanel'
import { ResultsView } from './results/ResultsView'
import { SkeletonOverlay } from './results/SkeletonOverlay'
import { useVideoAnalysis } from './results/useVideoAnalysis'

export function App() {
  const videoSource = useVideoSource()
  const poseDetector = usePoseDetector()
  const analysis = useVideoAnalysis(videoSource, poseDetector.detector)

  // "Try again" unmounts the alert that holds focus when the analysis error clears — without
  // this, focus silently drops to <body>, disorienting keyboard/screen-reader users (the same
  // bug class already fixed once in WebcamCapture on #4). The video element is a stable,
  // already-visible next target.
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
      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-10 space-y-8 lg:grid lg:grid-cols-2 lg:items-start lg:gap-8 lg:space-y-0">
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
          <ResultsView analysis={analysis} onTryAgain={handleTryAgain} />
        )}
      </main>
    </>
  )
}

import { QualityWarningBanner } from './quality/QualityWarningBanner'
import { useVideoQualityGate } from './quality/useVideoQualityGate'
import { useVideoSource } from './video/useVideoSource'
import { VideoInputPanel } from './video/VideoInputPanel'

export function App() {
  const videoSource = useVideoSource()
  const qualityGate = useVideoQualityGate(videoSource)

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
      <VideoInputPanel videoSource={videoSource} />
      {videoSource.status === 'ready' && (
        <QualityWarningBanner
          status={qualityGate.status}
          assessment={qualityGate.assessment}
          dismissed={qualityGate.dismissed}
          proceedAnyway={handleProceedAnyway}
        />
      )}
    </main>
  )
}

import { QualityWarningBanner } from './quality/QualityWarningBanner'
import { useVideoQualityGate } from './quality/useVideoQualityGate'
import { useVideoSource } from './video/useVideoSource'
import { VideoInputPanel } from './video/VideoInputPanel'

export function App() {
  const videoSource = useVideoSource()
  const qualityGate = useVideoQualityGate(videoSource)

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
          proceedAnyway={qualityGate.proceedAnyway}
        />
      )}
    </main>
  )
}

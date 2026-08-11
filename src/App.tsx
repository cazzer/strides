import { useVideoSource } from './video/useVideoSource'
import { VideoInputPanel } from './video/VideoInputPanel'

export function App() {
  const videoSource = useVideoSource()

  return (
    <main>
      <h1>Strides</h1>
      <p>Browser-based running form analysis.</p>
      <VideoInputPanel videoSource={videoSource} />
    </main>
  )
}

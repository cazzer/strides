import { useCallback, useState } from 'react'
import { DemoVideoButton } from './DemoVideoButton'
import { FileUpload } from './FileUpload'
import { WebcamCapture } from './WebcamCapture'
import parkApproachDemoUrl from './demo-clips/park-approach.mp4'
import parkSideLandscapeDemoUrl from './demo-clips/park-side-landscape.mp4'
import parkSidePortraitDemoUrl from './demo-clips/park-side-portrait.mp4'

/**
 * The bundled demo, in the order these become clips 1..3. All three are the same runner at the
 * same park, and between them they cover both camera geometries the heuristics gate on — which is
 * the point of loading them as one session rather than offering a button each. `stepWidth` wants
 * the front approach; `verticalRatio`, `kneeFlexion`, `overstriding` and `footStrikePattern` want
 * a side view. No single clip satisfies both, so a one-clip demo can only ever show half the panel.
 *
 * The two side clips lead so the fused panel is populated by the time a reader looks at it.
 *
 * Every clip is bundled rather than fetched from a third party: the demo used to open with stock
 * footage pulled live from Pexels, which needed network, could fail with a download error, and
 * showed a runner nobody here has met.
 */
const DEMO_CLIP_URLS = [
  parkSideLandscapeDemoUrl,
  parkSidePortraitDemoUrl,
  parkApproachDemoUrl,
] as const

export interface ClipPickerProps {
  /**
   * Called once per chosen source. `FileUpload` fires once per selected file (`FileUpload.tsx:33`),
   * so a multi-file picker interaction calls this several times — a caller that creates one clip
   * per call therefore gets one clip per file for free.
   */
  onSource: (source: Blob | File, opts?: { frameRateHint?: number }) => void
  /**
   * Notifies a host that the Record tab is mid-recording, so it can refuse to tear this picker
   * down underneath it. The picker already guards its OWN destructive control for this reason (the
   * tab bar disables switching mid-recording); a host that can collapse the whole picker — the
   * header's add-a-clip disclosure — owns a strictly more destructive one, and unmounting
   * `WebcamCapture` mid-recording stops the tracks and discards the take with nothing to undo it.
   *
   * Optional, and unobserved by the zero-clip full-page presentation, which has no way to collapse
   * itself and therefore nothing to guard.
   */
  onRecordingStateChange?: (isRecording: boolean) => void
}

type Tab = 'record' | 'upload'

/**
 * The three ways into a clip — record, upload, and the bundled demo — with the record/upload tab
 * bar that switches between the first two. The demo is one action loading several clips at once,
 * not one action per clip; see `DEMO_CLIP_URLS`.
 *
 * Extracted verbatim out of `VideoInputPanel`, which used to render exactly this while its own
 * `videoSource.status` was `'empty'`. It renders a fragment, not a container, so it keeps
 * inheriting whatever vertical rhythm its host applies to its own direct children — that is what
 * makes the extraction DOM-identical to what `VideoInputPanel` produced, which matters because
 * both `e2e/multiPersonAcquisition.spec.ts` and `scripts/ab-person-selection.mjs` drive this UI by
 * accessible name (`Upload`) and by `input[type=file]`. The harness no longer drives the demo
 * button at all: one action loading three clips cannot serve as a per-clip measurement arm, and
 * every demo clip is now a local file it can upload individually instead.
 *
 * It is deliberately unaware of `VideoSource`: it hands a caller the bytes the user chose and has
 * no opinion about which clip — or which of several clips — they become.
 */
export function ClipPicker({ onSource, onRecordingStateChange }: ClipPickerProps) {
  const [activeTab, setActiveTab] = useState<Tab>('record')
  const [isRecording, setIsRecording] = useState(false)

  // Memoized because `WebcamCapture` reports through an effect keyed on this identity
  // (`WebcamCapture.tsx:71-75`) — a fresh function each render would re-run that effect on every
  // render of this picker.
  const handleRecordingStateChange = useCallback(
    (recording: boolean) => {
      setIsRecording(recording)
      onRecordingStateChange?.(recording)
    },
    [onRecordingStateChange],
  )

  return (
    <>
      <div className="flex border-2 border-black dark:border-white divide-x-2 divide-black dark:divide-white w-fit">
        <button
          type="button"
          aria-pressed={activeTab === 'record'}
          disabled={isRecording && activeTab !== 'record'}
          title={
            isRecording && activeTab !== 'record'
              ? "Can't switch while recording"
              : undefined
          }
          onClick={() => setActiveTab('record')}
          className="px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide aria-pressed:bg-black aria-pressed:text-white dark:aria-pressed:bg-white dark:aria-pressed:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Record
        </button>
        <button
          type="button"
          aria-pressed={activeTab === 'upload'}
          disabled={isRecording && activeTab !== 'upload'}
          title={
            isRecording && activeTab !== 'upload'
              ? "Can't switch while recording"
              : undefined
          }
          onClick={() => setActiveTab('upload')}
          className="px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide aria-pressed:bg-black aria-pressed:text-white dark:aria-pressed:bg-white dark:aria-pressed:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Upload
        </button>
      </div>

      {activeTab === 'record' && (
        <WebcamCapture
          onRecorded={(blob, opts) =>
            onSource(blob, { frameRateHint: opts.frameRateHint ?? undefined })
          }
          onRecordingStateChange={handleRecordingStateChange}
        />
      )}

      {activeTab === 'upload' && (
        <FileUpload onSelected={(file) => onSource(file)} />
      )}

      <div className="flex flex-wrap gap-2">
        <DemoVideoButton
          onLoaded={(blob) => onSource(blob)}
          disabled={isRecording}
          videoUrls={DEMO_CLIP_URLS}
          label="Demo (3 clips)"
        />
      </div>
    </>
  )
}

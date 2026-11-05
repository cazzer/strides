import { useId, useState } from 'react'
import type { MetricId } from '../heuristics/types'
import { resolvePoseDetectorConfig } from '../pose/poseBackendConfig'
import type { ClipSession } from '../results/multiClipAnalysis'
import { resolveSamplingRobustnessConfig } from '../results/samplingRobustnessConfig'
import type { AggregateAnalysisState } from '../results/types'
import { outlinePassStatus } from '../results/types'
import {
  assessmentFolderName,
  buildAssessmentRecord,
  buildFootageManifest,
  type AssessmentClipInput,
} from './assessmentRecord'
import { sharedSaveJobs, useSaveJob, type SaveJobs } from './saveJobs'
import { buildInfo } from './buildInfo'
import { saveReadiness } from './saveReadiness'
import {
  storageErrorMessage,
  useStorageConnection,
  type StorageConnection,
} from './storageConnection'
import { formatMegabytes } from './formatBytes'
import { BUTTON_FILLED, BUTTON_OUTLINED, BUTTON_TEXT } from './buttonStyles'

export interface SaveAssessmentPanelProps {
  aggregate: Pick<AggregateAnalysisState, 'phase' | 'heuristics'>
  clips: readonly ClipSession[]
  sourceIndices: Record<MetricId, number> | null
  /** Changes whenever the session's clips change; a save belongs to one session result. */
  resultKey: string
  onOpenProgress?: () => void
  connection?: StorageConnection
  /** Where saves live; outlives this panel (see saveJobs.ts). */
  jobs?: SaveJobs
}


function clipInputs(clips: readonly ClipSession[]): AssessmentClipInput[] {
  return clips.map((clip, index) => ({
    index,
    source: clip.videoSource.sourceBlob,
    metadata: clip.videoSource.metadata,
    view: clip.analysis.heuristics?.view.view ?? null,
    samplingPath: clip.analysis.diagnostics?.sampling.path ?? clip.analysis.primarySamplingPath ?? null,
    scalePass: clip.analysis.scalePass.status,
    outlinePass: outlinePassStatus(clip.analysis),
  }))
}

/**
 * Save this assessment to the runner's own storage (design D4, D7, D8). Nothing is written until
 * Save is pressed; the video only if its box is ticked.
 *
 * Every provider call that can open a sign-in popup (`connect`, `ensureAccess`) is made
 * synchronously in its click handler, before any await: Safari allows a popup for about a second
 * after a tap.
 */
export function SaveAssessmentPanel({
  aggregate,
  clips,
  sourceIndices,
  resultKey,
  onOpenProgress,
  connection: connectionProp,
  jobs: jobsProp,
}: SaveAssessmentPanelProps) {
  const { snapshot, connection } = useStorageConnection(connectionProp)
  const jobs = jobsProp ?? sharedSaveJobs()
  const shownState = useSaveJob(resultKey, jobs)
  const [includeFootage, setIncludeFootage] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const headingId = useId()
  const footageId = useId()
  const { provider, availability, prepared, preparing, remembered } = snapshot
  const readiness = saveReadiness(aggregate, clips)

  const savedHere = shownState.kind === 'saved'
  const footageBytes = clips.reduce((sum, clip) => sum + (clip.videoSource.sourceBlob?.size ?? 0), 0)
  const linked = availability === 'connected' || remembered !== null

  const save = () => {
    if (!readiness.ready || !aggregate.heuristics) return
    // FIRST, synchronously: may open the sign-in popup inside this tap.
    const access = connection.ensureAccess()
    const heuristics = aggregate.heuristics
    const inputs = clipInputs(clips)
    const footage = includeFootage
    jobs.reset(resultKey)
    jobs.start(resultKey, {
      provider,
      connection,
      access,
      rootFolderId: remembered?.rootFolderId ?? null,
      prepare: async () => {
        const id = crypto.randomUUID()
        const savedAt = new Date()
        const record = buildAssessmentRecord({
          id,
          savedAt,
          heuristics,
          sourceIndices,
          clips: inputs,
          poseBackend: resolvePoseDetectorConfig(),
          samplingRobustness: resolveSamplingRobustnessConfig(),
          build: buildInfo(),
        })
        const manifest = await buildFootageManifest(id, inputs, footage)
        const clipSources = new Map<number, Blob>()
        for (const input of inputs) if (input.source) clipSources.set(input.index, input.source)
        return { record, manifest, clipSources, folderName: assessmentFolderName(savedAt, record.view.clipViews, id) }
      },
    })
  }

  const retry = () => {
    if (shownState.kind === 'error' && shownState.retry === 'index') jobs.retryIndex(resultKey)
    else save()
  }
  const cancel = () => jobs.cancel(resultKey)

  const startConnect = () => {
    setConnectError(null)
    connection.prepare().catch((error: unknown) => setConnectError(storageErrorMessage(error)))
  }
  const continueConnect = () => {
    setConnectError(null)
    connection.connect().catch((error: unknown) => setConnectError(storageErrorMessage(error)))
  }
  const disconnect = () => {
    jobs.cancel(resultKey)
    void connection.disconnect()
  }

  let body: React.ReactNode
  if (availability === 'unavailable') {
    body = (
      <p className="font-sans text-sm text-neutral-700 dark:text-neutral-300">
        Saving to your own {provider.label} isn&apos;t set up on this build yet.
      </p>
    )
  } else if (!linked) {
    body = (
      <>
        <p className="font-sans text-sm text-neutral-700 dark:text-neutral-300">
          Save the numbers to a Strides folder in your own {provider.label}, then see how they move
          from one assessment to the next. Nothing goes to a Strides server, and nothing is saved
          until you press Save.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {prepared ? (
            <button type="button" className={BUTTON_FILLED} onClick={continueConnect}>
              Continue to Google
            </button>
          ) : (
            <button type="button" className={BUTTON_OUTLINED} onClick={startConnect} disabled={preparing}>
              {preparing ? 'Loading Google sign-in…' : `Connect ${provider.label}`}
            </button>
          )}
        </div>
        {prepared && (
          <p className="font-sans text-xs text-neutral-600 dark:text-neutral-400">
            Google asks whether Strides may create files in your Drive. It can only see the files it
            creates.
          </p>
        )}
      </>
    )
  } else {
    const saving = shownState.kind === 'saving'
    const waitingForScript = !prepared && availability !== 'connected'
    const disabledReason = !readiness.ready
      ? readiness.reason === 'background'
        ? 'Finishing background checks…'
        : 'Available once the analysis is complete.'
      : waitingForScript
        ? 'Loading Google sign-in…'
        : null
    body = (
      <>
        <p className="font-sans text-sm text-neutral-700 dark:text-neutral-300">
          Saves to the Strides folder in your {provider.label}. Nothing goes to a Strides server.
        </p>
        <div className="flex items-start gap-2">
          <input
            id={footageId}
            type="checkbox"
            className="mt-1"
            checked={includeFootage}
            disabled={saving || savedHere}
            onChange={(event) => setIncludeFootage(event.target.checked)}
          />
          <label htmlFor={footageId} className="font-sans text-sm">
            Also save the video ({formatMegabytes(footageBytes)})
            <span className="block text-xs text-neutral-600 dark:text-neutral-400">
              Without it, only a list of the clips (length, size and a fingerprint to match them by)
              is saved, never the video.
            </span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {savedHere ? (
            <>
              <p role="status" className="save-assessment__saved font-sans text-sm font-semibold">
                Saved to {provider.label}: Strides / {shownState.kind === 'saved' ? shownState.folderName : ''}
              </p>
              {onOpenProgress && (
                <button type="button" className={BUTTON_OUTLINED} onClick={onOpenProgress}>
                  See progress
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                className={BUTTON_FILLED}
                onClick={save}
                disabled={saving || disabledReason !== null}
                aria-describedby={disabledReason ? `${headingId}-reason` : undefined}
              >
                {saving ? 'Saving…' : `Save to ${provider.label}`}
              </button>
              {saving && shownState.kind === 'saving' && !shownState.committed && (
                <button type="button" className={BUTTON_OUTLINED} onClick={cancel}>
                  Cancel
                </button>
              )}
              {disabledReason && !saving && (
                <p id={`${headingId}-reason`} className="font-sans text-sm text-neutral-700 dark:text-neutral-300">
                  {disabledReason}
                </p>
              )}
            </>
          )}
        </div>
        {saving && (
          <div className="space-y-1">
            <progress
              className="save-assessment__progress h-2 w-full max-w-sm"
              max={1}
              value={shownState.kind === 'saving' ? shownState.fraction : 0}
              aria-label="Saving"
            />
          </div>
        )}
        {shownState.kind === 'error' && (
          <div role="alert" className="flex flex-wrap items-center gap-3 font-sans text-sm text-red-800 dark:text-red-300">
            <p>{shownState.message}</p>
            {shownState.retry !== null && (
              <button
                type="button"
                className={BUTTON_OUTLINED}
                onClick={retry}
                disabled={shownState.retry === 'save' && disabledReason !== null}
              >
                Try again
              </button>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <button type="button" className={BUTTON_TEXT} onClick={disconnect}>
            Disconnect {provider.label}
          </button>
          <span className="font-sans text-xs text-neutral-600 dark:text-neutral-400">
            Stops Strides reaching your {provider.label}. Saved files stay there. You can also remove
            Strides from your Google Account&apos;s third-party access page.
          </span>
        </div>
      </>
    )
  }

  return (
    <section
      aria-labelledby={headingId}
      className="save-assessment space-y-3 border-2 border-black p-4 dark:border-white"
    >
      <h2 id={headingId} className="font-display text-lg font-bold">
        Keep this assessment
      </h2>
      {body}
      {connectError && (
        <p role="alert" className="font-sans text-sm text-red-800 dark:text-red-300">
          {connectError}
        </p>
      )}
    </section>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadIndex, type LoadedIndex } from '../storage/assessmentStore'
import { BUTTON_FILLED, BUTTON_OUTLINED, BUTTON_TEXT } from '../storage/buttonStyles'
import {
  storageErrorMessage,
  useStorageConnection,
  type StorageConnection,
} from '../storage/storageConnection'
import { MetricProgressChart } from './MetricProgressChart'
import { dateLabels, progressSeries } from './progressSeries'

export interface ProgressPageProps {
  onBack: () => void
  /** "Back to results" when a session is loaded, "Back" otherwise. */
  hasResults: boolean
  connection?: StorageConnection
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; loaded: LoadedIndex }
  | { kind: 'error'; message: string }

const VIEW_WORDS: Record<string, string> = { side: 'side', front: 'front', ambiguous: 'unclear view' }

function viewsLabel(views: (string | null)[]): string {
  const distinct = [...new Set(views.map((v) => VIEW_WORDS[v ?? 'ambiguous'] ?? 'unclear view'))]
  return distinct.join(' + ')
}

/**
 * Saved assessments over time (design D6), read only from the runner's own storage. Lists dates,
 * then one chart per measured metric. Draws no verdicts: same-runner clip-to-clip spread is real
 * and unmeasured (`strides-83y`), so the page shows values and leaves the reading to the runner.
 */
export function ProgressPage({ onBack, hasResults, connection: connectionProp }: ProgressPageProps) {
  const { snapshot, connection } = useStorageConnection(connectionProp)
  const { provider, availability, prepared, preparing, remembered } = snapshot
  const [state, setState] = useState<LoadState>({ kind: 'idle' })
  const [connectError, setConnectError] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const generation = useRef(0)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const startedRef = useRef(false)
  const load = useCallback(
    (forceRebuild = false, showLoading = true) => {
      startedRef.current = true
      const mine = ++generation.current
      // From the effect below the state is still 'idle', which already renders as loading.
      if (showLoading) setState({ kind: 'loading' })
      loadIndex(provider, { rootFolderId: remembered?.rootFolderId ?? null, forceRebuild })
        .then((loaded) => {
          if (mine !== generation.current) return
          if (loaded.root) connection.rememberRoot(loaded.root.id)
          setState({ kind: 'loaded', loaded })
        })
        .catch((error: unknown) => {
          if (mine !== generation.current) return
          setState({ kind: 'error', message: storageErrorMessage(error) })
        })
    },
    [provider, remembered?.rootFolderId, connection],
  )

  // Load as soon as access is in hand (the header's Progress tap asks for it in the gesture).
  const connected = availability === 'connected'
  useEffect(() => {
    if (connected && !startedRef.current) load(false, false)
  }, [connected, load])

  const askAndLoad = () => {
    setConnectError(null)
    // Synchronously, inside the tap: may open the sign-in popup.
    connection
      .ensureAccess()
      .then(() => load())
      .catch((error: unknown) => setConnectError(storageErrorMessage(error)))
  }
  const startConnect = () => {
    setConnectError(null)
    connection.prepare().catch((error: unknown) => setConnectError(storageErrorMessage(error)))
  }
  const continueConnect = () => {
    setConnectError(null)
    connection
      .connect()
      .then(() => load())
      .catch((error: unknown) => setConnectError(storageErrorMessage(error)))
  }

  let body: React.ReactNode
  if (availability === 'unavailable') {
    body = (
      <p className="font-sans text-sm">Saving to your own {provider.label} isn&apos;t set up on this build yet.</p>
    )
  } else if (!connected && remembered === null) {
    body = (
      <div className="space-y-3" data-progress-state="not-connected">
        <p className="font-sans text-sm">
          Progress shows the assessments you saved to your own {provider.label}. Connect it to see them.
          Nothing is read from anywhere else.
        </p>
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
    )
  } else if (!connected && state.kind !== 'loaded') {
    body = (
      <div className="space-y-3" data-progress-state="reconnect">
        <p className="font-sans text-sm">Your saved assessments are in your {provider.label}.</p>
        <button type="button" className={BUTTON_FILLED} onClick={askAndLoad} disabled={!prepared}>
          {prepared ? 'Show my saved assessments' : 'Loading Google sign-in…'}
        </button>
      </div>
    )
  } else if (state.kind === 'idle' || state.kind === 'loading') {
    body = (
      <p role="status" className="font-sans text-sm" data-progress-state="loading">
        Loading your saved assessments…
      </p>
    )
  } else if (state.kind === 'error') {
    body = (
      <div role="alert" className="space-y-3" data-progress-state="error">
        <p className="font-sans text-sm">{state.message}</p>
        <button type="button" className={BUTTON_OUTLINED} onClick={connected ? () => load() : askAndLoad}>
          Try again
        </button>
      </div>
    )
  } else {
    const { index, skipped, rebuilt } = state.loaded
    const entries = index.assessments
    const series = progressSeries(entries)
    const labels = dateLabels(entries)
    body = (
      <div className="space-y-8" data-progress-state={entries.length === 0 ? 'empty' : 'loaded'}>
        {(rebuilt === 'missing' || rebuilt === 'invalid') && entries.length > 0 && (
          <p className="font-sans text-sm" data-progress-note="rebuilt">
            The list of saved assessments was {rebuilt === 'missing' ? 'missing' : 'unreadable'}, so it was rebuilt
            from the assessment folders.
          </p>
        )}
        {rebuilt === 'requested' && (
          <p className="font-sans text-sm" data-progress-note="rebuilt">
            Rebuilt from the assessment folders.
          </p>
        )}
        {skipped > 0 && (
          <p className="font-sans text-sm" data-progress-note="skipped">
            {skipped === 1 ? 'One saved assessment' : `${skipped} saved assessments`} could not be read and{' '}
            {skipped === 1 ? 'is' : 'are'} left out.
          </p>
        )}
        {entries.length === 0 ? (
          <p className="font-sans text-sm">
            No saved assessments yet. After an analysis, use Keep this assessment to save one.
          </p>
        ) : (
          <>
            <section aria-labelledby="progress-dates" className="space-y-2">
              <h3 id="progress-dates" className="font-display text-lg font-bold">
                Saved assessments
              </h3>
              <ol className="progress-dates space-y-1 font-sans text-sm">
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <span className="font-semibold">{labels.get(entry.id)}</span>{' '}
                    <span className="text-neutral-700 dark:text-neutral-300">
                      · {viewsLabel(entry.views)} · {entry.clipCount} {entry.clipCount === 1 ? 'clip' : 'clips'}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
            <section aria-labelledby="progress-metrics" className="space-y-4">
              <h3 id="progress-metrics" className="font-display text-lg font-bold">
                Each measure over time
              </h3>
              <p className="font-sans text-sm text-neutral-700 dark:text-neutral-300">
                Readings vary from clip to clip even when nothing about your running has changed, so a
                small move between two points may be noise. Hollow points had lower confidence.
              </p>
              {series.length === 0 ? (
                <p className="font-sans text-sm">No measure was read in any saved assessment.</p>
              ) : (
                <div className="grid gap-6 sm:grid-cols-2">
                  {series.map((s) => (
                    <MetricProgressChart key={s.metric} series={s} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
        <button type="button" className={BUTTON_TEXT} onClick={() => load(true)}>
          Rebuild the list from my saved folders
        </button>
      </div>
    )
  }

  return (
    <section aria-labelledby="progress-heading" className="progress-page space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 ref={headingRef} id="progress-heading" tabIndex={-1} className="font-display text-2xl font-bold focus:outline-none">
          Progress
        </h2>
        <button type="button" className={BUTTON_OUTLINED} onClick={onBack}>
          {hasResults ? 'Back to results' : 'Back'}
        </button>
      </div>
      {body}
      {connectError && (
        <p role="alert" className="font-sans text-sm text-red-800 dark:text-red-300">
          {connectError}
        </p>
      )}
    </section>
  )
}

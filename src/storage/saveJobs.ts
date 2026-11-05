import { useSyncExternalStore } from 'react'
import { IndexUpdateError, saveAssessment, updateIndex, type SaveRequest } from './assessmentStore'
import { StorageError, type StorageProvider } from './provider'
import { isRetryable, storageErrorMessage, type StorageConnection } from './storageConnection'

/**
 * One save per session result, kept OUTSIDE the panel (review of `strides-w85q.5`): the progress
 * page unmounts the panel, and neither an in-flight save nor a finished one may be lost with it —
 * losing the first would orphan an upload, losing the second would offer to save the same result
 * twice. Keyed by the session's result key, so a new set of clips starts clean.
 */
export type SaveJobState =
  | { kind: 'idle' }
  | { kind: 'saving'; fraction: number; committed: boolean }
  | { kind: 'saved'; folderName: string }
  | { kind: 'error'; message: string; retry: 'save' | 'index' | null }

interface Job {
  state: SaveJobState
  controller: AbortController | null
  retryIndex: (() => void) | null
}

const IDLE: SaveJobState = { kind: 'idle' }

export interface StartSave {
  provider: StorageProvider
  connection: StorageConnection
  /** The access request, already made synchronously inside the tap. */
  access: Promise<void>
  /** Builds the request once access is in hand (hashing can take a moment). */
  prepare: () => Promise<SaveRequest>
  rootFolderId: string | null
}

export function createSaveJobs() {
  const jobs = new Map<string, Job>()
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())
  const set = (key: string, patch: Partial<Job>) => {
    const current = jobs.get(key) ?? { state: IDLE, controller: null, retryIndex: null }
    jobs.set(key, { ...current, ...patch })
    emit()
  }

  function start(key: string, args: StartSave): void {
    const current = jobs.get(key)?.state
    if (current?.kind === 'saving' || current?.kind === 'saved') return
    const controller = new AbortController()
    set(key, { state: { kind: 'saving', fraction: 0, committed: false }, controller, retryIndex: null })
    let committed = false
    let folderName = ''
    args.access
      .then(async () => {
        const request = await args.prepare()
        folderName = request.folderName
        if (controller.signal.aborted) throw new StorageError('cancelled', 'Save cancelled.')
        return saveAssessment(args.provider, request, {
          rootFolderId: args.rootFolderId,
          signal: controller.signal,
          onCommit: () => {
            committed = true
            set(key, { state: { kind: 'saving', fraction: 0.99, committed: true }, controller: null })
          },
          onProgress: (p) => set(key, { state: { kind: 'saving', fraction: p.fraction, committed } }),
        })
      })
      .then((outcome) => {
        args.connection.rememberRoot(outcome.root.id)
        set(key, { state: { kind: 'saved', folderName }, controller: null })
      })
      .catch((error: unknown) => {
        if (error instanceof IndexUpdateError) {
          args.connection.rememberRoot(error.root.id)
          const retryIndex = () => {
            set(key, { state: { kind: 'saving', fraction: 0.99, committed: true }, retryIndex: null })
            updateIndex(args.provider, error.root, error.entry).then(
              () => set(key, { state: { kind: 'saved', folderName } }),
              (again: unknown) =>
                set(key, {
                  state: { kind: 'error', message: indexMessage(again), retry: isRetryable(again) ? 'index' : null },
                  retryIndex,
                }),
            )
          }
          set(key, {
            state: { kind: 'error', message: indexMessage(error), retry: error.retryable ? 'index' : null },
            controller: null,
            retryIndex,
          })
          return
        }
        if (error instanceof StorageError && error.code === 'cancelled') {
          set(key, { state: IDLE, controller: null })
          return
        }
        set(key, {
          state: { kind: 'error', message: storageErrorMessage(error), retry: isRetryable(error) ? 'save' : null },
          controller: null,
        })
      })
  }

  return {
    get: (key: string): SaveJobState => jobs.get(key)?.state ?? IDLE,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start,
    /** Only before the commit point; afterwards there is nothing safe to stop. */
    cancel(key: string) {
      jobs.get(key)?.controller?.abort()
    },
    retryIndex(key: string) {
      jobs.get(key)?.retryIndex?.()
    },
    /** A failed save can be tried again from scratch (nothing of it was kept). */
    reset(key: string) {
      if (jobs.get(key)?.state.kind === 'error') set(key, { state: IDLE, retryIndex: null })
    },
  }
}

function indexMessage(error: unknown): string {
  const base = 'Saved, but the list of assessments could not be updated.'
  if (error instanceof StorageError && error.code === 'newer-version') return error.message
  return `${base} Try again, or open Progress to rebuild the list.`
}

export type SaveJobs = ReturnType<typeof createSaveJobs>

let shared: SaveJobs | null = null
export function sharedSaveJobs(): SaveJobs {
  shared ??= createSaveJobs()
  return shared
}

export function useSaveJob(key: string, jobs: SaveJobs = sharedSaveJobs()): SaveJobState {
  return useSyncExternalStore(jobs.subscribe, () => jobs.get(key))
}

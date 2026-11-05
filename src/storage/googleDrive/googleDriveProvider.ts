import {
  StorageError,
  type ProviderAvailability,
  type StorageProvider,
  type StoredFolder,
} from '../provider'
import { ROOT_FOLDER_NAME } from '../assessmentRecord'
import { DriveApi, propsQuery, quote, type FetchLike, type XhrLike } from './driveApi'
import { loadGisScript, type GisOAuth2 } from './gis'
import { TokenManager } from './tokenManager'

export interface GoogleDriveProviderOptions {
  clientId: string | undefined
  loadGis?: () => Promise<GisOAuth2>
  fetchImpl?: FetchLike
  createXhr?: () => XhrLike
  now?: () => number
}

/**
 * Google Drive through the GIS token client and Drive v3, `drive.file` scope only: the app sees
 * the files it created and nothing else in the runner's Drive (design D1).
 */
export function createGoogleDriveProvider(options: GoogleDriveProviderOptions): StorageProvider {
  const clientId = options.clientId?.trim() || undefined
  const loadGis = options.loadGis ?? (() => loadGisScript())
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => window.fetch(input, init))
  const createXhr = options.createXhr ?? (() => new XMLHttpRequest() as unknown as XhrLike)
  let tokens: TokenManager | null = null
  let preparing: Promise<void> | null = null

  const requireToken = (): string => {
    const token = tokens?.current()
    if (!token) throw new StorageError('not-connected', 'Connect Google Drive first.')
    return token
  }
  const api = new DriveApi(requireToken, fetchImpl, createXhr)

  const requireTokens = (): TokenManager => {
    if (!clientId) throw new StorageError('unavailable', 'Saving to Google Drive is not set up on this build.', false)
    if (!tokens) throw new StorageError('not-connected', 'Google sign-in is still loading. Tap again in a moment.')
    return tokens
  }

  return {
    id: 'google-drive',
    label: 'Google Drive',
    availability(): ProviderAvailability {
      if (!clientId) return 'unavailable'
      return tokens?.current() ? 'connected' : 'disconnected'
    },
    prepare() {
      if (!clientId) return Promise.reject(new StorageError('unavailable', 'Saving to Google Drive is not set up on this build.', false))
      if (tokens) return Promise.resolve()
      preparing ??= loadGis()
        .then((oauth2) => {
          tokens = new TokenManager(oauth2, clientId, options.now)
        })
        .catch(() => {
          preparing = null
          throw new StorageError('network', 'Could not load Google sign-in. Check your connection and try again.')
        })
      return preparing
    },
    isPrepared: () => tokens !== null,
    // Not `async`: the popup must open in this same task as the tap.
    connect() {
      try {
        return requireTokens().request().then(() => undefined)
      } catch (error) {
        return Promise.reject(error)
      }
    },
    ensureAccess() {
      try {
        const manager = requireTokens()
        if (manager.current()) return Promise.resolve()
        return manager.request('').then(() => undefined)
      } catch (error) {
        return Promise.reject(error)
      }
    },
    // Not `async`: with no token in hand (after a reload) revoking needs one, and asking for it
    // can open the popup, which must happen in this same task as the tap.
    disconnect() {
      if (!tokens) return Promise.resolve()
      const manager = tokens
      if (manager.current()) return manager.revoke()
      return manager
        .request('')
        .then(() => manager.revoke())
        .catch(() => undefined) // could not get a token to revoke with: the copy points at Google
    },
    async findRoot(knownId) {
      return api.findRoot(knownId ?? null)
    },
    async ensureRoot(knownId) {
      const found = await api.findRoot(knownId ?? null)
      if (found) return found
      return api.createFolder(null, ROOT_FOLDER_NAME, { stridesKind: 'root' })
    },
    async createFolder(parent: StoredFolder, name, props) {
      return api.createFolder(parent.id, name, props)
    },
    async writeJson(parent, name, data, props, existing) {
      return api.writeJson(parent.id, name, data, props, existing?.id)
    },
    async uploadBlob(parent, name, blob, props, onProgress, signal) {
      return api.uploadBlob(parent.id, name, blob, props, onProgress, signal)
    },
    async readJson(file) {
      return api.readJson(file.id)
    },
    async trash(folder) {
      await api.trash(folder.id)
    },
    async findByProps(parent, props) {
      return api.list([`${quote(parent.id)} in parents`, ...propsQuery(props)])
    },
  }
}

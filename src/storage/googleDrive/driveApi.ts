import { StorageError, type StoredFile, type StoredFolder, type StoredKind, type StoredProps } from '../provider'

/**
 * Drive API v3 over `fetch` (design D1): no `gapi` client library. JSON is written with
 * `uploadType=multipart`; clip bytes with `uploadType=resumable`, one `PUT` through
 * `XMLHttpRequest` because `fetch` reports no upload progress.
 */

export const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
export const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'
export const FOLDER_MIME = 'application/vnd.google-apps.folder'
const FILE_FIELDS = 'id,name,appProperties,trashed'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface XhrLike {
  open(method: string, url: string): void
  setRequestHeader(name: string, value: string): void
  send(body: Blob): void
  abort(): void
  readonly status: number
  readonly responseText: string
  upload: { onprogress: ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null }
  onload: (() => void) | null
  onerror: (() => void) | null
  onabort: (() => void) | null
}

interface DriveFile {
  id: string
  name: string
  appProperties?: Record<string, string>
  trashed?: boolean
}

/** Drive query string literal: backslash and single quote escaped. */
export function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

export function propsQuery(props: Partial<StoredProps>): string[] {
  return Object.entries(props)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `appProperties has { key=${quote(k)} and value=${quote(String(v))} }`)
}

function toProps(appProperties: Record<string, string> | undefined): StoredProps {
  return {
    stridesKind: (appProperties?.stridesKind ?? 'root') as StoredKind,
    ...(appProperties?.stridesAssessmentId ? { stridesAssessmentId: appProperties.stridesAssessmentId } : {}),
  }
}

function toFile(file: DriveFile): StoredFile {
  return { id: file.id, name: file.name, props: toProps(file.appProperties) }
}

async function errorFor(response: Response): Promise<StorageError> {
  let reason = ''
  try {
    const body = (await response.json()) as { error?: { errors?: { reason?: string }[]; message?: string } }
    reason = body.error?.errors?.[0]?.reason ?? ''
  } catch {
    // not JSON
  }
  return errorForStatus(response.status, reason)
}

export function errorForStatus(status: number, reason = ''): StorageError {
  if (status === 401) {
    return new StorageError('not-connected', 'Google Drive access has expired. Tap again to reconnect.')
  }
  if (reason === 'storageQuotaExceeded' || reason === 'quotaExceeded') {
    return new StorageError('quota', 'Your Google Drive is full.', false)
  }
  if (status === 403) return new StorageError('access-denied', 'Google Drive refused the request.')
  if (status === 404) return new StorageError('not-found', 'That file is no longer in your Google Drive.', false)
  if (status === 429 || status >= 500) {
    return new StorageError('network', 'Google Drive is busy. Try again in a moment.')
  }
  return new StorageError('unknown', `Google Drive returned an error (${status}).`)
}

export class DriveApi {
  private readonly getToken: () => string
  private readonly fetchImpl: FetchLike
  private readonly createXhr: () => XhrLike

  constructor(getToken: () => string, fetchImpl: FetchLike, createXhr: () => XhrLike) {
    this.getToken = getToken
    this.fetchImpl = fetchImpl
    this.createXhr = createXhr
  }

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    // Outside the try: an expired token is 'not-connected', not a network failure.
    const token = this.getToken()
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new StorageError('cancelled', 'Cancelled.')
      }
      throw new StorageError('network', 'Could not reach Google Drive. Check your connection.')
    }
    if (!response.ok) throw await errorFor(response)
    return response
  }

  async getFile(id: string): Promise<DriveFile | null> {
    try {
      const response = await this.call(`${DRIVE_FILES_URL}/${encodeURIComponent(id)}?fields=${FILE_FIELDS}`)
      return (await response.json()) as DriveFile
    } catch (error) {
      if (error instanceof StorageError && error.code === 'not-found') return null
      throw error
    }
  }

  async trash(id: string): Promise<void> {
    await this.call(`${DRIVE_FILES_URL}/${encodeURIComponent(id)}?fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ trashed: true }),
    })
  }

  async list(clauses: string[], orderBy?: string): Promise<StoredFile[]> {
    const q = [...clauses, 'trashed=false'].join(' and ')
    const files: StoredFile[] = []
    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({
        q,
        fields: 'nextPageToken,files(id,name,appProperties)',
        pageSize: '1000',
        spaces: 'drive',
      })
      if (orderBy) params.set('orderBy', orderBy)
      if (pageToken) params.set('pageToken', pageToken)
      const response = await this.call(`${DRIVE_FILES_URL}?${params.toString()}`)
      const body = (await response.json()) as { files?: DriveFile[]; nextPageToken?: string }
      files.push(...(body.files ?? []).map(toFile))
      pageToken = body.nextPageToken
    } while (pageToken)
    return files
  }

  async findRoot(knownId: string | null): Promise<StoredFolder | null> {
    if (knownId) {
      const known = await this.getFile(knownId)
      if (known && !known.trashed && known.appProperties?.stridesKind === 'root') {
        return { id: known.id, name: known.name }
      }
    }
    // Oldest first: if two first saves raced on two devices, every device settles on the same one.
    const roots = await this.list([`mimeType=${quote(FOLDER_MIME)}`, ...propsQuery({ stridesKind: 'root' })], 'createdTime')
    return roots[0] ? { id: roots[0].id, name: roots[0].name } : null
  }

  async createFolder(parentId: string | null, name: string, props: StoredProps): Promise<StoredFolder> {
    const response = await this.call(`${DRIVE_FILES_URL}?fields=${FILE_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        ...(parentId ? { parents: [parentId] } : {}),
        appProperties: props,
      }),
    })
    const file = (await response.json()) as DriveFile
    return { id: file.id, name: file.name }
  }

  async writeJson(
    parentId: string,
    name: string,
    data: unknown,
    props: StoredProps,
    existingId?: string,
  ): Promise<StoredFile> {
    const boundary = `strides-${Math.random().toString(36).slice(2)}`
    const metadata = existingId
      ? { name, appProperties: props }
      : { name, mimeType: 'application/json', parents: [parentId], appProperties: props }
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data, null, 2)}\r\n` +
      `--${boundary}--`
    const url = existingId
      ? `${DRIVE_UPLOAD_URL}/${encodeURIComponent(existingId)}?uploadType=multipart&fields=${FILE_FIELDS}`
      : `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=${FILE_FIELDS}`
    const response = await this.call(url, {
      method: existingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    })
    return toFile((await response.json()) as DriveFile)
  }

  async readJson(id: string): Promise<unknown> {
    const response = await this.call(`${DRIVE_FILES_URL}/${encodeURIComponent(id)}?alt=media`)
    try {
      return await response.json()
    } catch {
      return null // unparseable content reads as invalid, and the caller's validator says so
    }
  }

  async uploadBlob(
    parentId: string,
    name: string,
    blob: Blob,
    props: StoredProps,
    onProgress?: (fraction: number) => void,
    signal?: AbortSignal,
  ): Promise<StoredFile> {
    const type = blob.type || 'application/octet-stream'
    const start = await this.call(`${DRIVE_UPLOAD_URL}?uploadType=resumable&fields=${FILE_FIELDS}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': type,
        'X-Upload-Content-Length': String(blob.size),
      },
      body: JSON.stringify({ name, mimeType: type, parents: [parentId], appProperties: props }),
      signal,
    })
    const session = start.headers.get('Location')
    if (!session) throw new StorageError('unknown', 'Google Drive did not start the upload.')

    return new Promise<StoredFile>((resolve, reject) => {
      const xhr = this.createXhr()
      const onAbort = () => xhr.abort()
      signal?.addEventListener('abort', onAbort, { once: true })
      const cleanup = () => signal?.removeEventListener('abort', onAbort)
      xhr.open('PUT', session)
      xhr.setRequestHeader('Content-Type', type)
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total)
      }
      xhr.onload = () => {
        cleanup()
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            onProgress?.(1)
            resolve(toFile(JSON.parse(xhr.responseText) as DriveFile))
          } catch {
            reject(new StorageError('unknown', 'Google Drive returned an unreadable upload response.'))
          }
        } else {
          let reason = ''
          try {
            reason = (JSON.parse(xhr.responseText) as { error?: { errors?: { reason?: string }[] } }).error
              ?.errors?.[0]?.reason ?? ''
          } catch {
            // not JSON
          }
          reject(errorForStatus(xhr.status, reason))
        }
      }
      xhr.onerror = () => {
        cleanup()
        reject(new StorageError('network', 'The upload to Google Drive was interrupted.'))
      }
      xhr.onabort = () => {
        cleanup()
        reject(new StorageError('cancelled', 'Upload cancelled.'))
      }
      xhr.send(blob)
    })
  }
}

import { StorageError } from '../provider'
import type { GisClientError, GisOAuth2, GisTokenClient, GisTokenResponse } from './gis'

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

/** Re-ask this long before the token's stated expiry, so a save never starts on a dying token. */
const EXPIRY_MARGIN_MS = 60_000

/**
 * The access token, in memory only (design D1): never written to storage, gone on reload. GIS's
 * token model has no refresh token; an expired token is re-requested with `prompt: ''`, which
 * opens and closes the popup without a click once consent exists.
 */
export class TokenManager {
  private readonly client: GisTokenClient
  private token: string | null = null
  private expiresAt = 0
  private waiting: { resolve: (token: string) => void; reject: (error: unknown) => void } | null = null
  private readonly oauth2: GisOAuth2
  private readonly now: () => number

  constructor(oauth2: GisOAuth2, clientId: string, now: () => number = Date.now) {
    this.oauth2 = oauth2
    this.now = now
    this.client = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_FILE_SCOPE,
      callback: (response) => this.onResponse(response),
      error_callback: (error) => this.onError(error),
    })
  }

  current(): string | null {
    return this.token && this.now() < this.expiresAt - EXPIRY_MARGIN_MS ? this.token : null
  }

  /**
   * Opens the popup SYNCHRONOUSLY — callers must invoke this inside a click handler before any
   * await (Safari's transient activation lasts about a second). `prompt` undefined lets Google
   * decide (consent the first time), `''` asks without a consent screen.
   */
  request(prompt?: '' | 'consent'): Promise<string> {
    this.waiting?.reject(new StorageError('cancelled', 'Superseded by a newer sign-in request.'))
    const promise = new Promise<string>((resolve, reject) => {
      this.waiting = { resolve, reject }
    })
    this.client.requestAccessToken(prompt === undefined ? undefined : { prompt })
    return promise
  }

  invalidate(): void {
    this.token = null
    this.expiresAt = 0
  }

  revoke(): Promise<void> {
    const token = this.token
    this.invalidate()
    if (!token) return Promise.resolve()
    return new Promise((resolve) => {
      try {
        this.oauth2.revoke(token, () => resolve())
      } catch {
        resolve()
      }
    })
  }

  private settle(): { resolve: (token: string) => void; reject: (error: unknown) => void } | null {
    const waiting = this.waiting
    this.waiting = null
    return waiting
  }

  private onResponse(response: GisTokenResponse): void {
    const waiting = this.settle()
    if (response.error || !response.access_token) {
      waiting?.reject(
        new StorageError(
          'access-denied',
          response.error === 'access_denied'
            ? 'Google Drive access was not granted.'
            : 'Google did not grant access. Try again.',
        ),
      )
      return
    }
    if (!this.oauth2.hasGrantedAllScopes(response, DRIVE_FILE_SCOPE)) {
      // Granular consent: the runner can untick the Drive box and still "allow".
      waiting?.reject(
        new StorageError(
          'access-denied',
          'Saving needs permission to create files in your Google Drive. Tick it on the Google screen.',
        ),
      )
      return
    }
    const seconds = Number(response.expires_in)
    this.token = response.access_token
    this.expiresAt = this.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000
    waiting?.resolve(response.access_token)
  }

  private onError(error: GisClientError): void {
    const waiting = this.settle()
    if (error.type === 'popup_failed_to_open') {
      waiting?.reject(
        new StorageError('popup-blocked', 'The Google sign-in window was blocked. Allow pop-ups and tap again.'),
      )
    } else if (error.type === 'popup_closed') {
      waiting?.reject(new StorageError('popup-closed', 'The Google sign-in window was closed before finishing.'))
    } else {
      waiting?.reject(new StorageError('unknown', 'Google sign-in failed. Try again.'))
    }
  }
}

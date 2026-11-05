/**
 * The slice of Google Identity Services' token model this app uses, typed by hand (no
 * `@types/google.accounts` dependency for five members).
 * https://developers.google.com/identity/oauth2/web/reference/js-reference
 */

export interface GisTokenResponse {
  access_token?: string
  expires_in?: number | string
  scope?: string
  error?: string
  error_description?: string
}

export interface GisClientError {
  type?: 'popup_failed_to_open' | 'popup_closed' | 'unknown' | string
  message?: string
}

export interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void
}

export interface GisOAuth2 {
  initTokenClient(config: {
    client_id: string
    scope: string
    callback: (response: GisTokenResponse) => void
    error_callback?: (error: GisClientError) => void
  }): GisTokenClient
  hasGrantedAllScopes(response: GisTokenResponse, ...scopes: string[]): boolean
  revoke(accessToken: string, done?: () => void): void
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GisOAuth2 } }
  }
}

export const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client'

let pending: Promise<GisOAuth2> | null = null

/**
 * Injects the GIS script once and resolves with `google.accounts.oauth2`. Called only after the
 * runner chooses Google Drive (or chose it on an earlier visit) — never at page load, so nobody
 * who never picks Drive makes a request to Google (design D1).
 */
export function loadGisScript(doc: Document = document): Promise<GisOAuth2> {
  const ready = window.google?.accounts?.oauth2
  if (ready) return Promise.resolve(ready)
  if (pending) return pending
  pending = new Promise<GisOAuth2>((resolve, reject) => {
    const script = doc.createElement('script')
    script.src = GIS_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => {
      const oauth2 = window.google?.accounts?.oauth2
      if (oauth2) resolve(oauth2)
      else reject(new Error('Google sign-in loaded without its OAuth module.'))
    }
    script.onerror = () => reject(new Error('Could not load Google sign-in.'))
    doc.head.appendChild(script)
  }).catch((error) => {
    pending = null
    throw error
  })
  return pending
}

/** Test hook. */
export function resetGisLoaderForTests(): void {
  pending = null
}

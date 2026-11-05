import { createFakeProvider } from './fakeProvider'
import { createGoogleDriveProvider } from './googleDrive/googleDriveProvider'
import type { StorageProvider } from './provider'

declare global {
  interface Window {
    /**
     * Development-only: `'fake'` swaps Google Drive for the in-memory fake provider (mirrored to
     * `localStorage['strides.devFakeStorage']`), so a live check can save and open Progress with
     * no Google account. Set with `page.addInitScript()` before the app mounts. Never read outside
     * a development build (`import.meta.env.DEV`).
     */
    __STRIDES_STORAGE_PROVIDER_OVERRIDE__?: 'fake'
  }
}

export const DEV_FAKE_STORAGE_KEY = 'strides.devFakeStorage'

let provider: StorageProvider | null = null

/** The one provider for this page, created on first use. */
export function resolveStorageProvider(): StorageProvider {
  if (provider) return provider
  if (import.meta.env.DEV && window.__STRIDES_STORAGE_PROVIDER_OVERRIDE__ === 'fake') {
    provider = createFakeProvider({ persistKey: DEV_FAKE_STORAGE_KEY })
  } else {
    provider = createGoogleDriveProvider({ clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID })
  }
  return provider
}

/** Test hook. */
export function setStorageProviderForTests(next: StorageProvider | null): void {
  provider = next
}

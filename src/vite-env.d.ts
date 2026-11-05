/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Build commit, stamped by vite.config.ts (save-assessments-to-runner-storage, D5). */
  readonly VITE_STRIDES_COMMIT?: string
  /** Google OAuth web client ID for the Drive storage provider. Absent = Drive unavailable. */
  readonly VITE_GOOGLE_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

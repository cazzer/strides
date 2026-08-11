import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // See src/pose/backends/__shims__/mediapipe-pose.ts: @mediapipe/pose isn't a real
      // ESM/CJS module, which breaks Rollup's production build the moment anything
      // reachable from the app entry point imports @tensorflow-models/pose-detection
      // (which unconditionally imports it for a BlazePose backend this app never uses).
      '@mediapipe/pose': fileURLToPath(
        new URL(
          './src/pose/backends/__shims__/mediapipe-pose.ts',
          import.meta.url,
        ),
      ),
    },
  },
})

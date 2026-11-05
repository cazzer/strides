import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'

// Which code produced a saved assessment (save-assessments-to-runner-storage, D5). Read by
// src/storage/buildInfo.ts as import.meta.env.VITE_STRIDES_COMMIT; vite exposes VITE_* from
// process.env. GITHUB_SHA on the Pages deploy, else this checkout's short sha, else unset.
function resolveBuildCommit(): string | undefined {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 8)
  try {
    return execSync('git rev-parse --short=8 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return undefined
  }
}
const buildCommit = resolveBuildCommit()
if (buildCommit && !process.env.VITE_STRIDES_COMMIT) process.env.VITE_STRIDES_COMMIT = buildCommit

// https://vite.dev/config/
export default defineConfig({
  base: '/strides/',
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      // Agent worktrees nest inside this checkout. Without this, a `vite build` in one of them
      // rewrites its dist/index.html and this dev server full-reloads every open page — which
      // silently kills any analysis in flight (hit for real on a phone run, strides-p1qt).
      // Anchored to THIS config's directory: a bare `**/.claude/worktrees/**` also matches a
      // worktree's own root when vite runs inside one, and then vite never sees the harness
      // identity marker written to public/ at startup, so the provenance guard refuses.
      ignored: [fileURLToPath(new URL('./.claude/worktrees/**', import.meta.url))],
    },
  },
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

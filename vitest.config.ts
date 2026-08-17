import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    // Vitest's default excludes don't cover the last two — both are directories its default
    // include glob happily walks but that were never vitest's to run:
    //   `.claude/worktrees/**` — a sprint/tweak-spawned agent's isolated worktree is a full
    //     nested checkout, so without this every test runs twice (once from the real tree, once
    //     from the worktree copy).
    //   `e2e/**` — Playwright's testDir (playwright.config.ts), run by `npm run test:e2e`. Its
    //     specs import `test` from `@playwright/test`, which throws when called outside the
    //     Playwright runner, so collecting them fails `npm test` for a suite vitest cannot run.
    //     Latent until `@playwright/test` was actually installed in node_modules.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      '**/.claude/worktrees/**',
      'e2e/**',
    ],
  },
})

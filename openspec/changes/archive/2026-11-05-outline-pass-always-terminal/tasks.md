## 1. Outline pass always terminal

- [x] 1.1 Regression test: the outline sampler throws synchronously → pass 'failed', couldn't-run caveat, segmenter released
- [x] 1.2 Catch-all on the outline-pass body → `failPass`

## 2. Harness

- [x] 2.1 `ab-person-selection.mjs`: `page.on('crash')` and a liveness probe on settle timeout (`harness.pageAtSettleTimeout`, WARNING line)
- [x] 2.2 Probe paths checked: live (forced timeout), crashed (`chrome://crash`), unresponsive (busy loop)

## 3. Verify

- [x] 3.1 Unit tests, lint, build
- [x] 3.2 A/B on all 9 clips vs the 01c4ef04 baseline; front-approach outline reading unchanged
- [x] 3.3 Notes: `swing-foot-travel.md`, `harness.md`

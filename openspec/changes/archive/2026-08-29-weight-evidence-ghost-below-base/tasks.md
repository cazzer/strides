# Tasks

One ticket, `strides-c37`. Phase 1 is measurement and must complete before any constant is written —
the number is a sweep result, not a hypothesis.

## 1. Measure (Phase 1)

- [x] 1.1 Add the temporary probe to `extractFrame`: draw each instant a second time at α = 1 into
  its own canvas inside the existing seek loop (zero extra seeks), stash the sources plus the
  pre-annotation and annotated canvases on `window.__STRIDES_EVIDENCE_SOURCES__`, `import.meta.env.DEV`-gated.
- [x] 1.2 Drive all three clips in headless Chromium on real GPU (renderer asserted, dev server on a
  non-default port confirmed to serve this worktree), taking the **last** `[evidence-coverage]` line
  and classifying ghosted exemplars from it.
- [x] 1.3 Composite the five arms offline from the same two source crops per exemplar, at 640 px and
  downscaled to the real 144 px inline size.
- [x] 1.4 **Free model cross-check first**: PSNR each α against the app's own canvas; the peak must
  land at exactly 0.50. Verified on all 12 ghosted exemplars, 53.8–54.9 dB.
- [x] 1.5 Judge every arm on every ghosted exemplar against the pre-registered rule; record what each
  arm looked like per clip in `design.md`.
- [x] 1.6 Revert the probe (`git checkout -- src/video/extractFrames.ts`), confirmed with `git diff`.

## 2. Spec

- [x] 2.1 `openspec new change weight-evidence-ghost-below-base`.
- [x] 2.2 `proposal.md`, `design.md` (carrying the sweep table — the measurement IS the design
  record), and the `results-view` delta: **one ADDED requirement, zero MODIFIED blocks**.
- [x] 2.3 `openspec validate weight-evidence-ghost-below-base --strict` passes.

## 3. Code

- [x] 3.1 `evidenceFrames.ts`: rename to `EVIDENCE_GHOST_BLEND_ALPHA = 0.35`, add
  `EVIDENCE_GHOST_MARK_OPACITY = 0.5` adjacent, rewrite both doc comments to state the `(1−α)`
  arithmetic, the floor mechanism, and the size the number was judged at; update the `instantPlan`
  call site.
- [x] 3.2 `evidenceAnnotations.ts`: `frameOpacityFor`, its import and its doc → `EVIDENCE_GHOST_MARK_OPACITY`.
- [x] 3.3 `extractFrames.ts`: documentation only — the "symmetric 50/50 double exposure" claim and
  the dirty-alpha note are now false statements. No behaviour change in this file.
- [x] 3.4 `canvasTestUtils.ts`: add `globalCompositeOperation` to the fake context (T1 needs it).

## 4. Tests

- [x] 4.1 Re-point every existing constant site by **which value it stands for**, reviewed line by
  line — fixtures carrying `EvidenceInstantPlan.opacity` take `BLEND_ALPHA`; expectations multiplying
  `DETECTED_OPACITY`/`INTERPOLATED_OPACITY` take `MARK_OPACITY`.
- [x] 4.2 T1 — pin the ordered draw log (call, alpha, source time, composite mode), replacing the
  alpha-only recorder.
- [x] 4.3 T2 — replay that log through a test-local `source-over` reducer: one test pinning the exact
  65/35 split and its sum, one named for the strict-inequality invariant.
- [x] 4.4 T3 — a plan whose `ghost.opacity` is a third value neither constant equals, asserting the
  ghost's mark opacity still derives from the instant role.

## 5. Verify and record

- [x] 5.1 `npx tsc -b` clean, `npm test` green, `eslint` clean on touched files.
- [x] 5.2 Re-run all three clips in the real app and look at the rendered metric cards at their real
  size — closes the gap between the offline downscale and the browser's own 640→144 filter.
- [x] 5.3 One line in CLAUDE.md's "Metric frame evidence" section recording the asymmetry and the
  chosen number, since the archived design it points at states 50/50.

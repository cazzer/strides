# Design

## D1 — ADD a requirement rather than MODIFY the three that exist

Three requirements already bound a decoder count, each scoped to one feature:

- `video-input` / **Poster frame for a loaded clip** — "At most one **such** decoder SHALL exist at a
  time across the whole session, and that limit SHALL be enforced by the derivation itself rather
  than asked of its callers", plus the scenario *Several clips arrive at once and decode one at a
  time*.
- `results-view` / **Evidence frames are planned purely, then extracted from a detached video
  element** — "It SHALL hold at most one detached decoder open at a time".
- `results-view` / **Evidence renders as annotated thumbnails inside the metric card** — "whatever
  component owns it SHALL hold at most one detached decoder open at a time".

None of them is falsified by this change: a global ceiling of one implies each per-feature ceiling of
one, so all three statements stay true, and the poster requirement's "enforced by the derivation
itself rather than asked of its callers" also stays true — `deriveClipPoster` still enforces it from
inside itself; only the mechanism it enforces it with moved into a shared module.

What is missing from the spec is the ceiling for the **pair**, which is a property of neither feature
and therefore has no natural home inside either requirement. Stating it as its own requirement is
both more accurate and materially safer than rewriting three bodies: a MODIFIED block replaces a whole
requirement body, and this repo has already lost edits that way when two changes modified the same
requirement independently (CLAUDE.md, 2026-08-18). Three large MODIFIED bodies for one concurrency
sentence is a poor trade. `openspec/changes/` was empty of in-flight changes when this was written, so
there was no live conflict — the argument is about the cost of the hazard, not about a specific one.

It goes in `video-input` rather than `results-view` because it is about the app's video-decoding
resources rather than about what the results show, and because `video-input` already carries the
transient-decoder vocabulary and the 4K memory reasoning the new requirement builds on.

## D2 — What the requirement deliberately does not say

It does not name the two features as an exhaustive list, does not name the module, and does not say
the queue is a promise chain. It says "at most one across all of them, through a single shared
serialization point" — which is the property that was violated and the property a future reader needs.
A third consumer must join the same queue to comply; that is the point.

It also explicitly disclaims being a schedule. The old duplication had produced a false claim of
exactly that kind — `extractFrames.ts` stated "runs strictly after `phase: 'ready'`, never inside the
sampling loop" in the same module doc as the primitives `useClipPoster` borrowed to run DURING
sampling. Whoever reads the new requirement should not repeat that inference from a shared resource
bound.

## D3 — Why the cross-feature property needed a test of its own

Each feature's own suite is structurally blind to it: `posterFrame.test.ts` imports only the poster
entry point and `extractFrames.test.ts` only the evidence one, so each can observe its own queue and
nothing else. Both suites were fully green while the global peak of two was possible.

`videoElement.test.ts` drives both entry points against one bracket instrument — `URL.createObjectURL`
logs `open`, `URL.revokeObjectURL` logs `close`, so an interleaved log is direct evidence of overlap.
Verified by mutation: with a private queue restored to `posterFrame.ts` (the pre-change structure), the
log reads `open:1, open:2, close:1, close:2` and three of the four cross-module tests fail on a peak of
2. With the shared queue they read `open:1, close:1, open:2, close:2`.

## D4 — The extraction is behaviour-preserving by construction

Every moved primitive is byte-identical to the copy it replaced, verified mechanically against
`git show HEAD:` rather than by eye: `seekTo`, `waitForPresentedFrame`, `waitForDecodedData` (both
copies), the decoder open sequence (both copies), the teardown `finally` (both copies), and the
constant/type/doc blocks that travelled with them — 15 blocks, all identical.

Three doc sentences were rewritten rather than transplanted, because each was true only of the
evidence path and would have become false in a shared module: the load timeout's "has already been
decoded once by the analysis pass", `seekTo`'s "this one must mark the metric `'extraction-failed'`",
and the schedule claim in D2. Each is restated to cover both consumers.

## D5 — `deriveClipPoster`'s never-throws claim: the doc was wrong, not the code

`drawPosterFrame`'s doc claimed "every failure is a `null`, never a throw" while `decodePosterFrame`
was `try`/`finally` with no `catch`, and `useClipPoster` attaches no rejection handler
(beads `strides-k03`, finding 5). The doc is what was corrected, for three reasons:

1. An existing test — *"does not wedge the queue when a derivation fails outright"* — deliberately
   pins `deriveClipPoster` **rejecting** when `URL.createObjectURL` throws, and pins that the queue
   survives it. Adding a `catch` would delete a behaviour the suite asserts on purpose, inside a
   change whose bar is behaviour preservation.
2. Every failure mode the code knows about is already a `null`. A throw is therefore by definition a
   bug, and catching it would leave the poster `null` either way while erasing the only signal that
   the bug exists.
3. The claim was scoped wrongly rather than wrong in mechanism: the failures `drawPosterFrame`
   *decides* genuinely are nulls. The overclaim is the universal quantifier.

The corrected docs now say both halves explicitly — nulls for what the code decides, propagation for
what it does not — on `drawPosterFrame` and on `deriveClipPoster`, the exported entry point whose
callers are the ones who have to know.

`useClipPoster.ts:41`'s missing rejection handler is left as it is. It is the repo's existing shape
(`useSessionEvidence.ts:280` is identical) and changing it is a behaviour change in a file this change
otherwise does not touch. Flagged rather than fixed.

## D6 — Verification

- `npx tsc -b`, `npx eslint src/`, `npm test` (85 files, 1217 tests) all clean.
- Live, headless Chromium on real GPU (`ANGLE Metal Renderer: Apple M4 Pro`), per-checkout derived
  port with the identity guard passing: posters render on the clip strip (Demo 1 240x135 landscape,
  Demo 2 135x240 portrait — the `POSTER_MAX_SIDE_PX` cap on the longer side, both orientations), and
  evidence thumbnails render at **7 images / 5 sections** on Demo 1 and **5 / 4** on Demo 2, matching
  the per-metric coverage table in CLAUDE.md exactly.
- Regression anchor exact: Demo 1 `verticalOscillationCm` = `4.421467928439415`,
  `fit.frequencyHz` 1.52 x 60 = 91.2 == `cadence.value` 91.2, `subjectAgreement` 52/53.
- The concealment/throughput risk does not apply: `useClipPoster.ts` is untouched, no component
  renders differently, and `ClipStripEntry`'s `showsLiveElement` is a function of analysis state
  alone, never of whether a poster exists — so nothing here can change when a clip's `<video>` is
  mounted, sized or presented. The playback-arm re-verification was therefore not run.

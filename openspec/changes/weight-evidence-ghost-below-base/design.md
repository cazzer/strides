# Design — weighting a ghosted evidence photograph toward its base

## D1. The arithmetic, and why "0.35" is not "the ghost is 35% of the picture"

`extractFrame` draws the base first at `globalAlpha = 1` onto a *transparent* canvas, then the ghost
at `globalAlpha = α`. Under `source-over` that is:

```
out = α·ghost + (1 − α)·base
```

so `α = 0.35` yields a **65/35** split in the base's favour. The compositing input (`α`) and the
resulting weight (`1 − α`) are different numbers, which is why the two constants are named
differently:

| name | value | job | read by |
|---|---|---|---|
| `EVIDENCE_BASE_OPACITY` | `1` | the base is opaque in **both** jobs | `evidenceFrames.ts`, `evidenceAnnotations.ts` |
| `EVIDENCE_GHOST_BLEND_ALPHA` | `0.35` | `globalAlpha` the ghost PHOTOGRAPH composites at | `evidenceFrames.ts` only |
| `EVIDENCE_GHOST_MARK_OPACITY` | `0.5` | frame-level multiplier on the ghost's ANNOTATION marks | `evidenceAnnotations.ts` only |

`ALPHA` vs `OPACITY` in the names is load-bearing. Both live in `evidenceFrames.ts`, adjacent, so the
invariant `EVIDENCE_GHOST_BLEND_ALPHA < EVIDENCE_GHOST_MARK_OPACITY` — the photograph is fainter than
the marks drawn on it — is visible in one place.

`EVIDENCE_BASE_OPACITY` is deliberately **not** split. It is genuinely `1` in both jobs, and two
constants that must always be equal are a coupling waiting to break.

## D2. The floor mechanism — why lowering α cannot be pushed arbitrarily far

On a static camera the background is identical in both frames and reproduces at `α + (1 − α) = 1` —
full contrast regardless of α. The BODIES do not: the base body's contrast against that background
scales by `(1 − α)`, the ghost's by `α`. Lowering α therefore fades the ghost against a background
that never fades.

The floor is consequently a function of **each clip's own subject-vs-background contrast**, not of α
alone — which is why the sweep below covers three clips rather than one, and why the answer is the
largest α that satisfies the emphasis requirement rather than the smallest that still looks clean.

## D3. How the candidates were rendered — one extraction, five arms composited offline

Patching the constant five times and re-running the app was rejected: `multiperson-track.mp4` is
documented run-to-run non-deterministic (coverage swings 7/5 → 4/3 between trials), so five separate
runs would differ in WHICH FRAMES each arm drew — the arms would not be comparable on the one clip
most likely to expose the floor.

Instead: **one extraction per clip, five arms composited offline from the same two source crops.**

1. A temporary probe in `extractFrame` (added, measured, reverted — the repo's documented cycle)
   drew each instant a second time at α = 1 into its own canvas, inside the existing seek loop, so
   **zero extra seeks**, and stashed `{metric, kind, side, baseTimestamp, ghostTimestamp, cropSide,
   outputSide, baseCanvas, ghostCanvas, photoCanvas, annotatedCanvas}` on
   `window.__STRIDES_EVIDENCE_SOURCES__` under an `import.meta.env.DEV` guard.
2. A throwaway Playwright driver (real GPU — `ANGLE Metal Renderer: Apple M4 Pro`, asserted, never
   SwiftShader; dev server on a non-default port confirmed to be serving THIS worktree) loaded each
   clip, waited for `analysis complete` and then for the **last** `[evidence-coverage]` line, and
   exported every stashed canvas as PNG. Ghosted exemplars were classified from that coverage line
   (`pairedTimestamp` present and `demotedFromPair === false`), not assumed from a table.
3. Arms were composited offline with ffmpeg and downscaled to exactly **144 px** — the real inline
   size (`MetricsPanel.tsx` renders the thumbnail in a `w-36` box; commit `0325943` enlarged it from
   112, so any older note saying 112 is stale).

No `window.__STRIDES_*_OVERRIDE__` was added: a permanent override point for a one-shot number
selection is surface with exactly one use.

## D4. The free model cross-check — done FIRST, before any image was judged

If the offline arithmetic model is wrong, every arm below is meaningless and so is the T2 unit test,
which encodes the same model. So before judging: composite at α = 0.5 and PSNR against the app's own
canvas for the same exemplar. **The peak must land at exactly 50/50.**

It does, on **all 12 ghosted exemplars across all three clips**, against the app's own photographic
layer:

| clip | exemplar | α=0.25 | α=0.35 | α=0.45 | **α=0.50** | α=0.55 | α=0.65 |
|---|---|---|---|---|---|---|---|
| demo1 | `verticalOscillation` | 30.38 | 34.73 | 43.50 | **54.46** | 44.11 | 34.96 |
| demo1 | `verticalRatio` stridePair | 32.14 | 36.45 | 44.92 | **54.48** | 45.69 | 36.76 |
| demo1 | `kneeFlexion` | 31.37 | 35.70 | 44.33 | **54.55** | 44.97 | 35.96 |
| demo2 | `verticalOscillation` | 27.16 | 31.57 | 40.71 | **54.25** | 40.95 | 31.65 |
| demo2 | `armSwingSymmetry` left | 23.47 | 27.92 | 37.40 | **54.93** | 37.20 | 27.85 |
| demo2 | `stepWidth` | 28.38 | 32.74 | 41.66 | **54.11** | 42.27 | 32.96 |
| multiperson | `kneeFlexion` | 23.81 | 28.19 | 37.36 | **54.07** | 38.03 | 28.42 |
| multiperson | `verticalOscillationCm` | 21.44 | 26.05 | 35.06 | **53.80** | 35.72 | 26.02 |

(dB; the four exemplars omitted are byte-identical duplicates of rows above — `verticalRatio`
/`verticalOscillationCm` share `verticalOscillation`'s bounce pair on demo1 and demo2, confirmed by
md5.)

Two notes on reading these:
- The peak is 53.8–54.9 dB — near-exact reconstruction, ~10 dB clear of its own α = 0.45/0.55
  neighbours — because the probe's sources are the app's OWN decoded pixels. The RCA's ~17.74 dB
  figure came from ffmpeg-reconstructed frames, a lower-fidelity source; its 17-24 dB regime is
  reproduced here by the α = 0.00/1.00 endpoints (15.5–26.3 dB). The claim under test is the
  **argmax**, and it lands at exactly 50/50 in every row.
- Against the *annotated* canvas the argmax is also exactly 0.50 (21.9–30.0 dB — the annotation marks
  cap the achievable PSNR, since no photographic blend can reproduce them).

**A real trap this check did not catch, and one that mattered.** ffmpeg's `blend` filter applies
`all_opacity` to input **0**, which is the TOP layer — so the first version of the compositor
produced `α·base + (1−α)·ghost`, a mirrored sweep. A symmetric peak at 0.50 is invariant under that
mirror, so the cross-check above passed while the arms were inverted. It was caught by a *patch-mean*
check instead: sampling a 40×40 patch where the base has background and the ghost has the runner's
shorts, and confirming the measured mean tracks `(1−α)·base + α·ghost` numerically
(α = 0.25 → red channel 0x42 = 66, predicted `0.75·83 + 0.25·17 = 66.5`). **Any re-measurement should
anchor "which body is which" numerically before judging pixels; visual impression is not sufficient
and was wrong here.**

## D5. The sweep — pre-registered candidates and rule

Fixed before looking:

| α | base/ghost | hypothesis registered up front |
|---|---|---|
| **0.50** | 50/50 | **control — today's behaviour, rendered so every arm is judged against it rather than memory** |
| 0.40 | 60/40 | emphasis exists at 640 px, likely does not survive the 640→144 downscale |
| **0.35** | 65/35 | expected pick |
| 0.30 | 70/30 | unambiguous at 640 px; suspect at 144 px on low-contrast clips |
| 0.25 | 75/25 | **deliberate floor probe, expected to fail** — brackets the floor with an observed failure rather than taste |

Decision rule, fixed before looking and not amended after:

1. On every ghosted exemplar, all three clips, **at 144 px**: the base body reads as the foreground.
2. On every ghosted exemplar, at 144 px: the ghost is still identifiable as a *body*, not a smudge.
3. The solid cyan skeleton sits on the body a reader reads as solid (the ticket's acceptance
   criterion).
4. **Choose the largest α satisfying 1+3**, so the floor in 2 keeps the most margin. Ties go to the
   control.
5. If no candidate satisfies both 1 and 2 on some clip, the answer is NOT a smaller number — it is a
   finding that opacity alone cannot carry the emphasis. Record and stop.

## D6. What each arm looked like

Ghosted exemplars measured: **demo1 5** (`verticalOscillation`, `verticalRatio` bounce, `verticalRatio`
stridePair-left, `kneeFlexion`-left, `verticalOscillationCm`), **demo2 5** (`verticalOscillation`,
`verticalOscillationCm`, `armSwingSymmetry` left and right, `stepWidth`), **multiperson 2**
(`kneeFlexion`-right, `verticalOscillationCm`) — the multiperson run was one of that clip's
lower-coverage trials, within its documented range. Every one was looked at at true 144 px and at a
4× nearest-neighbour magnification of the same 144 px pixels (magnification adds no information; it
only makes the same pixels readable).

| α | demo1 (side view, bright seats behind the runner) | demo2 (front approach, overlapping instants) | multiperson (light fence, low subject/background contrast) |
|---|---|---|---|
| **0.50** | two bodies at identical weight; neither is the subject | the head is a doubled face, the second arm as strong as the first — the reported symptom | two equally-weighted runners; the image reads as two people |
| 0.40 | base measurably firmer (deeper blue shorts, crisper shoe) but at true 144 px it is a look-twice difference, not a glance-level foreground | base's face begins to win; ghost arm still competes | base slightly stronger; marginal at true size |
| **0.35** | base clearly the foreground at a glance; on `verticalOscillation` (dark fence behind the ghost) the ghost is still a complete legible body — head, arms, shorts, both legs. **Not uniform across this clip's exemplars — see D10** | one coherent runner with a translucent second arm/shoulder and second leg | base clearly primary; ghost unmistakably a second body |
| 0.30 | base solid; ghost clearly secondary, still legible everywhere | base solid; ghost arm and leg still visible | base solid; ghost noticeably faint but still a body |
| 0.25 | base very solid; the ghost's torso over the bright seats is washing out — heading toward a smudge | base near-single-image; the ghost's overlapped forearm is faint | **fails** — the ghost's light top against the light fence nearly disappears at true size |

**Verdict: α = 0.35, a 65/35 split.** It is the largest arm satisfying rules 1 and 3: 0.40's emphasis
does not survive the 640→144 downscale — exactly the pre-registered hypothesis for that arm — while
0.35 reads as a foreground body at a glance on all three clips. Rule 2 is satisfied with margin at
0.35 and fails at 0.25 on the lowest-contrast clip, which is the floor the probe was there to find.
Rule 5 never fired.

Rule 3 follows from rule 1 by construction — `frameOpacityFor` draws the base's marks at
`EVIDENCE_BASE_OPACITY` and the base is now also the photographically dominant body — and was
confirmed in-app afterwards rather than assumed (see D8).

## D7. Coverage gaps in the sweep, recorded rather than fixed

- **`trunkLean` and `overstriding` emit no evidence on any of the three clips** (`all-gated-out`,
  documented in CLAUDE.md). Their pairs are the most time-separated the app produces, so the sweep
  has **no coverage** for the case most likely to sit near the floor. Accepted gap.
- **None of the three clips has a genuinely low-contrast subject** (dark clothing, dusk, cluttered
  background). Mitigated by decision rule 4 — the largest passing α keeps the most floor margin.
- On demo2's `verticalOscillation` exemplar the base instant's head is clipped by the crop
  (`strides-ql0`, a separate open ticket) — a competing cue for "which body is the subject". That
  exemplar was not the marginal one, so no α was tuned to compensate for a crop bug.
- The offline downscale is ffmpeg's `area` filter, not Chromium's own 640→144 filter. That gap is
  closed only by the in-app confirmation, D8.

## D8. Test design — what the unit suite can and cannot reach

The suite runs where `getContext('2d')` returns `null` by deliberate choice, and **must not acquire a
real compositor** (no `canvas` npm package). So the tests pin the *instructions*, and a test-local
reducer turns those instructions into the weights they would produce:

- **T1 — pin the draw log, not the alphas.** `extractFrames.test.ts` previously recorded only
  `ctx.globalAlpha` per `drawImage`. It now records an ordered log of
  `{call, alpha, sourceTime, composite}` — `sourceTime` read from `video.currentTime` inside the
  `drawImage` mock, which the fake video already exposes as a real accessor — and asserts the
  photographic prefix is exactly base-at-1 then ghost-at-`EVIDENCE_GHOST_BLEND_ALPHA`, both
  `source-over`. This catches reversed draw order (the sharp edge: base last over an opaque canvas
  ERASES the ghost rather than reweighting it), extra or missing draws, an intervening canvas
  mutation, and a composite-mode change.
- **T2 — pin the resulting weights.** The log is replayed through a test-local `source-over` reducer
  (`weights = scaleAllBy(1−α); weights[t] += α`, from `{}`), in two separate `it()`s: one asserting
  the exact `{base: 0.65, ghost: 0.35}` split and that it sums to 1 (so moving the constant is a
  deliberate edit, and a dropped base draw is caught), and one named **"the base instant is
  composited at strictly more weight than the ghost"**, asserting only the inequality — the invariant
  this ticket exists for, independent of the number. The reducer stays test-local; the draw path does
  not use it and a shared helper would drift.
- **T3 — pin the decoupling.** `evidenceAnnotations.test.ts` builds a plan whose `ghost.opacity` is a
  **third value neither constant equals** (`0.11`) and asserts the ghost's mark opacity is still
  `DETECTED_OPACITY × EVIDENCE_GHOST_MARK_OPACITY`. This proves `frameOpacityFor` derives from the
  instant ROLE and never from the plan's photographic alpha — the exact coupling that produced this
  bug, and the only thing that catches a mis-assigned constant inside `frameOpacityFor`.

**What these tests cannot catch:** that Chromium actually implements the modelled arithmetic (that is
D4's live PSNR check), premultiplied-alpha rounding, and anything at all about how the image looks.

## D9. Mis-assignment is the main risk, not breakage

Both symbols are plain numbers, so swapping them compiles and most tests still pass. Every current
`EVIDENCE_GHOST_OPACITY` site was therefore classified by **which value it stands for**, not by which
file it is in, and reviewed line by line rather than find-and-replaced. Fixture sites in the
annotation tests take `BLEND_ALPHA` (they are `EvidenceInstantPlan.opacity`, a photographic field);
expectation sites that multiply by `DETECTED_OPACITY`/`INTERPOLATED_OPACITY` take `MARK_OPACITY`. T3
guards `frameOpacityFor`; nothing guards a fixture, which is why the classification was done by hand.

## D10. What the UX review found afterwards — the floor is reached on one exemplar

The sweep (D5/D6) chose α from a judgement per *clip*. A UX review then re-drove all three clips
against a **rendered α = 0.50 control** — not against memory — and recovered each pair's two source
photographs per-pixel by solving the two composites as two equations, so "which body is which" was
anchored numerically rather than by eye. It confirmed the verdict on all 12 ghosted exemplars: the
base is the foreground body at 144 px and the solid cyan skeleton sits on it. That run got
multiperson at 7/5 coverage, the top of its documented range, so it saw more ghosted exemplars than
D6's run did.

It also found the floor is **not uniform within a clip**, which D6's per-clip cells obscured.

**The demo1 cell in D6 overstates its own measurement, and is corrected there.** "A complete legible
body — head, arms, shorts, both legs" is true of demo1 `verticalOscillation`, whose ghost sits over a
dark fence. It is false of demo1 **`kneeFlexion`**, whose ghost sits at the right edge over bright
grass and red track: at true 144 px it is a faint torso smear plus a three-dot amber stick with no
leg under it — the spec's "ghost stays visible as a body" scenario failing on a single exemplar.
Measured on the ghost's own pixels: its shin darkens the track by 24.5 levels (35 at α = 0.50), its
shorts tint the grass by +10 (+15 at α = 0.50). The content and the annotation placement are both
correct — the recovered ghost layer shows a perfectly legible leg with the amber line on it — so what
erases it is the weighting against a high-luminance background.

**This is not a reason to raise α.** The discriminator is the background luminance the ghost happens
to lie on, which α cannot see — exactly what D2 predicts. Raising α to rescue this exemplar would
give back the emphasis on the other eleven. If it is worth closing it is a per-exemplar decision, not
a different number.

Second, milder instance: demo2 **`stepWidth`**, where the two instants overlap. At 144 px the ghost
reads as whitish patches on the base's own thighs rather than a second position, so the second
instant the caption promises is carried entirely by the marks. The α = 0.50 control was only
marginally better, so most of this is the approach clip's overlap geometry rather than the weighting.

**Ghost survival, measured** — median per-pixel contribution of ghost-only content in the shipped
composite, and the share of ghost pixels still above a 12-level (8-bit) visibility floor:

| clip | exemplars | median ghost signal | still visible |
|---|---|---|---|
| demo1 | VO / VR-stride / VOcm / `kneeFlexion` | 16.3 / 17.1 / 17.1 / 19.4 | 84–89% |
| demo2 | VO / armSwing L / armSwing R / `stepWidth` | 21.0 / 22.6 / 23.3 / 18.7 | 85–92% |
| multiperson | VO / VR-stride / VOcm / `kneeFlexion` | 27.2 / 24.1 / 29.6 / 20.2 | 86–94% |

demo1 is the weakest column, which matches both the eye and the finding above.

**Both findings exist only at 144 px.** At 320–640 px every exemplar passes both tests comfortably,
`kneeFlexion` included — judged at full resolution neither would have been filed. That is the
strongest evidence available that this feature has to be judged at the size it renders at, and it is
why D5's rule fixed the judging size before any image was looked at.

Two further UX observations, both confirmed pre-existing and unmoved by this change, filed separately
rather than fixed here: amber marks over bright backgrounds run to low contrast (demo1 `kneeFlexion`
7.9:1, demo2 `stepWidth` 2.9:1, multiperson stride 1.7:1 — all within 0.1 of the α = 0.50 control),
and `altFor`'s text alternative does not convey the visual emphasis this change introduces.

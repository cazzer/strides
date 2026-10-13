## Context

`schedule-scale-passes-after-primaries` (archived 2026-10-07) gave the scale passes their own lane.
Rule 4 of `nextScalePassClipIndex` holds every pass while the next primary to run samples on the
sequential path. A next primary that may sample on the playback path does not hold it, because a
playback primary waits for the earlier passes (D9 of that change), and holding both would deadlock.
"May sample on the playback path" included a clip whose probe had not answered yet.

## Diagnosis

### Evidence from the phone

The four S21 runs captured by `android-profile.mjs` (`/private/tmp/claude-501/android/*.json`,
not in the repo). Times are `atMs` on the page clock. P = primary pass, S = scale pass.

| run | clip 2 probe | clip 2 primary | order | complete |
|---|---|---|---|---|
| `cold-1` | 244 ms, `true` | sequential, 345 samples | P1 P2 P3 S1 … | 56.2 s |
| `base-1` | **12,991 ms** (`arrayBufferMs` 12,941), `true` | **playback, 153 samples** | **P1 S1 P2 S2 P3 S3** | **81.2 s** |
| `yield-1` | 426 ms, `true` | sequential, 345 samples | P1 P2 P3 S1 S2 S3 | 46.4 s |
| `down-1` | 198 ms, `true` | sequential, 345 samples | P1 P2 P3 S1 … | 45.1 s |

In `base-1` clip 2's probe started at 2,965 ms. The 3,000 ms timeout committed `false` at about
5,965 ms, and the real `true` at 15,956 ms was discarded. Clip 2 was then scheduled as a playback
clip (D9: S1 before P2) and held the detector until S2 was terminal, which gives exactly the observed
order. It also sampled as a playback clip: 153 samples where every other run took 345. The perf line
still read `supported: true`, which is why this looked like a scheduling bug and not a sampling one.

So the bead's hypothesis — clip 2's video still loading — is not what happened on the phone. The
video had loaded. The probe was slow, because `blob.arrayBuffer()` on a 20 MB blob contended with
clip 1's primary pass on the main thread (that run predates `strides-6i6.1`'s yield).

### Desktop reproduction

`order-driver.mjs` (throwaway, scratchpad): three-clip demo, fresh Chromium with the real-GPU args,
`ANGLE Metal Renderer: Apple M4 Pro`, a dev server started by the driver on the checkout's derived
port and identity-checked. Base `054c86b`.

| arm | how | order | clip 2 primary | "Analysis complete" |
|---|---|---|---|---|
| plain | — | P1 P2 P3 S1 S2 S3 | sequential, 345 | 9.7 s |
| CPU ×6 | `Emulation.setCPUThrottlingRate` | P1 P2 P3 S1 S2 S3 (2/2) | sequential, 345 | 16.4–16.6 s |
| slow probe | clip 2's `arrayBuffer()` held 5 s | **P1 S1 P2 S2 P3 S3** | **playback, 338** | **36.8 s** |
| slow load | clip 2's `loadedmetadata` held 8 s | **P1 S1 P2 P3 S2 S3** | sequential, 345 | 12.2 s |

CPU throttling alone did not reproduce it: with `strides-6i6.1`'s yield in place, every probe on a
×6-throttled desktop answered in under 750 ms. The slow-probe arm reproduces the phone's exact
order and its sampler switch. The slow-load arm is the bead's own hypothesis, and it is real too:
rule 4 let S1 run while clip 2 was unprobed.

## Decisions

### D1. The timeout's answer is a stand-in until a run picks its sampler

The 3 s bound exists so a probe that never settles cannot stall auto-start. Only a clip that holds
the detector is waiting for that. A queued clip is not, yet the bound fired for it all the same and
fixed its sampler for good. Now the timeout commits `false` as before, but the probe's real answer
replaces it as long as no run of that clip has picked a sampler. `start()` records the pick
(`samplerChosenForRef`), so a run already sampling on the stand-in is never switched underneath.

The bound itself is unchanged. For the clip that holds the detector it still decides after 3 s, and
on the phone the active clip's probe took 318–435 ms. Making it longer for that clip trades start
latency for fidelity on a probe we have never seen be slow; that is left open.

A late answer of `false` also commits, which is a no-op. A late answer of `true` for a clip whose
run already started is discarded and its demuxed track released, as before.

**The stand-in is hidden from the schedule.** The first version of this change showed the stand-in
to the session as `primarySamplingPath: 'playback'`. Its slow-probe arm then still ran
P1 S1 P2 P3 S2 S3 (clip 2 sampled sequentially, 345 samples, but S1 went first): the 5 s probe
outlasted both the 3 s bound and clip 1's 4.7 s primary, so at P1's `'ready'` clip 2 read as a
known playback clip. Now `primarySamplingPath` stays `null` while only the stand-in is known, and
settles when the probe answers, when a run picks its sampler, or when
`SEQUENTIAL_DECODE_PROBE_GIVE_UP_MS` (30 s) passes. Only a probe that never answers — never observed
— waits that long, so the bound has to guarantee progress, not be tight.

### D2. An unprobed next primary holds the lane

Rule 4 now holds the lane while the next primary's sampling path is undecided, as well as while it is
sequential. Only a next primary known to be playback lets the earlier passes drain.

This cannot deadlock. The active-clip rule still refuses to advance into an undecided clip while an
earlier pass is pending, so both lanes wait for the answer, and the answer depends on neither lane:

- The video loads and fires `loadedmetadata`, which starts the probe, or fails, and a failed source
  is not an outstanding primary.
- The probe answers, or the give-up bound settles the clip on the stand-in (D1), within 30 s.

An `'empty'` source has no load in progress, so no answer is coming. It does not hold the lane. In
practice every clip is created with a pending load, so `'empty'` is momentary.

### D3. What is not changed

- The active-clip rule (`nextActiveClipIndex`) and the lease are unchanged. An undecided clip is
  still treated as playback there, the conservative reading D9 chose.
- A waiting playback-path clip still takes the lane before rule 4 (rule 3), so a playback session
  still runs P1 S1 P2 S2.
- "Try again" and late-added clips: a clip reset by "Try again" keeps its probe's answer (the probe
  is per loaded clip, not per run), so it is decided. A late-added clip is undecided while it loads,
  and now holds the remaining passes for that load plus its probe, at most a few seconds, instead of
  letting them run ahead of a primary that will then wait for them.

## Pre-registered gate

1. **Single-clip gate (shared rule):** `scripts/ab-person-selection.mjs --arm 'base={}' --clips
   side-landscape,side-portrait,front-approach,multiperson,private-IMG_9114 … IMG_9119 --trials 2
   --evidence`, base `054c86b` against this branch, each with its own dev server. With `elapsedMs`
   and the `# commit` / `# baseURL` lines stripped, the two reports must be identical by `diff` and
   md5. A single clip has no ordering question, and its probe answers in well under 3 s on desktop,
   so no field may move.
2. **Three-clip sessions:** the demo button, base against branch, plain and with CPU ×6. Each clip's
   `[analysis-diagnostics]` and scale-pass lines, and the results panel's text, are compared. The
   order is already P1 P2 P3 S1 S2 S3 on both sides here, so the expectation is identical values.
   Any difference is reported with its cause, not hidden.
3. **The two reproduction arms** (slow probe, slow load) must run P1 P2 P3 S1 S2 S3 on the branch,
   with clip 2 sampled sequentially. Their values are compared with the plain arm, not hidden.

## Results

1. **Single-clip gate: identical.** Base `054c86b` against `6830a63`, 10 clips × 2 trials,
   `--evidence`, each with its own identity-verified dev server (ports 5354 and 5280). With
   `elapsedMs` and the header lines stripped, 2178 lines each; `diff` differs only in six table
   dividers whose width follows the `elapsedMs` string. With those removed both md5s are
   `1dbe12081dfbec48da347d8c4347d666`.
2. **Three-clip sessions: identical values.** Every clip's `[analysis-diagnostics]` and scale-pass
   line, the last `[evidence-coverage]` line, and the results panel text, compared field by field
   against one base plain run: 0 differences across base plain ×3, base CPU ×6 ×3, branch plain ×2
   and branch CPU ×6 ×2. All of them ran P1 P2 P3 S1 S2 S3.
3. **Reproduction arms on the branch:**

   | arm | base order | branch order | branch values vs plain |
   |---|---|---|---|
   | slow probe (5 s) | P1 S1 P2 S2 P3 S3, clip 2 playback 338 | **P1 P2 P3 S1 S2 S3**, clip 2 sequential 345 | 0 differences |
   | slow load (8 s) | P1 S1 P2 P3 S2 S3 | **P1 P2 P3 S1 S2 S3** | 0 differences |

   On base the slow-probe arm differs from plain in 266 fields — clip 2's sampling, person
   selection, view and metrics, its scale pass, 11 fields of clip 3's scale pass, and the evidence
   line — and in the fused panel: vertical oscillation reads **15.4 %** of torso length from clip 1
   instead of **17.1 %** from clip 2. That is the phone defect's user-visible cost, not noise. The
   base slow-load arm, which changed only the order, has 0 differences: in these runs the order
   alone moved no value.

## Risks / Trade-offs

- **A video that never loads and never errors** now holds the earlier clips' passes as well as the
  later clips' primaries. Before this change it already held every later primary, because the
  active index would stop on it, so the session was already stalled. No such source has been seen.
- **A probe that never answers** holds the queued passes for up to 30 s before the clip settles on
  playback. Never observed; the alternative was an unbounded wait.
- **An active clip whose probe outlasts the 3 s bound** still samples on the playback path. That
  includes a clip handed the detector while its probe is still running, which can happen when no
  earlier pass is due (clip 1 errored, say), since the bound was counted from that clip's
  `loadedmetadata`, not from when it got the detector. Both are today's behaviour, unchanged, and
  neither has been observed: on the phone the active clip's probe took 318–435 ms.

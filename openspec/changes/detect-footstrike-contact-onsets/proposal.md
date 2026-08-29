# Detect footstrike contact onsets, not ankle-y maxima

## Why

`detectFootstrikes` reports every prominence-confirmed maximum of one ankle's **raw screen y** as a
footstrike. A single ankle's screen y is the sum of two things — the leg's own configuration, and
the whole body's vertical motion, which every keypoint shares. The second term is contamination,
and on this repo's own reference clip it is three times the size of the gate meant to filter noise
(Demo 1's vertical oscillation is 16.3% of torso length against a `footstrikeMinProminenceRatio` of
0.05).

Frame-by-frame ground truth on Demo 1 (25 fps, static camera, contacts read off shoe-meets-shadow)
puts the real contact onsets at ffmpeg `t = 3.90 / 4.60 / 5.16 / 5.84`. The app emitted three
instants, all carrying the same `side` label, at ffmpeg `3.92 / 4.96 / 5.52`: one real onset, one
**toe-off**, and one **late-stance** instant belonging to a different (therefore opposite-foot)
contact. Two of three are not contacts.

Two distinct failures produce that, and both trace to the same contaminated signal:

- **A maximum where no foot landed.** A leg trailing through early swing is carried *downward* by
  the body's descent into the other foot's stance faster than it is lifting, so its screen y turns
  over and back — a prominence-confirmed maximum with the foot in the air. `cadence.ts` names this
  mechanism as the reason cadence stopped consuming this detector; `strideLength.ts` names it again
  under "halving bias".
- **A real contact reported at the wrong instant.** A planted foot does not move, so its screen y is
  a flat plateau across stance; the argmax over a flat plateau is decided by the scan's tie handling
  rather than by the gait, and lands at the plateau's end.

The consequences are **directional, so a median does not absorb them**. `overstriding` measures
`ankle.x − hipMid.x` signed by travel direction: at toe-off and late stance the ankle is *behind*
the hip, contributing a strongly negative ratio that pulls the median toward "not overstriding".
`footStrikePattern` measures `ankle.x − knee.x`: at late stance the ankle is behind the knee, which
classifies as **forefoot** — and both Demo 1 and the multiperson clip currently report "Forefoot
strike (proxy)". Demo 1's recorded `overstriding` distribution (n = 7, median 0.2266, MAD 0.2403 —
a spread as large as the median) has the shape of a bimodal mixture, not of one population.

`strides-dy8` fixed the *interval* consequence by gating stride pairs on the fitted step period.
This fixes the *instant* consequence, which that change deliberately left alone. It is the upstream
fix both tickets point at: the detector, not each consumer.

## What Changes

- `detectFootstrikes` detects on **each ankle's vertical position relative to the other ankle**
  (`ankle_S.y − ankle_opposite.y`) instead of on its raw screen y. The whole body's vertical motion
  and any vertical camera motion are common to both feet and cancel exactly; what remains is the
  between-legs geometry that alternating gait actually is.
- The maximum of that differenced signal falls on the **ground-contact onset** rather than
  somewhere inside the stance plateau, for a reason with no free parameter in it: approaching
  touchdown this foot is descending fast while the other is at its swing apex, and the instant this
  foot lands its own descent stops while the other begins descending toward its own contact — so the
  difference's slope flips sign at touchdown and keeps falling through the rest of stance.
- A maximum on the relative series is additionally required to be **non-negative** — a foot cannot
  be planted while the other foot is below it. Running has no double-support phase, so at a genuine
  strike the margin is most of a swing excursion; this rejects the physically impossible, not the
  marginal.
- A frame where either ankle is unresolvable becomes a gap, using `findLocalExtrema`'s existing
  gap semantics. A clip where the **opposite** ankle is resolvable in no frame at all falls back to
  raw ankle-y — the pre-existing behaviour, for a single-leg trace where the ambiguity this
  resolves cannot arise.
- **No threshold moves and no new constant is introduced.** `footstrikeMinProminenceRatio` and
  `footstrikeMinIntervalSeconds` are read exactly as before.

Expected downstream movement, which is the point rather than a regression: `overstriding`,
`footStrikePattern`, `stepWidth`, `stepWidthCm` and `verticalRatio` all read a geometry or an
interval at these instants and will report different values once the instants are correct.
`cadence` does not consume this detector and is untouched.

## Impact

- Affected specs: `form-heuristics` (one ADDED requirement; nothing modified or removed)
- Affected code: `src/heuristics/footstrikes.ts`, `src/heuristics/footstrikes.test.ts`,
  `src/heuristics/strideLength.test.ts` (fixture idiom only — see design D8)

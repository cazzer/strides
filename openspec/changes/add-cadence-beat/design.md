## Context

The model runner (archived changes `add-model-runner`, `add-landing-camera`; design D1 to D16)
annotates each measured focus parameter with a mark whose geometry is the drawn value. Cadence
moves no geometry (`cyclesPerSecond = cadence / 120`), so it had no annotation, and the Rhythm
stop's headline had nothing on the figure. Two footfalls happen per cycle, at
`GAIT_PHASES.leftContact` (0) and `rightContact` (0.5), and ps19.4 pins each contact foot's lowest
point exactly to `GROUND_Y`.

## Goals / Non-Goals

**Goals:** a cadence mark that is honest about rate; foot-strike wording that says what is drawn;
step-width guides that meet both feet in `feetFront`.

**Non-Goals:** any change to `gaitModel.ts`, `runnerParams.ts`, the bindings or
`__fixtures__/measureModel.ts`; any change under `src/results` (the shared card wording is a
follow-up bead); a new ModelRunner prop.

## Decisions

### D17. The foot-strike label names the first contact (runner only)

`formatGuidedValue` is shared by the cards, summary rows, tour text and `MetricsPanel`, so it is
not touched. `formatRunnerValue` branches for `footStrikePattern` and calls the same
`classifyFootStrike(value, DEFAULT_HEURISTICS_CONFIG.footStrikeMidfootBandRatio)`, printing
"Heel first (estimate)", "Midfoot first (estimate)" or "Forefoot first (estimate)". The class is
therefore always the card's; only the words differ. The new words flow into the label lines, the
clamped suffix and `describeRunner`.

### D18. Step-width guides meet both feet

The mark is unchanged: at `GROUND_Y − 0.06`, from z = 0 to the contact ankle's z, so its length
is |step width| × hip width exactly. The old guides were a short midline stub and a drop from the
contact ankle, which in the front view sat inside the foot. Now: a midline plumb from hip-mid down
past the mark, and a tick from the ground under EACH foot (z = ±ankle.z). The model has no
asymmetry, so the far foot plants at the mirror of the near one; outside the swing-arc window
[0.5, 5/6] of its own leg phase a stance ankle's z is exactly side × step width × hip width, so a
planted ankle stands exactly above its tick (tested to 1e-9 for step width {0.15, 0.3, −0.2} ×
swing arc {0.15, 0.6}).

Live (park-approach.mp4, Foot path stop, `feetFront`, ANGLE Metal): over 4 s of playback at 1280
and at 390, every frame with a foot planted (lowest point within 1 px of the ground line) had that
ankle 0.0 px from a tick (planted frames: 196/176 left/right at 1280, 177/202 at 390). The review's
"guides at x 249/263 vs feet at 222/279" was NOT reproduced at 390: going to the stop the moment
analysis completed and sampling every frame for 12 s (motion and reduced motion), no planted
ankle was more than 1 px from a tick, and at rest the feet (183.1 / 206.9 px) sit on the ticks
(183.1 / 206.9 px). Those numbers fit a figure drawn at a different step width from its marks
(for example the neutral one); no such state was found in the app.

### D19. Cadence is a footfall beat

- **Kind `'beat'`.** `PARAM_ANNOTATION_KIND.cadence = 'beat'`; `KEY_LEG_PHASE.cadence` stays null,
  so cadence never moves the held phase and is shown while still.
- **Label** "N steps/min" (the metric's own value), side `above`, anchored at
  `headTopAnchor(pose)` at the held phase: the point the intro flash already used, extracted from
  `introFlash.ts` (behaviour unchanged) into `runnerAnnotations.ts` to avoid an import cycle
  (`introFlash` → `runnerScene` → `runnerAnnotations`).
- **Footfalls.** One pulse per foot at its contact phase, centred on the lower of its heel and
  toe at that contact, with y = `GROUND_Y`. Static guides: a tick from each centre to
  `GROUND_Y − 0.08`. There are no marks or fills.
- **Ring.** `circle[data-pulse]`, `fill="none"`, the focus accent stroke (cyan; `Highlight` in
  forced colours). Envelope `e = u ≥ 1 ? 0 : (1 − u)²`, `u = fract(phase − pulse.phase) /
  BEAT_DECAY_CYCLES` (0.25); radius `beatRingMax − (beatRingMax − beatRingMin) × e` px (4 → 12),
  opacity `e`. The loop writes `cx`, `cy`, `r` and `opacity` in the draw from the live phase: no
  React commit per frame. Rings render only while `playing && !reduced` (Q3: under reduced motion
  never, even after Play). Paused or reduced: label and ticks only.
- **Honest rate.** Two pulses per cycle at cadence / 120 cycles/s × rate = cadence × rate pulses a
  minute; the label always prints the measured cadence (the tour's slowed stops say "Slow motion"
  already; Q4: no extra line). Tested: over 10 s of 30 fps `stepPlayback`, ring onsets are within
  ±1 of cadence × rate × 10 / 60 for cadence {150, 180, 190} × rate {1, 0.4}. Live check
  (park-side-landscape.mp4, Rhythm stop, 1×, label "174 steps/min"): 9 onsets in 3.00 s at 1280
  and 8 at 390, against 8.7 expected.
- **Lift rule split.** During an intro tween the figure's standing height can change. Paths on
  the ground (landing, step width, cadence ticks) stay put; labels on the ground (landing, step
  width) stay put; the cadence label hangs off the head, so it rides with the figure. Rings never
  lift.
- **Landing holds.** If cadence were focused on `landingSide`, the window's 300 ms contact hold
  would hold the ring at full strength. No app path focuses cadence there (Rhythm uses
  `wholeBodySide`); documented only.

### D20. WCAG 2.3.1 (Three Flashes or Below Threshold)

At 190 steps/min the rings start ~3.2 times a second, so the pass is by the below-threshold
clause, not the three-flash clause. Per W3C Understanding 2.3.1 (WCAG 2.2), content passes when
"the combined area of flashes occurring concurrently occupies no more than a total of .006
steradians within any 10 degree visual field on the screen (25% of any 10 degree visual field on
the screen)", estimated as 25% of "a 341 x 256 pixel rectangle anywhere on the displayed screen
area when the content is viewed at 1024 x 768 pixels" = 21,824 px². A ring is a 2 px stroke of
radius ≤ 12 px: about 2π × 12 × 2 ≈ 151 px² (a filled 13 px disc would still be only 531 px²).
The two rings never overlap in time (each fades within a quarter cycle; they are half a cycle
apart). The ring is never a saturated red (WCAG 2.2 defines red flash by R/(R+G+B) ≥ 0.8); it is
the cyan focus accent. 2.3.2 (AAA, no flashes at all) is not claimed; reduced motion removes the
rings entirely. Guard tests: `beatRingMax ≤ 16` px, the ring's class carries no red/rose/pink/orange
and uses `Highlight` in forced colours.

## Risks / Trade-offs

- The ring is small at 4 px at contact and 12 px when gone; it reads as a tap at the foot rather
  than a flash. A larger ring would read better but approaches the flash-area budget at large
  runner sizes; kept small by design.
- At `feetFront` the midline plumb from hip-mid starts above the frame (the hips are out of view),
  so it reads as a full-height centre line.
- A paused figure off the held phase (pausing mid-stride on a non-landing camera) keeps showing the
  step-width mark at the key-phase geometry, as before this change.

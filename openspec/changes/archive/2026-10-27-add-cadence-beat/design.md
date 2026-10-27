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
clamped suffix and `describeRunner`. The shared card wording is follow-up bead strides-z8j7
(filed by the orchestrator).

### D18. Step-width guides meet both feet

The mark is unchanged: at `GROUND_Y − 0.06`, from z = 0 to the contact ankle's z, so its length
is |step width| × hip width exactly. The old guides were a short midline stub and a drop from the
contact ankle, which in the front view sat inside the foot. Now: a midline plumb from hip-mid
(hip-mid's x at both ends, z = 0) down past the mark, and a tick from the ground under EACH foot (z = ±ankle.z). The model has no
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

- **Kind `'beat'`, keyed on a footfall.** `PARAM_ANNOTATION_KIND.cadence = 'beat'` and
  `KEY_LEG_PHASE.cadence = GAIT_PHASES.leftContact` (review round 1). As the first keyed focus,
  the still frame holds the near leg's contact (`phaseForLeg(near, 0)`), so the near foot stands
  planted on its tick. With cadence unkeyed the still frame was mid-stance, and in the side view both
  ticks (the two contact points share one screen x on the treadmill) stood under no foot.
  Consumers checked: `planAnnotations` (held phase, front-view leg choice) and
  `src/results/focusAreaCamera.ts` `runnerFocusFor` (one key phase per still beat). Rhythm's
  metrics are cadence plus the bounce metrics (unkeyed), and no other area holds cadence, so every
  focus keeps the same parameters; `src/results` tests pass unchanged. The tour's and summary's
  still Rhythm frame (paused or reduced motion) now shows the near foot's contact instead of
  mid-stance, which is the intent. Behind an earlier keyed focus (no app path), cadence would follow
  the usual rule: shown while still only at its own key phase.
- **Label** "N steps/min" (the metric's own value), side `above`, anchored at
  `headTopAnchor(pose)` at the held phase: the point the intro flash already used, extracted from
  `introFlash.ts` (behaviour unchanged) into `runnerAnnotations.ts` to avoid an import cycle
  (`introFlash` → `runnerScene` → `runnerAnnotations`).
- **Footfalls.** One pulse per foot at its contact phase, centred on the lower of its heel and
  toe at that contact, with y = `GROUND_Y`. Static guides: a tick from each centre to
  `GROUND_Y − 0.08`. There are no marks or fills.
- **Ring.** `circle[data-pulse]`, `fill="none"`, the focus accent stroke (cyan; `Highlight` in
  forced colours), `beatRingStroke` 2.5 px. Envelope `e = u ≥ 1 ? 0 : (1 − u)²`,
  `u = fract(phase − pulse.phase) / BEAT_DECAY_CYCLES` (0.25); radius
  `beatRingMin + (beatRingMax − beatRingMin) × e` px, opacity `e`: the strong moment is the large
  one, 15 px and opaque at contact, shrinking to 6 px as it fades (review round 1; the first round
  grew 4 → 12 px as it faded, so at its peak it was a 4 px glint under the heel). An accent copy of
  the foot's tick (`path[data-pulse-tick]`, 2 px) flashes with it at opacity `e`, over the grey
  static tick. The loop writes `cx`, `cy`, `r`, `opacity` and the tick's `d` in the draw from the
  live phase: no React commit per frame. Rings render only while
  `playing && !reduced && phaseWindow === null` (Q3: under reduced motion never, even after Play;
  never on `landingSide`, whose 300 ms contact hold would freeze a ring at full strength). Paused,
  reduced or on the landing camera: label and ticks only.
- **Honest rate.** Two pulses per cycle at cadence / 120 cycles/s × rate = cadence × rate pulses a
  minute; the label always prints the measured cadence (the tour's slowed stops say "Slow motion"
  already; Q4: no extra line). Tested: over 10 s of 30 fps `stepPlayback`, ring onsets are within
  ±1 of cadence × rate × 10 / 60 for cadence {150, 180, 190} × rate {1, 0.4}; through the real
  ModelRunner loop (fake timers, 16 ms steps, 10 s, cadence 180) the `circle[data-pulse]` opacity
  rises 30 ± 1 times at 1× and 12 ± 1 at 0.4×. Live check
  (park-side-landscape.mp4, Rhythm stop, 1×, label "174 steps/min"): 9 onsets in 3.00 s at 1280
  and 8 at 390, against 8.7 expected.
- **Lift rule split.** During an intro tween the figure's standing height can change. Paths on
  the ground (landing, step width, cadence ticks) stay put; labels on the ground (landing, step
  width) stay put; the cadence label hangs off the head, so it rides with the figure. Rings never
  lift.
- **Landing holds.** On `landingSide` the window's 300 ms contact hold would hold a ring at full
  strength, so no ring is drawn there (tested). No app path focuses cadence there (Rhythm uses
  `wholeBodySide`).

### D20. WCAG 2.3.1 (Three Flashes or Below Threshold)

At 190 steps/min the rings start ~3.2 times a second, so the pass is by the below-threshold
clause, not the three-flash clause. Per W3C Understanding 2.3.1 (WCAG 2.2), content passes when
"the combined area of flashes occurring concurrently occupies no more than a total of .006
steradians within any 10 degree visual field on the screen (25% of any 10 degree visual field on
the screen)", estimated as 25% of "a 341 x 256 pixel rectangle anywhere on the displayed screen
area when the content is viewed at 1024 x 768 pixels" = 21,824 px². The ring is a 2.5 px stroke
at radius ≤ 15 CSS px (fixed in CSS px whatever the runner's size): about 2π × 15 × 2.5 ≈ 236 px²
at its strongest; even the filled outer disc, π × 16.25² ≈ 830 px², is under 4% of the threshold.
The flashing tick is a 2 px accent line BEAT_TICK_DEPTH (0.08 torso lengths) long, about 11 px on
the 1280 tour's runner and still under 40 px at a 1000 px-wide runner: under 80 px². Ring plus
tick stay under ~320 px², about 1.5% of the threshold. The two feet's flashes never overlap in time
(each fades within a quarter cycle; they are half a cycle apart).

Not a red flash, under either definition. WCAG 2.0's note gave "the current working definition in
the field for 'pair of opposing transitions involving a saturated red'" as "where, for either or
both states involved in each transition, R/(R+G+B) >= 0.8, and the change in the value of
(R-G-B)x320 is > 20 (negative values of (R-G-B)x320 are set to zero) for both transitions", with
R, G and B the linearised 0–1 values of the relative-luminance definition. WCAG 2.2 (Note 3)
replaces it with "the new working definition in the field": one transition to or from a state with
R/(R+G+B) ≥ 0.8 and a chromaticity change of more than 0.2 in CIE 1976 UCS. The ring's states are
the cyan accent (cyan-700 ≈ sRGB (0, 117, 149); cyan-300 ≈ (83, 234, 253) in dark mode) and the
white or near-black background: linearised R/(R+G+B) is about 0.0 and 0.05 for the cyans and 1/3
for neutral backgrounds, never near 0.8, and (R−G−B) is negative for both cyans, so
(R−G−B)×320 is set to zero. 2.3.2 (AAA, no flashes at all) is not claimed; reduced motion removes
the rings entirely. Guard tests: 14 ≤ `beatRingMax` ≤ 16 px, `beatRingStroke` ≥ 2 px, and the ring
and flashing tick classes carry no red/rose/pink/orange and use `Highlight` in forced colours.

## Risks / Trade-offs

- The ring is 15 px at contact. It is fixed in CSS px, so it stays readable on a phone and stays
  inside the flash-area budget on a large runner.
- At `feetFront` the midline plumb from hip-mid starts above the frame (the hips are out of view),
  so it reads as a full-height centre line.
- A paused figure off the held phase (pausing mid-stride on a non-landing camera) keeps showing the
  step-width mark at the key-phase geometry, as before this change.

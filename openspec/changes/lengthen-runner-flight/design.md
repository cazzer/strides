## Context

The planted stance leg can absorb only `STANCE_DROP` (0.10 torso lengths) of the hips' bounce:
more, and either the stance foot leaves the ground inside the pin's declared domain (landing ≤ 0.3,
pin < 0.01) or the stance knee forms a second prominent knee-flexion maximum. So `STANCE_DROP` is
the hard limit, and any bounce above it happens in flight. With stance at 0.38 of a cycle, flight
was 0.12 and a 0.3 bounce moved 2.28× a sinusoid per 30 fps frame.

The bead's first acceptance criterion (≤ 1.3× everywhere) is not reachable without raising
`STANCE_DROP`, which breaks the pin domain. The orchestrator restated it: ≤ 1.3× up to b = 0.22,
≤ 1.6× at 0.25 and 0.3, ≤ 1.9× at 0.4 and 0.5; step-peak spread ≤ 0.12b up to 0.3 and ≤ 0.13b
at 0.4–0.5 (recorded on the bead).

## Goals / Non-Goals

**Goals:** a longer flight so large bounces spread over more frames; no regression to the pin
domain, the fallback bounds past it, any binding's exactness or measure tolerance, or ModelRunner's
API.

**Non-Goals:** a Hermite (non-eased) flight curve; changing the landing camera's phase window;
changing `STANCE_DROP` or any knee/foot key value.

## Decisions

- **Stance 0.30, mid-stance 0.15, flight peak 0.40.** Mid-stance is halfway through stance and
  the flight peak midway between toe-off and the other contact, so they stay a quarter cycle apart
  and `SINUSOID_STANCE_ENDS_SHAPE = −cos(4π·midStance)` (now 0.309) puts a small bounce at a
  sinusoid's height at contact and toe-off. Between the keys the path is cosine-eased: close to a
  sinusoid, not one, and held to the per-frame bounds below. `FLIGHT_PEAK_PHASE` is derived from
  `GAIT_PHASES`, not a literal.
- **Peak thigh 0.78**, not 0.85: at 0.85 the far leg is already in flight under the shorter stance
  (its foot 0.056 off the ground), so the knee-drive still frame would show no planted foot. 0.80
  sits on the stance boundary and fails on rounding.
- **One swing-thigh key at 0.65** (the other leg's mid-stance), 0.6 of the way from toe-off to the
  peak. Without it the eased thigh lags under the lowest hips and the swing foot dips further in the
  landing-0.35 fallback; 0.45 of the way is too low.
- **The thigh passes that key moving (review round 1).** As a cosine-eased key it stopped dead at
  0.65 and then whipped to its peak. Toe-off → mid → peak is now a monotone cubic Hermite
  (Fritsch–Carlson): at rest at toe-off and at the peak (so the peak stays the maximum and the knee
  drive reading is unchanged), through the mid key at the weighted harmonic mean of the two secants.
  Peak → contact stays cosine-eased. Neutral thigh speed over toe-off → peak, per decile as a
  fraction of the mean (114.9°/cycle): before ps19.7 0.25 0.72 1.12 1.40 1.55 1.55 1.40 1.11 0.71
  0.24; eased key 0.28 0.78 1.14 1.29 1.20 0.90 0.43 0.59 2.29 1.24 (minimum over 10–90%: 0.007);
  Hermite 0.18 0.50 0.75 0.94 1.07 1.13 1.14 1.43 1.98 1.02 (minimum 0.347). Largest thigh step per
  30 fps frame at 190 steps/min: 13.11° before, 13.13° eased key, 13.00° Hermite.
- **A still figure stands on the ground (review round 1).** On the demo clip (landing 0.512, past
  the pin's domain) the knees stop's held frame sank the stance foot −0.043 below the ground. While
  the figure is still (reduced motion, paused), the renderer lifts the whole figure by the held
  pose's sink, through the existing figure-height path: marks that ride the figure lift, ground
  marks (landing, step width, cadence ticks) stay. Playing drops the lift (a snap). No metric reads
  absolute height, so no bound value moves.
- **Rejected:** a deeper toe-off knee (32°/34°): NaN in the fallback solve.
- **Landing window kept at 0.35..0.60** for its framing. With the shorter stance the large
  overstride's stance sink starts sooner: at the demo clip's 0.512 the window's end frame (0.10
  after contact) now sinks −0.045 torso lengths, −0.049 by 0.15 after. Shown in the end hold;
  checked in screenshots.

## Measured (worst over cadence 150/174/190)

| bounce | frame ratio | step-peak spread / b |
|---|---|---|
| ≤ 0.14 | 1.069 | 0.055 |
| 0.17 | 0.968 | 0.066 |
| 0.2 | 1.176 | 0.080 |
| 0.22 | 1.283 | 0.087 |
| 0.25 | 1.411 | 0.096 |
| 0.3 | 1.568 (was 2.284) | 0.107 |
| 0.4 | 1.764 | 0.120 |
| 0.5 | 1.881 | 0.128 |

Pin domain worst 0.00997 (< 0.01) on the test grid; domain swing clearance 0 (≥ −0.005). Fallback
worst stance / swing per landing (Hermite thigh): 0.35 0.056 / −0.045, 0.4 0.077 / −0.066, 0.45
0.089 / −0.077, 0.512 0.108 / −0.097, 0.6 0.138 / −0.131, 0.7 0.181 / −0.177: stance unchanged,
swing dips all shallower than before ps19.7 (−0.060, −0.083, −0.096, −0.115, −0.146, −0.188);
`FALLBACK_BOUNDS` kept. Neutral mid-stance knee 37.7°.

The grid's worst set (landing 0.15, bounce 0, foot strike −0.2, thigh peak 20, swing knee 60, step
width 0.3, raw) is not a maximum of the domain: a denser sample around it (landing 0.10–0.22, foot
strike −0.2 to −0.15, thigh peak 15–25, swing knee 60–70, bounce 0–0.04, step width 0.2–0.5) reaches
0.0115 at landing 0.22, step width 0.5. Before ps19.7 the same sample gives the same 0.0115, so this
is a pre-existing gap between the grid and the declared domain, not a regression; left for a
follow-up.

## Risks / Trade-offs

- The stance foot slides back faster (stance is shorter for the same ankle travel): the cadence
  ring's "under the foot" slide window grows from about 0.16 to 0.208 projected units. The ring
  still tracks the foot; the test's sanity bound moves 0.2 → 0.25.
- The neutral bound bounce (0.15) now sits at the bounce that stands the figure lowest, so the
  cadence tween test picks whichever bounce moves the standing height more, up or down.
- The pin domain margin is thin (0.00997 against 0.01 on the grid), and off the grid the pin
  exceeds 0.01 (above, pre-existing).

## Accepted limits

- **Narrow flight peak at b = 0.3.** The rise into and fall from the flight peak takes about five
  30 fps frames, with the largest step 0.121 torso lengths (1.46× the floor at 160 steps/min). It
  meets the restated AC (≤ 1.6×); the cosine keys already rest at the peak, and widening it further
  needs more `STANCE_DROP`, which breaks the pin domain.
- **Transient landing end-hold sink.** On the landing camera the window's last frame (0.10 after
  contact) is held 150 ms while playing. At the demo clip's 0.512 it shows the stance foot below
  the ground: −0.045 torso lengths with only the landing bound, −0.030 in the app's fully bound
  frame (measured live at 1280). The overstride bracket, on the ground, then sits that far below
  the sunk foot for those 150 ms. It is a moving frame, so the still-frame lift does not apply.
- **Knee-flexion wedge crosses the stance shin.** On the knees stop (legsSide) the knee-flexion
  wedge and its label sit at the swing knee and can overlap the other leg's shin. Moving them would
  need per-pose label avoidance against the figure's own segments, which the label placer does not
  do; recorded as a known limit rather than changed here.

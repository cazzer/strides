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
  and `SINUSOID_STANCE_ENDS_SHAPE = −cos(4π·midStance)` (now 0.309) keeps a small bounce a true
  sinusoid. `FLIGHT_PEAK_PHASE` is derived from `GAIT_PHASES`, not a literal.
- **Peak thigh 0.78**, not 0.85: at 0.85 the far leg is already in flight under the shorter stance
  (its foot 0.056 off the ground), so the knee-drive still frame would show no planted foot. 0.80
  sits on the stance boundary and fails on rounding.
- **One swing-thigh key at 0.65** (the other leg's mid-stance), 0.6 of the way from toe-off to the
  peak. Without it the eased thigh lags under the lowest hips and the swing foot dips further in the
  landing-0.35 fallback; 0.45 of the way is too low. Monotone from toe-off to the peak, so the knee
  drive reading is unchanged.
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

Pin domain worst 0.00997 (< 0.01); domain swing clearance 0 (≥ −0.005). Fallback worst
stance / swing per landing: 0.35 0.056 / −0.027, 0.4 0.077 / −0.050, 0.45 0.089 / −0.066,
0.512 0.108 / −0.087, 0.6 0.138 / −0.121, 0.7 0.181 / −0.169: stance unchanged, swing dips all
shallower; `FALLBACK_BOUNDS` kept. Neutral mid-stance knee 37.7°.

## Risks / Trade-offs

- The stance foot slides back faster (stance is shorter for the same ankle travel): the cadence
  ring's "under the foot" slide window grows from about 0.16 to 0.208 projected units. The ring
  still tracks the foot; the test's sanity bound moves 0.2 → 0.25.
- The neutral bound bounce (0.15) now sits at the bounce that stands the figure lowest, so the
  cadence tween test picks whichever bounce moves the standing height more, up or down.
- The pin domain margin is thin (0.00997 against 0.01).

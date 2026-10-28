## Context

The runner's arm is a rigid bent unit (upper arm 0.6, forearm 0.55, elbow bend 80°) swinging about
the shoulder in the sagittal plane. Its reach is R = 0.8815 torso lengths and the shoulder→wrist line
sits φ = 37.91° forward of the upper arm. The wrist's drop below the shoulder is R·cos ψ, ψ the
shoulder→wrist line's forward angle, and ψ swings sinusoidally about a centre c with amplitude A,
so wrist travel is 2R·sin c·sin A. A is solved so that equals the bound `armSwing` v.

## Decisions

### D1. Centre 33°, so the elbow passes behind the trunk

At c = 48° the upper arm ran −3.1°…+23.3° at the neutral 0.3 (never behind the neutral 4°-forward
trunk line), −4.5°…+24.7° at 0.33 and −12.8°…+33.0° at 0.51: the arm pumped in front of the chest.
At c = 33° the upper arm's centre is 33 − 37.91 ≈ −5° and:

| v | c / A | upper arm | ψ | travel |
|---|---|---|---|---|
| 0.05 | 33 / 3.0 | −7.9…−1.9 | 30.0…36.0 | 0.0500 |
| 0.30 neutral | 33 / 18.2 | −23.1…+13.3 | 14.8…51.2 | 0.3000 |
| 0.33 front | 33 / 20.1 | −25.0…+15.2 | 12.9…53.1 | 0.3300 |
| 0.51 side | 33 / 32.1 | −37.0…+27.2 | 0.9…65.1 | 0.5100 |
| 0.55 pinned | 34.0 / 34.0 | −37.9…+30.0 | 0.0…67.9 | 0.5500 |
| 0.90 max | 45.6 / 45.6 | −37.9…+53.3 | 0.0…91.2 | 0.9000 |

Real bent-arm running is roughly −35°…+25° upper arm, ≈ 0.48 torso of wrist travel, in line with
the side readings.

### D2. Pin the backswing at ψ = 0 above v*

Travel 2R·sin c·sin A needs c − A ≥ 0: below ψ = 0 the wrist goes behind the shoulder and the drop
R·cos ψ shrinks again (the wrist rises), so the readback would come up short. For
v > v* = 2R·sin²33° ≈ 0.523 the centre becomes c = asin(√(v / 2R)) with A = c, so ψ runs 0…2c and travel is R(1 − cos 2c) = v.
`c = max(33°, asin(√(v / 2R)))` is both cases in one formula and is continuous at v*.

### D3. Label the value as wrist up-and-down travel

`Arm swing (wrist up-and-down)` in `SHORT_METRIC_LABELS`, read by the tour stop's value label and
the summary row's headline. Both sit outside the 25-word budget. The figure annotation (a vertical
bracket labelled with the value) is unchanged: it already draws the vertical travel.

### D4. The bracket's label sits above its top end

The bracket hangs from the wrist's highest point, so a pinned swing's bracket reaches a full arm
reach below the shoulder. On a phone the arms stop's panel overlays the rail from about 0.09 viewBox
units below that foot, so the label hung under the foot went behind the panel (its second line, "of
torso length", at 390 px). The label now hangs above the bracket's top end, centred on it.

Measured alternatives (upper-front-quarter camera, 0.05–0.9):
- **Below the foot** never meets the arm, but at 390 px no below-placement can clear the panel.
- **Right of the top end** clears the panel, but above about 0.45 the bracket sits so far right that
  the frame clamp pulls the label back over the bracket, and its halo hides the top tick.
- **Above the top end** fits the frame without a clamp up to 0.9, never covers the bracket and
  clears the panel.

In the front-¾ view the forearm crosses the region above and right of the top end in some phases
whichever upper placement is used. The label's halo keeps it legible, as for every other label.
Only the arm-swing builder changed; no other annotation's label moves.

### D5. The arms stop looks from 15° off the side (`armsQuarter`)

With the arm centre behind vertical, `upperFrontQuarter` (yaw 45) drew the near forearm across the
chest and the two forearms as an X, which read as arms crossing the midline. A new preset,
`armsQuarter` (yaw 15, pitch 5, zoom 1.7, target 0.4 forward of hip-mid), serves the arms stop only.
`upperFrontQuarter` stays for the dev sandbox and the footage-plate tests.

Measured over a full cycle (shoulder–hip outline, viewBox units, negative inside):
- **The near elbow's backswing** is outside the outline at every yaw ≥ 10°.
- **The near elbow's forward swing** is drawn over the chest at every yaw above 0, because the arm
  swings at the near shoulder's depth. Its worst overlap (v 0.335/0.5627, lean 4° and −15°) is
  0.123 at 15°, 0.162 at 20° and 0.30 at 45°. 20° fails the 0.15 bound, so 15° it is. The near
  arm is painted over the trunk by depth order.
- **The far wrist** stays outside at the neutral lean. The exception is a pinned swing at a −15°
  (backward) lean: the pinned wrist hangs straight under a shoulder the hips have moved ahead of,
  so it lies inside the far half of the outline at any yaw off the side (−0.10 at 15°). That is
  the lean's geometry, not the camera, and the test excludes it with that reason.
- **Yaw 0** would overlap the arms on each other and lose the depth separation.

Framing: the side-on view puts a full forward reach further right. The target sits 0.4 forward, so
the neutral arms (x −1.31…0.97 at 0.5627) and the bracket's label fit ±1.5 unclamped on a phone up
to 0.9.

Under this camera the near upper arm never enters the arm label above the bracket, at phone or
desktop label scale, so D4's placement stands everywhere. The far forearm's wrist, which projects
about 0.08 right of the bracket at its forward peak, does reach the label's lower line in some
phases (about 11–15 of 60 at realistic values). The halo keeps the label legible.

## Risks

- The neutral figure now shows a visible backswing; it is dashed grey and illustrative, never a
  target (the honesty rules).
- The arm bracket sits at the wrist's forward extreme plus a margin; checked live at 390 px (D4).

# Design — a second override plane on the A/B driver

## D1. Why a parallel flag, not a wrapped `--arm` JSON

Three shapes were considered for expressing a backend arm:

1. `--arm 'on={"backend":{...},"sampling":{...}}'` — one flag, a wrapper object naming the plane.
2. `--arm 'on={...}'` with the driver sniffing which plane each key belongs to.
3. `--backend-arm 'on={...}'` — a parallel flag, arms joined by label.

(2) is rejected outright: `enabled` and `minKeypointConfidence` exist on **both** planes
(`personSelection.minKeypointConfidence` and `trackingCrop.minKeypointConfidence`), so sniffing
would have to guess, and guessing wrong yields an arm that silently merges into nothing — the
precise failure `ARM_KEYS` exists to make loud.

(1) breaks every `--arm` invocation already recorded in CLAUDE.md and on four `#52` tickets. A
measurement harness whose recorded invocations stop parsing has destroyed its own back-catalogue.

(3) is chosen. `--arm` keeps its exact present meaning, so every recorded invocation still runs and
still means what it meant. Joining by label is what makes the two planes composable without a
wrapper: `--arm 'on={}' --backend-arm 'on={"trackingCrop":{"enabled":true}}'` is one arm on two
planes, and an arm named on only one plane gets `{}` on the other.

## D2. Validation must go three levels, so it is recursive

`ARM_KEYS` is currently a two-level literal walked by a hand-unrolled double loop. The backend
plane is three levels deep:

```
personOfInterest.continuityGate.enabled
personOfInterest.continuityGate.maxCenterSpeedSidesPerSecond
personOfInterest.continuityGate.maxAreaRatio
```

`resolvePoseDetectorConfig` merges that third level explicitly, with a comment saying why:
`continuityGate` is the only field on the config that is itself an object, so without the deeper
merge, overriding one gate threshold would blank the gate's `enabled` flag to `undefined` rather
than leave it at its default. A validator that stops at two levels would wave through
`{"personOfInterest":{"continuityGate":{"enable":true}}}` — a typo that merges into nothing and
reads in the report as a genuine "no effect".

So the schema becomes recursive (`null` = leaf, object = nested) and one `assertKnownKeys` walks it
to any depth. `ARM_KEYS` is re-expressed in that form with **no change to which keys it accepts**;
`BACKEND_ARM_KEYS` is the new one.

## D3. What `BACKEND_ARM_KEYS` admits, and what it deliberately does not

Mirrors `PoseDetectorConfig` (`src/pose/detector.ts`) plus the two nested shapes
`resolvePoseDetectorConfig` merges:

| key | source |
|---|---|
| `backend` | `PoseBackendId` — `movenet` \| `blazepose` \| `posenet` \| `mediapipePoseLandmarker` |
| `movenetModelType` | `lightning` \| `thunder` |
| `trackingCrop.*` | `TrackingCropConfig`, 6 fields |
| `personOfInterest.enabled` | `PersonOfInterestConfig` |
| `personOfInterest.continuityGate.*` | `ContinuityGateConfig`, 3 fields |

`backend` and `movenetModelType` additionally have their **values** checked against the closed
unions, which the sampling plane has no equivalent of because its leaves are all open numerics. The
justification is the same as the key check: `{"backend":"mediapipe"}` is not a recognised id,
`createPoseDetector` would fall through to its default, and the arm would read as baseline. A
closed union is checkable, so it is checked.

The `blazepose`/`posenet` ids are accepted despite both being known-broken in this environment
(CLAUDE.md, "Known issues"). The driver's job is to run the arm it was asked for and report what
came back; refusing an id the app accepts would make the harness disagree with the app about what
is expressible, and the trial would fail loudly on its own.

## D4. What is NOT changed

Fresh process per trial, the server-identity nonce guard, the SwiftShader refusal, trial-major
ordering, the warm-up navigation, the fixed field order, `--json`, `--evidence`. A report produced
with no `--backend-arm` differs from one produced before this change by **nothing at all** — the
header line for backend arms is emitted only when at least one exists, so `> before.txt` /
`> after.txt` diffs spanning this change stay clean on the sampling plane.

## D5. Verification (2026-08-31, on `1f629d6`)

All eight parse-time guards fire, each naming the dotted path:

| case | outcome |
|---|---|
| `--arm 'x={"personSelection":{"enable":true}}'` (regression) | `unknown key "personSelection.enable"` |
| `--backend-arm 'x={"trackingCrop":{"enable":true}}'` | `unknown key "trackingCrop.enable"` |
| `--backend-arm 'x={"personOfInterest":{"continuityGate":{"enable":true}}}'` | `unknown key "personOfInterest.continuityGate.enable"` — **the case the old two-level validator structurally could not reach** |
| `--backend-arm 'x={"backend":"mediapipe"}'` | `must be one of movenet \| blazepose \| posenet \| mediapipePoseLandmarker` |
| `--backend-arm 'x={"personSelection":{"enabled":true}}'` | wrong-plane key rejected |
| `--backend-arm 'x={}' --backend-arm 'x={}'` | `--backend-arm labels must be unique` |
| `--backend-arm 'x={"trackingCrop":true}'` | `"trackingCrop" must be a JSON object` |
| no arms | `at least one --arm or --backend-arm ... is required` |

**The override reaches the page and moves numbers.** Demo 2, 1 trial each, fresh process, real GPU
(`ANGLE Metal Renderer: Apple M4 Pro`), server started and identity-verified by the run:

| field | `{"trackingCrop":{"enabled":false}}` | `{"trackingCrop":{"enabled":true}}` |
|---|---|---|
| `metrics.kneeFlexion.value` | 106.103 | 177.686 |
| `metrics.cadence.confidence` | 0.37247 | 0.155874 |
| `segments[0].integratedAreaPx` | 19,153,500 | 19,402,600 |
| `view.confidence` | 0.548582 | 0.587854 |

**A report with no `--backend-arm` is unchanged across this change.** `--arm 'base={}' --clips demo2
--trials 1` run on the stashed tree and on the changed tree differ on **exactly one line**,
`elapsedMs` (3330 vs 4020) — the same single-line difference two same-version runs already produce.

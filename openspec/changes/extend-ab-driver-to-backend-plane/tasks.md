# Tasks

## 1. Generalize arm validation

- [x] 1.1 Re-express `ARM_KEYS` in the recursive form (`null` = leaf, object = nested), accepting
      exactly the same key set it accepts today.
- [x] 1.2 Replace the hand-unrolled two-level loop in `parseArm` with a recursive
      `assertKnownKeys(schema, value, path, label)` that walks to any depth.
- [x] 1.3 Confirm the existing sampling-plane typo case still fails loudly:
      `--arm 'x={"personSelection":{"enable":true}}'`.

## 2. Add the backend plane

- [x] 2.1 Add `BACKEND_ARM_KEYS` mirroring `PoseDetectorConfig` + `TrackingCropConfig` +
      `PersonOfInterestConfig` + `ContinuityGateConfig`.
- [x] 2.2 Add closed-union value checks for `backend` and `movenetModelType`.
- [x] 2.3 Add `--backend-arm <label>=<json>` parsing; join arms by label so an arm may carry a
      sampling override, a backend override, or both, defaulting the absent plane to `{}`.
- [x] 2.4 Assign the backend override in `runTrial` via a second `addInitScript`.

## 3. Provenance

- [x] 3.1 Stamp `# backend-arm <label>: <json>` into the report header, emitted only when at least
      one backend arm exists, so a no-backend-arm report stays byte-identical to before.
- [x] 3.2 Record both planes per arm in the `--json` output.
- [x] 3.3 Update the module doc-comment usage block.

## 4. Verify

- [x] 4.1 A deliberate typo one level down fails at parse time: `--backend-arm
      'x={"trackingCrop":{"enable":true}}'`.
- [x] 4.2 A deliberate typo **two** levels down fails at parse time: `--backend-arm
      'x={"personOfInterest":{"continuityGate":{"enable":true}}}'` — the case the old validator
      structurally could not reach.
- [x] 4.3 A bad union value fails at parse time: `--backend-arm 'x={"backend":"mediapipe"}'`.
- [x] 4.4 A live run proves the override reaches the page and moves a number.
- [x] 4.5 `npm run lint` and `npx tsc -b` clean.

# Bundle a three-clip demo

## Why

The demo is two buttons loading two unrelated clips. **Demo 1** is stock footage of a stranger,
fetched live from Pexels — so the demo needs network, can fail with a download error, and shows a
runner the app's owner has never met. **Demo 2** is `park-approach.mp4`, a 1.65 s front-approach
clip that is too short and too front-on for most of the metric panel: it resolves 5 of the 11
metrics that can carry evidence, and `verticalRatio`, `trunkLean`, `overstriding`, `kneeFlexion`
and `footStrikePattern` are all tier-3 excluded on it.

Neither button shows what the app can actually do. The multi-clip session — fusion picking, per
metric, whichever clip fits that metric's view best — is the app's most capable path and the demo
never exercises it.

The owner has three clips of their own running: the existing front-approach clip plus a landscape
side pass and a portrait side pass, all at the same park. Together they cover both camera
geometries the heuristics gate on. Rolled into one session they demonstrate fusion rather than
merely asserting it exists.

## What Changes

- **The two demo buttons become one.** A single **Demo** button loads all three clips into one
  session, in a fixed order. Demo 1's Pexels URL leaves `src/` entirely.
- **All three demo clips are bundled locally.** The demo no longer touches the network, so it
  cannot fail with a download error and works offline.
- **Clips are emitted one at a time, as each finishes fetching**, so clip 1 begins analyzing while
  clips 2 and 3 are still downloading — the three assets total ~69 MB.
- **`scripts/ab-person-selection.mjs` drives every clip through the Upload tab.** Its `demo1` and
  `demo2` arms addressed clips by demo-button accessible name; those names are gone. Because all
  three clips are now local files, each is drivable individually the way `multiperson` already is —
  the harness keeps per-clip measurement AND stops depending on network for `demo1`.

**BREAKING for the measurement corpus, not for users.** Every anchor CLAUDE.md records under the
name "Demo 1" was measured on the Pexels clip, which is no longer reachable from the UI. Those
readings are not retrofitted or deleted — they were honestly measured on a clip that still exists
at a stable URL — but the name now points somewhere else, so the harness's clip keys are renamed
to say which footage they mean.

## Impact

- Affected specs: `video-input` (new requirement for the bundled demo)
- Affected code: `src/video/DemoVideoButton.tsx`, `src/video/ClipPicker.tsx`, their tests,
  `src/results/MultiClipVideoSession.test.tsx`, `src/video/AddClipAction.test.tsx`,
  `scripts/ab-person-selection.mjs`, `CLAUDE.md`
- New assets: `src/video/demo-clips/park-side-landscape.mp4` (3840×2160, 60 fps, 3.88 s, 36.7 MB),
  `src/video/demo-clips/park-side-portrait.mp4` (1080×1920, 12.17 s, 345 frames, 19.5 MB)

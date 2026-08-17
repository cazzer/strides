# Tasks

## 1. Spec — the contract defect

- [x] 1.1 REMOVE `sampling-robustness-config`'s `Sampling/robustness plane is a single
  configuration object` (with Reason/Migration) and ADD `Sampling/robustness plane is a single
  configuration object with person selection on by default`: `personSelection.enabled: true` as
  the shipped default, and the off-unless-asked-for scenario replaced by a runs-unless-turned-off
  one. Not MODIFIED — that block may neither drop nor rename the reversed scenario.
- [x] 1.2 `openspec validate correct-person-selection-default-docs --strict` passes.

## 2. Comment rot

- [x] 2.1 `src/results/samplingRobustnessConfig.ts`'s `personSelection` comment states
  `enabled: true` and why, reusing `DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG`'s existing
  wording rather than inventing new phrasing.
- [x] 2.2 CLAUDE.md's `__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__` entry states
  `enabled: true` as the shipped default with the same reason, and inverts its override example to
  `{ personSelection: { enabled: false } }` — now the non-default arm every A/B needs.

## 3. Unrelated staleness in the same sweep

- [x] 3.1 CLAUDE.md's live-browser harness section drops the "this repo has no `playwright`
  devDependency" claim (it has had one since `37441b7`) and keeps the cached-browser-binary
  version-mismatch warning, which is still live.

## 4. Verification

- [x] 4.1 `npm test`, `npm run build`, `npm run lint` all green.
- [x] 4.2 No behaviour change: no file under `src/` changes other than one comment.

# Correct the documented default for retroactive person selection

## Why

`DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG` ships `enabled: true`
(`src/results/retroactivePersonSelection.ts`), asserted by
`samplingRobustnessConfig.test.ts`'s "ships retroactive person selection ENABLED by default".

The `sampling-robustness-config` capability spec still says the opposite —
"`personSelection.enabled: false`, meaning the selection stage is opt-in", plus a scenario
asserting the stage is off with no override. `openspec/specs/` is this repo's authoritative
behaviour contract, so it currently contradicts the shipped code on a default that changes what
frames every analysis run measures. That is the part that matters; the same stale claim also sits
in `samplingRobustnessConfig.ts`'s inline comment and in CLAUDE.md, which are comment rot rather
than a contract defect.

The flip was made by explicit user decision on 2026-08-16, **overriding a pre-registered ship rule
that fired** — recorded plainly rather than quietly reworded, because the rule's whole purpose was
to stop a favourable-looking metric shift excusing a measured false cut. What was knowingly
accepted is #52's items 1–3: splice-tolerant segmentation (on the side-view track demo the stage
cuts the runner's own continuous 55-detection track and discards a 5-frame prefix), boxless
survival inside the winner's span, and primary/scale-pass selection divergence.

## What Changes

- **Spec (the contract defect).** `Sampling/robustness plane is a single configuration object` is
  REMOVED and re-ADDED as `Sampling/robustness plane is a single configuration object with person
  selection on by default`: same bundling contract, same three merge/default scenarios verbatim,
  `personSelection.enabled: true` as the shipped default, and the off-unless-asked-for scenario
  replaced by one describing the stage running unless a development-only override disables it.
  REMOVE+ADD rather than MODIFIED because a MODIFIED block may neither drop nor rename an existing
  scenario, and this requirement's default — including a scenario title asserting it — reverses.
- **Comment rot, no spec ceremony.** `samplingRobustnessConfig.ts`'s `personSelection` comment and
  CLAUDE.md's config-override entry describe `true` as the default, with the reason (explicit user
  decision overriding a ship rule that fired, accepting #52 items 1–3), reusing the wording
  `DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG`'s doc already carries rather than inventing new
  phrasing. CLAUDE.md's override example is inverted to `{ personSelection: { enabled: false } }`,
  which is now the non-default arm every A/B needs.
- **Unrelated, same sweep.** CLAUDE.md's live-browser harness section drops its "this repo has no
  `playwright` devDependency" premise — it has had one since `37441b7` — and keeps the
  cached-browser-binary version-mismatch warning, which is still live.

## Impact

- Affected specs: `sampling-robustness-config`
- Affected code: none. No behaviour change — this change touches a spec, one comment, and
  CLAUDE.md prose only.
- Not in scope: the four #52 follow-ups themselves, and `retroactivePersonSelection.ts`'s own doc
  comment (owned by a separate ticket).

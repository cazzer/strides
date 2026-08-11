## Why

Issue #16 (parent, partial) asks for additional running-form heuristics beyond the original three
(vertical oscillation, trunk lean, overstriding). Left/right arm swing asymmetry is a coachable
signal — a compensatory pattern, old injury, or fatigue often shows up as one arm swinging
noticeably more than the other — that none of the existing metrics capture, since all three are
built around a single (usually bilateral-midpoint) signal rather than a left-vs-right comparison.

## What Changes

- Add `computeArmSwingSymmetry` in `src/heuristics/armSwingSymmetry.ts`: per-side wrist-relative-
  to-shoulder vertical swing amplitude (reusing the same gap-aware extrema / half-cycle-amplitude
  machinery vertical oscillation already uses), compared as `min(left, right) / max(left, right)`
  — a 0-1 ratio where 1 means perfectly symmetric swing.
- Extend `MetricId`, `FormHeuristicsResult`, and `DEFAULT_VIEW_FIT_TABLE`
  (`src/heuristics/types.ts`) with `armSwingSymmetry`, gated **front-view-primary** — the mirror
  image of trunk lean/overstriding's side-view-primary gating, because a side view occludes or
  superimposes the far arm rather than because the swing signal itself is invisible from the side.
- Add a `'percent'` `MetricResult['unit']` variant. The existing `'ratio'` unit's `formatValue`
  hard-codes a "% of torso length" suffix that is semantically wrong for a dimensionless left/right
  ratio — see `design.md` for why reusing `'ratio'` as-is was rejected.
- Wire `computeArmSwingSymmetry` into `computeFormHeuristics` (`src/heuristics/index.ts`).
- Render a fourth `MetricCard` in `MetricsPanel` (`src/results/MetricsPanel.tsx`) with a label,
  plain-language description, and `'percent'`-aware formatting.

## Capabilities

### Modified Capabilities
- `form-heuristics`: adds a fourth metric, arm swing symmetry, with its own view-fit table entry
  and an output contract identical in shape to the existing three metrics (`MetricResult`, never
  `null` purely because the view is unsuitable, never throws, never `NaN`).

## Impact

- New: `src/heuristics/armSwingSymmetry.ts`, `src/heuristics/armSwingSymmetry.test.ts`.
- Edited: `src/heuristics/types.ts`, `src/heuristics/index.ts`, `src/results/MetricsPanel.tsx`,
  `src/results/MetricsPanel.test.tsx` (fixtures need the new required `FormHeuristicsResult`
  field).
- No new runtime dependencies. No changes to view detection, the robustness layer, or the
  computation of the other three metrics.

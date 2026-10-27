## 1. Layout

- [x] 1.1 Drawing floor `max(40svh, 200px)`; drawing height `max(stage − draw-top − reserve, floor)`
- [x] 1.2 Cap the phone panel to leave 85% of the floor uncovered; scroll inside when longer
- [x] 1.3 Short phone: dots and Skip in a sticky row in the body, the runner's controls over its start
- [x] 1.4 Reading line never above the stuck bar

## 2. Gate

- [x] 2.1 `useMostlyVisible` requires ≥ 120 px height and re-reads on resize; unit tests

## 3. Verification

- [x] 3.1 Live heights per stop at 375×548/600/667 and 390×844, light and dark; widths 360–430
- [x] 3.2 Desktop 1280×800 screenshots compared before/after
- [x] 3.3 lint, `tsc -b`, vitest, playwright, `openspec validate --all --strict`
- [x] 3.4 A/B gate on side-landscape (tour vs classic) bit-identical but `elapsedMs`

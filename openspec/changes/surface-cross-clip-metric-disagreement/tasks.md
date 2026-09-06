# Tasks

## 1. Decide the rule

- [x] 1.1 Survey all twelve `MetricId`s for an existing classifier, band, or interpretive boundary
      keyed on the metric's own value (design.md D3 table)
- [x] 1.2 Adjudicate `stepWidth`/`stepWidthCm`'s zero-crossing and `cadence`'s `isNearGridEdge`
      explicitly, in the code as well as the design (D4, D5)
- [x] 1.3 Confirm no magnitude threshold is introduced anywhere

## 2. Implement

- [x] 2.1 `metricReading` — value → category, via `classifyFootStrike` and
      `DEFAULT_HEURISTICS_CONFIG.footStrikeMidfootBandRatio`, matching what
      `MetricsPanel.formatValue` renders; `null` for every other metric
- [x] 2.2 `fusionDisagreementCaveat` — the sentence, naming each disagreeing clip and its reading,
      claiming no winner
- [x] 2.3 `disagreementCaveat` — eligibility via `metricTier !== 'excluded'` on the winner and on
      each contender; `null` where fewer than two eligible clips or no reading differs
- [x] 2.4 Append it in `pickMetric`, after the provenance sentence, through the existing
      `.filter(Boolean).join(' ')`
- [x] 2.5 Leave `pickBestWithIndex`, `fusionSourceIndices` and the single-clip reference return
      untouched

## 3. Test

- [x] 3.1 Two clips straddling the band produce the sentence; the metric's own caveat and the
      provenance sentence both survive, in order
- [x] 3.2 Numbers far apart inside one band produce nothing
- [x] 3.3 A metric with no band (`overstriding`, the measured `+0.512135` vs `-0.00809497` pair)
      produces nothing
- [x] 3.4 A null-valued clip and a `viewFit: 'unsuitable'` clip are not quoted; an excluded winner
      short-circuits
- [x] 3.5 A three-clip session lists every disagreeing clip
- [x] 3.6 No computed field moves when the sentence fires
- [x] 3.7 A single-clip session stays reference-identical with no caveat

## 4. Verify

- [x] 4.1 `npx tsc -b` — one pre-existing `vite.config.ts` error only
- [x] 4.2 `npm run lint`
- [x] 4.3 `npx vitest run`
- [x] 4.4 Negative-control A/B: `--clips side-landscape,side-portrait,front-approach --trials 3
      --evidence`, before vs after, nothing but `elapsedMs` moves (md5-cross-checked)
- [x] 4.5 Positive control: drive the *Demo (3 clips)* button live and read the rendered
      `footStrikePattern` card text out of the DOM
- [x] 4.6 `openspec validate surface-cross-clip-metric-disagreement --strict`

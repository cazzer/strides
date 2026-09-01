# Tasks

- [x] 1. Probe the ankle separation at every emitted strike, 3 clips x both passes, live GPU.
- [x] 2. Adjudicate against the pre-registered margin rule — it FIRED on the pooled corpus; stop and
      report rather than re-tune.
- [x] 3. Architect decision: scope the gate to the phase path. Re-adjudicate on that corpus — the
      rule is satisfied at 2.05x / 2.32x.
- [x] 4. `footstrikeMinAnkleSeparationRatio` on `HeuristicsConfig`, with the derivation.
- [x] 5. `ankleMeasurable` on `FootstrikeCandidate`; `hasMeasurableAnkles`; annotate at the path fork.
- [x] 6. Skip an unmeasurable strike in the four ankle-reading metrics; state the non-consumption at
      `strideLength`'s call site.
- [x] 7. Rewrite `MIN_OVERSTRIDE_SAMPLE_SIZE`'s docstring; leave its value and its four siblings alone.
- [x] 8. Tests: annotation, threshold, undecidable, path exemption, ordering, fixture margins,
      and one consumer test per metric.
- [x] 9. Gates: `tsc -b`, eslint, full unit suite, `openspec validate --strict`.
- [x] 10. Live A/B against the `34dc08b` baseline, plus the drop-arm that justifies annotate-over-drop.
- [x] 11. Revert the probe; `src/` carries no instrumentation.

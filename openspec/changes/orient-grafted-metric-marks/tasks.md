# Tasks

- [x] 1. Confirm the premise is false by reading `planClipEvidence`'s routing and enumerating every
      reachable `graftedFrames` case, rather than trusting the ticket.
- [x] 2. Delete `GRAFTED_METRICS`, `InstantContext.polarityAllowed` and `polaritySource`; pass the
      direction directly at all four call sites.
- [x] 3. Correct `EvidenceCaliperOp.polarity`'s doc — it listed grafted withholding as a case. The
      other stale doc the ticket named (`evidenceAnnotations.ts:53`, still claiming `useSessionEvidence`
      hands `planClipEvidence` `clip.analysis.robustFrames`) lived inside the deleted block and went
      with it; verified no occurrence of that claim remains in `src/`.
- [x] 4. Replace `evidenceAnnotations.test.ts`'s membership assertion with the inverse: a grafted
      metric's caliper polarity EQUALS its pixel sibling's on identical geometry.
- [x] 5. Spec delta: drop the false grafted example from "A suppressed polarity still draws the
      span", forbid suppressing polarity by metric id, add a scenario pinning the grafted case.
- [x] 6. Verify: unit suite, `tsc -b`, lint, and a live before/after evidence-coverage diff on all
      three clips.

## Context

On the baseline 9348 trial, the scale-pass line arrived and then nothing else did. Three things a
live page always emits after the scale graft were all missing:

1. **The outline-pass line.** A lane that granted the scale pass stays granted, so the claim is
   certain. The watchdog (max(30 s, 0.2 s/frame)) then bounds segmenter creation and sampling.
2. **The scale graft's evidence re-extraction perf line.** It starts ~5 ms after the graft and
   doesn't queue behind the outline pass. It logs when it finishes or is aborted.
3. **A second `[evidence-coverage]` line.**

Every primary and scale-pass field of that trial matched the repro trials exactly. The most likely
explanation is that the page stopped running JS (renderer crash or main-thread freeze) about 2 s
after the scale-pass line. That can't be proven after the fact, and it didn't recur in ~55 trials:
driver and standalone runs, a cold Vite cache, the baseline's clip order, and up to 8 parallel
browsers.

## Decisions

- **Catch-all on the pass body, routed to the same `failPass`.** The reader or sampler setup
  throwing synchronously is the only way left for the pass to stay 'running' in a live page. The
  `failPass` runId guard still discards a superseded run.
- **Diagnose rather than guess.** The driver now classifies an unsettled trial's page as
  crashed/unresponsive/live, so a recurrence names its cause. The row is written only on timeout,
  which keeps A/B diffs of settled trials byte-identical.

## Non-goals

- Any defence against a renderer crash. No in-page code can report after the page dies.

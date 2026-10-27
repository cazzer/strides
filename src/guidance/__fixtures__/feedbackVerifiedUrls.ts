/**
 * Every URL a why line, cue or non-point may cite. **Closed**: a URL not in this set cannot ship in
 * a feedback line without `feedbackPoints.test.ts` failing. A test fixture, shared with the guided
 * view's page-wide link check. Each member was opened on 2026-10-27 and found to
 * state the line that cites it; the quoted sentence is in add-runner-tour design.md. Each member
 * must also appear in docs/prd/runner-led-results-research.md or among METRIC_GUIDANCE's own URLs.
 */
export const FEEDBACK_VERIFIED_URLS: ReadonlySet<string> = new Set([
  // Why lines
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC11127892/',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC4296200',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC11809138/',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC5473370/',
  'https://journals.biologists.com/jeb/article/218/21/3406/14416/',
  // Non-points
  'https://www.theinjuryclinic.com.au/wp-content/uploads/2021/06/Anderson2020_Article_WhatAreTheBenefitsAndRisksAsso.pdf',
  'https://pubmed.ncbi.nlm.nih.gov/21316058/',
  // Cues: each cue-capable metric's existing Try line, reused verbatim
  'https://ijspt.scholasticahq.com/article/90909-a-one-session-gait-retraining-protocol-with-metronome-augmentation-increases-cadence-in-novice-and-recreational-runners',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC6088121/',
])

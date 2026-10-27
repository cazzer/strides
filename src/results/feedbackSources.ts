import type { EvidenceKind } from '../guidance/feedbackPoints'

/**
 * The short citation each feedback line's URL is linked under, as a reader says it aloud. Keyed by
 * URL: `feedbackPoints.ts` records only the URL, and three of its sources are not in the guidance
 * record, so their link names cannot be looked up there. Names and years are design.md D2's table.
 * The test pins that every why line and non-point has one.
 */
export const FEEDBACK_SOURCE_TITLES: Readonly<Record<string, string>> = {
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC11127892/': 'Van Hooren et al. 2024',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC4296200': 'Arellano & Kram 2014',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC11809138/': 'Braun et al. 2024',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC5473370/': 'Folland et al. 2017',
  'https://journals.biologists.com/jeb/article/218/21/3406/14416/': 'Lieberman et al. 2015',
  'https://www.theinjuryclinic.com.au/wp-content/uploads/2021/06/Anderson2020_Article_WhatAreTheBenefitsAndRisksAsso.pdf':
    'Anderson et al. 2020',
  'https://pubmed.ncbi.nlm.nih.gov/21316058/': 'Arellano & Kram 2011',
}

/**
 * How strong a feedback line's claim is, said beside its source: whether anyone changed the
 * quantity and measured the outcome (`EvidenceKind`'s own doc).
 */
export const EVIDENCE_KIND_LABELS: Readonly<Record<EvidenceKind, string>> = {
  association: 'Linked, not tested',
  trial: 'Tested in a trial',
  mixed: 'Reviewed across studies',
}

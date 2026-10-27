import { describe, expect, it } from 'vitest'
import { NON_POINTS, WHY_LINES } from '../guidance/feedbackPoints'
import { EVIDENCE_KIND_LABELS, FEEDBACK_SOURCE_TITLES } from './feedbackSources'

describe('feedback sources', () => {
  it('names the source of every why line and non-point', () => {
    for (const line of [...Object.values(WHY_LINES), ...Object.values(NON_POINTS)]) {
      expect(FEEDBACK_SOURCE_TITLES[line!.url], line!.url).toMatch(/\S/)
    }
  })

  it('titles only URLs a feedback line cites, so a retired source does not linger here', () => {
    const cited = new Set(
      [...Object.values(WHY_LINES), ...Object.values(NON_POINTS)].map((line) => line!.url),
    )
    expect(Object.keys(FEEDBACK_SOURCE_TITLES).sort()).toEqual([...cited].sort())
  })

  it('labels every evidence kind', () => {
    expect(Object.keys(EVIDENCE_KIND_LABELS).sort()).toEqual(['association', 'mixed', 'trial'])
  })
})

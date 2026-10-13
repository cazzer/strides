import type { View } from '../heuristics/types'

export function clipViewLabel(view: View | undefined): string {
  if (view === 'side') return 'Side view'
  if (view === 'front') return 'Approach view'
  return 'View uncertain'
}

export function clipSourceLabel(
  index: number,
  total: number,
  views: readonly string[],
): string {
  return `Clip ${index + 1} of ${total} · ${views[index] ?? 'View pending'}`
}

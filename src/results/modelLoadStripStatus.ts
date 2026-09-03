import type { ModelLoadState, ModelLoadStates } from '../pose/modelLoadState'

/**
 * What the header bar's model-download entry is currently reporting, derived purely from the two
 * detector owners' `ModelLoadState`s (`strides-utn.5`).
 *
 * ### This is deliberately NOT a `ClipStripCondition`
 *
 * `clipStripStatus.ts`'s union is a closed 8-member set over a CLIP's own state, and
 * `describeClipStripStatus` is a pure function of clip inputs. A model download is not a clip: it
 * has no video, no poster, no preview and no position in clip-session order. Widening that union to
 * carry model states would put a non-clip through a function whose every branch reads clip fields,
 * and would invite the same confusion in the strip that the spec forbids in the DOM (the entry is a
 * preceding SIBLING of `<ul aria-label="Clips">`, never a member of it, so that
 * `"Combined from clip N of TOTAL"` still matches a strip entry by counting).
 *
 * ### Why there is no percentage here, and never can be one from this shape
 *
 * `ModelLoadProgress.totalBytes` is knowably PARTIAL while a load is in flight. Each file's total
 * is reported only once its own response headers arrive, and MoveNet's shards are not even NAMED
 * until `model.json` is parsed — so the primary owner's aggregate total climbs from ~417 kB (the
 * two `model.json` files) to ~14.5 MB as the shards begin (design.md D10.4, `strides-utn.6`).
 * `loadedBytes / totalBytes` therefore goes BACKWARDS: roughly 100% of the known total, then ~3% of
 * the real one.
 *
 * Three presentations were considered and two rejected (design.md D11.1):
 *
 * - **A high-water mark on the fraction** is worse than the raw one, not better. Both `model.json`
 *   files complete before any shard's headers arrive, so the mark pins at 100% for the remaining
 *   ~14.1 MB — a bar that reads "done" through 97% of the work.
 * - **Swinging determinate → indeterminate** the moment a fraction would fall is honest, but it is
 *   the same confusing presentation D10.4 already rejected for the alternative seeding scheme, in
 *   the one place a reader is actually watching.
 * - **Transferred bytes** — what ships. `loadedBytes` is monotonic non-decreasing by construction
 *   (each asset's own count only rises, and `aggregateModelAssetProgress`'s map only gains
 *   entries), so it cannot regress, and it is a measurement rather than an inference. It is also
 *   the more actionable of the two readings: "4.2 MB" tells a reader this is a large download,
 *   while a percentage of a number that is not yet the total tells them nothing true.
 *
 * So this module reports bytes and never a fraction, and the entry's bar carries no width.
 */
export type ModelLoadStripCondition = 'loading' | 'error'

/** Which detector owner a reading came from — the two have genuinely different consequences. */
export type ModelLoadOwner = 'primary' | 'scalePass'

export interface ModelLoadStripStatus {
  condition: ModelLoadStripCondition
  /**
   * Total bytes transferred so far across every owner this entry is currently reporting, or `null`
   * when nothing measurable has been reported yet. **Never a fraction and never a percentage** —
   * see the module doc. Monotonic within one presentation of the entry.
   */
  loadedBytes: number | null
  /**
   * Short visible caption, in the strip's own idiom: the measured figure where there is one
   * (`4.2 MB`, the counterpart of a clip entry's `42%`), a word otherwise.
   */
  caption: string
  /** A single non-colour glyph, a redundant encoding beside the caption. `aria-hidden` at the call
   * site; the announcement below is what assistive technology reads. */
  glyph: string
  /**
   * The full sentence exposed to assistive technology as PLAIN TEXT — this entry is never a live
   * region (design.md D11.3). `results-view`'s "Session status stays a single announced line while
   * per-clip progress moves to the clips" permits at most one live region announcing progress for
   * the session, and that budget belongs to the active clip's `role="status"` caption. The rule
   * this entry follows is exactly the rule every non-active clip entry already follows: expose the
   * condition as text, do not announce it.
   */
  announcement: string
}

/** Sentence-case with a trailing ellipsis, matching `clipStripStatus.ts`'s announcements. */
const LOADING_SENTENCE: Record<ModelLoadOwner, string> = {
  primary: 'Downloading the pose model…',
  scalePass: 'Downloading the scale model…',
}

/**
 * Failure copy names the recovery action rather than offering a control, because no in-product
 * retry ships (design.md D11.2): the primary detector is created once and cached for the app's
 * lifetime, its failure window is at mount before any clip exists — so a page reload costs the
 * reader nothing — and the scale pass already retries by construction on the next analysis run.
 */
const ERROR_SENTENCE: Record<ModelLoadOwner, string> = {
  primary: 'The pose model could not be downloaded. Reload the page to try again.',
  scalePass:
    'The scale model could not be downloaded. Centimetre measurements are unavailable for this session.',
}

const OWNERS: readonly ModelLoadOwner[] = ['primary', 'scalePass']

/**
 * PURE. `null` means "render nothing" — which is the settled state and by far the commonest one:
 * both owners idle or ready, i.e. no download is in flight and none has failed.
 *
 * Failure takes precedence over a load in flight. In practice the two never contend (the scale pass
 * cannot start until a clip has been analysed, which requires a working primary), but stating the
 * order makes it deterministic rather than incidental, and a failed primary is fatal to the whole
 * page — it must never be masked by a later, non-fatal download.
 */
export function describeModelLoadStripStatus(
  states: ModelLoadStates,
): ModelLoadStripStatus | null {
  const failed = OWNERS.filter((owner) => states[owner].phase === 'error')
  if (failed.length > 0) {
    return {
      condition: 'error',
      loadedBytes: null,
      caption: 'Failed',
      glyph: '!',
      announcement: ERROR_SENTENCE[failed[0]],
    }
  }

  const loading = OWNERS.filter((owner) => states[owner].phase === 'loading')
  if (loading.length === 0) return null

  const loadedBytes = sumLoadedBytes(loading.map((owner) => states[owner]))
  const transferred = loadedBytes === null ? null : formatTransferredBytes(loadedBytes)

  return {
    condition: 'loading',
    loadedBytes,
    // `Loading` while nothing has been measured, the figure once something has. The caption is
    // ~96 px of 11 px text, so it holds a word or a number and the sentence lives in
    // `announcement`, exactly as a clip entry's does.
    caption: transferred ?? 'Loading',
    glyph: '⋯',
    announcement:
      loadingSentence(loading) + (transferred === null ? '' : ` ${transferred} so far.`),
  }
}

function loadingSentence(loading: readonly ModelLoadOwner[]): string {
  if (loading.length === 1) return LOADING_SENTENCE[loading[0]]
  return 'Downloading the pose and scale models…'
}

/**
 * `null` when NO reporting owner has a byte reading at all. An owner that is loading without
 * progress contributes nothing rather than forcing the whole reading to indeterminate: the sum is
 * still every byte anyone has measured, which is a true lower bound and still monotonic. (The two
 * owners never load at once in practice, so this only ever folds one term.)
 */
function sumLoadedBytes(states: readonly ModelLoadState[]): number | null {
  let total = 0
  let measured = false
  for (const state of states) {
    if (state.progress === null) continue
    total += state.progress.loadedBytes
    measured = true
  }
  return measured ? total : null
}

/**
 * Decimal SI, matching the units this epic measured and recorded in (`14,522,593` bytes reported as
 * 14.5 MB). Sub-megabyte readings are shown in kB so the first `model.json` is a meaningful figure
 * rather than `0.2 MB`; the unit switch is the only discontinuity and the underlying quantity rises
 * through it either way.
 *
 * Zero is not a reading — a download that has reported no bytes is described by a word, not by
 * `0 kB`, which reads as a stalled transfer rather than as one about to start.
 */
export function formatTransferredBytes(bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return null
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} kB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

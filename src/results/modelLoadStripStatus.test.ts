import { describe, expect, it } from 'vitest'
import { IDLE_MODEL_LOAD_STATE } from '../pose/modelLoadState'
import type { ModelLoadState, ModelLoadStates } from '../pose/modelLoadState'
import {
  describeModelLoadStripStatus,
  formatTransferredBytes,
} from './modelLoadStripStatus'

function states(
  primary: ModelLoadState,
  scalePass: ModelLoadState = IDLE_MODEL_LOAD_STATE,
): ModelLoadStates {
  return { primary, scalePass }
}

const READY: ModelLoadState = { phase: 'ready', progress: null }

function loading(loadedBytes?: number, totalBytes?: number): ModelLoadState {
  return {
    phase: 'loading',
    progress:
      loadedBytes === undefined
        ? null
        : { loadedBytes, totalBytes: totalBytes ?? loadedBytes },
  }
}

describe('describeModelLoadStripStatus', () => {
  it('renders nothing while both owners are settled', () => {
    expect(describeModelLoadStripStatus(states(IDLE_MODEL_LOAD_STATE))).toBeNull()
    expect(describeModelLoadStripStatus(states(READY, READY))).toBeNull()
    expect(describeModelLoadStripStatus(states(READY, IDLE_MODEL_LOAD_STATE))).toBeNull()
  })

  it('reports a primary download that has not measured anything yet without a number', () => {
    const status = describeModelLoadStripStatus(states(loading()))

    expect(status).not.toBeNull()
    expect(status!.condition).toBe('loading')
    expect(status!.loadedBytes).toBeNull()
    expect(status!.caption).toBe('Loading')
    expect(status!.announcement).toBe('Downloading the pose model…')
    // The whole point of the shape: nothing that could be read as a percentage or a byte count.
    expect(status!.caption).not.toMatch(/%|\d/)
    expect(status!.announcement).not.toMatch(/%|\d/)
  })

  it('reports transferred bytes, never a percentage, once something has been measured', () => {
    const status = describeModelLoadStripStatus(states(loading(4_200_000, 14_522_593)))!

    expect(status.caption).toBe('4.2 MB')
    expect(status.announcement).toBe('Downloading the pose model… 4.2 MB so far.')
    expect(status.caption).not.toContain('%')
    expect(status.announcement).not.toContain('%')
  })

  /**
   * `strides-utn.6`, the whole reason this module reports bytes rather than a fraction: MoveNet's
   * aggregate total climbs from the two `model.json` files (~417 kB) to ~14.5 MB as the shards
   * begin, so `loadedBytes / totalBytes` falls from ~100% to ~3%. The reported reading must not.
   */
  it('does not go backwards when the aggregate total grows as further files begin', () => {
    // The exact shape `strides-utn.4` measured: both manifests complete, then the shards start.
    const manifestsDone = describeModelLoadStripStatus(states(loading(417_083, 417_083)))!
    const shardsStarted = describeModelLoadStripStatus(states(loading(430_000, 14_522_593)))!

    expect(manifestsDone.loadedBytes).toBe(417_083)
    expect(shardsStarted.loadedBytes).toBe(430_000)
    expect(shardsStarted.loadedBytes!).toBeGreaterThan(manifestsDone.loadedBytes!)

    // A naive determinate reading over the same two samples is the failure being avoided.
    expect(430_000 / 14_522_593).toBeLessThan(417_083 / 417_083)
  })

  it('reports the scale pass by name, since it starts long after the page has loaded', () => {
    const status = describeModelLoadStripStatus(states(READY, loading(9_398_198)))!

    expect(status.condition).toBe('loading')
    expect(status.caption).toBe('9.4 MB')
    expect(status.announcement).toBe('Downloading the scale model… 9.4 MB so far.')
  })

  it('sums the owners and names both if they ever load at once', () => {
    const status = describeModelLoadStripStatus(states(loading(1_000_000), loading(2_000_000)))!

    expect(status.loadedBytes).toBe(3_000_000)
    expect(status.announcement).toBe('Downloading the pose and scale models… 3.0 MB so far.')
  })

  it('counts the measured owner when a co-loading owner reports nothing', () => {
    const status = describeModelLoadStripStatus(states(loading(1_500_000), loading()))!

    expect(status.loadedBytes).toBe(1_500_000)
  })

  it('reads as a failure, not as work in progress, when the primary download fails', () => {
    const status = describeModelLoadStripStatus(states({ phase: 'error', progress: null }))!

    expect(status.condition).toBe('error')
    expect(status.caption).toBe('Failed')
    expect(status.glyph).toBe('!')
    expect(status.announcement).toBe(
      'The pose model could not be downloaded. Reload the page to try again.',
    )
    expect(status.announcement).not.toMatch(/loading|downloading/i)
  })

  it('names the consequence when the scale model fails, which is not fatal', () => {
    const status = describeModelLoadStripStatus(
      states(READY, { phase: 'error', progress: null }),
    )!

    expect(status.condition).toBe('error')
    expect(status.announcement).toContain('Centimetre measurements are unavailable')
  })

  it('lets a fatal primary failure win over a download still in flight', () => {
    const status = describeModelLoadStripStatus(
      states({ phase: 'error', progress: null }, loading(500_000)),
    )!

    expect(status.condition).toBe('error')
    expect(status.announcement).toContain('pose model')
  })
})

describe('formatTransferredBytes', () => {
  it('describes a sub-megabyte reading in kB so the first manifest is a real figure', () => {
    expect(formatTransferredBytes(168_013)).toBe('168 kB')
    expect(formatTransferredBytes(417_083)).toBe('417 kB')
  })

  it('describes a megabyte-scale reading in the decimal MB this epic measured in', () => {
    expect(formatTransferredBytes(14_522_593)).toBe('14.5 MB')
    expect(formatTransferredBytes(9_398_198)).toBe('9.4 MB')
  })

  it('treats zero and nonsense as no reading at all rather than as a stalled transfer', () => {
    expect(formatTransferredBytes(0)).toBeNull()
    expect(formatTransferredBytes(-1)).toBeNull()
    expect(formatTransferredBytes(Number.NaN)).toBeNull()
  })

  it('never decreases across the unit boundary', () => {
    const under = formatTransferredBytes(999_000)!
    const over = formatTransferredBytes(1_001_000)!
    expect(under).toBe('999 kB')
    expect(over).toBe('1.0 MB')
  })
})

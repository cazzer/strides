import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SAMPLING_ROBUSTNESS_CONFIG,
  resolveSamplingRobustnessConfig,
} from './samplingRobustnessConfig'
import { DEFAULT_ROBUSTNESS_CONFIG } from '../pose/robustness/types'
import { DEFAULT_MAX_CONSECUTIVE_ERRORS, DEFAULT_DETECTION_TIMEOUT_MS } from './sampleClip'
import { DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG } from './retroactivePersonSelection'

afterEach(() => {
  vi.unstubAllEnvs()
  delete window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__
})

describe('DEFAULT_SAMPLING_ROBUSTNESS_CONFIG', () => {
  it('matches the existing hardcoded defaults exactly', () => {
    expect(DEFAULT_SAMPLING_ROBUSTNESS_CONFIG).toEqual({
      robustness: DEFAULT_ROBUSTNESS_CONFIG,
      maxConsecutiveErrors: DEFAULT_MAX_CONSECUTIVE_ERRORS,
      detectionTimeoutMs: DEFAULT_DETECTION_TIMEOUT_MS,
      sequentialSampling: { enabled: true, targetSamplesPerSecond: null },
      personSelection: DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG,
    })
  })

  it('ships retroactive person selection ENABLED by default', () => {
    // Enabled by explicit user decision, OVERRIDING the pre-registered ship rule, which fired:
    // the stage is not a no-op on the side-view track demo (one collapsed detection splits the
    // runner's own track and strands five real frames). See the change's design.md and
    // DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG's doc for what is knowingly accepted.
    expect(DEFAULT_SAMPLING_ROBUSTNESS_CONFIG.personSelection.enabled).toBe(true)
  })

  it('ships the sequential-decode path enabled by default', () => {
    // Flipped 2026-08-16: every-frame WebCodecs sampling is the default, trading a known,
    // unresolved MoveNet/side-view confidence regression (design.md D7) for eliminating the
    // real-time-playback frame-selection nondeterminism this plane exists to fix.
    expect(DEFAULT_SAMPLING_ROBUSTNESS_CONFIG.sequentialSampling.enabled).toBe(true)
  })
})

describe('resolveSamplingRobustnessConfig', () => {
  it('returns the default when no override is present', () => {
    expect(resolveSamplingRobustnessConfig()).toEqual(DEFAULT_SAMPLING_ROBUSTNESS_CONFIG)
  })

  it('merges an override on top of the default, in a dev build', () => {
    window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__ = {
      maxConsecutiveErrors: 5,
      robustness: { minKeypointConfidence: 0.9 },
    }

    const resolved = resolveSamplingRobustnessConfig()

    expect(resolved.maxConsecutiveErrors).toBe(5)
    expect(resolved.robustness.minKeypointConfidence).toBe(0.9)
    // Untouched fields keep their default values -- a partial override.
    expect(resolved.detectionTimeoutMs).toBe(DEFAULT_DETECTION_TIMEOUT_MS)
    expect(resolved.robustness.maxGapSeconds).toBe(DEFAULT_ROBUSTNESS_CONFIG.maxGapSeconds)
  })

  it('ignores the override outside a dev build', () => {
    vi.stubEnv('DEV', false)
    window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__ = { maxConsecutiveErrors: 5 }

    expect(resolveSamplingRobustnessConfig()).toEqual(DEFAULT_SAMPLING_ROBUSTNESS_CONFIG)
  })

  it('merges a sequentialSampling override on top of the default, same nested-partial pattern as robustness', () => {
    window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__ = {
      sequentialSampling: { targetSamplesPerSecond: 15 },
    }

    const resolved = resolveSamplingRobustnessConfig()

    // enabled keeps its default (true) since the override only touched targetSamplesPerSecond.
    expect(resolved.sequentialSampling).toEqual({ enabled: true, targetSamplesPerSecond: 15 })
    // Untouched fields keep their default values -- a partial override, same as robustness.
    expect(resolved.maxConsecutiveErrors).toBe(DEFAULT_MAX_CONSECUTIVE_ERRORS)
    expect(resolved.robustness).toEqual(DEFAULT_ROBUSTNESS_CONFIG)
  })

  it('defaults sequentialSampling to every-decoded-frame (null) and enabled when no override touches it', () => {
    window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__ = { maxConsecutiveErrors: 5 }

    const resolved = resolveSamplingRobustnessConfig()

    expect(resolved.sequentialSampling).toEqual({ enabled: true, targetSamplesPerSecond: null })
  })

  it('lets a dev-only override flip the sequential-decode path off', () => {
    window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__ = {
      sequentialSampling: { enabled: false },
    }

    const resolved = resolveSamplingRobustnessConfig()

    expect(resolved.sequentialSampling).toEqual({ enabled: false, targetSamplesPerSecond: null })
  })

  it('merges a personSelection override on top of the default, one level deep', () => {
    window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__ = {
      personSelection: { minBoundingBoxAreaFraction: 1e-3 },
    }

    const resolved = resolveSamplingRobustnessConfig()

    expect(resolved.personSelection).toEqual({
      ...DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG,
      minBoundingBoxAreaFraction: 1e-3,
    })
    // Untouched planes keep their defaults -- the same nested-partial pattern robustness and
    // sequentialSampling already have.
    expect(resolved.robustness).toEqual(DEFAULT_ROBUSTNESS_CONFIG)
    expect(resolved.sequentialSampling).toEqual({
      enabled: true,
      targetSamplesPerSecond: null,
    })
  })

  it('lets a dev-only override flip retroactive person selection OFF', () => {
    // The A/B switch, and the reason this plane needs no `window` global of its own. Asserted in
    // the OFF direction on purpose: the stage ships ON, so overriding it to `true` and checking
    // for `true` would pass even if `override.personSelection` were dropped from the merge
    // entirely. Only the non-default direction proves the override is actually read -- and OFF is
    // the direction that matters operationally now, since it is the revert path.
    window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__ = {
      personSelection: { enabled: false },
    }

    const resolved = resolveSamplingRobustnessConfig()

    expect(DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG.enabled).toBe(true)
    expect(resolved.personSelection.enabled).toBe(false)
    // ...and the siblings the override never mentioned are untouched at their defaults, so
    // flipping the switch does not quietly reset the tuning around it.
    expect(resolved.personSelection).toEqual({
      ...DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG,
      enabled: false,
    })
  })

  it('defaults personSelection when an override touches only other planes', () => {
    window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__ = { maxConsecutiveErrors: 5 }

    const resolved = resolveSamplingRobustnessConfig()

    expect(resolved.personSelection).toEqual(DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG)
  })
})

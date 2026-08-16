import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SAMPLING_ROBUSTNESS_CONFIG,
  resolveSamplingRobustnessConfig,
} from './samplingRobustnessConfig'
import { DEFAULT_ROBUSTNESS_CONFIG } from '../pose/robustness/types'
import { DEFAULT_MAX_CONSECUTIVE_ERRORS, DEFAULT_DETECTION_TIMEOUT_MS } from './sampleClip'

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
    })
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
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_POSE_DETECTOR_CONFIG,
  resolvePoseDetectorConfig,
} from './poseBackendConfig'
import { DEFAULT_TRACKING_CROP_CONFIG } from './backends/trackingCropConfig'
import {
  DEFAULT_CONTINUITY_GATE_CONFIG,
  DEFAULT_PERSON_OF_INTEREST_CONFIG,
} from './backends/personOfInterestConfig'

afterEach(() => {
  vi.unstubAllEnvs()
  delete window.__STRIDES_POSE_BACKEND_OVERRIDE__
})

describe('DEFAULT_POSE_DETECTOR_CONFIG', () => {
  it('defaults to the movenet backend with the default tracking-crop and person-of-interest config', () => {
    expect(DEFAULT_POSE_DETECTOR_CONFIG).toEqual({
      backend: 'movenet',
      trackingCrop: DEFAULT_TRACKING_CROP_CONFIG,
      personOfInterest: DEFAULT_PERSON_OF_INTEREST_CONFIG,
    })
  })
})

describe('resolvePoseDetectorConfig', () => {
  it('returns the default when no override is present', () => {
    expect(resolvePoseDetectorConfig()).toEqual(DEFAULT_POSE_DETECTOR_CONFIG)
  })

  it('applies an override on top of the default, in a dev build', () => {
    window.__STRIDES_POSE_BACKEND_OVERRIDE__ = { backend: 'blazepose' }

    expect(resolvePoseDetectorConfig()).toEqual({
      backend: 'blazepose',
      trackingCrop: DEFAULT_TRACKING_CROP_CONFIG,
      personOfInterest: DEFAULT_PERSON_OF_INTEREST_CONFIG,
    })
  })

  it('ignores the override outside a dev build', () => {
    vi.stubEnv('DEV', false)
    window.__STRIDES_POSE_BACKEND_OVERRIDE__ = { backend: 'blazepose' }

    expect(resolvePoseDetectorConfig()).toEqual(DEFAULT_POSE_DETECTOR_CONFIG)
  })

  it('shallow-merges a partial trackingCrop override over the default, in a dev build', () => {
    window.__STRIDES_POSE_BACKEND_OVERRIDE__ = {
      trackingCrop: { enabled: false, minCropSidePx: 512 },
    }

    const resolved = resolvePoseDetectorConfig()

    expect(resolved.trackingCrop).toEqual({
      ...DEFAULT_TRACKING_CROP_CONFIG,
      enabled: false,
      minCropSidePx: 512,
    })
    // Untouched fields keep their default values -- a partial override.
    expect(resolved.trackingCrop?.paddingMultiplier).toBe(
      DEFAULT_TRACKING_CROP_CONFIG.paddingMultiplier,
    )
  })

  it('ignores a trackingCrop override outside a dev build', () => {
    vi.stubEnv('DEV', false)
    window.__STRIDES_POSE_BACKEND_OVERRIDE__ = {
      trackingCrop: { enabled: false },
    }

    expect(resolvePoseDetectorConfig()).toEqual(DEFAULT_POSE_DETECTOR_CONFIG)
  })

  it('shallow-merges a partial personOfInterest override over the default, in a dev build', () => {
    window.__STRIDES_POSE_BACKEND_OVERRIDE__ = {
      personOfInterest: { enabled: false },
    }

    const resolved = resolvePoseDetectorConfig()

    expect(resolved.personOfInterest).toEqual({
      ...DEFAULT_PERSON_OF_INTEREST_CONFIG,
      enabled: false,
    })
  })

  it('ignores a personOfInterest override outside a dev build', () => {
    vi.stubEnv('DEV', false)
    window.__STRIDES_POSE_BACKEND_OVERRIDE__ = {
      personOfInterest: { enabled: false },
    }

    expect(resolvePoseDetectorConfig()).toEqual(DEFAULT_POSE_DETECTOR_CONFIG)
  })

  it('merges a partial continuityGate override one level deeper, preserving its sibling fields', () => {
    window.__STRIDES_POSE_BACKEND_OVERRIDE__ = {
      personOfInterest: { continuityGate: { maxAreaRatio: 1.5 } },
    }

    const resolved = resolvePoseDetectorConfig()

    expect(resolved.personOfInterest?.continuityGate).toEqual({
      ...DEFAULT_CONTINUITY_GATE_CONFIG,
      maxAreaRatio: 1.5,
    })
    // Without the extra merge level these would come back `undefined` rather than defaulted.
    expect(resolved.personOfInterest?.continuityGate.enabled).toBe(
      DEFAULT_CONTINUITY_GATE_CONFIG.enabled,
    )
    expect(
      resolved.personOfInterest?.continuityGate.maxCenterSpeedSidesPerSecond,
    ).toBe(DEFAULT_CONTINUITY_GATE_CONFIG.maxCenterSpeedSidesPerSecond)
  })

  it('keeps the default continuityGate when personOfInterest is overridden without it', () => {
    window.__STRIDES_POSE_BACKEND_OVERRIDE__ = {
      personOfInterest: { enabled: false },
    }

    expect(resolvePoseDetectorConfig().personOfInterest?.continuityGate).toEqual(
      DEFAULT_CONTINUITY_GATE_CONFIG,
    )
  })

  it('can disable the continuity gate while leaving multi-pose dispatch enabled', () => {
    window.__STRIDES_POSE_BACKEND_OVERRIDE__ = {
      personOfInterest: { continuityGate: { enabled: false } },
    }

    const resolved = resolvePoseDetectorConfig()

    expect(resolved.personOfInterest?.enabled).toBe(true)
    expect(resolved.personOfInterest?.continuityGate.enabled).toBe(false)
  })
})

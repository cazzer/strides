import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_POSE_DETECTOR_CONFIG,
  resolvePoseDetectorConfig,
} from './poseBackendConfig'
import { DEFAULT_TRACKING_CROP_CONFIG } from './backends/trackingCropConfig'

afterEach(() => {
  vi.unstubAllEnvs()
  delete window.__STRIDES_POSE_BACKEND_OVERRIDE__
})

describe('DEFAULT_POSE_DETECTOR_CONFIG', () => {
  it('defaults to the movenet backend with the default tracking-crop config', () => {
    expect(DEFAULT_POSE_DETECTOR_CONFIG).toEqual({
      backend: 'movenet',
      trackingCrop: DEFAULT_TRACKING_CROP_CONFIG,
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
    window.__STRIDES_POSE_BACKEND_OVERRIDE__ = { trackingCrop: { enabled: false } }

    expect(resolvePoseDetectorConfig()).toEqual(DEFAULT_POSE_DETECTOR_CONFIG)
  })
})

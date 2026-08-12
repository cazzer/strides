import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_POSE_DETECTOR_CONFIG,
  resolvePoseDetectorConfig,
} from './poseBackendConfig'

afterEach(() => {
  vi.unstubAllEnvs()
  delete window.__STRIDES_POSE_BACKEND_OVERRIDE__
})

describe('DEFAULT_POSE_DETECTOR_CONFIG', () => {
  it('defaults to the movenet backend', () => {
    expect(DEFAULT_POSE_DETECTOR_CONFIG).toEqual({ backend: 'movenet' })
  })
})

describe('resolvePoseDetectorConfig', () => {
  it('returns the default when no override is present', () => {
    expect(resolvePoseDetectorConfig()).toEqual(DEFAULT_POSE_DETECTOR_CONFIG)
  })

  it('applies an override on top of the default, in a dev build', () => {
    window.__STRIDES_POSE_BACKEND_OVERRIDE__ = { backend: 'blazepose' }

    expect(resolvePoseDetectorConfig()).toEqual({ backend: 'blazepose' })
  })

  it('ignores the override outside a dev build', () => {
    vi.stubEnv('DEV', false)
    window.__STRIDES_POSE_BACKEND_OVERRIDE__ = { backend: 'blazepose' }

    expect(resolvePoseDetectorConfig()).toEqual(DEFAULT_POSE_DETECTOR_CONFIG)
  })
})

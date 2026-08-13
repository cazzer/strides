import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SCALE_PASS_CONFIG, resolveScalePassConfig } from './scalePassConfig'

afterEach(() => {
  vi.unstubAllEnvs()
  delete window.__STRIDES_SCALE_PASS_CONFIG_OVERRIDE__
})

describe('DEFAULT_SCALE_PASS_CONFIG', () => {
  it('defaults to enabled', () => {
    expect(DEFAULT_SCALE_PASS_CONFIG).toEqual({ enabled: true })
  })
})

describe('resolveScalePassConfig', () => {
  it('returns the default when no override is present', () => {
    expect(resolveScalePassConfig()).toEqual(DEFAULT_SCALE_PASS_CONFIG)
  })

  it('applies an override on top of the default, in a dev build', () => {
    window.__STRIDES_SCALE_PASS_CONFIG_OVERRIDE__ = { enabled: false }

    expect(resolveScalePassConfig()).toEqual({ enabled: false })
  })

  it('ignores the override outside a dev build', () => {
    vi.stubEnv('DEV', false)
    window.__STRIDES_SCALE_PASS_CONFIG_OVERRIDE__ = { enabled: false }

    expect(resolveScalePassConfig()).toEqual(DEFAULT_SCALE_PASS_CONFIG)
  })
})

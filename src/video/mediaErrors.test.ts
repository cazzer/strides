import { describe, expect, it } from 'vitest'
import { classifyGetUserMediaError, classifyMediaError } from './mediaErrors'

function fakeMediaError(code: number): MediaError {
  return { code, message: '' } as MediaError
}

describe('classifyMediaError', () => {
  it('classifies code 4 (MEDIA_ERR_SRC_NOT_SUPPORTED) as unsupported-format', () => {
    const result = classifyMediaError(fakeMediaError(4))
    expect(result.kind).toBe('unsupported-format')
    expect(result.message).toMatch(/format/i)
    expect(result.message).toMatch(/webcam/i)
  })

  it('classifies code 3 (MEDIA_ERR_DECODE) as decode-error', () => {
    const result = classifyMediaError(fakeMediaError(3))
    expect(result.kind).toBe('decode-error')
    expect(result.message.length).toBeGreaterThan(0)
  })

  it('classifies other codes as unknown', () => {
    expect(classifyMediaError(fakeMediaError(1)).kind).toBe('unknown')
    expect(classifyMediaError(fakeMediaError(2)).kind).toBe('unknown')
  })

  it('classifies a null error as unknown', () => {
    expect(classifyMediaError(null).kind).toBe('unknown')
  })

  it('always returns a non-empty, user-facing message', () => {
    for (const code of [1, 2, 3, 4, 99]) {
      const result = classifyMediaError(fakeMediaError(code))
      expect(result.message.length).toBeGreaterThan(10)
    }
  })
})

describe('classifyGetUserMediaError', () => {
  it('classifies NotAllowedError as permission-denied', () => {
    const err = new DOMException('denied', 'NotAllowedError')
    const result = classifyGetUserMediaError(err)
    expect(result.kind).toBe('permission-denied')
    expect(result.message).toMatch(/upload/i)
  })

  it('classifies SecurityError as permission-denied', () => {
    const err = new DOMException('blocked', 'SecurityError')
    expect(classifyGetUserMediaError(err).kind).toBe('permission-denied')
  })

  it('classifies NotFoundError as no-camera', () => {
    const err = new DOMException('none', 'NotFoundError')
    const result = classifyGetUserMediaError(err)
    expect(result.kind).toBe('no-camera')
    expect(result.message).toMatch(/upload/i)
  })

  it('classifies OverconstrainedError as no-camera', () => {
    const err = new DOMException('constraints', 'OverconstrainedError')
    expect(classifyGetUserMediaError(err).kind).toBe('no-camera')
  })

  it('classifies NotReadableError as device-error', () => {
    const err = new DOMException('busy', 'NotReadableError')
    const result = classifyGetUserMediaError(err)
    expect(result.kind).toBe('device-error')
    expect(result.message).toMatch(/upload/i)
  })

  it('classifies AbortError as device-error', () => {
    const err = new DOMException('aborted', 'AbortError')
    expect(classifyGetUserMediaError(err).kind).toBe('device-error')
  })

  it('classifies an unrecognized error as unknown', () => {
    const err = new DOMException('mystery', 'SomeOtherError')
    const result = classifyGetUserMediaError(err)
    expect(result.kind).toBe('unknown')
    expect(result.message).toMatch(/upload/i)
  })

  it('classifies a non-Error value as unknown without throwing', () => {
    const result = classifyGetUserMediaError('not an error')
    expect(result.kind).toBe('unknown')
    expect(result.message.length).toBeGreaterThan(0)
  })
})

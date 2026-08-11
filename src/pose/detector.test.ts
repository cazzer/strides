import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createMoveNetDetectorMock } = vi.hoisted(() => ({
  createMoveNetDetectorMock: vi.fn(),
}))

vi.mock('./backends/movenet', () => ({
  createMoveNetDetector: createMoveNetDetectorMock,
}))

import { createDetector } from './detector'
import type { PoseDetector } from './detector'

beforeEach(() => {
  createMoveNetDetectorMock.mockReset()
})

describe('createDetector', () => {
  it('resolves a MoveNet-backed detector for backend: "movenet"', async () => {
    const fakeDetector: PoseDetector = {
      estimatePose: vi.fn(),
      dispose: vi.fn(),
    }
    createMoveNetDetectorMock.mockResolvedValue(fakeDetector)

    const detector = await createDetector({ backend: 'movenet' })

    expect(detector).toBe(fakeDetector)
    expect(createMoveNetDetectorMock).toHaveBeenCalledTimes(1)
  })

  it('defaults to the movenet backend when no config is given', async () => {
    const fakeDetector: PoseDetector = {
      estimatePose: vi.fn(),
      dispose: vi.fn(),
    }
    createMoveNetDetectorMock.mockResolvedValue(fakeDetector)

    const detector = await createDetector()

    expect(detector).toBe(fakeDetector)
  })

  it('throws synchronously for an unknown backend', () => {
    expect(() =>
      createDetector({ backend: 'blazepose' as unknown as 'movenet' }),
    ).toThrow(/unknown pose detector backend/i)
    expect(createMoveNetDetectorMock).not.toHaveBeenCalled()
  })
})

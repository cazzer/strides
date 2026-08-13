import { vi } from 'vitest'

/**
 * jsdom doesn't ship a native canvas implementation, so `HTMLCanvasElement.getContext('2d')`
 * returns `null` — this repo deliberately doesn't add the `canvas` npm package (a real
 * CI/sandbox risk, being a native binary dependency). `skeletonGeometry.ts`'s pure functions are
 * unit-tested with zero canvas involvement for exactly this reason; this helper exists only for
 * a thin smoke test confirming `SkeletonOverlay` wires that pure logic into real draw calls.
 */
export interface FakeCanvasRenderingContext2D {
  clearRect: ReturnType<typeof vi.fn>
  beginPath: ReturnType<typeof vi.fn>
  arc: ReturnType<typeof vi.fn>
  moveTo: ReturnType<typeof vi.fn>
  lineTo: ReturnType<typeof vi.fn>
  stroke: ReturnType<typeof vi.fn>
  fill: ReturnType<typeof vi.fn>
  save: ReturnType<typeof vi.fn>
  restore: ReturnType<typeof vi.fn>
  drawImage: ReturnType<typeof vi.fn>
  globalAlpha: number
  strokeStyle: string
  fillStyle: string
  lineWidth: number
}

/** Stubs `HTMLCanvasElement.prototype.getContext` to return a fake 2D context (a plain object
 * of `vi.fn()`s) for every canvas — good enough for a wiring smoke test, not a real renderer. */
export function stubCanvas2DContext(): FakeCanvasRenderingContext2D {
  const ctx: FakeCanvasRenderingContext2D = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    drawImage: vi.fn(),
    globalAlpha: 1,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
  }

  HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
    return contextId === '2d' ? ctx : null
  }) as HTMLCanvasElement['getContext']

  return ctx
}

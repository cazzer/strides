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
  /** Used by the evidence annotation layer, which dashes its construction lines. */
  setLineDash: ReturnType<typeof vi.fn>
  globalAlpha: number
  /** Recorded so a test can prove the photographic layers composite, rather than replace. */
  globalCompositeOperation: string
  strokeStyle: string
  fillStyle: string
  lineWidth: number
  lineCap: string
  lineJoin: string
}

/** A fresh fake 2D context: a plain object of `vi.fn()`s with the default drawing state. */
export function createFakeCanvas2DContext(): FakeCanvasRenderingContext2D {
  return {
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
    setLineDash: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
  }
}

/** Stubs `HTMLCanvasElement.prototype.getContext` to return a fake 2D context (a plain object
 * of `vi.fn()`s) for every canvas — good enough for a wiring smoke test, not a real renderer.
 * Every canvas shares the ONE context returned; `stubPerCanvas2DContexts` gives each its own. */
export function stubCanvas2DContext(): FakeCanvasRenderingContext2D {
  const ctx = createFakeCanvas2DContext()

  HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
    return contextId === '2d' ? ctx : null
  }) as HTMLCanvasElement['getContext']

  return ctx
}

/**
 * Stubs `getContext` so that each canvas gets its OWN fake 2D context, created on first request,
 * and returns the canvas-to-context map in creation order — for a test that has to tell apart what
 * was drawn onto which canvas. `onCreate` sees each context before anything can draw on it.
 */
export function stubPerCanvas2DContexts(
  onCreate?: (ctx: FakeCanvasRenderingContext2D, canvas: HTMLCanvasElement) => void,
): Map<HTMLCanvasElement, FakeCanvasRenderingContext2D> {
  const contexts = new Map<HTMLCanvasElement, FakeCanvasRenderingContext2D>()
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string) {
    if (contextId !== '2d') return null
    let ctx = contexts.get(this)
    if (ctx === undefined) {
      ctx = createFakeCanvas2DContext()
      contexts.set(this, ctx)
      onCreate?.(ctx, this)
    }
    return ctx
  } as HTMLCanvasElement['getContext']
  return contexts
}

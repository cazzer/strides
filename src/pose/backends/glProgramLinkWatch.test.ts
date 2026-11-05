import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { watchProgramLinks } from './glProgramLinkWatch'

/** jsdom has no WebGL; a minimal stand-in whose programs carry their own link result. */
class FakeGL {
  readonly LINK_STATUS = 0x8b82
  linkProgram(program: { ok: boolean }): void {
    void program
  }
  getProgramParameter(program: { ok: boolean }): boolean {
    return program.ok
  }
}

const g = globalThis as unknown as Record<string, unknown>
let originalLink: unknown

beforeEach(() => {
  g.WebGL2RenderingContext = FakeGL
  originalLink = FakeGL.prototype.linkProgram
})

afterEach(() => {
  delete g.WebGL2RenderingContext
})

describe('watchProgramLinks', () => {
  it('counts failed links while open and ignores successful ones', () => {
    const watch = watchProgramLinks()
    const gl = new FakeGL()
    gl.linkProgram({ ok: true })
    gl.linkProgram({ ok: false })
    gl.linkProgram({ ok: false })
    expect(watch.failures()).toBe(2)
    watch.stop()
  })

  it('stops counting once stopped and restores the original linkProgram', () => {
    const watch = watchProgramLinks()
    expect(FakeGL.prototype.linkProgram).not.toBe(originalLink)
    watch.stop()
    expect(FakeGL.prototype.linkProgram).toBe(originalLink)
    new FakeGL().linkProgram({ ok: false })
    expect(watch.failures()).toBe(0)
  })

  it('credits every open watch and keeps the wrap until the last one stops', () => {
    const outer = watchProgramLinks()
    const inner = watchProgramLinks()
    new FakeGL().linkProgram({ ok: false })
    inner.stop()
    expect(FakeGL.prototype.linkProgram).not.toBe(originalLink)
    new FakeGL().linkProgram({ ok: false })
    expect(inner.failures()).toBe(1)
    expect(outer.failures()).toBe(2)
    outer.stop()
    expect(FakeGL.prototype.linkProgram).toBe(originalLink)
  })

  it('is a harmless no-op where WebGL does not exist', () => {
    delete g.WebGL2RenderingContext
    const watch = watchProgramLinks()
    expect(watch.failures()).toBe(0)
    watch.stop()
    watch.stop()
  })
})

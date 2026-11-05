/**
 * Counts WebGL program link failures while a watch is open (strides-p1qt.22).
 *
 * MediaPipe's GPU delegate builds its kernels as WebGL programs and never surfaces a failed link:
 * on Adreno 660 one segmentation-head kernel fails to link (empty info log), every draw with it
 * then raises GL_INVALID_OPERATION, and the person masks come out as garbage while the call still
 * "succeeds". A failed link is the one deterministic signal the page can see, so this wraps
 * `linkProgram` on the WebGL prototypes for the duration of a watch and asks each linked program
 * for its LINK_STATUS. The wrap is removed when the last open watch stops, so nothing outside a
 * watch pays for the extra status query.
 *
 * Any failure counts, whoever linked the program. A foreign failure inside the window can only
 * push a caller onto its safe fallback, never the other way.
 */
export interface ProgramLinkWatch {
  /** Link failures seen since this watch opened. */
  failures(): number
  /** Closes this watch; idempotent. */
  stop(): void
}

type LinkProgram = (this: WebGLRenderingContext | WebGL2RenderingContext, program: WebGLProgram) => void

interface Counter {
  count: number
}

const open = new Set<Counter>()
const originals = new Map<{ prototype: { linkProgram: LinkProgram } }, LinkProgram>()

function contextClasses(): Array<{ prototype: { linkProgram: LinkProgram } }> {
  const classes: Array<{ prototype: { linkProgram: LinkProgram } }> = []
  if (typeof WebGL2RenderingContext !== 'undefined') classes.push(WebGL2RenderingContext as never)
  if (typeof WebGLRenderingContext !== 'undefined') classes.push(WebGLRenderingContext as never)
  return classes
}

function install(): void {
  for (const ctor of contextClasses()) {
    if (originals.has(ctor)) continue
    const original = ctor.prototype.linkProgram
    originals.set(ctor, original)
    ctor.prototype.linkProgram = function (program) {
      original.call(this, program)
      if (open.size > 0 && this.getProgramParameter(program, this.LINK_STATUS) === false) {
        for (const counter of open) counter.count += 1
      }
    }
  }
}

function uninstall(): void {
  for (const [ctor, original] of originals) ctor.prototype.linkProgram = original
  originals.clear()
}

export function watchProgramLinks(): ProgramLinkWatch {
  const counter: Counter = { count: 0 }
  if (open.size === 0) install()
  open.add(counter)
  let stopped = false
  return {
    failures: () => counter.count,
    stop() {
      if (stopped) return
      stopped = true
      open.delete(counter)
      if (open.size === 0) uninstall()
    },
  }
}

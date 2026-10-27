import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MOSTLY_VISIBLE_MIN_HEIGHT, useMostlyVisible } from './useMostlyVisible'

interface Observed {
  callback: IntersectionObserverCallback
  target: Element | null
  /** How many times `observe` was called (observing again delivers a fresh entry). */
  observes: number
}

function stubObserver(): Observed[] {
  const observed: Observed[] = []
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      record: Observed
      constructor(callback: IntersectionObserverCallback) {
        this.record = { callback, target: null, observes: 0 }
        observed.push(this.record)
      }
      observe(target: Element) {
        this.record.target = target
        this.record.observes += 1
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return []
      }
    },
  )
  return observed
}

/**
 * Delivers one entry: `ratio` of the element on screen, `height` px of it, in a `viewport` px root.
 * The element's own height defaults to what the ratio implies (200 px when nothing is on screen).
 */
function report(
  observed: Observed[],
  ratio: number,
  height = 200 * ratio,
  viewport = 800,
  elementHeight = ratio > 0 ? height / ratio : 200,
) {
  act(() => {
    for (const { callback, target } of observed) {
      callback(
        [
          {
            intersectionRatio: ratio,
            intersectionRect: { height },
            boundingClientRect: { height: elementHeight },
            rootBounds: { height: viewport },
            target,
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      )
    }
  })
}

function Harness({ selector, onVisible }: { selector?: string; onVisible: (visible: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  onVisible(useMostlyVisible(ref, selector))
  return (
    <div ref={ref} data-testid="rail">
      <figure>
        <svg data-testid="drawing" />
      </figure>
      <p>legend</p>
    </div>
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('useMostlyVisible', () => {
  it('observes the selected element inside the container, and is true from 90% on screen', () => {
    const observed = stubObserver()
    const seen: boolean[] = []
    const { getByTestId } = render(<Harness selector="figure svg" onVisible={(v) => seen.push(v)} />)
    expect(observed.map(({ target }) => target)).toEqual([getByTestId('drawing')])
    expect(seen.at(-1)).toBe(false)
    report(observed, 0.89)
    expect(seen.at(-1)).toBe(false)
    report(observed, 0.9)
    expect(seen.at(-1)).toBe(true)
  })

  it('falls back to the container when nothing matches the selector', () => {
    const observed = stubObserver()
    const { getByTestId } = render(<Harness selector="canvas" onVisible={() => {}} />)
    expect(observed[0].target).toBe(getByTestId('rail'))
  })

  it('counts an element taller than the viewport once it fills 90% of it', () => {
    const observed = stubObserver()
    const seen: boolean[] = []
    render(<Harness onVisible={(v) => seen.push(v)} />)
    report(observed, 0.5, 760, 800)
    expect(seen.at(-1)).toBe(true)
  })

  it('never counts a zero-height element, which an IntersectionObserver reports as wholly on screen', () => {
    const observed = stubObserver()
    const seen: boolean[] = []
    render(<Harness selector="figure svg" onVisible={(v) => seen.push(v)} />)
    // What Chrome reports for a zero-area SVG inside the viewport (strides-xsl3).
    report(observed, 1, 0, 800, 0)
    expect(seen.at(-1)).toBe(false)
  })

  it(`needs the element to be at least ${MOSTLY_VISIBLE_MIN_HEIGHT} px tall`, () => {
    const observed = stubObserver()
    const seen: boolean[] = []
    render(<Harness selector="figure svg" onVisible={(v) => seen.push(v)} />)
    report(observed, 1, MOSTLY_VISIBLE_MIN_HEIGHT - 1, 800, MOSTLY_VISIBLE_MIN_HEIGHT - 1)
    expect(seen.at(-1)).toBe(false)
    report(observed, 1, MOSTLY_VISIBLE_MIN_HEIGHT, 800, MOSTLY_VISIBLE_MIN_HEIGHT)
    expect(seen.at(-1)).toBe(true)
    // The floor applies to the fill-the-viewport rule too.
    report(observed, 1, 100, 100, 100)
    expect(seen.at(-1)).toBe(false)
  })

  it('re-reads the element when it resizes, as growing from 0 px while on screen crosses no threshold', () => {
    const observed = stubObserver()
    const resizes: ResizeObserverCallback[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resizes.push(callback)
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    const seen: boolean[] = []
    render(<Harness selector="figure svg" onVisible={(v) => seen.push(v)} />)
    expect(observed[0].observes).toBe(1)
    report(observed, 1, 0, 800, 0)
    expect(seen.at(-1)).toBe(false)
    // The figure gets its room: the hook observes it again, and the fresh entry counts.
    act(() => resizes[0]([], {} as ResizeObserver))
    expect(observed[0].observes).toBe(2)
    report(observed, 1, 219, 548, 219)
    expect(seen.at(-1)).toBe(true)
  })

  it('is true where IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const seen: boolean[] = []
    render(<Harness onVisible={(v) => seen.push(v)} />)
    expect(seen.at(-1)).toBe(true)
  })
})

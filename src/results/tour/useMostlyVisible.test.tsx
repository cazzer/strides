import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMostlyVisible } from './useMostlyVisible'

interface Observed {
  callback: IntersectionObserverCallback
  target: Element | null
}

function stubObserver(): Observed[] {
  const observed: Observed[] = []
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      record: Observed
      constructor(callback: IntersectionObserverCallback) {
        this.record = { callback, target: null }
        observed.push(this.record)
      }
      observe(target: Element) {
        this.record.target = target
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

function report(observed: Observed[], ratio: number, height = 100 * ratio, viewport = 800) {
  act(() => {
    for (const { callback, target } of observed) {
      callback(
        [
          {
            intersectionRatio: ratio,
            intersectionRect: { height },
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

  it('is true where IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const seen: boolean[] = []
    render(<Harness onVisible={(v) => seen.push(v)} />)
    expect(seen.at(-1)).toBe(true)
  })
})

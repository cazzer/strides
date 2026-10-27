import { act, fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TourStopId } from '../../guidance/focusAreas'
import { READING_LINE_FRACTION, useActiveStop } from './useActiveStop'

const IDS: TourStopId[] = ['rhythm', 'knees', 'oneThing']

function Harness({ ids = IDS, onActive }: { ids?: TourStopId[]; onActive: (id: TourStopId | null) => void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const active = useActiveStop(rootRef, ids)
  onActive(active)
  return (
    <>
      {/* Outside the root: never selected, however it is placed. */}
      <section data-tour-stop="landing" data-top="0" tabIndex={-1}>
        outside
      </section>
      <div ref={rootRef}>
        {ids.map((id) => (
          <section key={id} data-tour-stop={id} tabIndex={-1}>
            <a href="#x">{id} link</a>
          </section>
        ))}
      </div>
    </>
  )
}

/** Places each stop's top at the given offset from the viewport top. */
function placeStops(tops: Record<string, number>) {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const top = tops[this.dataset.tourStop ?? ''] ?? 10_000
    return { top, bottom: top + 400, left: 0, right: 0, width: 0, height: 400, x: 0, y: top, toJSON: () => ({}) }
  }
}

const originalRect = HTMLElement.prototype.getBoundingClientRect
const line = () => window.innerHeight * READING_LINE_FRACTION

beforeEach(() => {
  // One frame per schedule, run at once, so a scroll reads the line synchronously.
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = originalRect
  vi.unstubAllGlobals()
})

describe('useActiveStop', () => {
  it('is null while the first stop is still below the reading line', () => {
    placeStops({ rhythm: line() + 1, knees: line() + 600, oneThing: line() + 1200 })
    const seen: Array<TourStopId | null> = []
    render(<Harness onActive={(id) => seen.push(id)} />)
    expect(seen.at(-1)).toBeNull()
  })

  it('is the last stop whose top has reached the line, re-read on scroll', () => {
    placeStops({ rhythm: line(), knees: line() + 1, oneThing: line() + 600 })
    const seen: Array<TourStopId | null> = []
    render(<Harness onActive={(id) => seen.push(id)} />)
    expect(seen.at(-1)).toBe('rhythm')

    placeStops({ rhythm: -800, knees: line() - 10, oneThing: line() + 400 })
    act(() => {
      fireEvent.scroll(window)
    })
    expect(seen.at(-1)).toBe('knees')

    placeStops({ rhythm: -1600, knees: -800, oneThing: 0 })
    act(() => {
      fireEvent(window, new Event('resize'))
    })
    expect(seen.at(-1)).toBe('oneThing')
  })

  it('selects the stop that receives keyboard focus', () => {
    placeStops({})
    const seen: Array<TourStopId | null> = []
    const { getByText } = render(<Harness onActive={(id) => seen.push(id)} />)
    expect(seen.at(-1)).toBeNull()
    act(() => getByText('knees link').focus())
    expect(seen.at(-1)).toBe('knees')
  })

  it('ignores stops outside its root', () => {
    placeStops({ landing: 0 })
    const seen: Array<TourStopId | null> = []
    const { getByText } = render(<Harness onActive={(id) => seen.push(id)} />)
    expect(seen.at(-1)).toBeNull()
    act(() => (getByText('outside') as HTMLElement).focus())
    expect(seen.at(-1)).toBeNull()
  })

  it('reads the line again when the root resizes (a stop above changed height)', () => {
    const observers: Array<() => void> = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          observers.push(callback)
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    )
    placeStops({ rhythm: line() + 1 })
    const seen: Array<TourStopId | null> = []
    render(<Harness onActive={(id) => seen.push(id)} />)
    expect(seen.at(-1)).toBeNull()
    placeStops({ rhythm: line() - 1 })
    act(() => observers.forEach((callback) => callback()))
    expect(seen.at(-1)).toBe('rhythm')
  })

  it('stops listening once unmounted', () => {
    placeStops({})
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(<Harness onActive={() => {}} />)
    unmount()
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function))
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
    remove.mockRestore()
  })

  it('keeps the line below the tour’s sticky bar where the bar reaches past 42% (a short phone)', () => {
    // A bar that sticks at 300 px and is 54 px tall ends at 354 px, past 42% of jsdom's 768 px
    // (322.6 px). The line moves to a quarter of the way down the rest: 354 + 414 / 4 = 457.5 px.
    function WithBar({ onActive }: { onActive: (id: TourStopId | null) => void }) {
      const rootRef = useRef<HTMLDivElement>(null)
      onActive(useActiveStop(rootRef, IDS))
      return (
        <div ref={rootRef}>
          <div className="runner-tour__header" style={{ position: 'sticky', top: '300px' }} />
          {IDS.map((id) => (
            <section key={id} data-tour-stop={id} />
          ))}
        </div>
      )
    }
    const tops: Record<string, number> = { rhythm: 356, knees: 768, oneThing: 1100 }
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const bar = this.classList.contains('runner-tour__header')
      // Where the bar is now (scrolled away, say) does not matter: where it sticks does.
      const top = bar ? -500 : (tops[this.dataset.tourStop ?? ''] ?? 10_000)
      const height = bar ? 54 : 400
      return { top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) }
    }
    expect(line()).toBeLessThan(356)
    const seen: Array<TourStopId | null> = []
    render(<WithBar onActive={(id) => seen.push(id)} />)
    // The first stop at rest, its top just under the bar: active, though below 42%.
    expect(seen.at(-1)).toBe('rhythm')

    tops.rhythm = -50
    tops.knees = 458
    act(() => {
      fireEvent.scroll(window)
    })
    expect(seen.at(-1)).toBe('rhythm')
    tops.knees = 457
    act(() => {
      fireEvent.scroll(window)
    })
    expect(seen.at(-1)).toBe('knees')
  })
})

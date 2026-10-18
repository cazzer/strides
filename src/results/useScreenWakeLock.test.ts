import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useScreenWakeLock } from './useScreenWakeLock'

function installWakeLock(request: (type: 'screen') => Promise<unknown>) {
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })
}

function makeSentinel() {
  const sentinel = {
    released: false,
    release: vi.fn(async () => {
      sentinel.released = true
    }),
  }
  return sentinel
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

afterEach(() => {
  // @ts-expect-error -- removing the test double
  delete navigator.wakeLock
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

describe('useScreenWakeLock', () => {
  it('requests a screen lock while active and releases it when no longer active', async () => {
    const sentinel = makeSentinel()
    const request = vi.fn(async () => sentinel)
    installWakeLock(request)

    const { rerender } = renderHook(({ active }) => useScreenWakeLock(active), {
      initialProps: { active: true },
    })
    await act(async () => {})
    expect(request).toHaveBeenCalledWith('screen')

    rerender({ active: false })
    expect(sentinel.release).toHaveBeenCalledTimes(1)
  })

  it('requests nothing while inactive', async () => {
    const request = vi.fn(async () => makeSentinel())
    installWakeLock(request)
    renderHook(() => useScreenWakeLock(false))
    await act(async () => {})
    expect(request).not.toHaveBeenCalled()
  })

  it('re-acquires when the page becomes visible again, since hiding releases the lock', async () => {
    const first = makeSentinel()
    const second = makeSentinel()
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    installWakeLock(request)
    renderHook(() => useScreenWakeLock(true))
    await act(async () => {})

    first.released = true // what the browser does when the page is hidden
    await act(async () => setVisibility('hidden'))
    expect(request).toHaveBeenCalledTimes(1)
    await act(async () => setVisibility('visible'))
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('is a silent no-op without the API, and swallows a refused request', async () => {
    expect(() => renderHook(() => useScreenWakeLock(true))).not.toThrow()

    installWakeLock(vi.fn(async () => Promise.reject(new DOMException('denied', 'NotAllowedError'))))
    const { unmount } = renderHook(() => useScreenWakeLock(true))
    await act(async () => {})
    unmount()
  })

  it('releases a lock that arrives after it stopped being wanted', async () => {
    const sentinel = makeSentinel()
    let resolve: (value: typeof sentinel) => void = () => {}
    installWakeLock(() => new Promise((r) => (resolve = r)))
    const { rerender } = renderHook(({ active }) => useScreenWakeLock(active), {
      initialProps: { active: true },
    })
    rerender({ active: false })
    await act(async () => resolve(sentinel))
    expect(sentinel.release).toHaveBeenCalledTimes(1)
  })
})

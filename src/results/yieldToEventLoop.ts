/**
 * Resolves on a fresh macrotask, so the browser gets a turn to paint and handle input before the
 * caller continues.
 *
 * Exists because a loop of `await`s whose promises are already settled never leaves the microtask
 * queue: on a Galaxy S21 the sequential sampler ran as single RunMicrotasks tasks of 3-4 s, during
 * which the page could neither paint nor take a tap (strides-6i6.1).
 *
 * `scheduler.yield()` where the browser has it (it keeps the continuation's priority); otherwise a
 * `MessageChannel` round trip, which unlike `setTimeout(0)` is neither clamped to 4 ms after nested
 * calls nor throttled in a background tab.
 */
export function yieldToEventLoop(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (typeof scheduler?.yield === 'function') return scheduler.yield()
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}

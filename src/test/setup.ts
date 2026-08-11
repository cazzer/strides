import '@testing-library/jest-dom/vitest'

// jsdom's HTMLMediaElement is a stub: .load()/.play() throw "Not implemented"
// unless overridden, and URL.createObjectURL/revokeObjectURL don't exist.
// Video tests drive state manually (Object.defineProperty + dispatchEvent),
// so these just need to not throw.
HTMLMediaElement.prototype.load = () => {}
HTMLMediaElement.prototype.play = () => Promise.resolve()

if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:mock-url'
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = () => {}
}

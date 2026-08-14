import { useRef } from 'react'
import { usePoseDetector } from './pose/usePoseDetector'
import { MultiClipVideoSession } from './results/MultiClipVideoSession'

export function App() {
  const poseDetector = usePoseDetector()

  // "Choose a different video" (now a whole-session reset) unmounts the results column and
  // hides every video element, so the button's focus needs to land on something that survives
  // the transition back to the picker — the page heading. Same fix already applied once for the
  // single-clip flow (WebcamCapture, #4); MultiClipVideoSession now owns the reset logic but the
  // heading itself stays here, in the header it belongs to.
  const headingRef = useRef<HTMLHeadingElement>(null)

  return (
    <>
      <header className="sticky top-0 z-10 border-b-2 border-black dark:border-white bg-white dark:bg-black px-4 sm:px-6 py-4">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-2xl font-bold tracking-tight focus:outline-none"
        >
          Strides
        </h1>
        <p className="font-sans text-sm text-neutral-600 dark:text-neutral-400">
          Browser-based running form analysis.
        </p>
      </header>
      <MultiClipVideoSession detector={poseDetector.detector} headingRef={headingRef} />
    </>
  )
}

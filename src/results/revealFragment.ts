import { useEffect } from 'react'
import type { RefObject } from 'react'

/**
 * Opens every closed `<details>` between `target` and the document root. Returns whether any was
 * closed, i.e. whether the target was hidden until now.
 */
export function openAncestors(target: Element): boolean {
  let opened = false
  for (
    let details = target.parentElement?.closest('details');
    details;
    details = details.parentElement?.closest('details')
  ) {
    if (!details.open) {
      details.open = true
      opened = true
    }
  }
  return opened
}

/**
 * The fragment this page session has already revealed — on a mount or a hash change (a contents-list
 * click causes one, unless it names the fragment already in the address, which is handled already).
 *
 * The guided measurements mount again every time an analysis reaches ready (adding a clip) and every
 * time the view is toggled back from classic, and the toggle keeps the hash. Revealing the hash on
 * each of those mounts would scroll the page back to a card the reader left long ago. So a mount
 * reveals a fragment only the first time the page session sees it, and never moves focus: focus
 * moves only when the reader asks for a card, by a hash change or a contents-list click.
 *
 * Module scope, because the component's own state dies with the very remount this has to survive.
 */
let handledHash: string | null = null

/** The element a fragment names, if it is inside `root`. */
function fragmentTarget(
  root: HTMLElement | null,
  hash: string,
): HTMLElement | null {
  if (root === null || hash.length <= 1) return null
  let id: string
  try {
    id = decodeURIComponent(hash.slice(1))
  } catch {
    return null
  }
  const target = document.getElementById(id)
  return target !== null && root.contains(target) ? target : null
}

/**
 * Reveals a card's fragment inside `rootRef`. On mount, a fragment this page session has not
 * revealed yet (typically a shared link, whose card did not exist when the browser tried to scroll
 * to it) is opened and scrolled to, and focus stays where it is: nobody asked for it on this mount,
 * and the reader may be on a view control. A later hash change is the reader asking for a card, so
 * its closed `<details>` ancestors open and focus moves to it. See `handledHash`.
 *
 * Call it once per mounted guided body, on the element that holds the cards.
 */
export function useRevealFragment(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const hash = window.location.hash
    const target = fragmentTarget(rootRef.current, hash)
    if (target !== null && hash !== handledHash) {
      handledHash = hash
      openAncestors(target)
      target.scrollIntoView?.({ block: 'start' })
    }
    // A hash change is the reader asking for a card. The browser already scrolled to a visible
    // target; one it could not see needs doing here.
    const onHashChange = () => {
      const current = window.location.hash
      const next = fragmentTarget(rootRef.current, current)
      if (next === null) return
      handledHash = current
      if (openAncestors(next)) next.scrollIntoView?.({ block: 'start' })
      next.focus({ preventScroll: true })
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [rootRef])
}

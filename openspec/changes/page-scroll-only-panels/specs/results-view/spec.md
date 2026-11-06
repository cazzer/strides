## ADDED Requirements

### Requirement: On a phone only the page scrolls

At phone widths (360 to 430 px) no results panel SHALL have a scroll area of its own or a height cap
that clips its content: not a runner-tour stop, the summary or any of its rows and guided cards,
the classic view, the save panel, nor the progress page. A swipe that starts anywhere on the results
SHALL move the page, and the page SHALL NOT scroll horizontally. Two things are exempt: a modal
dialog, whose page behind is inert, and the header's clip strip, which scrolls sideways within its
own bounds. An automated check SHALL fail when a panel regains a scroll of its own at 390 px.

#### Scenario: Every view at 390 px

- **WHEN** the 3-clip demo's results are shown at 390×844, in the tour (every stop), the summary
  with every row open, the classic view, the save panel (connected, then saved) and the progress page
- **THEN** no element outside a modal dialog is a vertical scroll container in the page's main
  content or overflows one anywhere, and the page is no wider than the screen

#### Scenario: A panel regains a scroll

- **WHEN** a results panel is given `overflow-y: auto` or a `max-height` below `lg`
- **THEN** the source check (`noInnerScroll.test.ts`) fails in CI and the 390 px browser check
  (`e2e/phonePageScroll.spec.ts`) fails

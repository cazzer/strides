## Context

A back-fill: every requirement here describes code that shipped in `e382aea` ("Land strides-3f6").
The wording was written by reading that commit and the components it touched, not from intent.

## Decisions

### D1 — ADDED only

Each behaviour is new relative to the spec, and none contradicts an existing requirement:

- "A card shows at most one studied change" says nothing about the line's lead-in words, so the
  choice-framed prefix sits beside it rather than modifying it.
- "A band states where the runner sits, never where they should be" already forbids a target; the
  "Observed, not a target" label is one visible means of meeting it, stated as its own requirement so
  removing the label is a visible spec change.
- The bounce introduction leaves "The guided view ranks metrics into three groups by what can be said
  about them" intact: each bounce metric still renders in the group it belongs to, and the
  introduction only links to it.
- Provenance and evidence-to-video are additions to their capabilities with no prior wording at all.

### D2 — Where each requirement lives

Each goes in the capability that already owns the surface: the guided view's own copy in
`guided-results-view`; the per-metric source clip in `multi-clip-analysis`, next to the
machine-readable source index it is rendered from; the evidence dialog in `results-view`, which owns
evidence thumbnails in both views; and the picker copy in `video-input`, which owns the picker.

### D3 — State behaviour, not copy, except where the copy is the behaviour

Exact strings are quoted only where the words carry the requirement ("Observed, not a target"; the
"If you choose to" framing). Elsewhere the requirement states what the reader must be told and lets
the copy move.

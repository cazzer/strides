# Design

## D1. Why the reuse key moves to the plan, and why that is provably sufficient

`extractSessionEvidence(batch)` receives `ClipEvidenceInput[]`, and that type is exactly
`{ sourceBlob, plan }`. Nothing else reaches the extractor. Its output is therefore a pure function
of those two inputs, and equality of those two inputs is a **sufficient** condition for reuse — not
a heuristic, and not a judgement call about which upstream changes "matter".

The old key (`heuristics`, `frames`, `graftedFrames`, `frameSize`, `sourceBlob`, all by reference)
was a *proxy* for that, and a lossy one in the one direction that costs something: it reports
"different" for changes the extractor cannot observe. The graft is precisely such a change.
`graftScalePassResult` returns `{ ...primary, verticalOscillationCm, stepWidthCm }`, so nine of the
eleven metric objects survive by reference — the information needed to skip the work is already
present, one level down from where the comparison was looking.

`frameSize` drops out of the key rather than being kept for safety: it feeds crop-rectangle
computation, so any change to it is already visible in the plan. Keeping it would assert a
dependency the extractor does not have.

**Two-layer comparison, kept deliberately.** `sameClipInputs`/`sameInputList` survive unchanged as
the effect's every-render early-out: `clips` is rebuilt on every render of the session component, so
that guard runs constantly and must stay cheap (five reference comparisons). The plan comparison is
structural and runs only past it, on the rare renders where something genuinely changed. Replacing
the cheap guard with the structural one would move a deep comparison onto every render for no gain;
replacing the structural one with the cheap one is the bug this change fixes.

**Plans are compared structurally, via `JSON.stringify`.** A plan is pure data — numbers, strings,
booleans, nulls, arrays and plain objects — and both sides are produced by the same
`planClipEvidence` code path, so key insertion order is deterministic and the serialisations are
comparable. `EvidenceFramePlan.side` is the one optional key, and `JSON.stringify` omits it
identically on both sides. The known imprecision is that `NaN` and `-0` serialise to `null` and `0`,
which makes the comparison marginally *more* permissive; neither value is producible here (a plan
carrying `NaN` timestamps would have been rejected upstream), and in both cases the failure mode
would be reusing an image that is identical anyway.

Cost: the comparison runs at most once per clip per genuine input change, against a string on the
order of tens of kilobytes. It is not on a render path.

## D2. Why the cache stores the plan it extracted from

The reuse decision needs the plan the cached images were actually produced from. Reconstructing it
from the cached `ClipEvidence` via `settledPlan` would round-trip through the extraction result and
re-derive the plan from the items that survived — which is the same value only when extraction
succeeded for every planned metric. Storing the plan beside the evidence states the relationship
directly, and it is the same object the batch was built from, so it costs one reference.

## D3. Why `extracting` carries sections rather than the consumer holding the last good value

Two places could hold the previous sections: the hook's state, or `MultiClipVideoSession` keeping a
ref to the last non-empty value. The hook is the right owner because it is the only layer that knows
*why* the sections went away — a re-extraction on an unchanged clip set (carry them) is not the same
event as a session reset or a clip being removed (do not). A consumer holding "the last thing I
saw" cannot distinguish those, and would keep rendering a removed clip's imagery.

Making `sections` a field of `extracting` rather than a separate `previousSections` slot also means
the consumer cannot accidentally read the two out of step: every non-idle state carries exactly one
sections array, and it is always the right one to render.

## D4. Why the clip set gates the carry-forward

`EvidenceSection.clipIndex` is a **position** in the session's clip list, and it drives the card's
"From clip N of M" attribution. Removing a clip shifts every later index, so carrying sections
across that change would attribute an image to the wrong clip — a false statement about the runner's
footage, which is exactly the class of error the annotation rules elsewhere in this spec exist to
prevent. Appending a clip happens to leave existing indices intact, but the guard does not special-
case it: "same clip ids, same order" is one condition that is obviously correct, where "appended
only" is a second code path to get wrong for a benefit measured in one render.

## D5. What this deliberately does not fix

**Per-metric extraction granularity.** When a graft genuinely changes a plan — Demo 1, where
`verticalOscillationCm` moves from `metric-excluded` to `planned` — the whole clip is still
re-extracted, including the nine metrics whose plans did not change. Fixing that means splitting one
clip's plan into an extract-these/reuse-those pair and merging the results, which is a real change
to the extractor's batch contract. It is no longer user-visible once evidence stays on screen, so it
is filed as follow-up work rather than bundled into a fix for the flicker.

**The second `[evidence-coverage]` line.** Where a plan genuinely changes, a second line is still
emitted, and the documented harness guidance (take the LAST line) is unchanged. Where the plan does
not change, the second line is now emitted from fully-reused evidence and is byte-identical to the
first — as it was before, but without the decode behind it.

## D6. Verification

The defect is invisible on both demo clips (see the proposal's race), so a live check must use a
clip long enough that the scale pass finishes after the first extraction settles. The reproduction
used `park-approach.mp4` concatenated eight times with `ffmpeg -f concat -c copy` (13.2 s), uploaded
through the Upload tab, with a DOM poll counting canvases inside `main` at 100 ms and the two
console lines timestamped against it.

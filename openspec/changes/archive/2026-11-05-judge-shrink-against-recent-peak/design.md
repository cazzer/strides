## Context

See proposal.md. Evidence: strides-p1qt.15's per-frame probe traces
(`strides-p1qt.15/traces/*-v4.json` in the second-runner baseline under `fixtures-private/`, whose online behaviour equals
25bea2a1), an offline replica of retroactive segmentation run over them
(`strides-p1qt.18/sim.mjs`, same place), driver screens, and the final gate.

IMG_9345's exit, frame by frame (emitted box, `[minX, …]` in a 3840-wide frame):

| f | area | minX | who |
|---|---|---|---|
| 108 | 242k | 71 | runner |
| 109 | 244k | 24 | runner, reaching the left edge |
| 110–114 | 163k → 97k | 26 → 8 | runner, truncated by the left edge |
| 115 | 45k | 76 | background runner (fully in frame), within 3× of 97k |
| 116–134 | 53k → 11k | | background runner, then he exits too |

## Decisions

### D1. Shrinkage is judged against the recent peak; growth frame to frame

Every cause of an undersized box (edge truncation, occlusion, keypoints below the confidence floor)
only shrinks it. So the largest box a track produced in the last 0.5 s is the measure of how big
that person is, and a box more than `maxAreaRatio` below it is not them. Growth keeps the existing
frame-to-frame test, so approaching and entering runners are untouched. Reuse `maxAreaRatio`; the
only new number is the window.

### D2. A box truncated by the frame edge is exempt

Without the exemption, the offline replica cut each runner's OWN last one or two exit frames on
9346, 9347, IMG_9117 and side-portrait. A hull stopping 7–31 px from the edge is a body cut off by
it, and the edge already explains why it is small. The intruder at 9345 f115 sits 76 px in.
Margin: 2% of the shorter frame side (43 px at 4K, 22 px at 1080). With the exemption, the replica
changes the winning segment on 9345 only. Its other new cuts (side-landscape f30/f76, multiperson
f23/f74) fall inside the fence walker's collapsing pre-runner boxes, in losing segments.

### D3. Not a floor

This is a continuity rule between consecutive detections of one track. It drops nothing on its
own: it cuts a boundary, and integrated area still decides the winner. The 4K area floor's closed
decision (`area-floor.md`: phantoms and collapsed subjects overlap in size within one clip) is
untouched. That finding is also why the rule needs a time window and the splice tolerance (a single
collapsed frame is still bridged): the peak is recent and per-track, not a global size.

### D4. Retroactive only by default; online available but off

The same rule is wired into the online continuity gate (per-identity anchor history, emptied on
every identity change). Measured (gate 348a5dac, both on): it adds nothing on IMG_9345. On the
twins, side-landscape starts 1.667 → 1.550 s (+7 frames) and multiperson 1.600 → 1.567 s (+2), and
multiperson's cadence/VO/VR fall from normal to caveated. With only the retroactive window, every
other clip is value-identical to the reference. Ships online `0`, overridable for a future A/B.

## Measurement

Final gate (commit c9af3a79, `--evidence --scale-pass --outline-pass --perf`, fresh process, under
the gate lock), against the strides-p1qt.15 gate (78a6ccb9, value-identical to 25bea2a1):

| clip | change |
|---|---|
| IMG_9345 | winner f13–114 (was f13–134): 102 frames (was 122); cadence withheld → **188.4** (GT 190 ±3); VO withheld → 0.167; VR withheld → 0.032; cadence/VO/VR tiers excluded → normal |
| IMG_9346, 9347, 9348, 9349, front-approach | bit-identical |
| side-landscape, side-portrait, multiperson, IMG_9117 | every metric value identical; only losing-segment diagnostics differ (`segmentCount` etc.) |

## Risks / Trade-offs

- A track that genuinely shrinks >3× within 0.5 s while fully in frame would be cut. Running
  speeds can't do that in depth: the fastest measured approach, IMG_9349, grows ~15× over 3.4 s,
  ≈1.5× per 0.5 s. A run of ≥2 consecutive collapsed detections also now cuts (one is still
  bridged), and the collapse literature here (`area-floor.md`) records single-frame collapses.
- The 2% edge margin sits between measured clusters (≤31 px truncated, ≥76 px not) at 4K, about
  1.4× of headroom on the truncated side.

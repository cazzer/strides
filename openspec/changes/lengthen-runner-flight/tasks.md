## 1. Gait model

- [x] 1.1 `GAIT_PHASES`: `stanceEnd` 0.30, `midStance` 0.15, `peakThigh` 0.78; doc comment on the 0.20 flight
- [x] 1.2 `FLIGHT_PEAK_PHASE` derived as midway from toe-off to the other contact (0.40)
- [x] 1.3 Swing-thigh key at `rightContact + midStance` (0.65), 0.6 of the way from toe-off to the peak
- [x] 1.4 `STANCE_DROP` doc comment; `LANDING_PHASE_WINDOW` comment (0.512 end-hold sink −0.045)

## 2. Tests

- [x] 2.1 Smoothness: ≤ 1.3× and spread ≤ 0.12b for b ∈ {0.03, 0.07, 0.1, 0.14, 0.17, 0.2, 0.22}; ≤ 1.6× / 0.12b at {0.25, 0.3}; ≤ 1.9× / 0.13b at {0.4, 0.5}; cadence 150/174/190
- [x] 2.2 Phase guards: mid-stance halfway through stance, flight peak a quarter cycle later and the hips' highest sample; bounce keys on the 1/1000 grid; peak thigh, peak swing knee bend and mid-arc with the other leg in stance; swing arc starts after toe-off
- [x] 2.3 `FALLBACK_BOUNDS` measured-worst comment updated, bounds kept
- [x] 2.4 Cadence-beat fixtures: slide sanity bound 0.25; tween test picks the bounce that moves the standing height most

## 3. Sandbox and verification

- [x] 3.1 Sandbox scenarios binding only vertical oscillation at 0.14 and 0.3
- [x] 3.2 Gates: lint, `tsc -b`, vitest (runner, results, full), `vite build`, `openspec validate --strict`
- [x] 3.3 Screenshots: sandbox hip trace at 0.14 and 0.3; real app reduced-motion stops and the landing end hold

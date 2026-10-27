/**
 * Dev-only page for looking at ModelRunner (screenshots at 390 / 1280 px, light / dark, reduced /
 * normal motion). Entry: `src/runner/dev/sandbox.html`, never bundled by `vite build`.
 */
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../index.css'
import { makeHeuristics, makeMetric } from '../../results/__fixtures__/metricResult'
import type { FormHeuristicsResult, MetricId } from '../../heuristics/types'
import { CAMERA_PRESETS } from '../camera'
import { ModelRunner, type RunnerFocus } from '../ModelRunner'
import { bindRunnerParams } from '../runnerParams'
import type { BoundRunnerParams, CameraPreset } from '../types'

function bind(
  measured: readonly MetricId[] | 'all',
  overrides: Partial<FormHeuristicsResult> = {},
): BoundRunnerParams {
  return bindRunnerParams(makeHeuristics(overrides), (metric) =>
    measured === 'all' || measured.includes(metric.metric) ? 'normal' : 'excluded',
  )
}

interface Scenario {
  id: string
  title: string
  params: BoundRunnerParams
  camera: CameraPreset
  focus?: RunnerFocus
  cameraButtons?: boolean
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'all-measured',
    title: 'All measured, whole body',
    params: bind('all'),
    camera: 'wholeBodySide',
    cameraButtons: true,
  },
  {
    id: 'trunk-lean',
    title: 'Half neutral, trunk lean in focus',
    params: bind(['cadence', 'trunkLean', 'kneeFlexion', 'overstriding', 'stepWidth']),
    camera: 'torsoSide',
    focus: { metricIds: ['trunkLean'] },
  },
  {
    id: 'knees',
    title: 'Knee drive and knee flexion',
    params: bind('all'),
    camera: 'legsSide',
    focus: { metricIds: ['kneeDrive', 'kneeFlexion'] },
  },
  {
    id: 'contact',
    title: 'Overstride and foot strike, clamped pair',
    params: bind('all', {
      overstriding: makeMetric('overstriding', { value: 0.05 }),
      footStrikePattern: makeMetric('footStrikePattern', { value: 0.1 }),
    }),
    camera: 'footSide',
    focus: { metricIds: ['overstriding', 'footStrikePattern'] },
  },
  {
    id: 'feet-front',
    title: 'Step width and swing-foot excursion',
    params: bind('all', {
      stepWidth: makeMetric('stepWidth', { value: 0.3 }),
      swingFootLateralExcursion: makeMetric('swingFootLateralExcursion', { value: 0.35 }),
    }),
    camera: 'feetFront',
    focus: { metricIds: ['stepWidth', 'swingFootLateralExcursion'] },
  },
  {
    id: 'bounce',
    title: 'Vertical oscillation and arm swing',
    params: bind('all'),
    camera: 'wholeBodySide',
    focus: { metricIds: ['verticalOscillation', 'armSwingAmplitude'] },
  },
]

const PRESETS = Object.keys(CAMERA_PRESETS) as CameraPreset[]

export function ScenarioView({ scenario }: { scenario: Scenario }) {
  const [camera, setCamera] = useState<CameraPreset>(scenario.camera)
  return (
    <section data-scenario={scenario.id} className="space-y-2 border-2 border-black p-3 dark:border-white">
      <h2 className="font-display text-lg font-bold">{scenario.title}</h2>
      {scenario.cameraButtons && (
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={camera === preset}
              onClick={() => setCamera(preset)}
              className="min-h-11 border border-black px-2 font-sans text-xs aria-pressed:bg-black aria-pressed:text-white dark:border-white dark:aria-pressed:bg-white dark:aria-pressed:text-black"
            >
              {preset}
            </button>
          ))}
        </div>
      )}
      <ModelRunner
        params={scenario.params}
        camera={camera}
        focus={scenario.focus}
        label={`Model runner: ${scenario.title}`}
        className="h-[60vh]"
      />
    </section>
  )
}

export function Sandbox() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <h1 className="font-display text-2xl font-bold">Model runner sandbox</h1>
      {SCENARIOS.map((scenario) => (
        <ScenarioView key={scenario.id} scenario={scenario} />
      ))}
    </main>
  )
}

document.body.className = 'bg-white text-black dark:bg-black dark:text-white'
const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Sandbox />
    </StrictMode>,
  )
}

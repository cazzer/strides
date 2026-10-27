/**
 * The one line that says what a compact band bar is: where other runners measured, not a target.
 * Shared by the results summary (above its rows) and the tour (under its runner), and rendered by
 * each only when one of its bars is on screen.
 */
export function BandLegend({ className = '' }: { className?: string }) {
  return (
    <p className={`font-sans text-xs text-neutral-600 dark:text-neutral-400 ${className}`}>
      Bars: where other runners measured.{' '}
      {/* The shading inverts between themes (MetricScale), so each states its own true word;
          forced colours drop the shading, and the clause with it. */}
      <span className="dark:hidden forced-colors:hidden">Darker = more runners. </span>
      <span className="hidden dark:inline forced-colors:hidden">Brighter = more runners. </span>
      Not a target.
    </p>
  )
}

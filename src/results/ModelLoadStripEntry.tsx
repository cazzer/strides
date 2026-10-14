import type { ModelLoadStripStatus } from './modelLoadStripStatus'

export interface ModelLoadStripEntryProps {
  status: ModelLoadStripStatus
}

/**
 * The model-download entry at the head of the header bar (`strides-utn.5`) — the one place the
 * product admits that a 14.5 MB download is happening. Before this, a loaded clip read *Ready*
 * while the app was blocked on an unmentioned fetch, and a failed download said nothing at all.
 *
 * ### A sibling component, not a mode of `ClipStripEntry`
 *
 * It borrows that component's frame/caption/bar markup and shares none of its code, deliberately.
 * `ClipStripEntry`'s props are clip-specific — `onRemove` and `children` are required, and
 * `children` is where that clip's canonical `<video>` lives — so a `kind` discriminator would mean
 * a component whose central obligation (host an element the sampler is reading) is inapplicable to
 * half its instances. `ClipStripEntry.test.tsx` also asserts on `.clip-strip__frame` /
 * `.clip-strip__poster` and on the `w-24` utility with bare `document.querySelector`, so a shared
 * markup extraction would ripple into tests measuring something else entirely. Hence the parallel
 * `model-load-entry__*` class names: nothing here can ever be the first match for a clip query.
 *
 * ### It hosts nothing, so it is inert
 *
 * No `<video>`, no poster, no preview, no Remove, no activation target — there is nothing to open
 * and nothing to remove. That also means it introduces no focusable element into the header, so the
 * strip's tab order is exactly the clips' tab order, unchanged.
 *
 * ### Same height as a clip entry, on purpose
 *
 * `h-[4.5rem]` + `w-24` matches `ClipStripEntry`'s concealed frame exactly. The width is visual
 * rhythm; the HEIGHT is the load-bearing half — an entry of a different height would change the
 * header's rendered height when it appears and again when it leaves, shifting `<main>` twice per
 * page load for a purely decorative reason. Note the 96x72 floor `strides-kyu.13` measured is a
 * floor for an element the SAMPLER reads; this entry hosts no element, so it inherits the size for
 * consistency rather than for throughput.
 *
 * ### Where it sits, and why that is not a detail
 *
 * `MultiClipVideoSession` renders it as a preceding SIBLING of `<ul aria-label="Clips">`, inside
 * the same horizontally-scrolling strip. Sibling, because `multi-clip-analysis` requires exactly
 * one entry per clip in clip-session order so a reader can match `"Combined from clip N of TOTAL"`
 * by counting, and because a non-clip does not belong in a list labelled *Clips*. Inside the same
 * scroller, because that is what stops it from permanently stealing the width a clip's own
 * `<video>` needs at a narrow viewport — the working clip scrolls this entry off the left edge
 * instead of being pushed out of view behind it.
 */
export function ModelLoadStripEntry({ status }: ModelLoadStripEntryProps) {
  return (
    <div
      data-model-load-condition={status.condition}
      className="model-load-entry relative shrink-0"
    >
      <div className="model-load-entry__frame relative h-[4.5rem] w-24 overflow-hidden border-2 border-black bg-neutral-100 dark:border-white dark:bg-neutral-900">
        {/*
          A neutral mark, not a spinner — the same posture `ClipStripEntry` takes for a clip with no
          poster yet. A spinner would be a second, redundant animation next to the condition bar,
          and it would keep spinning on the error branch where nothing is happening at all.
        */}
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center font-display text-lg font-bold text-neutral-400 dark:text-neutral-600"
        >
          ↓
        </div>
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-1.5 bg-black/25 dark:bg-white/25"
        >
          <ModelConditionBar condition={status.condition} />
        </div>
      </div>

      <p className="model-load-entry__caption mt-0.5 flex w-24 items-center gap-1 font-sans text-[0.6875rem] leading-tight font-semibold uppercase tracking-wide">
        <span aria-hidden="true" className="shrink-0">
          {status.glyph}
        </span>
        <span aria-hidden="true" className="truncate">
          {status.caption}
        </span>
        {/*
          Plain text, NOT a live region. `results-view` allows one live region announcing progress
          for the whole session and the active clip's caption already holds it; a download is not
          clip analysis progress, and a byte figure that updates on every chunk would be the
          chattiest announcer on the page. Same rule every non-active clip entry follows: expose the
          condition as text, leave the announcing to the one thing that announces.
        */}
        <span className="sr-only">{status.announcement}</span>
      </p>
    </div>
  )
}

/**
 * The bar is a second encoding of the condition behind the caption, and it deliberately carries NO
 * width — there is no honest fraction to encode (`modelLoadStripStatus.ts`), so the indeterminate
 * treatment is the accurate one rather than a fallback. Copied from `ClipStripEntry`'s `ConditionBar`
 * rather than shared with it: ten lines of markup is a smaller cost than coupling a clip's condition
 * union to a model's, and the two will diverge (a clip has five bar treatments, this has two).
 */
function ModelConditionBar({ condition }: { condition: ModelLoadStripStatus['condition'] }) {
  if (condition === 'error') {
    return (
      <div
        className="h-full w-full bg-brand-700"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, transparent 0 3px, rgba(255,255,255,0.7) 3px 6px)',
        }}
      />
    )
  }
  return <div className="h-full w-full animate-pulse bg-brand-600" />
}

import type { ChangeEvent } from 'react'

export interface FileUploadProps {
  onSelected: (file: File) => void
  disabled?: boolean
}

/**
 * Thin wrapper around a native file input. Format/corruption validation is
 * intentionally not duplicated here — `useVideoSource`'s native `error`
 * event handling (via `classifyMediaError`) is the source of truth once the
 * file is actually handed to a `<video>` element.
 *
 * Accepts multiple files in one picker interaction (`multiple` on the input) — `onSelected`
 * fires once per selected file, in the order the browser reports them in `event.target.files`.
 * `onSelected`'s signature is unchanged (`(file: File) => void`); a caller that only ever wants
 * one clip (today's single-clip usage inside `VideoInputPanel`) doesn't need to change anything
 * — it just keeps acting on the last call when a user selects more than one file at such a call
 * site. A caller that wants one new item per selected file (multi-clip upload) calls `onSelected`
 * once per file already.
 */
export function FileUpload({ onSelected, disabled = false }: FileUploadProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    // Snapshot into a plain array before resetting the input below — `event.target.files` is a
    // *live* FileList backed by the input itself, and resetting `value` clears the input's
    // selection in place (mutating that same live list to empty in a real browser, verified via
    // live-browser testing during multi-clip-fusion). Iterating the live FileList directly would
    // see zero entries by the time the loop below runs; jsdom's file-input mock doesn't reproduce
    // this, so unit tests alone don't catch it.
    const files = event.target.files ? Array.from(event.target.files) : []
    // Allow re-selecting the same file(s) later (e.g. after "try again").
    event.target.value = ''
    for (const file of files) {
      onSelected(file)
    }
  }

  return (
    <label className="inline-flex w-full cursor-pointer flex-col items-center gap-2 border-2 border-dashed border-black dark:border-white p-8 text-center hover:bg-neutral-100 dark:hover:bg-neutral-900 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600">
      <span>Choose a video file</span>
      <input
        type="file"
        accept="video/*"
        multiple
        onChange={handleChange}
        disabled={disabled}
        className="sr-only"
      />
    </label>
  )
}

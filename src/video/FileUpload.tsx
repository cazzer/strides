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
 */
export function FileUpload({ onSelected, disabled = false }: FileUploadProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Allow re-selecting the same file later (e.g. after "try again").
    event.target.value = ''
    if (file) {
      onSelected(file)
    }
  }

  return (
    <label className="group inline-flex w-full cursor-pointer flex-col items-center gap-2 border-2 border-dashed border-black dark:border-white p-8 text-center hover:bg-neutral-100 dark:hover:bg-neutral-900 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600">
      <span>Choose a video file</span>
      <input
        type="file"
        accept="video/*"
        onChange={handleChange}
        disabled={disabled}
        className="sr-only"
      />
    </label>
  )
}

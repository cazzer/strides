import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileUpload } from './FileUpload'

function getInput() {
  return screen.getByLabelText(/choose a video file/i) as HTMLInputElement
}

describe('FileUpload', () => {
  it('renders a file input accepting video files', () => {
    render(<FileUpload onSelected={() => {}} />)
    const input = getInput()
    expect(input.type).toBe('file')
    expect(input.accept).toBe('video/*')
  })

  it('calls onSelected with the chosen file', () => {
    const onSelected = vi.fn()
    render(<FileUpload onSelected={onSelected} />)
    const input = getInput()
    const file = new File(['content'], 'run.mp4', { type: 'video/mp4' })

    fireEvent.change(input, { target: { files: [file] } })

    expect(onSelected).toHaveBeenCalledTimes(1)
    expect(onSelected).toHaveBeenCalledWith(file)
  })

  it('does not call onSelected when the selection is cleared', () => {
    const onSelected = vi.fn()
    render(<FileUpload onSelected={onSelected} />)
    const input = getInput()

    fireEvent.change(input, { target: { files: [] } })

    expect(onSelected).not.toHaveBeenCalled()
  })

  it('resets the input value after a selection so the same file can be re-picked', () => {
    const onSelected = vi.fn()
    render(<FileUpload onSelected={onSelected} />)
    const input = getInput()
    const file = new File(['content'], 'run.mp4', { type: 'video/mp4' })

    fireEvent.change(input, { target: { files: [file] } })

    expect(input.value).toBe('')
  })

  it('disables the input when disabled is true', () => {
    render(<FileUpload onSelected={() => {}} disabled />)
    expect(getInput()).toBeDisabled()
  })

  it('is enabled by default', () => {
    render(<FileUpload onSelected={() => {}} />)
    expect(getInput()).toBeEnabled()
  })
})

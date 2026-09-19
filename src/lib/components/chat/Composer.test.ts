import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import Composer from './Composer.svelte'

let component: ReturnType<typeof mount> | undefined

afterEach(async () => {
  if (component) await unmount(component)
  component = undefined
  document.body.innerHTML = ''
})

function setup(locked = false) {
  const onFilesSelected = vi.fn()
  component = mount(Composer, { target: document.body, props: { onFilesSelected, locked } })
  flushSync()
  return { onFilesSelected, input: document.querySelector('textarea')! }
}

function paste(input: HTMLTextAreaElement, transfer: object, type = 'paste') {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, type === 'paste' ? 'clipboardData' : 'dataTransfer', { value: transfer })
  Object.defineProperty(event, 'inputType', { value: 'insertFromPaste' })
  input.dispatchEvent(event)
  return event
}

// Array-like DOM collections need not implement Symbol.iterator.
function transfer(file: File, text = '') {
  return {
    items: { 0: { kind: 'file', getAsFile: () => file }, length: 1 },
    files: { 0: file, length: 1 },
    types: { 0: 'text/plain', length: 1 },
    getData: () => text,
  }
}

describe('composer attachments', () => {
  it('accepts files from the native picker and allows selecting the same file again', () => {
    const { onFilesSelected } = setup()
    const picker = document.querySelector('input[type=file]') as HTMLInputElement
    const file = new File(['hello'], 'notes.txt')
    Object.defineProperty(picker, 'files', { value: { 0: file, length: 1 } })
    picker.dispatchEvent(new Event('change', { bubbles: true }))
    expect(onFilesSelected).toHaveBeenCalledWith([file])
    expect(picker.value).toBe('')
    picker.dispatchEvent(new Event('change', { bubbles: true }))
    expect(onFilesSelected).toHaveBeenCalledTimes(2)
    expect(picker.disabled).toBe(false)
    expect(picker.getAttribute('accept')).toBeNull()
  })

  it('accepts pasted files from non-iterable clipboard collections', () => {
    const { input, onFilesSelected } = setup()
    const file = new File(['image'], 'image.png', { type: 'image/png' })
    expect(paste(input, transfer(file)).defaultPrevented).toBe(true)
    expect(onFilesSelected).toHaveBeenCalledWith([file])
  })

  it('falls back to clipboard.files when items have no file', () => {
    const { input, onFilesSelected } = setup()
    const file = new File(['pdf'], 'paper.pdf')
    paste(input, { ...transfer(file), items: { length: 0 } })
    expect(onFilesSelected).toHaveBeenCalledWith([file])
  })

  it('handles files delivered only by beforeinput', () => {
    const { input, onFilesSelected } = setup()
    const file = new File(['image'], 'image.png')
    expect(paste(input, transfer(file), 'beforeinput').defaultPrevented).toBe(true)
    expect(onFilesSelected).toHaveBeenCalledWith([file])
  })

  it('preserves accompanying text and avoids duplicate paste/beforeinput attachments', () => {
    const { input, onFilesSelected } = setup()
    const clipboard = transfer(new File(['image'], 'image.png'), 'caption')
    expect(paste(input, clipboard).defaultPrevented).toBe(false)
    expect(paste(input, clipboard, 'beforeinput').defaultPrevented).toBe(false)
    expect(onFilesSelected).toHaveBeenCalledTimes(1)
  })

  it('leaves ordinary text paste alone', () => {
    const { input, onFilesSelected } = setup()
    expect(paste(input, { files: [], items: [] }).defaultPrevented).toBe(false)
    expect(onFilesSelected).not.toHaveBeenCalled()
  })

  it('disables attachments when locked', () => {
    const { input, onFilesSelected } = setup(true)
    expect((document.querySelector('input[type=file]') as HTMLInputElement).disabled).toBe(true)
    paste(input, transfer(new File(['image'], 'image.png')))
    expect(onFilesSelected).not.toHaveBeenCalled()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import Composer from './Composer.svelte'
import ComposerHarness from './__fixtures__/ComposerHarness.svelte'

let component: ReturnType<typeof mount> | undefined

afterEach(async () => {
  if (component) await unmount(component)
  component = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function setup(locked = false) {
  const onFilesSelected = vi.fn()
  component = mount(Composer, { target: document.body, props: { onFilesSelected, locked } })
  flushSync()
  return { onFilesSelected, input: document.querySelector('textarea')! }
}

function paste(input: HTMLElement, transfer: object, type = 'paste') {
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


describe('Firefox Android image paste editor', () => {
  function setupEditor(initialInput = '', locked = false) {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Android 14; Mobile; rv:155.0) Gecko/155.0 Firefox/155.0',
    )
    const onFilesSelected = vi.fn()
    component = mount(ComposerHarness, { target: document.body, props: { initialInput, locked, onFilesSelected } })
    flushSync()
    return { input: document.querySelector('[contenteditable]') as HTMLDivElement, onFilesSelected }
  }

  it('uses a rich editable textbox so Gecko enables native image paste', () => {
    const { input } = setupEditor('existing draft')
    expect(input.getAttribute('contenteditable')).toBe('true')
    expect(input.getAttribute('role')).toBe('textbox')
    expect(input.getAttribute('aria-multiline')).toBe('true')
    expect(input.textContent).toBe('existing draft')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('attaches pasted images without inserting them into the text', () => {
    const { input, onFilesSelected } = setupEditor('caption')
    const file = new File(['image'], 'clipboard.png', { type: 'image/png' })
    expect(paste(input, transfer(file)).defaultPrevented).toBe(true)
    flushSync()
    expect(onFilesSelected).toHaveBeenCalledWith([file])
    expect(input.textContent).toBe('caption')
    expect(input.querySelector('img')).toBeNull()
    expect(document.querySelector('.image-previews img')).toBeTruthy()
  })

  it('handles beforeinput-only images and prevents duplicate attachments', () => {
    const { input, onFilesSelected } = setupEditor()
    const clipboard = transfer(new File(['image'], 'clipboard.png', { type: 'image/png' }))
    expect(paste(input, clipboard, 'beforeinput').defaultPrevented).toBe(true)
    expect(onFilesSelected).toHaveBeenCalledTimes(1)
    paste(input, clipboard)
    expect(paste(input, clipboard, 'beforeinput').defaultPrevented).toBe(true)
    expect(onFilesSelected).toHaveBeenCalledTimes(2)
  })

  it('inserts plain text at the selection without inserting clipboard HTML', () => {
    const { input, onFilesSelected } = setupEditor('before after')
    input.focus()
    const range = document.createRange()
    range.setStart(input.firstChild!, 7)
    range.setEnd(input.firstChild!, 12)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    const clipboard = {
      items: [], files: [], types: ['text/plain', 'text/html'],
      getData: (type: string) => type === 'text/plain' ? '<b>literal</b>' : '<b>formatted</b><img src=x>',
    }
    expect(paste(input, clipboard).defaultPrevented).toBe(true)
    flushSync()
    expect(input.textContent).toBe('before <b>literal</b>')
    expect(input.querySelector('b, img')).toBeNull()
    expect(document.querySelector('[data-testid=draft]')!.textContent).toBe('before <b>literal</b>')
    expect(onFilesSelected).not.toHaveBeenCalled()
  })

  it('keeps the caption with an image paste and handles a following beforeinput once', () => {
    const { input, onFilesSelected } = setupEditor()
    input.focus()
    const file = new File(['image'], 'image.png', { type: 'image/png' })
    const clipboard = transfer(file, 'image caption')
    paste(input, clipboard)
    paste(input, clipboard, 'beforeinput')
    flushSync()
    expect(input.textContent).toBe('image caption')
    expect(onFilesSelected).toHaveBeenCalledTimes(1)
  })

  it('still permits text composition while attachments are locked', () => {
    const { input, onFilesSelected } = setupEditor('', true)
    input.focus()
    const event = new InputEvent('beforeinput', { inputType: 'insertText', data: 'a', cancelable: true })
    input.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    paste(input, { items: [], files: [], types: ['text/plain'], getData: () => 'next message' })
    flushSync()
    expect(input.textContent).toBe('next message')
    expect(onFilesSelected).not.toHaveBeenCalled()
  })

  it('clears the editor when the parent sends its draft', () => {
    const { input } = setupEditor('draft to send')
    ;(document.querySelector('[aria-label=Send]') as HTMLButtonElement).click()
    flushSync()
    expect(document.querySelector('[data-testid=sent]')!.textContent).toBe('draft to send')
    expect(input.textContent).toBe('')
  })

  it('does not insert inline images when attachments are locked', () => {
    const { input, onFilesSelected } = setupEditor('', true)
    expect(paste(input, transfer(new File(['image'], 'image.png'))).defaultPrevented).toBe(true)
    expect(onFilesSelected).not.toHaveBeenCalled()
  })
})

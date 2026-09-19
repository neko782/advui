import { describe, expect, it } from 'vitest'
import { readEditableText } from './editableText'

describe('rich composer plain text', () => {
  it.each([
    ['', ''],
    ['<br>', ''],
    ['first<div>second</div>', 'first\nsecond'],
    ['<div>first</div><div>second</div>', 'first\nsecond'],
    ['<div>first</div><div><br></div>', 'first\n'],
    ['<div>first</div><div><br></div><div><br></div>', 'first\n\n'],
    ['<div><br></div><div>second</div>', '\nsecond'],
    ['first<br>second<br>', 'first\nsecond'],
    ['first<br><br>', 'first\n'],
    ['first<br><br>second', 'first\n\nsecond'],
    ['first\n\nsecond\n', 'first\n\nsecond\n'],
    ['first&nbsp; second&nbsp;', 'first  second '],
    ['&lt;b&gt;literal&lt;/b&gt;', '<b>literal</b>'],
  ])('serializes %s without extra caret newlines', (html, expected) => {
    const editor = document.createElement('div')
    editor.innerHTML = html
    expect(readEditableText(editor)).toBe(expected)
  })
})

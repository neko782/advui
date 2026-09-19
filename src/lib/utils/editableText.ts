/** Read a rich editor as plain text without counting Gecko's caret <br>s. */
export function readEditableText(element: HTMLElement): string {
  function read(parent: Node): string {
    let text = ''
    let previousBlock = false
    for (const child of Array.from(parent.childNodes)) {
      // Our editor only inserts plain text; these are the block wrappers that
      // browsers create for Enter. Each block occupies a line, even if empty.
      const block = child.nodeName === 'DIV' || child.nodeName === 'P'
      if (child.previousSibling && (previousBlock || (block && !text.endsWith('\n')))) {
        text += '\n'
      }
      if (child.nodeName === 'BR') {
        // A final br is the browser's caret placeholder, not message content.
        if (child.nextSibling) text += '\n'
      } else if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent || ''
      } else {
        text += read(child)
      }
      previousBlock = block
    }
    return text
  }
  return read(element).replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
}

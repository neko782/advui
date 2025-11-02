// DOM helpers used by multiple components

export function placeCaretAtEnd(el) {
  try {
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
  } catch {}
}

export function autoGrow(el, options = {}) {
  if (!el) return
  const max = options.maxHeight ?? 240
  const min = options.minHeight ?? 44
  try {
    el.style.height = 'auto'
    const content = el.scrollHeight
    const next = Math.min(content, max)
    el.style.height = Math.max(next, min) + 'px'
    el.style.overflowY = content > max ? 'auto' : 'hidden'
  } catch {}
}


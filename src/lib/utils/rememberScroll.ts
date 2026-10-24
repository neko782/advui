/** Keep independent scroll positions for session-local, hidden views. */
export function rememberScroll(node: HTMLElement, initial: { active: boolean; key?: string }) {
  const positions = new Map<string, { top: number; left: number }>()
  let current = initial
  let frame = 0
  const save = () => {
    if (current.active) positions.set(current.key ?? '', { top: node.scrollTop, left: node.scrollLeft })
  }
  const restore = () => {
    cancelAnimationFrame(frame)
    if (!current.active) return
    frame = requestAnimationFrame(() => {
      const position = positions.get(current.key ?? '')
      node.scrollTop = position?.top ?? 0
      node.scrollLeft = position?.left ?? 0
    })
  }
  node.addEventListener('scroll', save, { passive: true })
  restore()
  return {
    update(next: typeof initial) {
      const changed = current.active !== next.active || current.key !== next.key
      current = next
      if (changed) restore()
    },
    destroy() { cancelAnimationFrame(frame); node.removeEventListener('scroll', save) },
  }
}

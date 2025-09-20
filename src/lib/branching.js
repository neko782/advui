// Branching helpers centralized here to keep Chat.svelte lean

// A message is an anchor if it has variants (assistant always anchored; user/system may be anchored when branched)
export function isAnchor(m) {
  return !!(m && Array.isArray(m.variants))
}

// Build visible list with indices according to current branch selection
export function buildVisible(messages) {
  const out = []
  let chain = ''
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (isAnchor(m)) {
      const parent = m.branchPathBefore
      if (parent == null || parent === chain) {
        out.push({ m, i })
        const vi = typeof m.variantIndex === 'number' ? m.variantIndex : 0
        chain = chain ? `${chain}|${m.id}:${vi}` : `${m.id}:${vi}`
      }
      continue
    }
    if (m?.branchPath != null) {
      if (m.branchPath === chain) out.push({ m, i })
    } else {
      out.push({ m, i })
    }
  }
  return out
}

// Build visible messages up to an exclusive index
export function buildVisibleUpTo(messages, indexExclusive) {
  const upto = Math.max(0, Math.min(indexExclusive ?? 0, messages.length))
  const out = []
  let chain = ''
  for (let i = 0; i < upto; i++) {
    const m = messages[i]
    if (isAnchor(m)) {
      const parent = m.branchPathBefore
      if (parent == null || parent === chain) {
        out.push(m)
        const vi = typeof m.variantIndex === 'number' ? m.variantIndex : 0
        chain = chain ? `${chain}|${m.id}:${vi}` : `${m.id}:${vi}`
      }
      continue
    }
    if (m?.branchPath != null) {
      if (m.branchPath === chain) out.push(m)
    } else {
      out.push(m)
    }
  }
  return out
}

export function chainFromVisibleList(list) {
  const parts = []
  for (const m of list) {
    if (isAnchor(m)) {
      const vi = typeof m.variantIndex === 'number' ? m.variantIndex : 0
      parts.push(`${m.id}:${vi}`)
    }
  }
  return parts.join('|')
}

export function currentVisibleChain(messages) {
  return chainFromVisibleList(buildVisible(messages).map(vm => vm.m))
}

export function chainFromVisibleUpTo(messages, indexExclusive) {
  return chainFromVisibleList(buildVisibleUpTo(messages, indexExclusive))
}

// Inject an anchor token into downstream branch paths and anchor parents
// Used when turning a non-anchor into an anchor so the old content stays on variant 0.
export function injectAnchorToken(messages, startIndex, parentChain, anchorId, originalVariantIndex = 0) {
  const token = `${anchorId}:${originalVariantIndex}`
  function inject(path) {
    if (path == null) return path
    // Root-level injection (no parent chain)
    if (!parentChain) {
      // Idempotent: if token already at start, keep as-is
      if (path === token || path.startsWith(token + '|')) return path
      return token + (path ? `|${path}` : '')
    }
    // Exact parent: append token once
    if (path === parentChain) return `${parentChain}|${token}`
    const prefix = `${parentChain}|`
    if (path.startsWith(prefix)) {
      const rest = path.slice(prefix.length)
      // If token already immediately follows parent, leave unchanged
      if (rest === token || rest.startsWith(`${token}|`)) return path
      // Otherwise insert token between parent and rest
      return `${parentChain}|${token}` + (rest ? `|${rest}` : '')
    }
    return path
  }
  const arr = messages.slice()
  for (let k = startIndex + 1; k < arr.length; k++) {
    const m = arr[k]
    if (isAnchor(m)) {
      arr[k] = { ...m, branchPathBefore: inject(m.branchPathBefore) }
    } else if (m?.branchPath != null) {
      arr[k] = { ...m, branchPath: inject(m.branchPath) }
    }
  }
  return arr
}

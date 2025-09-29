// Notice/error message helpers
import { validateTree } from '../../branching.js'
import { BUG_NOTICE, DEBUG_AUTOFIX_NOTICE } from '../../constants/index.js'
import { buildVisible as _buildVisible } from '../../branching.js'

export function computeValidationNotice(nodes, rootId, debug) {
  const integrity = validateTree(nodes, rootId)
  if (!integrity.ok) {
    return `Chat structure issues detected: ${integrity.problems.join(' • ')}. ${BUG_NOTICE}${debug ? ` ${DEBUG_AUTOFIX_NOTICE}` : ''}`
  }
  return ''
}

export function computeGenerationNotice(nodes, rootId) {
  try {
    const buildVisible = () => _buildVisible(nodes, rootId)
    const vis = buildVisible()
    for (let i = vis.length - 1; i >= 0; i--) {
      const mm = vis[i]?.m
      if (mm?.error) {
        const msg = String(mm.error || '')
        return msg.startsWith('Error:') ? msg : `Error: ${msg}`
      }
    }
  } catch {}
  return ''
}

export function assembleNotice(generationNotice, sanitizerNotice, validationNotice, missingApiKeyNotice, dismissedNotice) {
  const assembled = [generationNotice, sanitizerNotice, validationNotice, missingApiKeyNotice].filter(Boolean).join(' ')
  return (assembled && assembled !== dismissedNotice) ? assembled : ''
}

export function computeFollowingMap(nodes, rootId) {
  const buildVisible = () => _buildVisible(nodes, rootId)
  const map = {}
  const visible = buildVisible()
  for (let j = 0; j < visible.length; j++) {
    const next = visible[j + 1]?.m
    if (next && next.role === 'assistant') {
      map[j] = { has: true, id: next.id, typing: !!next.typing }
    } else {
      map[j] = { has: false, id: null, typing: false }
    }
  }
  return map
}
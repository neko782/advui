// Chat persistence with signature tracking
import { saveChatContent } from '../../chatsStore.js'
import { sanitizeGraphIfNeeded } from './graphValidation.js'

export function computePersistSig(nodes, chatSettings, rootId) {
  try {
    const mini = (nodes || []).map(n => {
      const v = (n?.variants || [])[Number(n?.active) || 0]
      return `${n.id}|${v?.role||''}|${v?.content?.length||0}|${(v?.next!=null?1:0)}`
    })
    return JSON.stringify({
      m: mini,
      settings: {
        model: chatSettings?.model || '',
        streaming: !!chatSettings?.streaming,
        presetId: chatSettings?.presetId || '',
        maxOutputTokens: chatSettings?.maxOutputTokens ?? null,
        topP: chatSettings?.topP ?? null,
        temperature: chatSettings?.temperature ?? null,
        reasoningEffort: chatSettings?.reasoningEffort || '',
        textVerbosity: chatSettings?.textVerbosity || '',
        reasoningSummary: chatSettings?.reasoningSummary || '',
        connectionId: chatSettings?.connectionId || '',
      },
      rootId,
    })
  } catch {
    return ''
  }
}

export async function persistChatContent(chatId, nodes, chatSettings, rootId, debug, mounted) {
  try {
    if (!chatId || !mounted) return { updated: null, notice: '' }

    // Enforce invariant before persisting
    const { nodes: sanitized, notice } = sanitizeGraphIfNeeded(nodes, rootId, debug)

    // Persist full graph
    const updated = await saveChatContent(chatId, {
      nodes: sanitized,
      settings: chatSettings,
      rootId
    })

    return { updated, notice, nodes: sanitized }
  } catch (err) {
    return { updated: null, notice: '', nodes }
  }
}
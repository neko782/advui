// Chat loading and initialization
import { getChat as loadChatById } from '../../chatsStore.js'
import { loadSettings } from '../../settingsStore.js'
import { makeSystemPrologue, pickPresetFromSettings, buildChatSettings, recomputeNextIds } from './chatInit.js'
import { migrateLegacyGraphToNodes } from './legacyMigration.js'
import { computePersistSig } from './chatPersistence.js'
import { parseMaxTokens, parseTopP, parseTemperature, normalizeReasoning, normalizeVerbosity, normalizeReasoningSummary } from '../../utils/validation.js'

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key)

export async function loadChat(chatId) {
  const nextSettings = loadSettings()
  const basePreset = pickPresetFromSettings(nextSettings)

  let nextNodes = []
  let nextRootId = 1
  let nextChatSettings = buildChatSettings(basePreset, nextSettings)
  let nextNextId = 1
  let nextNextNodeId = 1
  let nextPersistSig = ''

  if (!chatId) {
    return {
      nodes: nextNodes,
      rootId: nextRootId,
      chatSettings: nextChatSettings,
      nextId: nextNextId,
      nextNodeId: nextNextNodeId,
      persistSig: nextPersistSig,
      settings: nextSettings
    }
  }

  try {
    const loaded = await loadChatById(chatId)

    if (loaded) {
      if (Array.isArray(loaded.nodes)) {
        nextNodes = loaded.nodes.slice()
        nextRootId = loaded?.rootId || (nextNodes[0]?.id || 1)
      } else {
        // Legacy support: migrate flat/graph messages to node-based
        const msgs = Array.isArray(loaded.messages) ? loaded.messages.slice() : []
        const mig = migrateLegacyGraphToNodes(msgs, loaded?.rootId, loaded?.selected)
        nextNodes = mig.nodes
        nextRootId = mig.rootId
      }

      nextChatSettings = {
        model: loaded?.settings?.model || basePreset.model || 'gpt-5',
        streaming: (typeof loaded?.settings?.streaming === 'boolean'
          ? loaded.settings.streaming
          : (typeof basePreset.streaming === 'boolean' ? basePreset.streaming : true)),
        presetId: (typeof loaded?.presetId === 'string') ? loaded.presetId : basePreset.id,
        maxOutputTokens: parseMaxTokens(hasOwn(loaded?.settings, 'maxOutputTokens') ? loaded.settings.maxOutputTokens : basePreset.maxOutputTokens),
        topP: parseTopP(hasOwn(loaded?.settings, 'topP') ? loaded.settings.topP : basePreset.topP),
        temperature: parseTemperature(hasOwn(loaded?.settings, 'temperature') ? loaded.settings.temperature : basePreset.temperature),
        reasoningEffort: normalizeReasoning(hasOwn(loaded?.settings, 'reasoningEffort') ? loaded.settings.reasoningEffort : basePreset.reasoningEffort),
        textVerbosity: normalizeVerbosity(hasOwn(loaded?.settings, 'textVerbosity') ? loaded.settings.textVerbosity : basePreset.textVerbosity),
        reasoningSummary: normalizeReasoningSummary(hasOwn(loaded?.settings, 'reasoningSummary') ? loaded.settings.reasoningSummary : basePreset.reasoningSummary),
        connectionId: (() => {
          const fromLoaded = hasOwn(loaded?.settings, 'connectionId') ? loaded.settings.connectionId : undefined
          if (typeof fromLoaded === 'string' && fromLoaded.trim()) return fromLoaded.trim()
          if (typeof basePreset?.connectionId === 'string' && basePreset.connectionId?.trim()) return basePreset.connectionId.trim()
          const settingsConn = typeof nextSettings?.selectedConnectionId === 'string' && nextSettings.selectedConnectionId.trim()
            ? nextSettings.selectedConnectionId.trim()
            : null
          return settingsConn
        })(),
      }

      if (!nextNodes.length) {
        if (loaded?.rootId == null) {
          nextRootId = null
          nextNextId = 1
          nextNextNodeId = 1
        } else {
          nextNextId = 2
          nextNextNodeId = 2
          nextNodes = [{ id: 1, variants: [{ ...makeSystemPrologue(1) }], active: 0 }]
          nextRootId = 1
        }
      } else {
        const ids = recomputeNextIds(nextNodes)
        nextNextId = ids.nextId
        nextNextNodeId = ids.nextNodeId
      }
    } else {
      nextNodes = [{ id: 1, variants: [{ ...makeSystemPrologue(1) }], active: 0 }]
      nextRootId = 1
      nextNextId = 2
      nextNextNodeId = 2
      nextChatSettings = buildChatSettings(basePreset, nextSettings)
    }
  } catch {
    nextNodes = [{ id: 1, variants: [{ ...makeSystemPrologue(1) }], active: 0 }]
    nextRootId = 1
    nextNextId = 2
    nextNextNodeId = 2
    nextChatSettings = buildChatSettings(basePreset, nextSettings)
  }

  // Precompute a persist signature for the loaded chat content
  try {
    nextPersistSig = computePersistSig(nextNodes, nextChatSettings, nextRootId)
  } catch {
    nextPersistSig = ''
  }

  return {
    nodes: nextNodes,
    rootId: nextRootId,
    chatSettings: nextChatSettings,
    nextId: nextNextId,
    nextNodeId: nextNextNodeId,
    persistSig: nextPersistSig,
    settings: nextSettings
  }
}

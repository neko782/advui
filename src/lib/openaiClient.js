// Client-side OpenAI helper for Responses and Chat Completions APIs
// Uses the official OpenAI SDK only (no fetch fallback)

import OpenAI from 'openai'
import { loadSettings, findConnection } from './settingsStore.js'
import { toIntOrNull, toClampedNumber } from './utils/numbers.js'

function resolveConnection({ connectionId, connection, settings } = {}) {
  if (connection && typeof connection === 'object') {
    const id = typeof connection.id === 'string' && connection.id.trim()
      ? connection.id.trim()
      : (typeof connection.connectionId === 'string' && connection.connectionId.trim() ? connection.connectionId.trim() : null)
    const apiKey = typeof connection.apiKey === 'string' ? connection.apiKey : ''
    const apiBaseUrl = connection.apiBaseUrl
    const apiMode = connection.apiMode === 'chat_completions' ? 'chat_completions' : 'responses'
    return { id, apiKey, apiBaseUrl, apiMode }
  }
  const srcSettings = settings || loadSettings()
  const resolved = findConnection(srcSettings, connectionId)
  return {
    id: resolved?.id || null,
    apiKey: typeof resolved?.apiKey === 'string' ? resolved.apiKey : '',
    apiBaseUrl: resolved?.apiBaseUrl,
    apiMode: resolved?.apiMode === 'chat_completions' ? 'chat_completions' : 'responses',
  }
}

function buildClientOptions({ apiKey, apiBaseUrl }) {
  if (!apiKey) return null
  const baseURL = typeof apiBaseUrl === 'string' && apiBaseUrl.trim() ? apiBaseUrl.trim() : ''
  const options = { apiKey, dangerouslyAllowBrowser: true }
  if (baseURL) options.baseURL = baseURL
  return options
}

export async function getClient(options = {}) {
  const settings = options.settings || loadSettings()
  const connection = resolveConnection({
    connectionId: options.connectionId,
    connection: options.connection,
    settings,
  })
  if (!connection.apiKey) return null
  const clientOptions = buildClientOptions(connection)
  if (!clientOptions) return null
  return new OpenAI(clientOptions)
}

function pickActivePreset(settings) {
  const list = Array.isArray(settings?.presets) ? settings.presets : []
  const fallbackConnectionId = typeof settings?.selectedConnectionId === 'string' ? settings.selectedConnectionId : null
  if (!list.length) return { model: 'gpt-5', streaming: true, connectionId: fallbackConnectionId }
  const selected = typeof settings?.selectedPresetId === 'string'
    ? list.find(p => p?.id === settings.selectedPresetId)
    : null
  return selected || list[0] || { model: 'gpt-5', streaming: true, connectionId: fallbackConnectionId }
}

// Create a response using either a single prompt string or an array of messages
// Messages should be of the form: { role: 'system'|'user'|'assistant', content: string }
export async function respond({
  prompt,
  messages,
  model,
  connectionId,
  stream = false,
  onTextDelta,
  onEvent,
  maxOutputTokens,
  topP,
  temperature,
  reasoningEffort,
  textVerbosity,
  reasoningSummary,
  thinkingEnabled,
  thinkingBudgetTokens,
  onReasoningSummaryDelta,
  onReasoningSummaryDone,
  onAbort,
}) {
  const settings = loadSettings()
  const preset = pickActivePreset(settings)
  const useModel = model || preset?.model || 'gpt-5'
  const preferredConnectionId = typeof connectionId === 'string' && connectionId.trim()
    ? connectionId.trim()
    : (typeof preset?.connectionId === 'string' && preset.connectionId.trim()
      ? preset.connectionId.trim()
      : null)
  const resolvedConnection = resolveConnection({
    connectionId: preferredConnectionId,
    settings,
  })
  if (!resolvedConnection.apiKey) {
    throw new Error('Missing OpenAI API key. Set it in Settings.')
  }
  const apiMode = resolvedConnection.apiMode === 'chat_completions' ? 'chat_completions' : 'responses'
  const useChatCompletions = apiMode === 'chat_completions'

  // SDK call only
  const effectiveConnectionId = resolvedConnection.id || preferredConnectionId || null
  const client = await getClient({
    settings,
    connectionId: effectiveConnectionId,
    connection: { ...resolvedConnection, id: effectiveConnectionId },
  })
  if (!client) {
    throw new Error('OpenAI SDK is not available or is outdated.')
  }
  const supportsResponses = !!client?.responses?.create
  const supportsChatCompletions = !!client?.chat?.completions?.create
  if (useChatCompletions && !supportsChatCompletions) {
    throw new Error('OpenAI SDK does not support the Chat Completions API.')
  }
  if (!useChatCompletions && !supportsResponses) {
    throw new Error('OpenAI SDK is not available or is outdated.')
  }
  const provideAbort = (fn) => {
    if (typeof onAbort !== 'function') return
    onAbort(() => {
      try { fn?.() } catch {}
    })
  }
  let input
  if (Array.isArray(messages) && messages.length) {
    // Normalize: strip extra fields like ids/typing and keep valid roles only
    const allowed = new Set(['system', 'user', 'assistant'])
    input = messages
      .filter(m => m && (typeof m.content === 'string' || (m.images && Array.isArray(m.images))) && allowed.has(m.role))
      .map(({ role, content, images }) => {
        // For Responses API: if there are images, convert content to array format
        if (images && Array.isArray(images) && images.length > 0) {
          const contentArray = []
          if (content && typeof content === 'string') {
            contentArray.push({ type: 'input_text', text: content })
          }
          for (const img of images) {
            if (img && typeof img.id === 'string' && typeof img.data === 'string') {
              const mimeType = img.mimeType || 'image/jpeg'
              contentArray.push({
                type: 'input_image',
                image_url: `data:${mimeType};base64,${img.data}`,
              })
            }
          }
          return { role, content: contentArray }
        }
        return { role, content }
      })
  } else {
    input = typeof prompt === 'string' ? prompt : ''
  }
  const request = { model: useModel, input }

  // For Chat Completions API: convert image format
  const chatMessages = Array.isArray(input)
    ? input.map(msg => {
        // If content is an array (from Responses format), convert to Chat Completions format
        if (Array.isArray(msg.content)) {
          const contentArray = []
          for (const part of msg.content) {
            if (part.type === 'input_text' && part.text) {
              contentArray.push({ type: 'text', text: part.text })
            } else if (part.type === 'input_image' && part.image_url) {
              contentArray.push({
                type: 'image_url',
                image_url: { url: part.image_url }
              })
            }
          }
          return { role: msg.role, content: contentArray }
        }
        return msg
      })
    : (typeof input === 'string' && input
      ? [{ role: 'user', content: input }]
      : [])
  const chatRequest = { model: useModel, messages: chatMessages }
  const tokens = toIntOrNull(maxOutputTokens)
  if (tokens != null) request.max_output_tokens = tokens
  if (tokens != null) chatRequest.max_completion_tokens = tokens
  const topPVal = toClampedNumber(topP, 0, 1)
  if (topPVal != null) request.top_p = topPVal
  if (topPVal != null) chatRequest.top_p = topPVal
  const tempVal = toClampedNumber(temperature, 0, 2)
  if (tempVal != null) request.temperature = tempVal
  if (tempVal != null) chatRequest.temperature = tempVal
  const reasoningOptions = {}
  if (typeof reasoningEffort === 'string' && reasoningEffort && reasoningEffort !== 'none') {
    reasoningOptions.effort = reasoningEffort
  }
  if (typeof reasoningSummary === 'string' && reasoningSummary) {
    reasoningOptions.summary = reasoningSummary
  }
  if (Object.keys(reasoningOptions).length) {
    request.reasoning = reasoningOptions
  }
  if (reasoningOptions?.effort) {
    chatRequest.reasoning_effort = reasoningOptions.effort
  }
  if (typeof textVerbosity === 'string' && textVerbosity) {
    request.text = { verbosity: textVerbosity }
  }
  const thinkingBudget = toIntOrNull(thinkingBudgetTokens)
  const thinkingConfig = (() => {
    if (!thinkingEnabled) return null
    const body = { type: 'enabled' }
    if (thinkingBudget != null) body.budget_tokens = thinkingBudget
    return body
  })()
  if (thinkingConfig) {
    request.thinking = thinkingConfig
    chatRequest.thinking = thinkingConfig
    request.extra_body = { ...(request.extra_body || {}), thinking: thinkingConfig }
    chatRequest.extra_body = { ...(chatRequest.extra_body || {}), thinking: thinkingConfig }
  }

  if (stream) {
    if (useChatCompletions) {
      const abortController = (typeof AbortController === 'function') ? new AbortController() : null
      if (abortController) {
        provideAbort(() => {
          try { abortController.abort() } catch {}
        })
      }
      const streamIt = await client.chat.completions.create(
        { ...chatRequest, stream: true },
        abortController ? { signal: abortController.signal } : undefined,
      )
      provideAbort(() => {
        try { streamIt.controller?.abort?.() } catch {}
      })
      let full = ''
      const summaryByIndex = new Map()
      let summaryDelivered = false
      const buildSummary = () => {
        const ordered = Array.from(summaryByIndex.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([, text]) => (typeof text === 'string' ? text : ''))
          .filter(Boolean)
        if (!ordered.length) return ''
        const combined = ordered.join('\n\n\n')
        return combined.replace(/\n{4,}/g, '\n\n\n')
      }
      try {
        for await (const chunk of streamIt) {
          try { onEvent?.(chunk) } catch {}
          const deltaText = collectChatDeltaText(chunk)
          if (deltaText) {
            full += deltaText
            try { onTextDelta?.(full) } catch {}
          }
          const choices = Array.isArray(chunk?.choices) ? chunk.choices : []
          let finishReasonSeen = false
          for (const choice of choices) {
            const idx = Number.isFinite(Number(choice?.index)) ? Number(choice.index) : 0
            const prev = summaryByIndex.get(idx) || ''
            let next = prev
            const deltaSummary = collectChatReasoningContent(choice?.delta?.reasoning_content)
            if (deltaSummary) {
              next += deltaSummary
            }
            const messageSummary = collectChatReasoningContent(choice?.message?.reasoning_content)
            if (messageSummary) {
              next = messageSummary
            }
            if (next !== prev) {
              summaryByIndex.set(idx, next)
              const summary = buildSummary()
              try { onReasoningSummaryDelta?.(summary, deltaSummary || messageSummary || '', choice) } catch {}
            }
            if (!finishReasonSeen && typeof choice?.finish_reason === 'string' && choice.finish_reason) {
              finishReasonSeen = true
            }
          }
          if (finishReasonSeen && !summaryDelivered) {
            const summary = buildSummary()
            try {
              onReasoningSummaryDone?.(summary || '', chunk)
              summaryDelivered = true
            } catch {}
          }
        }
      } catch (err) {
        throw err
      } finally {
        try { streamIt.controller?.abort?.() } catch {}
      }
      const finalSummary = buildSummary()
      if (!summaryDelivered) {
        try {
          onReasoningSummaryDone?.(finalSummary || '', null)
          summaryDelivered = true
        } catch {}
      }
      return {
        text: full,
        reasoningSummary: finalSummary,
      }
    }

    // Stream via SDK's async iterator
    const abortController = (typeof AbortController === 'function') ? new AbortController() : null
    if (abortController) {
      provideAbort(() => {
        try { abortController.abort() } catch {}
      })
    }
    const streamIt = await client.responses.create({ ...request, stream: true }, abortController ? { signal: abortController.signal } : undefined)
    provideAbort(() => {
      try { streamIt.controller?.abort?.() } catch {}
    })
    let full = ''
    const summaryByIndex = new Map()
    let summaryDelivered = false
    const buildSummary = () => {
      const ordered = Array.from(summaryByIndex.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, text]) => (typeof text === 'string' ? text : ''))
        .filter(Boolean)
      if (!ordered.length) return ''
      const combined = ordered.join('\n\n\n')
      return combined.replace(/\n{4,}/g, '\n\n\n')
    }
    let completed = false
    try {
      for await (const event of streamIt) {
        try { onEvent?.(event) } catch {}
        const t = event?.type || event?.event || ''
        if (t === 'response.output_text.delta') {
          const delta = event?.delta || ''
          if (typeof delta === 'string' && delta) {
            full += delta
            try { onTextDelta?.(full, delta, event) } catch {}
          }
        } else if (t === 'response.reasoning_summary_text.delta') {
          const delta = event?.delta || ''
          const idx = Number.isFinite(Number(event?.summary_index)) ? Number(event.summary_index) : 0
          const prev = summaryByIndex.get(idx) || ''
          const next = typeof delta === 'string' && delta ? prev + delta : prev
          summaryByIndex.set(idx, next)
          const summary = buildSummary()
          try { onReasoningSummaryDelta?.(summary, typeof delta === 'string' ? delta : '', event) } catch {}
        } else if (t === 'response.reasoning_summary_text.done') {
          const idx = Number.isFinite(Number(event?.summary_index)) ? Number(event.summary_index) : 0
          const text = typeof event?.text === 'string' ? event.text : ''
          const existing = summaryByIndex.get(idx) || ''
          const finalText = text || existing
          if (finalText) summaryByIndex.set(idx, finalText)
          const summary = buildSummary()
          try {
            onReasoningSummaryDone?.(summary, event)
            summaryDelivered = true
          } catch {}
        } else if (t === 'response.completed' || t === 'response.text.done' || t === 'response.done') {
          completed = true
          if (!summaryDelivered) {
            const summary = buildSummary()
            if (summary) {
              try {
                onReasoningSummaryDone?.(summary, event)
                summaryDelivered = true
              } catch {}
            }
          }
          break
        } else if (t === 'response.failed' || t === 'error') {
          const msg = event?.error?.message || 'Stream failed.'
          throw new Error(msg)
        }
      }
    } catch (err) {
      // Re-throw so callers can handle
      throw err
    } finally {
      if (completed) {
        try { streamIt.controller?.abort?.() } catch {}
      }
    }
    const finalSummary = buildSummary()
    if (!summaryDelivered && finalSummary) {
      try {
        onReasoningSummaryDone?.(finalSummary, null)
        summaryDelivered = true
      } catch {}
    }
    return {
      text: full,
      reasoningSummary: finalSummary,
    }
  } else {
    if (useChatCompletions) {
      const abortController = (typeof AbortController === 'function') ? new AbortController() : null
      if (abortController) {
        provideAbort(() => {
          try { abortController.abort() } catch {}
        })
      } else if (typeof onAbort === 'function') {
        // Still provide a callable no-op so callers can clear their abort handle
        onAbort(() => {})
      }
      const res = await client.chat.completions.create(
        chatRequest,
        abortController ? { signal: abortController.signal } : undefined,
      )
      const text = extractOutputText(res)
      const summary = extractChatReasoningSummary(res)
      try { onReasoningSummaryDone?.(summary || '', null) } catch {}
      return { text, reasoningSummary: summary || '' }
    }

    const abortController = (typeof AbortController === 'function') ? new AbortController() : null
    if (abortController) {
      provideAbort(() => {
        try { abortController.abort() } catch {}
      })
    } else if (typeof onAbort === 'function') {
      // Still provide a callable no-op so callers can clear their abort handle
      onAbort(() => {})
    }
    const res = await client.responses.create(request, abortController ? { signal: abortController.signal } : undefined)
    const text = extractOutputText(res)
    const summary = extractReasoningSummary(res)
    if (summary) {
      try { onReasoningSummaryDone?.(summary, null) } catch {}
    }
    return { text, reasoningSummary: summary }
  }
}

// List available models via the official SDK
export async function listModels(options = {}) {
  let client = null
  if (options?.apiKey) {
    const clientOptions = buildClientOptions(options)
    if (!clientOptions) throw new Error('Missing OpenAI API key.')
    client = new OpenAI(clientOptions)
  } else {
    client = await getClient(options)
  }
  if (!client) throw new Error('Missing OpenAI API key. Set it in Settings.')
  if (!client?.models?.list) throw new Error('OpenAI SDK does not support listing models.')
  const res = await client.models.list()
  const items = Array.isArray(res?.data) ? res.data : []
  return sortModels(items).map(m => m.id)
}

// List models using a provided API key (without saving it)
export async function listModelsWithKey(apiKey, apiBaseUrl = '') {
  return listModels({ apiKey, apiBaseUrl })
}

function sortModels(items) {
  const arr = items
    .map(m => ({ id: String(m?.id || ''), created: Number(m?.created) || 0 }))
    .filter(m => m.id)
  arr.sort((a, b) => (b.created - a.created))
  // Deduplicate by id while preserving order
  const seen = new Set()
  const out = []
  for (const m of arr) {
    if (!seen.has(m.id)) { seen.add(m.id); out.push(m) }
  }
  return out
}

function collectContentText(content) {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (typeof content === 'number') return String(content)
  if (Array.isArray(content)) {
    return content.map(item => collectContentText(item)).join('')
  }
  if (typeof content === 'object') {
    if (typeof content.text === 'string') return content.text
    if (Array.isArray(content.text)) return content.text.map(val => collectContentText(val)).join('')
    if (typeof content.output_text === 'string') return content.output_text
    if (Array.isArray(content.output_text)) return content.output_text.map(val => collectContentText(val)).join('')
    if (typeof content.content === 'string') return content.content
    if (Array.isArray(content.content)) return content.content.map(val => collectContentText(val)).join('')
    if (typeof content.value === 'string') return content.value
  }
  return ''
}

function collectChatDeltaText(chunk) {
  if (!chunk) return ''
  const pieces = []
  const choices = Array.isArray(chunk?.choices) ? chunk.choices : []
  for (const choice of choices) {
    const deltaText = collectContentText(choice?.delta?.content)
    if (deltaText) {
      pieces.push(deltaText)
    } else {
      const messageText = collectContentText(choice?.message?.content)
      if (messageText) pieces.push(messageText)
    }
  }
  return pieces.join('')
}

function collectChatReasoningContent(reasoningContent) {
  if (reasoningContent == null) return ''
  if (typeof reasoningContent === 'string' || typeof reasoningContent === 'number') {
    return String(reasoningContent)
  }
  const pieces = []
  const items = Array.isArray(reasoningContent) ? reasoningContent : [reasoningContent]
  for (const item of items) {
    if (item == null) continue
    if (typeof item === 'string' || typeof item === 'number') {
      if (String(item)) pieces.push(String(item))
      continue
    }
    if (typeof item.text === 'string') {
      if (item.text) pieces.push(item.text)
      continue
    }
    if (Array.isArray(item.text)) {
      const text = collectContentText(item.text)
      if (text) pieces.push(text)
      continue
    }
    if (typeof item.content === 'string') {
      if (item.content) pieces.push(item.content)
      continue
    }
    if (Array.isArray(item.content)) {
      const text = collectContentText(item.content)
      if (text) pieces.push(text)
      continue
    }
    const fallback = collectContentText(item)
    if (fallback) pieces.push(fallback)
  }
  return pieces.join('')
}

function extractOutputText(res) {
  // SDK convenience property
  if (res && typeof res.output_text === 'string' && res.output_text.length) return res.output_text
  try {
    // Try Responses API shape
    const parts = res?.output ?? res?.choices ?? []
    if (Array.isArray(parts) && parts.length) {
      const first = parts[0]
      const content = first?.content ?? first?.message?.content ?? first
      const text = collectContentText(content)
      if (text) return text
    }
    const dataContent = res?.data?.[0]?.content
    const dataText = collectContentText(dataContent)
    if (dataText) return dataText
    if (Array.isArray(res?.choices)) {
      for (const choice of res.choices) {
        const msgText = collectContentText(choice?.message?.content)
        if (msgText) return msgText
        const deltaText = collectContentText(choice?.delta?.content)
        if (deltaText) return deltaText
      }
    }
  } catch {}
  return JSON.stringify(res)
}

function extractReasoningSummary(res) {
  const collect = (out) => {
    if (!Array.isArray(out)) return ''
    const order = []
    for (const item of out) {
      if (item && item.type === 'reasoning') {
        const parts = Array.isArray(item.summary) ? item.summary : []
        for (const part of parts) {
          if (part && typeof part.text === 'string') {
            order.push(part.text)
          }
        }
      }
    }
    if (!order.length) return ''
    const joined = order.join('\n\n\n')
    return joined.replace(/\n{4,}/g, '\n\n\n')
  }
  try {
    const direct = collect(res?.output)
    if (direct) return direct
  } catch {}
  try {
    const nested = collect(res?.response?.output)
    if (nested) return nested
  } catch {}
  return ''
}

function extractChatReasoningSummary(res) {
  try {
    const choices = Array.isArray(res?.choices) ? res.choices : []
    if (!choices.length) return ''
    const summaryByIndex = new Map()
    for (const choice of choices) {
      const idx = Number.isFinite(Number(choice?.index)) ? Number(choice.index) : summaryByIndex.size
      const messageSummary = collectChatReasoningContent(choice?.message?.reasoning_content)
      const deltaSummary = collectChatReasoningContent(choice?.delta?.reasoning_content)
      const combined = messageSummary || deltaSummary
      if (combined) summaryByIndex.set(idx, combined)
    }
    if (!summaryByIndex.size) return ''
    const ordered = Array.from(summaryByIndex.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, text]) => (typeof text === 'string' ? text : ''))
      .filter(Boolean)
    if (!ordered.length) return ''
    const joined = ordered.join('\n\n\n')
    return joined.replace(/\n{4,}/g, '\n\n\n')
  } catch {}
  return ''
}

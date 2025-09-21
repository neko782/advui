// Client-side OpenAI Responses API helper
// Uses the official OpenAI SDK only (no fetch fallback)

import OpenAI from 'openai'
import { loadSettings } from './settingsStore.js'

export async function getClient() {
  const { apiKey } = loadSettings()
  if (!apiKey) return null
  return new OpenAI({ apiKey, dangerouslyAllowBrowser: true })
}

// Create a response using either a single prompt string or an array of messages
// Messages should be of the form: { role: 'system'|'user'|'assistant', content: string }
export async function respond({ prompt, messages, model }) {
  const { apiKey } = loadSettings()
  if (!apiKey) throw new Error('Missing OpenAI API key. Set it in Settings.')
  const s = loadSettings()
  const useModel = model || s?.defaultChat?.model || s?.model || 'gpt-4o-mini'

  // SDK call only
  const client = await getClient()
  if (!client?.responses?.create) {
    throw new Error('OpenAI SDK is not available or is outdated.')
  }
  let input
  if (Array.isArray(messages) && messages.length) {
    // Normalize: strip extra fields like ids/typing and keep valid roles only
    const allowed = new Set(['system', 'user', 'assistant'])
    input = messages
      .filter(m => m && typeof m.content === 'string' && allowed.has(m.role))
      .map(({ role, content }) => ({ role, content }))
  } else {
    input = typeof prompt === 'string' ? prompt : ''
  }
  const res = await client.responses.create({ model: useModel, input })
  return extractOutputText(res)
}

// List available models via the official SDK
export async function listModels() {
  const client = await getClient()
  if (!client) throw new Error('Missing OpenAI API key. Set it in Settings.')
  if (!client?.models?.list) throw new Error('OpenAI SDK does not support listing models.')
  const res = await client.models.list()
  const items = Array.isArray(res?.data) ? res.data : []
  return sortModels(items).map(m => m.id)
}

// List models using a provided API key (without saving it)
export async function listModelsWithKey(apiKey) {
  if (!apiKey) throw new Error('Missing OpenAI API key.')
  const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true })
  if (!client?.models?.list) throw new Error('OpenAI SDK does not support listing models.')
  const res = await client.models.list()
  const items = Array.isArray(res?.data) ? res.data : []
  return sortModels(items).map(m => m.id)
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

function extractOutputText(res) {
  // SDK convenience property
  if (res && typeof res.output_text === 'string' && res.output_text.length) return res.output_text
  try {
    // Try Responses API shape
    const parts = res?.output ?? res?.choices ?? []
    // Walk common shapes
    const text =
      parts?.[0]?.content?.[0]?.text ??
      parts?.[0]?.message?.content ??
      res?.data?.[0]?.content?.[0]?.text ??
      ''
    if (typeof text === 'string' && text) return text
  } catch {}
  return JSON.stringify(res)
}

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
  const useModel = model || loadSettings().model || 'gpt-4o-mini'

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

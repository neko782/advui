import { loadSettings, findConnection } from '../../settingsStore.js'

/**
 * Resolves the connection context including settings, active connection, and API key
 * @param {Object} currentSettings - Current settings object
 * @param {string|null} preferredConnectionId - Preferred connection ID to use
 * @returns {Object} Object containing latestSettings, activeConnection, connectionId, and apiKey
 */
export function resolveConnectionContext(currentSettings, preferredConnectionId) {
  let latestSettings = currentSettings
  try {
    latestSettings = loadSettings()
  } catch {}

  let activeConnection = null
  try {
    activeConnection = findConnection(latestSettings, preferredConnectionId)
  } catch {}

  const connectionId = activeConnection?.id || preferredConnectionId || latestSettings?.selectedConnectionId || null
  const apiKey = typeof activeConnection?.apiKey === 'string' ? activeConnection.apiKey : ''

  return { latestSettings, activeConnection, connectionId, apiKey }
}
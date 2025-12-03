// Connection resolution helpers
import { loadSettings, findConnection } from '../../settingsStore.js';
import type { AppSettings, Connection } from '../../types/index.js';

export interface ConnectionContext {
  connectionId: string | null;
  apiKey: string;
  activeConnection: Connection | null;
  latestSettings: AppSettings;
}

export function resolveConnectionContext(
  currentSettings: Partial<AppSettings> | null,
  preferredConnectionId: string | null | undefined
): ConnectionContext {
  // Always try to load the latest settings
  let latestSettings: AppSettings;
  try {
    latestSettings = loadSettings();
  } catch {
    latestSettings = currentSettings as AppSettings;
  }

  // Determine which connection ID to use
  const connectionIdToUse = preferredConnectionId ?? currentSettings?.selectedConnectionId ?? null;

  // Try to find the connection
  let activeConnection: Connection | null = null;
  try {
    activeConnection = findConnection(latestSettings, connectionIdToUse) ?? null;
  } catch {
    activeConnection = null;
  }

  // Extract API key, ensuring it's a string
  const apiKey = (activeConnection && typeof activeConnection.apiKey === 'string') 
    ? activeConnection.apiKey 
    : '';

  return {
    connectionId: connectionIdToUse,
    apiKey,
    activeConnection,
    latestSettings,
  };
}

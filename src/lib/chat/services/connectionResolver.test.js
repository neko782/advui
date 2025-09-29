import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveConnectionContext } from './connectionResolver.js'
import * as settingsStore from '../../settingsStore.js'

vi.mock('../../settingsStore.js', () => ({
  loadSettings: vi.fn(),
  findConnection: vi.fn(),
}))

describe('resolveConnectionContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should load latest settings and return them', () => {
    const currentSettings = { selectedConnectionId: 'conn1' }
    const latestSettings = { selectedConnectionId: 'conn2' }

    settingsStore.loadSettings.mockReturnValue(latestSettings)
    settingsStore.findConnection.mockReturnValue(null)

    const result = resolveConnectionContext(currentSettings, 'conn2')

    expect(settingsStore.loadSettings).toHaveBeenCalled()
    expect(result.latestSettings).toEqual(latestSettings)
    expect(result.connectionId).toBe('conn2')
  })

  it('should use active connection when found', () => {
    const currentSettings = { selectedConnectionId: 'conn1' }
    const activeConnection = { id: 'conn2', apiKey: 'test-key' }

    settingsStore.loadSettings.mockReturnValue(currentSettings)
    settingsStore.findConnection.mockReturnValue(activeConnection)

    const result = resolveConnectionContext(currentSettings, 'conn2')

    expect(result.activeConnection).toEqual(activeConnection)
    expect(result.connectionId).toBe('conn2')
    expect(result.apiKey).toBe('test-key')
  })

  it('should fall back to selectedConnectionId from settings', () => {
    const currentSettings = { selectedConnectionId: 'fallback-conn' }

    settingsStore.loadSettings.mockReturnValue(currentSettings)
    settingsStore.findConnection.mockReturnValue(null)

    const result = resolveConnectionContext(currentSettings, null)

    expect(result.connectionId).toBe('fallback-conn')
    expect(result.apiKey).toBe('')
  })

  it('should use preferredConnectionId if provided', () => {
    const currentSettings = { selectedConnectionId: 'fallback-conn' }
    const activeConnection = { id: 'preferred-conn', apiKey: 'key123' }

    settingsStore.loadSettings.mockReturnValue(currentSettings)
    settingsStore.findConnection.mockReturnValue(activeConnection)

    const result = resolveConnectionContext(currentSettings, 'preferred-conn')

    expect(settingsStore.findConnection).toHaveBeenCalledWith(currentSettings, 'preferred-conn')
    expect(result.connectionId).toBe('preferred-conn')
  })

  it('should handle loadSettings throwing error', () => {
    const currentSettings = { selectedConnectionId: 'conn1' }

    settingsStore.loadSettings.mockImplementation(() => {
      throw new Error('Settings load failed')
    })
    settingsStore.findConnection.mockReturnValue(null)

    const result = resolveConnectionContext(currentSettings, 'conn1')

    expect(result.latestSettings).toEqual(currentSettings)
    expect(result.connectionId).toBe('conn1')
  })

  it('should handle findConnection throwing error', () => {
    const currentSettings = { selectedConnectionId: 'conn1' }

    settingsStore.loadSettings.mockReturnValue(currentSettings)
    settingsStore.findConnection.mockImplementation(() => {
      throw new Error('Find connection failed')
    })

    const result = resolveConnectionContext(currentSettings, 'conn1')

    expect(result.activeConnection).toBe(null)
    expect(result.apiKey).toBe('')
  })

  it('should return empty apiKey when activeConnection has no apiKey', () => {
    const currentSettings = { selectedConnectionId: 'conn1' }
    const activeConnection = { id: 'conn1' }

    settingsStore.loadSettings.mockReturnValue(currentSettings)
    settingsStore.findConnection.mockReturnValue(activeConnection)

    const result = resolveConnectionContext(currentSettings, 'conn1')

    expect(result.apiKey).toBe('')
  })

  it('should return empty apiKey when activeConnection.apiKey is not a string', () => {
    const currentSettings = { selectedConnectionId: 'conn1' }
    const activeConnection = { id: 'conn1', apiKey: 12345 }

    settingsStore.loadSettings.mockReturnValue(currentSettings)
    settingsStore.findConnection.mockReturnValue(activeConnection)

    const result = resolveConnectionContext(currentSettings, 'conn1')

    expect(result.apiKey).toBe('')
  })
})
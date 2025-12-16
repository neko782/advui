<script lang="ts">
  import { loadSettings, saveSettings } from './settingsStore'
  import { setModelsCache, loadModelsCache, loadAllModelCaches } from './modelsStore'
  import { listModelsWithKey } from './openaiClient'
  import { IconClose, IconAdd, IconVisibility, IconVisibilityOff, IconAutorenew, IconDelete, IconDownload, IconUpload, IconDragHandle } from './icons'
  import { getThemeState, setThemeMode, subscribeTheme } from './themeStore'
  import { exportAllData, importAllData, importChat } from './utils/exportImport'
  import { onMount } from 'svelte'
  import type { AppSettings, Preset, Connection, ThemeState, ThemeMode, ReasoningEffort, TextVerbosity, ReasoningSummary } from './types'

  interface Props {
    open?: boolean
    onClose?: () => void
    onSaved?: () => void
  }

  const props: Props = $props()

  let local = $state<AppSettings>(loadSettings())
  let modelCacheByConnection = $state<Record<string, { ids: string[], fetchedAt: number }>>({})
  let modelCacheLoaded = $state(false)
  let revealKey = $state(false)
  let refreshingConnectionId = $state('')
  let connectionFormReady = $state(false)

  // Lazy load model cache when connection tab is accessed
  $effect(() => {
    if (activeTab === 'connection' && !modelCacheLoaded) {
      // Defer to next frame to avoid blocking tab switch
      requestAnimationFrame(() => {
        modelCacheByConnection = loadAllModelCaches()
        modelCacheLoaded = true
      })
    }
  })

  // Defer rendering connection form to avoid Firefox password manager blocking
  $effect(() => {
    if (activeTab === 'connection') {
      connectionFormReady = false
      // Wait for tab render, then show form
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          connectionFormReady = true
        })
      })
    }
  })
  let refreshMessages = $state<Record<string, string>>({})
  let activePresetId = $state('')
  let activeConnectionId = $state('')
  let expandedPresetGroups = $state<{ general: boolean, sampling: boolean, reasoning: boolean }>({ general: false, sampling: false, reasoning: false })
  
  // Drag and drop state
  let draggedConnectionId = $state<string | null>(null)
  let draggedPresetId = $state<string | null>(null)
  let dragOverConnectionId = $state<string | null>(null)
  let dragOverPresetId = $state<string | null>(null)
  
  const TABS = [
    { id: 'general', label: 'General' },
    { id: 'connection', label: 'Connections' },
    { id: 'presets', label: 'Presets' },
    { id: 'developer', label: 'Developer' },
  ]
  let activeTab = $state<'general' | 'connection' | 'presets' | 'developer'>('general')
  let themeState = $state<ThemeState>({ mode: 'system', theme: 'light' })

  function togglePresetGroup(group) {
    expandedPresetGroups = { ...expandedPresetGroups, [group]: !expandedPresetGroups[group] }
  }

  // Import/Export state
  let importExportStatus = $state('')
  let importExportWorking = $state(false)

  onMount(() => {
    themeState = getThemeState()
    const unsubscribe = subscribeTheme((next) => {
      themeState = next
    })
    return () => {
      unsubscribe()
    }
  })

  const REASONING_OPTIONS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
  const TEXT_VERBOSITY_OPTIONS = ['low', 'medium', 'high']
  const REASONING_SUMMARY_OPTIONS = ['auto', 'concise', 'detailed']
  const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.'

  function parseMaxTokens(value) {
    if (value === '' || value == null) return null
    const num = Number(value)
    if (!Number.isFinite(num)) return null
    const rounded = Math.max(1, Math.floor(num))
    return Number.isFinite(rounded) ? rounded : null
  }

  function parseTopP(value) {
    if (value === '' || value == null) return null
    const num = Number(value)
    if (!Number.isFinite(num)) return null
    return Math.min(1, Math.max(0, num))
  }

  function parseTemperature(value) {
    if (value === '' || value == null) return null
    const num = Number(value)
    if (!Number.isFinite(num)) return null
    return Math.min(2, Math.max(0, num))
  }

  function parseReasoning(value) {
    return REASONING_OPTIONS.includes(value) ? value : 'none'
  }

  function parseVerbosity(value) {
    return TEXT_VERBOSITY_OPTIONS.includes(value) ? value : 'medium'
  }

  function parseReasoningSummary(value) {
    return REASONING_SUMMARY_OPTIONS.includes(value) ? value : 'auto'
  }

  function parseThinkingBudget(value) {
    return parseMaxTokens(value)
  }

  function genPresetId() {
    return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  }

  const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1'

  function genConnectionId() {
    return `connection_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  }

  function syncActiveConnection() {
    let list = Array.isArray(local?.connections) ? local.connections : []
    if (!list.length) {
      const conn = {
        id: genConnectionId(),
        name: 'Connection 1',
        apiKey: '',
        apiBaseUrl: DEFAULT_API_BASE_URL,
        apiMode: 'responses',
      }
      local.connections = [conn]
      list = local.connections
    }
    const hasActive = list.some(c => c?.id === activeConnectionId)
    const fallback = list.find(c => c?.id === local?.selectedConnectionId)
      || list[0]
      || null
    const nextId = hasActive ? activeConnectionId : (fallback?.id || '')
    if (nextId !== activeConnectionId) activeConnectionId = nextId
    if (nextId && local.selectedConnectionId !== nextId) {
      local.selectedConnectionId = nextId
    }
    const active = list.find(c => c?.id === nextId) || fallback || null
    const mode = typeof active?.apiMode === 'string' && active.apiMode ? active.apiMode : 'responses'
    local.apiMode = mode
  }

  function syncActivePreset() {
    const list = Array.isArray(local?.presets) ? local.presets : []
    if (!list.length) {
      local.presets = [{
        id: genPresetId(),
        name: 'Preset 1',
        model: 'gpt-5',
      streaming: true,
      maxOutputTokens: null,
      topP: null,
      temperature: null,
      reasoningEffort: 'none',
      textVerbosity: 'medium',
      reasoningSummary: 'auto',
      connectionId: local?.selectedConnectionId || activeConnectionId || (local?.connections?.[0]?.id || ''),
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
    }]
  }
    const updatedList = Array.isArray(local?.presets) ? local.presets : []
    const hasActive = updatedList.some(p => p?.id === activePresetId)
    const fallback = updatedList.find(p => p?.id === local?.selectedPresetId)
      || updatedList[0]
      || null
    const nextId = hasActive ? activePresetId : (fallback?.id || '')
    if (nextId !== activePresetId) activePresetId = nextId
    if (nextId && local.selectedPresetId !== nextId) {
      local.selectedPresetId = nextId
    }
  }

  const activePreset = $derived((() => {
    const list = Array.isArray(local?.presets) ? local.presets : []
    const found = list.find(p => p?.id === activePresetId)
    return found || list[0] || null
  })())

  const activeConnection = $derived((() => {
    const list = Array.isArray(local?.connections) ? local.connections : []
    const found = list.find(c => c?.id === activeConnectionId)
    const fallback = list.find(c => c?.id === local?.selectedConnectionId)
    return found || fallback || list[0] || null
  })())

  const activeConnectionModels = $derived((() => {
    const entry = modelCacheByConnection?.[activeConnectionId]
    return Array.isArray(entry?.ids) ? entry.ids : []
  })())

  const activeRefreshMsg = $derived((refreshMessages?.[activeConnectionId]) || '')
  const activeConnectionRefreshing = $derived(refreshingConnectionId === activeConnectionId)

  const activePresetModels = $derived((() => {
    const connectionId = activePreset?.connectionId
    if (!connectionId) return []
    const entry = modelCacheByConnection?.[connectionId]
    return Array.isArray(entry?.ids) ? entry.ids : []
  })())

  let persistTimer: ReturnType<typeof setTimeout> | null = null
  function persistSettings(): void {
    // Debounce to avoid blocking on rapid state changes
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      syncActiveConnection()
      syncActivePreset()
      saveSettings(local)
      try { props.onSaved?.() } catch {}
    }, 0)
  }

  function selectPreset(id) {
    if (!id) return
    activePresetId = id
    local.selectedPresetId = id
    persistSettings()
  }

  function addPreset() {
    const list = Array.isArray(local?.presets) ? local.presets.slice() : []
    const base = activePreset || list[list.length - 1] || { model: 'gpt-5', streaming: true }
    const count = list.length + 1
    let name = `Preset ${count}`
    const names = new Set(list.map(p => p?.name).filter(Boolean))
    while (names.has(name)) {
      name = `Preset ${Math.floor(Math.random() * 90) + 10}`
    }
    const preset = {
      id: genPresetId(),
      name,
      model: base?.model || 'gpt-5',
      streaming: typeof base?.streaming === 'boolean' ? base.streaming : true,
      maxOutputTokens: base?.maxOutputTokens ?? null,
      topP: base?.topP ?? null,
      temperature: base?.temperature ?? null,
      reasoningEffort: base?.reasoningEffort || 'none',
      textVerbosity: base?.textVerbosity || 'medium',
      reasoningSummary: base?.reasoningSummary || 'auto',
      connectionId: base?.connectionId || local?.selectedConnectionId || activeConnectionId || (local?.connections?.[0]?.id || ''),
      systemPrompt: typeof base?.systemPrompt === 'string' ? base.systemPrompt : DEFAULT_SYSTEM_PROMPT,
    }
    local.presets = [...list, preset]
    activePresetId = preset.id
    local.selectedPresetId = preset.id
    persistSettings()
  }

  function updateActivePreset(patch) {
    const list = Array.isArray(local?.presets) ? local.presets : []
    const idx = list.findIndex(p => p?.id === activePresetId)
    if (idx < 0) return
    const next = [...list]
    next[idx] = { ...next[idx], ...patch }
    local.presets = next
    persistSettings()
  }

  function removePreset(id) {
    const list = Array.isArray(local?.presets) ? local.presets : []
    if (list.length <= 1) return
    const next = list.filter(p => p?.id !== id)
    if (!next.length) return
    local.presets = next
    const fallback = next.find(p => p?.id === local.selectedPresetId) || next[0]
    activePresetId = fallback?.id || ''
    local.selectedPresetId = fallback?.id || ''
    persistSettings()
  }

  function selectConnection(id) {
    if (!id) return
    activeConnectionId = id
    local.selectedConnectionId = id
    const list = Array.isArray(local?.connections) ? local.connections : []
    const found = list.find(c => c?.id === id)
    const nextMode = typeof found?.apiMode === 'string' && found.apiMode ? found.apiMode : 'responses'
    local.apiMode = nextMode
    persistSettings()
  }

  function addConnection() {
    const list = Array.isArray(local?.connections) ? local.connections.slice() : []
    const base = activeConnection || list[list.length - 1] || null
    const count = list.length + 1
    let name = `Connection ${count}`
    const names = new Set(list.map(c => c?.name).filter(Boolean))
    while (names.has(name)) {
      name = `Connection ${Math.floor(Math.random() * 90) + 10}`
    }
    const id = genConnectionId()
    const connection = {
      id,
      name,
      apiKey: '',
      apiBaseUrl: base?.apiBaseUrl || DEFAULT_API_BASE_URL,
      apiMode: base?.apiMode || 'responses',
    }
    local.connections = [...list, connection]
    modelCacheByConnection = { ...modelCacheByConnection, [id]: { ids: [], fetchedAt: 0 } }
    activeConnectionId = id
    persistSettings()
  }

  function updateActiveConnection(patch) {
    const list = Array.isArray(local?.connections) ? local.connections : []
    const idx = list.findIndex(c => c?.id === activeConnectionId)
    if (idx < 0) return
    const next = [...list]
    const current = next[idx] || {}
    const updated = { ...current, ...patch }
    next[idx] = updated
    local.connections = next
    const shouldClearModels = ['apiKey', 'apiBaseUrl'].some((key) => Object.prototype.hasOwnProperty.call(patch || {}, key))
    if (shouldClearModels) {
      setModelsCache(current.id, [])
      const cache = { ...modelCacheByConnection, [current.id]: { ids: [], fetchedAt: 0 } }
      modelCacheByConnection = cache
    }
    persistSettings()
  }

  function removeConnection(id) {
    const list = Array.isArray(local?.connections) ? local.connections : []
    if (list.length <= 1) return
    const next = list.filter(c => c?.id !== id)
    if (!next.length) return
    local.connections = next
    if (local.selectedConnectionId === id) {
      local.selectedConnectionId = next[0]?.id || ''
    }
    if (activeConnectionId === id) {
      activeConnectionId = next.find(c => c?.id === local.selectedConnectionId)?.id || next[0]?.id || ''
    }
    const fallbackId = local.selectedConnectionId || activeConnectionId || next[0]?.id || ''
    if (Array.isArray(local?.presets)) {
      local.presets = local.presets.map(p => (p?.connectionId === id ? { ...p, connectionId: fallbackId } : p))
    }
    const cache = { ...modelCacheByConnection }
    delete cache[id]
    modelCacheByConnection = cache
    const msgs = { ...refreshMessages }
    delete msgs[id]
    refreshMessages = msgs
    if (refreshingConnectionId === id) refreshingConnectionId = ''
    persistSettings()
  }

  function reorderConnections(fromId: string, toId: string) {
    if (fromId === toId) return
    const list = Array.isArray(local?.connections) ? local.connections.slice() : []
    const fromIndex = list.findIndex(c => c.id === fromId)
    const toIndex = list.findIndex(c => c.id === toId)
    if (fromIndex < 0 || toIndex < 0) return
    const [moved] = list.splice(fromIndex, 1)
    list.splice(toIndex, 0, moved)
    local.connections = list
    persistSettings()
  }

  function reorderPresets(fromId: string, toId: string) {
    if (fromId === toId) return
    const list = Array.isArray(local?.presets) ? local.presets.slice() : []
    const fromIndex = list.findIndex(p => p.id === fromId)
    const toIndex = list.findIndex(p => p.id === toId)
    if (fromIndex < 0 || toIndex < 0) return
    const [moved] = list.splice(fromIndex, 1)
    list.splice(toIndex, 0, moved)
    local.presets = list
    persistSettings()
  }

  function handleConnectionDragStart(e: DragEvent, id: string) {
    draggedConnectionId = id
    e.dataTransfer!.effectAllowed = 'move'
    e.dataTransfer!.setData('text/plain', id)
  }

  function handleConnectionDragOver(e: DragEvent, id: string) {
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'
    dragOverConnectionId = id
  }

  function handleConnectionDragLeave() {
    dragOverConnectionId = null
  }

  function handleConnectionDrop(e: DragEvent, toId: string) {
    e.preventDefault()
    if (draggedConnectionId && draggedConnectionId !== toId) {
      reorderConnections(draggedConnectionId, toId)
    }
    draggedConnectionId = null
    dragOverConnectionId = null
  }

  function handleConnectionDragEnd() {
    draggedConnectionId = null
    dragOverConnectionId = null
  }

  function handlePresetDragStart(e: DragEvent, id: string) {
    draggedPresetId = id
    e.dataTransfer!.effectAllowed = 'move'
    e.dataTransfer!.setData('text/plain', id)
  }

  function handlePresetDragOver(e: DragEvent, id: string) {
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'
    dragOverPresetId = id
  }

  function handlePresetDragLeave() {
    dragOverPresetId = null
  }

  function handlePresetDrop(e: DragEvent, toId: string) {
    e.preventDefault()
    if (draggedPresetId && draggedPresetId !== toId) {
      reorderPresets(draggedPresetId, toId)
    }
    draggedPresetId = null
    dragOverPresetId = null
  }

  function handlePresetDragEnd() {
    draggedPresetId = null
    dragOverPresetId = null
  }

  async function handleExportAllData() {
    if (importExportWorking) return
    importExportWorking = true
    importExportStatus = 'Exporting data...'
    try {
      await exportAllData()
      importExportStatus = 'Export successful!'
      setTimeout(() => {
        importExportStatus = ''
      }, 3000)
    } catch (err) {
      console.error('Export failed:', err)
      importExportStatus = `Export failed: ${err.message}`
      setTimeout(() => {
        importExportStatus = ''
      }, 5000)
    } finally {
      importExportWorking = false
    }
  }

  async function handleImportAllData() {
    if (importExportWorking) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.tar'
    input.onchange = async (e) => {
      const file = e.target.files?.[0]
      if (!file) return

      importExportWorking = true
      importExportStatus = 'Importing data...'
      try {
        const results = await importAllData(file)
        let msg = `Import complete: ${results.chatsImported} chats`
        if (results.imagesImported > 0) {
          msg += `, ${results.imagesImported} images`
        }
        if (results.settingsImported) {
          msg += ', settings'
        }
        if (results.errors.length > 0) {
          msg += ` (${results.errors.length} errors)`
        }
        importExportStatus = msg
        setTimeout(() => {
          importExportStatus = ''
          // Refresh the page to reload all data
          if (results.chatsImported > 0 || results.settingsImported) {
            window.location.reload()
          }
        }, 3000)
      } catch (err) {
        console.error('Import failed:', err)
        importExportStatus = `Import failed: ${err.message}`
        setTimeout(() => {
          importExportStatus = ''
        }, 5000)
      } finally {
        importExportWorking = false
      }
    }
    input.click()
  }

  async function handleImportChat() {
    if (importExportWorking) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = e.target.files?.[0]
      if (!file) return

      importExportWorking = true
      importExportStatus = 'Importing chat...'
      try {
        const result = await importChat(file)
        importExportStatus = 'Chat imported successfully!'
        setTimeout(() => {
          importExportStatus = ''
          // Refresh the page to show the new chat
          window.location.reload()
        }, 2000)
      } catch (err) {
        console.error('Import failed:', err)
        importExportStatus = `Import failed: ${err.message}`
        setTimeout(() => {
          importExportStatus = ''
        }, 5000)
      } finally {
        importExportWorking = false
      }
    }
    input.click()
  }

  async function close() {
    // Reset local state to the persisted settings the next time we open
    local = loadSettings()
    modelCacheByConnection = {}
    modelCacheLoaded = false
    connectionFormReady = false
    activePresetId = local?.selectedPresetId || local?.presets?.[0]?.id || ''
    activeConnectionId = local?.selectedConnectionId || local?.connections?.[0]?.id || ''
    activeTab = 'general'
    revealKey = false
    refreshingConnectionId = ''
    refreshMessages = {}
    importExportStatus = ''
    importExportWorking = false
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    props.onClose?.()
  }

  function setTab(id) {
    if (TABS.some(tab => tab.id === id)) {
      activeTab = id
    }
  }
  async function refreshModelsNow(targetId = activeConnectionId, { quiet = false } = {}) {
    const list = Array.isArray(local?.connections) ? local.connections : []
    const connection = list.find(c => c?.id === targetId)
    if (!connection) {
      if (!quiet) {
        refreshMessages = { ...refreshMessages, [targetId]: 'Select or add a connection first.' }
      }
      return
    }
    if (!connection.apiKey) {
      if (!quiet) {
        refreshMessages = { ...refreshMessages, [targetId]: 'Enter an API key first.' }
      }
      return
    }
    refreshingConnectionId = targetId
    if (!quiet) {
      refreshMessages = { ...refreshMessages, [targetId]: 'Connecting…' }
    }
    try {
      const ids = await listModelsWithKey(connection.apiKey, connection.apiBaseUrl)
      setModelsCache(targetId, ids)
      modelCacheByConnection = { ...modelCacheByConnection, [targetId]: { ids, fetchedAt: Date.now() } }
      refreshMessages = { ...refreshMessages, [targetId]: `Connected ✓ Fetched ${ids.length} models.` }
    } catch (err) {
      const msg = err?.message || 'Failed to refresh models.'
      refreshMessages = { ...refreshMessages, [targetId]: `Error: ${msg}` }
    } finally {
      if (refreshingConnectionId === targetId) refreshingConnectionId = ''
    }
  }

  // Defer sync to avoid blocking during initialization
  $effect(() => {
    queueMicrotask(() => {
      syncActiveConnection()
      syncActivePreset()
    })
  })
</script>

<svelte:window onkeydown={(e) => { if (props.open && e.key === 'Escape') close() }} />

{#if props.open}
  <button type="button" class="backdrop" aria-label="Close settings overlay" onclick={close}></button>
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-label="Settings"
    tabindex="-1"
    onpointerdown={(event) => { if (event.target === event.currentTarget) close() }}
  >
    <div class="panel">
      <header class="modal-head">
        <div class="title">Settings</div>
        <button class="icon-btn" onclick={close} aria-label="Close">
          <IconClose style="font-size: 20px;" />
        </button>
      </header>
      <div class="tab-bar" role="tablist" aria-label="Settings sections">
        {#each TABS as tab}
          <button
            id={`settings-tab-${tab.id}`}
            type="button"
            role="tab"
            class={`tab ${tab.id === activeTab ? 'active' : ''}`}
            aria-selected={tab.id === activeTab}
            tabindex={tab.id === activeTab ? 0 : -1}
            onclick={() => setTab(tab.id)}
          >
            {tab.label}
          </button>
        {/each}
      </div>
      <div
        class="modal-body"
        role="tabpanel"
        aria-labelledby={`settings-tab-${activeTab}`}
      >
        <div class="modal-scroller">
          {#if activeTab === 'general'}
            <section class="group">
              <div class="group-title">Appearance</div>
              <label class="field">
                <span>Theme</span>
                <select
                  value={themeState.mode}
                  onchange={(event) => {
                    const next = event.currentTarget.value
                    themeState = setThemeMode(next)
                  }}
                  aria-label="Theme preference"
                >
                  <option value="system">System default</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <p class="hint">Choose whether to match your device setting or force a light or dark theme.</p>
            </section>
            <section class="group">
              <div class="group-title">Keyboard shortcuts</div>
              <label class="field">
                <span>Send message</span>
                <select
                  value={local.keybinds?.sendMessage || 'Enter'}
                  onchange={(event) => { local.keybinds = { ...local.keybinds, sendMessage: event.currentTarget.value }; persistSettings() }}
                  aria-label="Send message keybind"
                >
                  <option value="Enter">Enter</option>
                  <option value="Shift+Enter">Shift+Enter</option>
                  <option value="Ctrl+Enter">Ctrl+Enter (Cmd+Enter on Mac)</option>
                  <option value="Alt+Enter">Alt+Enter</option>
                  <option value="None">None</option>
                </select>
              </label>
              <label class="field">
                <span>New line</span>
                <select
                  value={local.keybinds?.newLine || 'Shift+Enter'}
                  onchange={(event) => { local.keybinds = { ...local.keybinds, newLine: event.currentTarget.value }; persistSettings() }}
                  aria-label="New line keybind"
                >
                  <option value="Enter">Enter</option>
                  <option value="Shift+Enter">Shift+Enter</option>
                  <option value="Ctrl+Enter">Ctrl+Enter (Cmd+Enter on Mac)</option>
                  <option value="Alt+Enter">Alt+Enter</option>
                  <option value="None">None</option>
                </select>
              </label>
              <p class="hint">Configure keyboard shortcuts for actions in the composer. Does not apply on mobile devices.</p>
            </section>
            <section class="group">
              <div class="group-title">Features</div>
              <label class="switch" title="Show thinking controls">
                <input
                  type="checkbox"
                  checked={!!local.showThinkingSettings}
                  onchange={(event) => {
                    local.showThinkingSettings = !!event.currentTarget.checked
                    persistSettings()
                  }}
                  aria-label="Show thinking controls"
                />
                <span class="switch-ui" aria-hidden="true"></span>
                <span class="switch-label">Anthropic thinking controls</span>
              </label>
              <p class="hint">Enable control of Anthropic-style thinking parameters in chat settings.</p>
            </section>
            <section class="group">
              <div class="group-title">Data</div>
              <div class="data-actions">
                <button
                  type="button"
                  class="data-action-btn"
                  onclick={handleImportChat}
                  disabled={importExportWorking}
                  title="Import a chat from JSON file"
                  aria-label="Import chat"
                >
                  <IconUpload style="font-size: 20px;" />
                  <span>Import chat</span>
                </button>
                <button
                  type="button"
                  class="data-action-btn"
                  onclick={handleExportAllData}
                  disabled={importExportWorking}
                  title="Export all chats, settings, and images as ZIP"
                  aria-label="Export all data"
                >
                  <IconDownload style="font-size: 20px;" />
                  <span>Export all data</span>
                </button>
                <button
                  type="button"
                  class="data-action-btn"
                  onclick={handleImportAllData}
                  disabled={importExportWorking}
                  title="Import all data from ZIP file"
                  aria-label="Import all data"
                >
                  <IconUpload style="font-size: 20px;" />
                  <span>Import all data</span>
                </button>
              </div>
              {#if importExportStatus}
                <p class="hint" aria-live="polite">{importExportStatus}</p>
              {:else}
                <p class="hint">Import and export your chats, settings, and images. Export all data creates a ZIP backup of everything.</p>
              {/if}
            </section>
          {:else if activeTab === 'connection'}
            <section class="group">
              <div class="group-head">
                <div class="group-title">Connections</div>
                <button type="button" class="icon-btn add-btn" title="Add connection" aria-label="Add connection" onclick={addConnection}>
                  <IconAdd style="font-size: 20px;" />
                </button>
              </div>
              <p class="hint section-hint">Manage your API connections. Drag to reorder.</p>
              <div class="item-list">
                {#each (local?.connections || []) as connection (connection.id)}
                  <div
                    class="list-item {connection.id === activeConnectionId ? 'active' : ''} {draggedConnectionId === connection.id ? 'dragging' : ''} {dragOverConnectionId === connection.id && draggedConnectionId !== connection.id ? 'drag-over' : ''}"
                    draggable="true"
                    ondragstart={(e) => handleConnectionDragStart(e, connection.id)}
                    ondragover={(e) => handleConnectionDragOver(e, connection.id)}
                    ondragleave={handleConnectionDragLeave}
                    ondrop={(e) => handleConnectionDrop(e, connection.id)}
                    ondragend={handleConnectionDragEnd}
                    role="listitem"
                  >
                    <button class="drag-handle" aria-label="Drag to reorder">
                      <IconDragHandle style="font-size: 20px;" />
                    </button>
                    <button
                      type="button"
                      class="item-content"
                      onclick={() => selectConnection(connection.id)}
                    >
                      <span class="item-name">{connection?.name || connection?.id || 'Connection'}</span>
                      <span class="item-meta">{connection?.apiBaseUrl || 'Default endpoint'}</span>
                    </button>
                    {#if (local?.connections?.length || 0) > 1}
                      <button
                        type="button"
                        class="item-delete"
                        onclick={() => removeConnection(connection.id)}
                        title="Delete connection"
                        aria-label="Delete connection"
                      >
                        <IconDelete style="font-size: 18px;" />
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>
              {#if activeConnection && connectionFormReady}
                <div class="form-section">
                  <div class="form-section-title">Edit: {activeConnection.name || 'Connection'}</div>
                  <label class="field">
                    <span>Name</span>
                    <input
                      type="text"
                      placeholder="Connection name"
                      value={activeConnection.name || ''}
                      oninput={(event) => updateActiveConnection({ name: event.currentTarget.value })}
                      aria-label="Connection name"
                      autocomplete="off"
                      data-1p-ignore
                      data-lpignore="true"
                    />
                  </label>
                  <label class="field">
                    <span>API Key</span>
                    <div class="row">
                      <input
                        type="text"
                        placeholder="sk-..."
                        value={activeConnection.apiKey || ''}
                        autocomplete="off"
                        oninput={(event) => updateActiveConnection({ apiKey: event.currentTarget.value })}
                        aria-label="API key"
                        data-1p-ignore
                        data-lpignore="true"
                        data-form-type="other"
                        style={revealKey ? '' : '-webkit-text-security: disc; font-family: text-security-disc;'}
                        inputmode="text"
                      />
                      <button class="icon-btn" title={revealKey ? 'Hide key' : 'Show key'} onclick={() => (revealKey = !revealKey)} aria-label={revealKey ? 'Hide key' : 'Show key'}>
                        {#if revealKey}
                          <IconVisibilityOff style="font-size: 20px;" />
                        {:else}
                          <IconVisibility style="font-size: 20px;" />
                        {/if}
                      </button>
                      <button class="icon-btn" title="Test connection & fetch models" onclick={() => refreshModelsNow(activeConnection.id)} aria-label="Refresh models" disabled={activeConnectionRefreshing}>
                        <IconAutorenew style="font-size: 20px;" />
                      </button>
                    </div>
                  </label>
                  <p class="hint">Your key is stored locally in this browser.</p>
                  <label class="field">
                    <span>API base URL</span>
                    <input
                      type="text"
                      placeholder={DEFAULT_API_BASE_URL}
                      value={activeConnection.apiBaseUrl || ''}
                      autocomplete="off"
                      inputmode="url"
                      oninput={(event) => updateActiveConnection({ apiBaseUrl: event.currentTarget.value })}
                      aria-label="API base URL"
                      data-1p-ignore
                      data-lpignore="true"
                    />
                  </label>
                  <p class="hint">Leave blank to use the default OpenAI endpoint.</p>
                  <label class="field">
                    <span>API</span>
                    <select
                      value={activeConnection.apiMode || 'responses'}
                      onchange={(event) => updateActiveConnection({ apiMode: event.currentTarget.value })}
                      aria-label="API mode"
                    >
                      <option value="responses">Responses API</option>
                      <option value="chat_completions">Chat Completions API</option>
                    </select>
                  </label>
                  {#if activeRefreshMsg}
                    <p class="hint status-msg" aria-live="polite">{activeRefreshMsg}</p>
                  {/if}
                </div>
              {/if}
            </section>
          {:else if activeTab === 'presets'}
            <section class="group presets">
              <div class="group-head">
                <div class="group-title">Presets</div>
                <button type="button" class="icon-btn add-btn" title="Add preset" aria-label="Add preset" onclick={addPreset}>
                  <IconAdd style="font-size: 20px;" />
                </button>
              </div>
              <p class="hint section-hint">Configure model presets for different use cases. Drag to reorder.</p>
              <div class="item-list">
                {#each (local.presets || []) as preset (preset.id)}
                  {@const presetConnection = (local?.connections || []).find(c => c.id === preset.connectionId)}
                  <div
                    class="list-item {preset.id === activePresetId ? 'active' : ''} {draggedPresetId === preset.id ? 'dragging' : ''} {dragOverPresetId === preset.id && draggedPresetId !== preset.id ? 'drag-over' : ''}"
                    draggable="true"
                    ondragstart={(e) => handlePresetDragStart(e, preset.id)}
                    ondragover={(e) => handlePresetDragOver(e, preset.id)}
                    ondragleave={handlePresetDragLeave}
                    ondrop={(e) => handlePresetDrop(e, preset.id)}
                    ondragend={handlePresetDragEnd}
                    role="listitem"
                  >
                    <button class="drag-handle" aria-label="Drag to reorder">
                      <IconDragHandle style="font-size: 20px;" />
                    </button>
                    <button
                      type="button"
                      class="item-content"
                      onclick={() => selectPreset(preset.id)}
                    >
                      <span class="item-name">{preset.name || 'Untitled'}</span>
                      <span class="item-meta">{preset.model || 'No model'} · {presetConnection?.name || 'No connection'}</span>
                    </button>
                    {#if (local?.presets?.length || 0) > 1}
                      <button
                        type="button"
                        class="item-delete"
                        onclick={() => removePreset(preset.id)}
                        title="Delete preset"
                        aria-label="Delete preset"
                      >
                        <IconDelete style="font-size: 18px;" />
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>
              {#if activePreset}
                <div class="form-section">
                  <div class="form-section-title">Edit: {activePreset.name || 'Preset'}</div>
                  <label class="field">
                    <span>Name</span>
                    <input
                      type="text"
                      placeholder="Preset name"
                      value={activePreset.name || ''}
                      oninput={(event) => updateActivePreset({ name: event.currentTarget.value })}
                      aria-label="Preset name"
                    />
                  </label>
                  <label class="field">
                    <span>System prompt</span>
                    <textarea
                      rows="3"
                      placeholder={DEFAULT_SYSTEM_PROMPT}
                      value={typeof activePreset.systemPrompt === 'string' ? activePreset.systemPrompt : ''}
                      oninput={(event) => updateActivePreset({ systemPrompt: event.currentTarget.value })}
                      aria-label="System prompt"
                    ></textarea>
                  </label>
                  <label class="field">
                    <span>Model</span>
                    <input
                      type="text"
                      placeholder="gpt-5"
                      value={activePreset.model || ''}
                      oninput={(event) => updateActivePreset({ model: event.currentTarget.value })}
                      list="preset-model-suggestions"
                      aria-label="Model"
                    />
                    {#if activePresetModels?.length}
                      <datalist id="preset-model-suggestions">
                        {#each activePresetModels as mid}
                          <option value={mid}>{mid}</option>
                        {/each}
                      </datalist>
                    {/if}
                  </label>

                  <div class="preset-group-divider"></div>
                <button class="preset-group-header" onclick={() => togglePresetGroup('general')}>
                  <span>General</span>
                  <svg class={`chevron ${expandedPresetGroups.general ? 'expanded' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>

                {#if expandedPresetGroups.general}
                  <label class="switch" title="Stream">
                    <input
                      type="checkbox"
                      checked={!!activePreset.streaming}
                      onchange={(event) => updateActivePreset({ streaming: !!event.currentTarget.checked })}
                      aria-label="Stream"
                    />
                    <span class="switch-ui" aria-hidden="true"></span>
                    <span class="switch-label">Stream</span>
                  </label>
                  <label class="field">
                    <span>Text verbosity</span>
                    <select
                      value={activePreset.textVerbosity || 'medium'}
                      onchange={(event) => updateActivePreset({ textVerbosity: parseVerbosity(event.currentTarget.value) })}
                      aria-label="Text verbosity"
                    >
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                    </select>
                  </label>
                  <label class="field">
                    <span>Connection</span>
                    <select
                      value={activePreset.connectionId || ''}
                      onchange={(event) => updateActivePreset({ connectionId: event.currentTarget.value })}
                      aria-label="Preset connection"
                    >
                      {#each (local?.connections || []) as connection (connection.id)}
                        <option value={connection.id}>{connection?.name || connection?.id || 'Connection'}</option>
                      {/each}
                    </select>
                  </label>
                {/if}

                <div class="preset-group-divider"></div>
                <button class="preset-group-header" onclick={() => togglePresetGroup('sampling')}>
                  <span>Sampling</span>
                  <svg class={`chevron ${expandedPresetGroups.sampling ? 'expanded' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>

                {#if expandedPresetGroups.sampling}
                  <label class="field">
                    <span>Top P</span>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.1"
                      placeholder="Default"
                      value={activePreset.topP ?? ''}
                      oninput={(event) => updateActivePreset({ topP: parseTopP(event.currentTarget.value) })}
                      aria-label="top_p"
                    />
                  </label>
                  <label class="field">
                    <span>Temperature</span>
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      placeholder="Default"
                      value={activePreset.temperature ?? ''}
                      oninput={(event) => updateActivePreset({ temperature: parseTemperature(event.currentTarget.value) })}
                      aria-label="Temperature"
                    />
                  </label>
                {/if}

                <div class="preset-group-divider"></div>
                <button class="preset-group-header" onclick={() => togglePresetGroup('reasoning')}>
                  <span>Reasoning</span>
                  <svg class={`chevron ${expandedPresetGroups.reasoning ? 'expanded' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>

                {#if expandedPresetGroups.reasoning}
                  <label class="field">
                    <span>Reasoning effort</span>
                    <select
                      value={activePreset.reasoningEffort || 'none'}
                      onchange={(event) => updateActivePreset({ reasoningEffort: parseReasoning(event.currentTarget.value) })}
                      aria-label="Reasoning effort"
                    >
                      <option value="none">none</option>
                      <option value="minimal">minimal</option>
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                      <option value="xhigh">xhigh</option>
                    </select>
                  </label>
                  <label class="field">
                    <span>Reasoning summary</span>
                    <select
                      value={activePreset.reasoningSummary || 'auto'}
                      onchange={(event) => updateActivePreset({ reasoningSummary: parseReasoningSummary(event.currentTarget.value) })}
                      aria-label="Reasoning summary"
                    >
                      <option value="auto">auto</option>
                      <option value="concise">concise</option>
                      <option value="detailed">detailed</option>
                    </select>
                  </label>
                  {#if local.showThinkingSettings}
                    <label class="switch" title="Enable Anthropic thinking">
                      <input
                        type="checkbox"
                        checked={!!activePreset.thinkingEnabled}
                        onchange={(event) => updateActivePreset({ thinkingEnabled: !!event.currentTarget.checked })}
                        aria-label="Enable Anthropic thinking"
                      />
                      <span class="switch-ui" aria-hidden="true"></span>
                      <span class="switch-label">Anthropic thinking</span>
                    </label>
                    <label class="field">
                      <span>Thinking budget tokens</span>
                      <input
                        type="number"
                        min="1"
                        step="100"
                        placeholder="Budget tokens"
                        value={activePreset.thinkingBudgetTokens ?? ''}
                        oninput={(event) => updateActivePreset({ thinkingBudgetTokens: parseThinkingBudget(event.currentTarget.value) })}
                        aria-label="Thinking budget tokens"
                        disabled={!activePreset.thinkingEnabled}
                      />
                    </label>
                  {/if}
                {/if}

                <div class="preset-group-divider"></div>
                <label class="switch" title="Enable web search">
                  <input
                    type="checkbox"
                    checked={!!activePreset.webSearchEnabled}
                    onchange={(event) => updateActivePreset({ webSearchEnabled: !!event.currentTarget.checked })}
                    aria-label="Enable web search"
                  />
                  <span class="switch-ui" aria-hidden="true"></span>
                  <span class="switch-label">Web search</span>
                </label>
                <div class="preset-group-divider"></div>
                <label class="switch" title="Enable image generation">
                  <input
                    type="checkbox"
                    checked={!!activePreset.imageGenerationEnabled}
                    onchange={(event) => updateActivePreset({ imageGenerationEnabled: !!event.currentTarget.checked })}
                    aria-label="Enable image generation"
                  />
                  <span class="switch-ui" aria-hidden="true"></span>
                  <span class="switch-label">Image generation</span>
                </label>
                {#if activePreset.imageGenerationEnabled}
                  <label class="field">
                    <span>Image generation model</span>
                    <input
                      type="text"
                      placeholder="gpt-image-1"
                      value={activePreset.imageGenerationModel || ''}
                      oninput={(event) => updateActivePreset({ imageGenerationModel: event.currentTarget.value })}
                      aria-label="Image generation model"
                    />
                  </label>
                {/if}
                </div>
              {/if}
            </section>
          {:else if activeTab === 'developer'}
            <section class="group">
              <div class="group-title">Developer</div>
              <label class="switch" title="Debug Mode">
                <input
                  type="checkbox"
                  bind:checked={local.debug}
                  onchange={() => persistSettings()}
                  aria-label="Debug Mode"
                />
                <span class="switch-ui" aria-hidden="true"></span>
                <span class="switch-label">Debug Mode</span>
              </label>
            </section>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 1000;
    border: 0;
    padding: 0;
  }
  .modal {
    position: fixed; inset: 0;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    z-index: 1001; /* Above app bars */
  }
  .panel {
    width: min(calc(100vw - 48px), 1080px);
    height: min(calc(100vh - 48px), 900px);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 18px;
    box-shadow: var(--float-shadow);
    color: var(--text);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .modal-head { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid var(--border); }
  .title { font-weight: 600; font-size: 1.1rem; }
  .tab-bar { display: flex; gap: 12px; padding: 0 24px; border-bottom: 1px solid var(--border); overflow-x: auto; }
  .tab-bar::-webkit-scrollbar { display: none; }
  .tab {
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    padding: 14px 4px;
    position: relative;
    white-space: nowrap;
    cursor: pointer;
  }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .tab.active { color: var(--text); font-weight: 600; }
  .tab.active::after {
    content: '';
    position: absolute;
    left: 0; right: 0; bottom: 6px;
    height: 2px;
    border-radius: 999px;
    background: var(--accent);
  }
  .modal-body { flex: 1; overflow: hidden; }
  .modal-scroller { height: 100%; overflow-y: auto; padding: 24px; display: grid; gap: 24px; align-content: start; }
  .icon-btn { border: 1px solid var(--border); border-radius: 8px; background: transparent; width: 32px; height: 32px; display: grid; place-items: center; line-height: 1; color: var(--text); }
  .icon-btn:disabled { opacity: .6; cursor: not-allowed; }
  .field { display: grid; gap: 4px; }
  .field > span { font-size: .9rem; color: var(--muted); }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  input[type="text"],
  input[type="password"],
  input[type="number"],
  select,
  textarea {
    flex: 1;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }
  textarea {
    min-height: 96px;
    line-height: 1.4;
    resize: vertical;
  }
  .hint { color: var(--muted); font-size: .9rem; margin-top: 4px; }
  /* API key action buttons size */
  .row .icon-btn { height: 38px; width: 38px; }
  .group { display: grid; gap: 4px; }
  .group-title { font-weight: 600; }
  .group-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .group-head .icon-btn { flex-shrink: 0; }
  .presets .group-head .icon-btn { width: 28px; height: 28px; border-radius: 6px; }
  .preset-group-divider { height: 1px; background: var(--border); margin: 0; }
  .preset-group-header {
    font-size: .8rem;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0 0 4px;
    width: 100%;
    border: none;
    background: transparent;
    padding: 4px 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    user-select: none;
  }
  .preset-group-header:hover { color: var(--text); }
  .chevron {
    transition: transform .2s ease;
    flex-shrink: 0;
  }
  .chevron.expanded {
    transform: rotate(180deg);
  }
  /* Item list for connections and presets */
  .section-hint { margin: 0 0 4px; }
  .item-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 16px;
  }
  .list-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
    border-radius: 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    transition: all 0.15s ease;
  }
  .list-item:hover {
    border-color: color-mix(in srgb, var(--border) 70%, var(--accent) 30%);
  }
  .list-item.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, var(--bg) 92%);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent 80%);
  }
  .list-item.dragging {
    opacity: 0.5;
    border-style: dashed;
  }
  .list-item.drag-over {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, var(--bg) 85%);
    transform: scale(1.01);
  }
  .drag-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 36px;
    color: var(--muted);
    cursor: grab;
    border: none;
    background: transparent;
    border-radius: 6px;
    flex-shrink: 0;
    transition: color 0.15s ease, background 0.15s ease;
  }
  .drag-handle:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--border) 50%, transparent);
  }
  .drag-handle:active {
    cursor: grabbing;
    color: var(--accent);
  }
  .item-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 6px 8px;
    text-align: left;
    border: none;
    background: transparent;
    border-radius: 6px;
    min-width: 0;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .item-content:hover {
    background: color-mix(in srgb, var(--border) 30%, transparent);
  }
  .item-name {
    font-weight: 500;
    font-size: 0.95rem;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .item-meta {
    font-size: 0.8rem;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .item-delete {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    color: var(--muted);
    border: none;
    background: transparent;
    border-radius: 6px;
    flex-shrink: 0;
    cursor: pointer;
    transition: color 0.15s ease, background 0.15s ease;
  }
  .item-delete:hover {
    color: #d64545;
    background: rgba(214, 69, 69, 0.1);
  }
  
  /* Form section styling */
  .form-section {
    display: grid;
    gap: 8px;
    padding: 16px;
    background: color-mix(in srgb, var(--panel) 50%, var(--bg) 50%);
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .form-section-title {
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--text);
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .status-msg {
    padding: 8px 12px;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
  }
  
  /* Add button styling */
  .add-btn {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border-color: color-mix(in srgb, var(--accent) 30%, transparent);
    color: var(--accent);
  }
  .add-btn:hover {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    border-color: var(--accent);
  }
  
  /* Legacy styles kept for backward compatibility */
  .preset-strip { display: flex; flex-wrap: wrap; gap: 6px; }
  .preset-pill { border: 1px solid var(--border); border-radius: 999px; padding: 4px 10px; background: var(--bg); color: var(--text); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-size: .85rem; transition: background-color .15s ease, color .15s ease, border-color .15s ease; }
  .preset-pill:hover { border-color: color-mix(in srgb, var(--border) 55%, var(--accent) 45%); }
  .preset-pill.active { background: var(--accent); border-color: transparent; color: #fff; box-shadow: 0 2px 5px rgba(0,0,0,0.14); }
  .preset-pill-name { pointer-events: none; }
  .preset-delete { display: inline-flex; align-items: center; gap: 6px; border: 1px solid rgba(214,69,69,0.4); border-radius: 8px; padding: 4px 8px; background: transparent; color: #d64545; cursor: pointer; width: fit-content; font-size: .85rem; }
  .preset-delete:hover { background: rgba(214,69,69,0.06); }
  .preset-delete:focus-visible { outline: 2px solid rgba(214,69,69,0.6); outline-offset: 2px; }
  .connection-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  /* Toggle switch */
  .switch { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; }
  .switch > input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
  .switch-ui { width: 42px; height: 24px; border-radius: 999px; background: var(--border); position: relative; transition: background-color .15s ease; box-shadow: inset 0 0 0 1px var(--border); }
  .switch-ui::after { content: ''; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.15); transition: transform .15s ease, background-color .15s ease; }
  :global(:root[data-theme='dark']) .switch-ui { background: #2a2a2a; box-shadow: inset 0 0 0 1px #2f2f2f; }
  :global(:root[data-theme='dark']) .switch-ui::after { background: #e6e6e6; }
  .switch > input:checked + .switch-ui { background: color-mix(in srgb, var(--accent), #0000 70%); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent), #0000 60%); }
  .switch > input:checked + .switch-ui::after { transform: translateX(18px); }
  .switch-label { font-size: .95rem; }
  .data-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .data-action-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    color: var(--text);
    font: inherit;
    cursor: pointer;
    transition: background-color 150ms ease, border-color 150ms ease;
  }
  .data-action-btn:hover:not(:disabled) {
    background: var(--bg);
    border-color: color-mix(in srgb, var(--border), var(--accent) 30%);
  }
  .data-action-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  @media (max-width: 640px) {
    .modal { padding: 12px; }
    .panel { width: 100%; height: 100%; }
    .modal-head { padding: 16px; }
    .tab-bar { padding: 0 16px; }
    .modal-scroller { padding: 16px; }
  }
</style>

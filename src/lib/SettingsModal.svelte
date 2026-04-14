<script lang="ts">
  import { loadSettings, saveSettings } from './settingsStore'
  import { setModelsCache, loadModelsCache, loadAllModelCaches } from './modelsStore'
  import { listModelsWithKey } from './openaiClient'
  import { IconClose, IconAdd, IconVisibility, IconVisibilityOff, IconAutorenew, IconDelete, IconDownload, IconUpload, IconDragHandle, IconTravelExplore, IconCodeBlocks, IconTerminal, IconImagesmode, IconExtension } from './icons'
  import { getThemeState, setThemeMode, subscribeTheme } from './themeStore'
  import { exportAllData, importAllData, importChat } from './utils/exportImport'
  import { onMount } from 'svelte'
  import type { AppSettings, Preset, Connection, ThemeState, ThemeMode, ReasoningEffort, TextVerbosity, ReasoningSummary, MessageActionButton, EditorActionButton, DefaultToolSettings } from './types'
  import { DEFAULT_MESSAGE_ACTIONS, DEFAULT_EDITOR_ACTIONS, DEFAULT_TOOL_SETTINGS } from './types'

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

  // Touch drag state for mobile
  let touchDragType = $state<'connection' | 'preset' | null>(null)
  let touchDragId = $state<string | null>(null)
  let touchCurrentY = $state<number>(0)
  let touchListRef = $state<HTMLElement | null>(null)

  // Simple list getters for rendering
  const connectionsForRender = $derived(() => {
    return Array.isArray(local?.connections) ? local.connections : []
  })

  const presetsForRender = $derived(() => {
    return Array.isArray(local?.presets) ? local.presets : []
  })
  
  const TABS = [
    { id: 'general', label: 'General' },
    { id: 'features', label: 'Features' },
    { id: 'connection', label: 'Connections' },
    { id: 'presets', label: 'Presets' },
  ]
  let activeTab = $state<'general' | 'connection' | 'presets' | 'features'>('general')

  // Message actions drag state
  let draggedActionId = $state<string | null>(null)
  let dragOverActionId = $state<string | null>(null)

  // Getter for current message actions
  const messageActionsForRender = $derived(() => {
    return Array.isArray(local?.messageActions) ? local.messageActions : DEFAULT_MESSAGE_ACTIONS.map(a => ({ ...a }))
  })

  // Getter for current default tools
  const defaultToolsForRender = $derived(() => {
    return local?.defaultTools ?? { ...DEFAULT_TOOL_SETTINGS }
  })

  function toggleMessageAction(id: string) {
    const actions = Array.isArray(local?.messageActions)
      ? local.messageActions.map(a => ({ ...a }))
      : DEFAULT_MESSAGE_ACTIONS.map(a => ({ ...a }))
    const idx = actions.findIndex(a => a.id === id)
    if (idx < 0) return
    actions[idx].enabled = !actions[idx].enabled
    local.messageActions = actions
    persistSettings()
  }

  function reorderMessageActions(fromId: string, toId: string) {
    if (fromId === toId) return
    const actions = Array.isArray(local?.messageActions)
      ? local.messageActions.map(a => ({ ...a }))
      : DEFAULT_MESSAGE_ACTIONS.map(a => ({ ...a }))
    const fromIndex = actions.findIndex(a => a.id === fromId)
    const toIndex = actions.findIndex(a => a.id === toId)
    if (fromIndex < 0 || toIndex < 0) return
    const [moved] = actions.splice(fromIndex, 1)
    actions.splice(toIndex, 0, moved)
    local.messageActions = actions
    persistSettings()
  }

  function handleActionDragStart(e: DragEvent, id: string) {
    draggedActionId = id
    e.dataTransfer!.effectAllowed = 'move'
    e.dataTransfer!.setData('text/plain', id)
  }

  function handleActionDragOver(e: DragEvent, id: string) {
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'
    if (!draggedActionId || draggedActionId === id) return
    dragOverActionId = id
  }

  function handleActionDrop(e: DragEvent) {
    e.preventDefault()
    if (draggedActionId && dragOverActionId && draggedActionId !== dragOverActionId) {
      reorderMessageActions(draggedActionId, dragOverActionId)
    }
    draggedActionId = null
    dragOverActionId = null
  }

  function handleActionDragEnd() {
    draggedActionId = null
    dragOverActionId = null
  }

  // Touch drag for message actions
  let touchActionDragId = $state<string | null>(null)
  let touchActionListRef = $state<HTMLElement | null>(null)

  function handleActionTouchStart(e: TouchEvent, id: string) {
    touchActionDragId = id
    draggedActionId = id
    const listEl = (e.currentTarget as HTMLElement).closest('.item-list')
    if (listEl) touchActionListRef = listEl as HTMLElement
  }

  function handleActionTouchMove(e: TouchEvent) {
    if (!touchActionDragId || !touchActionListRef) return
    e.preventDefault()
    const touchY = e.touches[0].clientY
    const items = touchActionListRef.querySelectorAll('.list-item')
    for (const item of items) {
      const id = item.getAttribute('data-id')
      if (id && id !== touchActionDragId) {
        const rect = item.getBoundingClientRect()
        if (touchY >= rect.top && touchY <= rect.bottom) {
          dragOverActionId = id
          return
        }
      }
    }
  }

  function handleActionTouchEnd() {
    if (touchActionDragId && dragOverActionId) {
      reorderMessageActions(touchActionDragId, dragOverActionId)
    }
    touchActionDragId = null
    touchActionListRef = null
    draggedActionId = null
    dragOverActionId = null
  }

  function updateDefaultTool(key: keyof DefaultToolSettings, value: boolean) {
    const tools = local?.defaultTools ? { ...local.defaultTools } : { ...DEFAULT_TOOL_SETTINGS }
    tools[key] = value
    local.defaultTools = tools
    persistSettings()
  }

  function resetMessageActions() {
    local.messageActions = DEFAULT_MESSAGE_ACTIONS.map(a => ({ ...a }))
    persistSettings()
  }

  // Editor actions
  const editorActionsForRender = $derived(() => {
    return Array.isArray(local?.editorActions) ? local.editorActions : DEFAULT_EDITOR_ACTIONS.map(a => ({ ...a }))
  })

  function toggleEditorAction(id: string) {
    const actions = Array.isArray(local?.editorActions)
      ? local.editorActions.map(a => ({ ...a }))
      : DEFAULT_EDITOR_ACTIONS.map(a => ({ ...a }))
    const idx = actions.findIndex(a => a.id === id)
    if (idx < 0) return
    actions[idx].enabled = !actions[idx].enabled
    local.editorActions = actions
    persistSettings()
  }

  function resetEditorActions() {
    local.editorActions = DEFAULT_EDITOR_ACTIONS.map(a => ({ ...a }))
    persistSettings()
  }
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
  const TEXT_VERBOSITY_OPTIONS = ['none', 'low', 'medium', 'high']
  const REASONING_SUMMARY_OPTIONS = ['none', 'auto', 'concise', 'detailed']
  const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.'
  const SOURCE_CODE_URL = (import.meta.env.VITE_SOURCE_CODE_URL || 'https://github.com/neko782/advui').trim()

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

  // Check if active preset's connection supports Responses API features (web search, code interpreter, shell, image generation)
  const activePresetSupportsResponsesApiFeatures = $derived((() => {
    const connectionId = activePreset?.connectionId
    if (!connectionId) return false
    const connection = (local?.connections || []).find(c => c.id === connectionId)
    return connection?.apiMode === 'responses'
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
      webSearchEnabled: !!base?.webSearchEnabled,
      webSearchDomains: base?.webSearchDomains,
      webSearchCountry: base?.webSearchCountry,
      webSearchCity: base?.webSearchCity,
      webSearchRegion: base?.webSearchRegion,
      webSearchTimezone: base?.webSearchTimezone,
      webSearchCacheOnly: !!base?.webSearchCacheOnly,
      codeInterpreterEnabled: !!base?.codeInterpreterEnabled,
      codeInterpreterNetworkEnabled: !!base?.codeInterpreterNetworkEnabled,
      codeInterpreterAllowedDomains: base?.codeInterpreterAllowedDomains,
      shellEnabled: !!base?.shellEnabled,
      shellNetworkEnabled: !!base?.shellNetworkEnabled,
      shellAllowedDomains: base?.shellAllowedDomains,
      imageGenerationEnabled: !!base?.imageGenerationEnabled,
      imageGenerationModel: base?.imageGenerationModel,
      mcpEnabled: !!base?.mcpEnabled,
      mcpServers: Array.isArray(base?.mcpServers) ? base.mcpServers.map(server => ({ label: server?.label || '', url: server?.url || '' })) : [],
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
    let updatedPatch = { ...patch }
    
    // If connectionId is being changed, check if we need to clear responses-API-only features
    if ('connectionId' in patch) {
      const newConnection = (local?.connections || []).find(c => c.id === patch.connectionId)
      if (newConnection?.apiMode !== 'responses') {
        // Clear responses API features when switching to non-responses API connection
        updatedPatch.webSearchEnabled = false
        updatedPatch.codeInterpreterEnabled = false
        updatedPatch.shellEnabled = false
        updatedPatch.imageGenerationEnabled = false
        updatedPatch.mcpEnabled = false
      }
    }
    
    next[idx] = { ...next[idx], ...updatedPatch }
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
    // If apiMode is being changed away from 'responses', clear responses-API-only features
    // on all presets that use this connection
    if ('apiMode' in patch && patch.apiMode !== 'responses') {
      if (Array.isArray(local?.presets)) {
        local.presets = local.presets.map(p => {
          if (p?.connectionId === current.id) {
            return {
              ...p,
              webSearchEnabled: false,
              codeInterpreterEnabled: false,
              shellEnabled: false,
              imageGenerationEnabled: false,
              mcpEnabled: false,
            }
          }
          return p
        })
      }
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
    if (!draggedConnectionId || draggedConnectionId === id) return
    dragOverConnectionId = id
  }

  function handleConnectionDrop(e: DragEvent) {
    e.preventDefault()
    if (draggedConnectionId && dragOverConnectionId && draggedConnectionId !== dragOverConnectionId) {
      reorderConnections(draggedConnectionId, dragOverConnectionId)
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
    if (!draggedPresetId || draggedPresetId === id) return
    dragOverPresetId = id
  }

  function handlePresetDrop(e: DragEvent) {
    e.preventDefault()
    if (draggedPresetId && dragOverPresetId && draggedPresetId !== dragOverPresetId) {
      reorderPresets(draggedPresetId, dragOverPresetId)
    }
    draggedPresetId = null
    dragOverPresetId = null
  }

  function handlePresetDragEnd() {
    draggedPresetId = null
    dragOverPresetId = null
  }

  // Touch handlers for mobile drag and drop
  function handleConnectionTouchStart(e: TouchEvent, id: string) {
    touchDragType = 'connection'
    touchDragId = id
    touchCurrentY = e.touches[0].clientY
    draggedConnectionId = id
    const listEl = (e.currentTarget as HTMLElement).closest('.item-list')
    if (listEl) touchListRef = listEl as HTMLElement
  }

  function handleConnectionTouchMove(e: TouchEvent) {
    if (touchDragType !== 'connection' || !touchDragId || !touchListRef) return
    e.preventDefault()
    const touchY = e.touches[0].clientY
    touchCurrentY = touchY

    // Find which item the touch is over
    const items = touchListRef.querySelectorAll('.list-item')
    for (const item of items) {
      const id = item.getAttribute('data-id')
      if (id && id !== touchDragId) {
        const rect = item.getBoundingClientRect()
        if (touchY >= rect.top && touchY <= rect.bottom) {
          dragOverConnectionId = id
          return
        }
      }
    }
  }

  function handleConnectionTouchEnd() {
    if (touchDragType === 'connection' && touchDragId && dragOverConnectionId) {
      reorderConnections(touchDragId, dragOverConnectionId)
    }
    resetTouchState()
  }

  function handlePresetTouchStart(e: TouchEvent, id: string) {
    touchDragType = 'preset'
    touchDragId = id
    touchCurrentY = e.touches[0].clientY
    draggedPresetId = id
    const listEl = (e.currentTarget as HTMLElement).closest('.item-list')
    if (listEl) touchListRef = listEl as HTMLElement
  }

  function handlePresetTouchMove(e: TouchEvent) {
    if (touchDragType !== 'preset' || !touchDragId || !touchListRef) return
    e.preventDefault()
    const touchY = e.touches[0].clientY
    touchCurrentY = touchY

    // Find which item the touch is over
    const items = touchListRef.querySelectorAll('.list-item')
    for (const item of items) {
      const id = item.getAttribute('data-id')
      if (id && id !== touchDragId) {
        const rect = item.getBoundingClientRect()
        if (touchY >= rect.top && touchY <= rect.bottom) {
          dragOverPresetId = id
          return
        }
      }
    }
  }

  function handlePresetTouchEnd() {
    if (touchDragType === 'preset' && touchDragId && dragOverPresetId) {
      reorderPresets(touchDragId, dragOverPresetId)
    }
    resetTouchState()
  }

  function resetTouchState() {
    touchDragType = null
    touchDragId = null
    touchCurrentY = 0
    touchListRef = null
    draggedConnectionId = null
    draggedPresetId = null
    dragOverConnectionId = null
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
      const ids = await listModelsWithKey(connection.apiKey, connection.apiBaseUrl, connection.apiMode)
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
                  title="Export all chats, settings, and images as an archive"
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
                  title="Import all data from an archive"
                  aria-label="Import all data"
                >
                  <IconUpload style="font-size: 20px;" />
                  <span>Import all data</span>
                </button>
              </div>
              {#if importExportStatus}
                <p class="hint" aria-live="polite">{importExportStatus}</p>
              {:else}
                <p class="hint">Import and export your chats, settings, and images. Export all data creates a backup of everything.</p>
              {/if}
            </section>
            <section class="group legal-group">
              <div class="group-title">Open-source notice</div>
              <p class="hint">This program is licensed under the GNU Affero General Public License, version 3 or any later version.</p>
              <p class="hint">You can access the complete corresponding source code here:</p>
              <a
                class="legal-link"
                href={SOURCE_CODE_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {SOURCE_CODE_URL}
              </a>
              <p class="hint">This software is provided without warranty, to the extent permitted by law.</p>
            </section>
            <section class="group developer-group">
              <div class="group-title">Developer</div>
              <label class="switch">
                <input
                  type="checkbox"
                  bind:checked={local.debug}
                  onchange={() => persistSettings()}
                  aria-label="Debug Mode"
                />
                <span class="switch-ui" aria-hidden="true"></span>
                <span class="switch-label">Debug mode</span>
              </label>
              <p class="hint">Useless and dangerous tools used for debugging. You don't need these.</p>
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
              <div class="item-list reorder-list">
                {#each connectionsForRender() as connection (connection.id)}
                  {@const isDragging = draggedConnectionId === connection.id}
                  {@const isDragOver = dragOverConnectionId === connection.id && draggedConnectionId !== connection.id}
                  <div
                    class="list-item {connection.id === activeConnectionId ? 'active' : ''} {isDragging ? 'dragging' : ''} {isDragOver ? 'drag-over' : ''}"
                    data-id={connection.id}
                    draggable="true"
                    ondragstart={(e) => handleConnectionDragStart(e, connection.id)}
                    ondragover={(e) => handleConnectionDragOver(e, connection.id)}
                    ondrop={handleConnectionDrop}
                    ondragend={handleConnectionDragEnd}
                    role="listitem"
                  >
                    <div
                      class="drag-handle"
                      aria-label="Drag to reorder"
                      ontouchstart={(e) => handleConnectionTouchStart(e, connection.id)}
                      ontouchmove={handleConnectionTouchMove}
                      ontouchend={handleConnectionTouchEnd}
                      ontouchcancel={resetTouchState}
                    >
                      <IconDragHandle style="font-size: 20px;" />
                    </div>
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
                  <p class="hint">Leave blank to use the default endpoint for the selected API.</p>
                  <label class="field">
                    <span>API</span>
                    <select
                      value={activeConnection.apiMode || 'responses'}
                      onchange={(event) => updateActiveConnection({ apiMode: event.currentTarget.value })}
                      aria-label="API mode"
                    >
                      <option value="responses">Responses API</option>
                      <option value="chat_completions">Chat Completions API</option>
                      <option value="gemini">Gemini API</option>
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
              <div class="item-list reorder-list">
                {#each presetsForRender() as preset (preset.id)}
                  {@const presetConnection = (local?.connections || []).find(c => c.id === preset.connectionId)}
                  {@const isDragging = draggedPresetId === preset.id}
                  {@const isDragOver = dragOverPresetId === preset.id && draggedPresetId !== preset.id}
                  <div
                    class="list-item {preset.id === activePresetId ? 'active' : ''} {isDragging ? 'dragging' : ''} {isDragOver ? 'drag-over' : ''}"
                    data-id={preset.id}
                    draggable="true"
                    ondragstart={(e) => handlePresetDragStart(e, preset.id)}
                    ondragover={(e) => handlePresetDragOver(e, preset.id)}
                    ondrop={handlePresetDrop}
                    ondragend={handlePresetDragEnd}
                    role="listitem"
                  >
                    <div
                      class="drag-handle"
                      aria-label="Drag to reorder"
                      ontouchstart={(e) => handlePresetTouchStart(e, preset.id)}
                      ontouchmove={handlePresetTouchMove}
                      ontouchend={handlePresetTouchEnd}
                      ontouchcancel={resetTouchState}
                    >
                      <IconDragHandle style="font-size: 20px;" />
                    </div>
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
                  {#if activePresetSupportsResponsesApiFeatures}
                    <label class="switch" title="Web search (Responses API only)">
                      <input
                        type="checkbox"
                        checked={!!activePreset.webSearchEnabled}
                        onchange={(event) => updateActivePreset({ webSearchEnabled: !!event.currentTarget.checked })}
                        aria-label="Web search"
                      />
                      <span class="switch-ui" aria-hidden="true"></span>
                      <span class="switch-label">Web search</span>
                    </label>
                    <label class="switch" title="Code interpreter (Responses API only)">
                      <input
                        type="checkbox"
                        checked={!!activePreset.codeInterpreterEnabled}
                        onchange={(event) => updateActivePreset({ codeInterpreterEnabled: !!event.currentTarget.checked })}
                        aria-label="Code interpreter"
                      />
                      <span class="switch-ui" aria-hidden="true"></span>
                      <span class="switch-label">Code interpreter</span>
                    </label>
                    {#if activePreset.codeInterpreterEnabled}
                      <div class="tool-network-settings">
                        <label class="switch" title="Allow network access for code interpreter">
                          <input
                            type="checkbox"
                            checked={!!activePreset.codeInterpreterNetworkEnabled}
                            onchange={(event) => updateActivePreset({ codeInterpreterNetworkEnabled: !!event.currentTarget.checked })}
                            aria-label="Code interpreter network access"
                          />
                          <span class="switch-ui" aria-hidden="true"></span>
                          <span class="switch-label">Allow network</span>
                        </label>
                        {#if activePreset.codeInterpreterNetworkEnabled}
                          <label class="field">
                            <span>Allowed domains</span>
                            <input
                              type="text"
                              placeholder="e.g. api.github.com, pypi.org"
                              value={activePreset.codeInterpreterAllowedDomains || ''}
                              oninput={(event) => updateActivePreset({ codeInterpreterAllowedDomains: event.currentTarget.value || undefined })}
                              aria-label="Code interpreter allowed domains"
                            />
                          </label>
                        {/if}
                      </div>
                    {/if}
                    <label class="switch" title="Shell (Responses API only)">
                      <input
                        type="checkbox"
                        checked={!!activePreset.shellEnabled}
                        onchange={(event) => updateActivePreset({ shellEnabled: !!event.currentTarget.checked })}
                        aria-label="Shell"
                      />
                      <span class="switch-ui" aria-hidden="true"></span>
                      <span class="switch-label">Shell</span>
                    </label>
                    {#if activePreset.shellEnabled}
                      <div class="tool-network-settings">
                        <label class="switch" title="Allow network access for shell">
                          <input
                            type="checkbox"
                            checked={!!activePreset.shellNetworkEnabled}
                            onchange={(event) => updateActivePreset({ shellNetworkEnabled: !!event.currentTarget.checked })}
                            aria-label="Shell network access"
                          />
                          <span class="switch-ui" aria-hidden="true"></span>
                          <span class="switch-label">Allow network</span>
                        </label>
                        {#if activePreset.shellNetworkEnabled}
                          <label class="field">
                            <span>Allowed domains</span>
                            <input
                              type="text"
                              placeholder="e.g. api.github.com, registry.npmjs.org"
                              value={activePreset.shellAllowedDomains || ''}
                              oninput={(event) => updateActivePreset({ shellAllowedDomains: event.currentTarget.value || undefined })}
                              aria-label="Shell allowed domains"
                            />
                          </label>
                        {/if}
                      </div>
                    {/if}
                    <label class="switch" title="Image generation (Responses API only)">
                      <input
                        type="checkbox"
                        checked={!!activePreset.imageGenerationEnabled}
                        onchange={(event) => updateActivePreset({ imageGenerationEnabled: !!event.currentTarget.checked })}
                        aria-label="Image generation"
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
                    <label class="switch" title="MCP (Responses API only)">
                      <input
                        type="checkbox"
                        checked={!!activePreset.mcpEnabled}
                        onchange={(event) => updateActivePreset({ mcpEnabled: !!event.currentTarget.checked })}
                        aria-label="MCP"
                      />
                      <span class="switch-ui" aria-hidden="true"></span>
                      <span class="switch-label">MCP</span>
                    </label>
                    {#if activePreset.mcpEnabled}
                      <div class="tool-network-settings mcp-settings">
                        {#if activePreset.mcpServers?.length}
                          {#each activePreset.mcpServers as server, index (index)}
                            <div class="mcp-server-row">
                              <input
                                type="text"
                                placeholder="https://example.com/mcp"
                                value={server?.url || ''}
                                oninput={(event) => updateActivePreset({
                                  mcpServers: (activePreset.mcpServers || []).map((entry, entryIndex) => (
                                    entryIndex === index
                                      ? { ...entry, url: event.currentTarget.value }
                                      : entry
                                  )),
                                })}
                                aria-label={`MCP server URL ${index + 1}`}
                              />
                              <button
                                type="button"
                                class="mcp-remove-btn"
                                onclick={() => updateActivePreset({
                                  mcpServers: (activePreset.mcpServers || []).filter((_, entryIndex) => entryIndex !== index),
                                })}
                                aria-label={`Remove MCP server ${index + 1}`}
                                title="Remove MCP server"
                              >
                                <IconDelete style="font-size: 14px;" />
                              </button>
                            </div>
                          {/each}
                        {:else}
                          <div class="field-hint">No servers configured.</div>
                        {/if}
                        <button
                          type="button"
                          class="reset-btn mcp-add-btn"
                          onclick={() => updateActivePreset({
                            mcpServers: [...(activePreset.mcpServers || []), { label: '', url: '' }],
                          })}
                        >
                          Add MCP server
                        </button>
                      </div>
                    {/if}
                  {/if}
                  <label class="field">
                    <span>Text verbosity</span>
                    <select
                      value={activePreset.textVerbosity || 'medium'}
                      onchange={(event) => updateActivePreset({ textVerbosity: parseVerbosity(event.currentTarget.value) })}
                      aria-label="Text verbosity"
                    >
                      <option value="none">none</option>
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
                      aria-label="Connection"
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
                      <option value="none">none</option>
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
                </div>
              {/if}
            </section>
          {:else if activeTab === 'features'}
            <section class="group">
              <div class="group-title">General</div>
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
              <label class="switch" title="Fancy effects">
                <input
                  type="checkbox"
                  checked={!!local.fancyEffects}
                  onchange={(event) => {
                    local.fancyEffects = !!event.currentTarget.checked
                    persistSettings()
                  }}
                  aria-label="Fancy effects"
                />
                <span class="switch-ui" aria-hidden="true"></span>
                <span class="switch-label">Fancy effects</span>
              </label>
              <p class="hint">Enable blur effects, shadows, and animations. Disable for better performance on slower devices.</p>
              <label class="switch" title="Allow inline HTML">
                <input
                  type="checkbox"
                  checked={!!local.allowInlineHtml}
                  onchange={(event) => {
                    local.allowInlineHtml = !!event.currentTarget.checked
                    persistSettings()
                  }}
                  aria-label="Allow inline HTML"
                />
                <span class="switch-ui" aria-hidden="true"></span>
                <span class="switch-label">Allow inline HTML</span>
              </label>
              <p class="hint">Allow HTML tags in markdown messages. Disabled by default for security.</p>
            </section>

            <section class="group">
              <div class="group-head">
                <div class="group-title">Message buttons</div>
                <button
                  type="button"
                  class="reset-btn"
                  onclick={resetMessageActions}
                  title="Reset to defaults"
                  aria-label="Reset message buttons to defaults"
                >Reset</button>
              </div>
              <p class="hint section-hint">Toggle and reorder the action buttons shown on chat messages. Drag to change order.</p>
              <div class="item-list reorder-list">
                {#each messageActionsForRender() as action (action.id)}
                  {@const isDragging = draggedActionId === action.id}
                  {@const isDragOver = dragOverActionId === action.id && draggedActionId !== action.id}
                  <div
                    class="list-item action-item {isDragging ? 'dragging' : ''} {isDragOver ? 'drag-over' : ''} {!action.enabled ? 'disabled-action' : ''}"
                    data-id={action.id}
                    draggable="true"
                    ondragstart={(e) => handleActionDragStart(e, action.id)}
                    ondragover={(e) => handleActionDragOver(e, action.id)}
                    ondrop={handleActionDrop}
                    ondragend={handleActionDragEnd}
                    role="listitem"
                  >
                    <div
                      class="drag-handle"
                      aria-label="Drag to reorder"
                      ontouchstart={(e) => handleActionTouchStart(e, action.id)}
                      ontouchmove={handleActionTouchMove}
                      ontouchend={handleActionTouchEnd}
                      ontouchcancel={() => { touchActionDragId = null; touchActionListRef = null; draggedActionId = null; dragOverActionId = null }}
                    >
                      <IconDragHandle style="font-size: 20px;" />
                    </div>
                    <span class="action-item-label">{action.label}</span>
                    <label class="action-toggle" title={action.enabled ? 'Disable' : 'Enable'}>
                      <input
                        type="checkbox"
                        checked={action.enabled}
                        onchange={() => toggleMessageAction(action.id)}
                        aria-label={`${action.enabled ? 'Disable' : 'Enable'} ${action.label}`}
                      />
                      <span class="switch-ui" aria-hidden="true"></span>
                    </label>
                  </div>
                {/each}
              </div>
            </section>

            <section class="group">
              <div class="group-head">
                <div class="group-title">Editor buttons</div>
                <button
                  type="button"
                  class="reset-btn"
                  onclick={resetEditorActions}
                  title="Reset to defaults"
                  aria-label="Reset editor buttons to defaults"
                >Reset</button>
              </div>
              <p class="hint section-hint">Toggle the action buttons shown when editing a message.</p>
              <div class="item-list">
                {#each editorActionsForRender() as action (action.id)}
                  <div
                    class="list-item action-item {!action.enabled ? 'disabled-action' : ''}"
                    data-id={action.id}
                  >
                    <span class="action-item-label">{action.label}</span>
                    <label class="action-toggle" title={action.enabled ? 'Disable' : 'Enable'}>
                      <input
                        type="checkbox"
                        checked={action.enabled}
                        onchange={() => toggleEditorAction(action.id)}
                        aria-label={`${action.enabled ? 'Disable' : 'Enable'} ${action.label}`}
                      />
                      <span class="switch-ui" aria-hidden="true"></span>
                    </label>
                  </div>
                {/each}
              </div>
            </section>

            <section class="group">
              <div class="group-title">Composer & roles</div>
              <label class="switch" title="Disable role switching">
                <input
                  type="checkbox"
                  checked={!!local.disableRoleSwitching}
                  onchange={(event) => {
                    local.disableRoleSwitching = !!event.currentTarget.checked
                    persistSettings()
                  }}
                  aria-label="Disable role switching"
                />
                <span class="switch-ui" aria-hidden="true"></span>
                <span class="switch-label">Disable role switching on messages</span>
              </label>
              <p class="hint">Prevent changing the role of existing messages by clicking the role badge.</p>
              <label class="switch" title="Disable send role popup">
                <input
                  type="checkbox"
                  checked={!!local.disableSendRolePopup}
                  onchange={(event) => {
                    local.disableSendRolePopup = !!event.currentTarget.checked
                    persistSettings()
                  }}
                  aria-label="Disable send role popup"
                />
                <span class="switch-ui" aria-hidden="true"></span>
                <span class="switch-label">Disable send role popup</span>
              </label>
              <p class="hint">Hide the role selection popup on the send button. Messages will always send as user.</p>
              <label class="switch" title="Show add without sending button">
                <input
                  type="checkbox"
                  checked={!!local.showAddWithoutSend}
                  onchange={(event) => {
                    local.showAddWithoutSend = !!event.currentTarget.checked
                    persistSettings()
                  }}
                  aria-label="Show add without sending button"
                />
                <span class="switch-ui" aria-hidden="true"></span>
                <span class="switch-label">Add without sending button</span>
              </label>
              <p class="hint">Show a button next to send that adds a message to the chat without triggering an API response.</p>
            </section>

            <section class="group">
              <div class="group-title">Default tools</div>
              <p class="hint section-hint">Set default tool availability for new presets. Only applies to Responses API connections.</p>
              <div class="tools-grid">
                <label class="tool-card" title="Web search">
                  <div class="tool-card-icon"><IconTravelExplore style="font-size: 24px;" /></div>
                  <div class="tool-card-info">
                    <span class="tool-card-name">Web search</span>
                    <span class="tool-card-desc">Search the web for up-to-date information</span>
                  </div>
                  <div class="tool-card-toggle">
                    <input
                      type="checkbox"
                      checked={defaultToolsForRender().webSearch}
                      onchange={(event) => updateDefaultTool('webSearch', event.currentTarget.checked)}
                      aria-label="Web search default"
                    />
                    <span class="switch-ui" aria-hidden="true"></span>
                  </div>
                </label>
                <label class="tool-card" title="Code interpreter">
                  <div class="tool-card-icon"><IconCodeBlocks style="font-size: 24px;" /></div>
                  <div class="tool-card-info">
                    <span class="tool-card-name">Code interpreter</span>
                    <span class="tool-card-desc">Run Python code in a sandboxed environment</span>
                  </div>
                  <div class="tool-card-toggle">
                    <input
                      type="checkbox"
                      checked={defaultToolsForRender().codeInterpreter}
                      onchange={(event) => updateDefaultTool('codeInterpreter', event.currentTarget.checked)}
                      aria-label="Code interpreter default"
                    />
                    <span class="switch-ui" aria-hidden="true"></span>
                  </div>
                </label>
                <label class="tool-card" title="Shell">
                  <div class="tool-card-icon"><IconTerminal style="font-size: 24px;" /></div>
                  <div class="tool-card-info">
                    <span class="tool-card-name">Shell</span>
                    <span class="tool-card-desc">Execute shell commands on the server</span>
                  </div>
                  <div class="tool-card-toggle">
                    <input
                      type="checkbox"
                      checked={defaultToolsForRender().shell}
                      onchange={(event) => updateDefaultTool('shell', event.currentTarget.checked)}
                      aria-label="Shell default"
                    />
                    <span class="switch-ui" aria-hidden="true"></span>
                  </div>
                </label>
                <label class="tool-card" title="Image generation">
                  <div class="tool-card-icon"><IconImagesmode style="font-size: 24px;" /></div>
                  <div class="tool-card-info">
                    <span class="tool-card-name">Image generation</span>
                    <span class="tool-card-desc">Generate images from text descriptions</span>
                  </div>
                  <div class="tool-card-toggle">
                    <input
                      type="checkbox"
                      checked={defaultToolsForRender().imageGeneration}
                      onchange={(event) => updateDefaultTool('imageGeneration', event.currentTarget.checked)}
                      aria-label="Image generation default"
                    />
                    <span class="switch-ui" aria-hidden="true"></span>
                  </div>
                </label>
                <label class="tool-card" title="MCP servers">
                  <div class="tool-card-icon"><IconExtension style="font-size: 24px;" /></div>
                  <div class="tool-card-info">
                    <span class="tool-card-name">MCP</span>
                    <span class="tool-card-desc">Remote tool servers via Model Context Protocol</span>
                  </div>
                  <div class="tool-card-toggle">
                    <input
                      type="checkbox"
                      checked={defaultToolsForRender().mcp}
                      onchange={(event) => updateDefaultTool('mcp', event.currentTarget.checked)}
                      aria-label="MCP default"
                    />
                    <span class="switch-ui" aria-hidden="true"></span>
                  </div>
                </label>
              </div>
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
    background: rgba(0,0,0,0.6);
    z-index: 1000;
    border: 0;
    padding: 0;
  }
  :global(:root[data-fancy-effects="true"]) .backdrop {
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    animation: backdrop-fade-in 0.2s ease-out;
  }
  @keyframes backdrop-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .modal {
    position: fixed; inset: 0;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    z-index: 1001;
  }
  .panel {
    width: min(calc(100vw - 48px), 1080px);
    height: min(calc(100vh - 48px), 900px);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 20px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    color: var(--text);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  :global(:root[data-fancy-effects="true"]) .panel {
    box-shadow:
      0 0 0 1px rgba(0,0,0,0.03),
      0 4px 12px rgba(0,0,0,0.08),
      0 16px 48px rgba(0,0,0,0.12),
      0 24px 64px rgba(0,0,0,0.08);
    animation: panel-slide-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }
  :global(:root[data-theme='dark']) .panel {
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }
  :global(:root[data-theme='dark'][data-fancy-effects="true"]) .panel {
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.05),
      0 4px 12px rgba(0,0,0,0.3),
      0 16px 48px rgba(0,0,0,0.4),
      0 24px 64px rgba(0,0,0,0.3);
  }
  @keyframes panel-slide-in {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(8px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }
  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 28px;
    border-bottom: 1px solid var(--border);
    background: linear-gradient(180deg, var(--panel), color-mix(in srgb, var(--panel) 95%, var(--bg) 5%));
  }
  .title {
    font-weight: 700;
    font-size: 1.15rem;
    letter-spacing: -0.01em;
  }
  .tab-bar {
    display: flex;
    gap: 6px;
    padding: 12px 24px;
    border-bottom: 1px solid var(--border);
    overflow: hidden;
    background: color-mix(in srgb, var(--panel) 98%, var(--bg) 2%);
  }
  .tab {
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-weight: 500;
    padding: 10px 18px;
    position: relative;
    white-space: nowrap;
    cursor: pointer;
    border-radius: 10px;
    transition: color 0.15s ease, background 0.15s ease;
  }
  .tab:hover:not(.active) {
    color: var(--text);
    background: color-mix(in srgb, var(--border) 40%, transparent);
  }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .tab.active {
    color: var(--text);
    background: color-mix(in srgb, var(--border) 60%, transparent);
  }
  .modal-body { flex: 1; overflow: hidden; }
  .modal-scroller {
    height: 100%;
    overflow-y: auto;
    padding: 28px;
    display: grid;
    gap: 20px;
    align-content: start;
  }
  .icon-btn {
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--panel);
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    line-height: 1;
    color: var(--text);
    transition: all 0.15s ease;
  }
  .icon-btn:hover:not(:disabled) {
    background: var(--bg);
    border-color: color-mix(in srgb, var(--border) 70%, var(--accent) 30%);
    transform: translateY(-1px);
  }
  .icon-btn:active:not(:disabled) {
    transform: translateY(0);
  }
  .icon-btn:disabled { opacity: .5; cursor: not-allowed; }
  .tool-network-settings {
    display: grid;
    gap: 10px;
    padding: 10px 12px;
    margin-left: 12px;
    border-left: 2px solid var(--border);
  }
  .mcp-settings {
    gap: 8px;
  }
  .mcp-server-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    align-items: center;
  }
  .mcp-remove-btn {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--panel);
    color: #d64545;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
  }
  .mcp-remove-btn:hover {
    background: color-mix(in srgb, #d64545 8%, var(--panel));
    border-color: color-mix(in srgb, #d64545 35%, var(--border));
  }
  .mcp-remove-btn:active {
    transform: scale(0.96);
  }
  .mcp-add-btn {
    width: fit-content;
  }
  .field-hint {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .field { display: grid; gap: 6px; }
  .field > span {
    font-size: .875rem;
    font-weight: 500;
    color: var(--muted);
  }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  input[type="text"],
  input[type="number"],
  select,
  textarea {
    flex: 1;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 11px 14px;
    background: var(--panel);
    color: var(--text);
    font: inherit;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  input[type="text"]:focus,
  input[type="number"]:focus,
  select:focus,
  textarea:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent);
  }
  input[type="text"]:hover:not(:focus),
  input[type="number"]:hover:not(:focus),
  select:hover:not(:focus),
  textarea:hover:not(:focus) {
    border-color: color-mix(in srgb, var(--border) 70%, var(--text) 30%);
  }
  textarea {
    min-height: 96px;
    line-height: 1.5;
    resize: vertical;
  }
  .hint {
    color: var(--muted);
    font-size: .85rem;
    margin-top: 2px;
    line-height: 1.4;
  }
  /* API key action buttons size */
  .row .icon-btn { height: 42px; width: 42px; }
  .group {
    display: grid;
    gap: 12px;
    padding: 20px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    transition: border-color 0.15s ease;
  }
  .group:hover {
    border-color: color-mix(in srgb, var(--border) 80%, var(--text) 20%);
  }
  .group-title {
    font-weight: 600;
    font-size: 1rem;
    letter-spacing: -0.01em;
    color: var(--text);
  }
  .group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 4px;
  }
  .group-head .icon-btn { flex-shrink: 0; }
  .presets .group-head .icon-btn { width: 32px; height: 32px; border-radius: 8px; }
  .preset-group-divider {
    height: 1px;
    background: var(--border);
    margin: 4px 0 0;
  }
  .preset-group-header {
    font-size: .75rem;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.6px;
    margin: 0;
    width: 100%;
    border: none;
    background: transparent;
    padding: 4px 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    user-select: none;
    transition: color 0.15s ease;
  }
  .preset-group-header:hover { color: var(--text); }
  .chevron {
    transition: transform .2s ease;
    flex-shrink: 0;
    opacity: 0.7;
  }
  .preset-group-header:hover .chevron {
    opacity: 1;
  }
  .chevron.expanded {
    transform: rotate(180deg);
  }
  .developer-group {
    background: color-mix(in srgb, var(--panel) 95%, var(--muted) 5%);
    border-style: dashed;
  }
  .legal-group {
    background: color-mix(in srgb, var(--panel) 96%, var(--accent) 4%);
  }
  .legal-link {
    color: var(--accent);
    font-size: 0.9rem;
    text-decoration: underline;
    text-underline-offset: 2px;
    word-break: break-all;
  }
  .legal-link:hover,
  .legal-link:focus-visible {
    color: color-mix(in srgb, var(--accent) 80%, var(--text) 20%);
  }
  /* Item list for connections and presets */
  .section-hint {
    margin: 0 0 8px;
    opacity: 0.9;
  }
  .item-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 20px;
  }
  .list-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px;
    border-radius: 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .list-item:hover {
    border-color: color-mix(in srgb, var(--border) 60%, var(--accent) 40%);
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  }
  .list-item.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, var(--bg) 94%);
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--accent) 12%, transparent),
      0 2px 8px rgba(0,0,0,0.06);
  }
  .list-item.dragging {
    opacity: 0.5;
    border-style: dashed;
    border-color: var(--accent);
    transform: scale(0.98);
    z-index: 10;
    background: color-mix(in srgb, var(--accent) 8%, var(--bg) 92%);
  }
  /* Reorder list with smooth transitions */
  .reorder-list .list-item {
    transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1), opacity 0.15s ease, border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
  }
  .reorder-list .list-item.dragging {
    transition: opacity 0.15s ease, border-color 0.15s ease;
  }
  /* Remove old drag-over highlight - items now shift visually */
  .list-item.drag-over {
    /* Items shift position instead of just highlighting */
  }
  .drag-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 44px;
    color: var(--muted);
    cursor: grab;
    border: none;
    background: transparent;
    border-radius: 8px;
    flex-shrink: 0;
    transition: color 0.15s ease, background 0.15s ease;
    opacity: 0.7;
    touch-action: none;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }
  .list-item:hover .drag-handle {
    opacity: 1;
  }
  .drag-handle:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--border) 40%, transparent);
  }
  .drag-handle:active {
    cursor: grabbing;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  /* Mobile: always show drag handle clearly */
  @media (pointer: coarse) {
    .drag-handle {
      opacity: 1;
      width: 44px;
      height: 48px;
    }
  }
  .item-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    padding: 8px 10px;
    text-align: left;
    border: none;
    background: transparent;
    border-radius: 8px;
    min-width: 0;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .item-content:hover {
    background: color-mix(in srgb, var(--border) 25%, transparent);
  }
  .item-name {
    font-weight: 600;
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
    width: 34px;
    height: 34px;
    color: var(--muted);
    border: none;
    background: transparent;
    border-radius: 8px;
    flex-shrink: 0;
    cursor: pointer;
    transition: all 0.15s ease;
    opacity: 0.6;
  }
  .list-item:hover .item-delete {
    opacity: 1;
  }
  .item-delete:hover {
    color: #e53935;
    background: rgba(229, 57, 53, 0.12);
  }
  :global(:root[data-theme='dark']) .item-delete:hover {
    background: rgba(229, 57, 53, 0.18);
  }

  /* Form section styling */
  .form-section {
    display: grid;
    gap: 10px;
    padding: 20px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: inset 0 1px 2px rgba(0,0,0,0.02);
  }
  .form-section-title {
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--text);
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
  .status-msg {
    padding: 10px 14px;
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--accent) 15%, transparent);
    font-size: 0.9rem;
  }

  /* Add button styling */
  .add-btn {
    background: color-mix(in srgb, var(--accent) 10%, var(--panel) 90%);
    border-color: color-mix(in srgb, var(--accent) 25%, transparent);
    color: var(--accent);
  }
  .add-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 18%, var(--panel) 82%);
    border-color: color-mix(in srgb, var(--accent) 50%, transparent);
    transform: translateY(-1px);
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
  .switch {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    user-select: none;
  }
  .switch > input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
  .switch-ui {
    width: 46px;
    height: 26px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--border) 80%, var(--muted) 20%);
    position: relative;
    transition: background-color .2s ease, box-shadow .2s ease;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
  }
  .switch-ui::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2), 0 2px 6px rgba(0,0,0,0.1);
    transition: transform .2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .switch:hover .switch-ui {
    background: color-mix(in srgb, var(--border) 60%, var(--muted) 40%);
  }
  :global(:root[data-theme='dark']) .switch-ui {
    background: #2a2a2a;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.3);
  }
  :global(:root[data-theme='dark']) .switch-ui::after { background: #e6e6e6; }
  .switch > input:checked + .switch-ui {
    background: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
  }
  .switch > input:checked + .switch-ui::after { transform: translateX(20px); }
  .switch-label {
    font-size: .95rem;
    font-weight: 500;
    color: var(--text);
  }
  .data-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .data-action-btn {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .data-action-btn:hover:not(:disabled) {
    background: var(--panel);
    border-color: color-mix(in srgb, var(--border) 60%, var(--accent) 40%);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  }
  .data-action-btn:active:not(:disabled) {
    transform: translateY(0);
  }
  .data-action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  @media (max-width: 640px) {
    .modal { padding: 0; }
    .panel {
      width: 100%;
      height: 100%;
      border-radius: 0;
      border: none;
    }
    .modal-head { padding: 16px 20px; }
    .tab-bar { padding: 10px 16px; gap: 4px; }
    .tab { padding: 8px 14px; font-size: 0.9rem; }
    .modal-scroller { padding: 20px; gap: 16px; }
    .group { padding: 16px; border-radius: 12px; }
    .data-actions { flex-direction: column; }
    .data-action-btn { width: 100%; justify-content: center; }
  }

  /* Smooth scrollbar styling */
  .modal-scroller::-webkit-scrollbar {
    width: 8px;
  }
  .modal-scroller::-webkit-scrollbar-track {
    background: transparent;
  }
  .modal-scroller::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 4px;
  }
  .modal-scroller::-webkit-scrollbar-thumb:hover {
    background: var(--muted);
  }

  /* Reset button */
  .reset-btn {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    color: var(--muted);
    font: inherit;
    font-size: 0.8rem;
    font-weight: 500;
    padding: 6px 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .reset-btn:hover {
    color: var(--text);
    border-color: color-mix(in srgb, var(--border) 60%, var(--text) 30%);
    background: var(--bg);
  }

  /* Action item in message buttons list */
  .action-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
  }
  .action-item-label {
    flex: 1;
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--text);
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 8px 4px;
  }
  .action-item.disabled-action .action-item-label {
    color: var(--muted);
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--muted) 50%, transparent);
  }
  .action-item.disabled-action {
    opacity: 0.7;
    background: color-mix(in srgb, var(--bg) 90%, var(--muted) 10%);
  }
  .action-toggle {
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    flex-shrink: 0;
    user-select: none;
  }
  .action-toggle > input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
    pointer-events: none;
  }
  .action-toggle .switch-ui {
    width: 40px;
    height: 22px;
  }
  .action-toggle .switch-ui::after {
    width: 16px;
    height: 16px;
  }
  .action-toggle > input:checked + .switch-ui {
    background: var(--accent) !important;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
  }
  .action-toggle > input:checked + .switch-ui::after {
    transform: translateX(18px);
  }
  .action-toggle:hover > input:not(:checked) + .switch-ui {
    background: color-mix(in srgb, var(--border) 60%, var(--muted) 40%);
  }
  :global(:root[data-theme='dark']) .action-toggle > input:not(:checked) + .switch-ui {
    background: #2a2a2a;
  }

  /* Tools grid */
  .tools-grid {
    display: grid;
    gap: 8px;
  }
  .tool-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 16px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    user-select: none;
  }
  .tool-card:hover {
    border-color: color-mix(in srgb, var(--border) 60%, var(--accent) 40%);
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  }
  .tool-card-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--accent) 10%, var(--panel) 90%);
    color: var(--accent);
    flex-shrink: 0;
    transition: background 0.15s ease;
  }
  .tool-card:hover .tool-card-icon {
    background: color-mix(in srgb, var(--accent) 16%, var(--panel) 84%);
  }
  .tool-card-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .tool-card-name {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
  }
  .tool-card-desc {
    font-size: 0.8rem;
    color: var(--muted);
    line-height: 1.3;
  }
  .tool-card-toggle {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }
  .tool-card-toggle > input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
    pointer-events: none;
  }
  .tool-card-toggle .switch-ui {
    width: 46px;
    height: 26px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--border) 80%, var(--muted) 20%);
    position: relative;
    transition: background-color .2s ease, box-shadow .2s ease;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
  }
  .tool-card-toggle .switch-ui::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2), 0 2px 6px rgba(0,0,0,0.1);
    transition: transform .2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .tool-card:hover .tool-card-toggle > input:not(:checked) + .switch-ui {
    background: color-mix(in srgb, var(--border) 60%, var(--muted) 40%);
  }
  :global(:root[data-theme='dark']) .tool-card-toggle > input:not(:checked) + .switch-ui {
    background: #2a2a2a;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.3);
  }
  :global(:root[data-theme='dark']) .tool-card-toggle .switch-ui::after {
    background: #e6e6e6;
  }
  .tool-card-toggle > input:checked + .switch-ui {
    background: var(--accent) !important;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
  }
  .tool-card-toggle > input:checked + .switch-ui::after {
    transform: translateX(20px);
  }
  .tool-card:has(.tool-card-toggle > input:checked) {
    border-color: color-mix(in srgb, var(--accent) 30%, var(--border) 70%);
    background: color-mix(in srgb, var(--accent) 4%, var(--bg) 96%);
  }
</style>

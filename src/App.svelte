<script>
  import Chat from './lib/Chat.svelte'
  import Sidebar from './lib/components/Sidebar.svelte'
  import SettingsModal from './lib/SettingsModal.svelte'
  import { loadAll, getChats, createChat, setSelected, getChat, deleteChat, renameChat, unlockAllChats } from './lib/chatsStore.js'
  import { loadSettings } from './lib/settingsStore.js'
  import { ensureModels } from './lib/modelsStore.js'
  import { initTheme } from './lib/themeStore.js'

  let chats = $state([])
  let selectedId = $state(null)
  let sidebarOpen = $state(true)
  let showSettings = $state(false)
  let settingsVersion = $state(0)
  let presets = $state([])
  let generatingMap = $state({})

  const SIDEBAR_KEY = 'ui.sidebar.open.v1'
  const SIDEBAR_BASE_WIDTH = 280 // matches `.sidebar` width in Sidebar.svelte
  const CHAT_AREA_FALLBACK_WIDTH = 980 // matches `--page-max` in Chat.svelte
  const COLLAPSE_LEEWAY = 80
  function loadSidebarPref() {
    try {
      const raw = localStorage.getItem(SIDEBAR_KEY)
      if (raw == null) return true
      return raw === '1'
    } catch { return true }
  }
  function saveSidebarPref(val) {
    try { localStorage.setItem(SIDEBAR_KEY, val ? '1' : '0') } catch {}
  }

  function measureChatWidth() {
    if (typeof document === 'undefined') return CHAT_AREA_FALLBACK_WIDTH
    const candidates = ['.chat-pane .composer-inner', '.chat-pane .stack', '.chat-pane']
    for (const selector of candidates) {
      const el = document.querySelector(selector)
      if (!el) continue
      const rect = el.getBoundingClientRect?.()
      if (rect?.width) return rect.width
    }
    return CHAT_AREA_FALLBACK_WIDTH
  }

  function measureSidebarWidth() {
    if (typeof document === 'undefined') return SIDEBAR_BASE_WIDTH
    const el = document.querySelector('.sidebar')
    const rect = el?.getBoundingClientRect?.()
    const width = rect?.width || SIDEBAR_BASE_WIDTH
    return (width > 0) ? width : SIDEBAR_BASE_WIDTH
  }

  function shouldCollapseForViewport() {
    if (!sidebarOpen) return false
    if (typeof window === 'undefined') return false
    const viewportWidth = window.innerWidth || 0
    if (!viewportWidth) return false
    const chatWidth = measureChatWidth()
    const sidebarWidth = measureSidebarWidth()
    const requiredWidth = chatWidth + (sidebarWidth * 2)
    return (viewportWidth + COLLAPSE_LEEWAY) < requiredWidth
  }

  function handleGlobalPointerDown(event) {
    if (!sidebarOpen) return
    if (event?.defaultPrevented) return
    const target = event?.target
    if (target && typeof target.closest === 'function' && target.closest('.sidebar')) return
    if (!shouldCollapseForViewport()) return
    sidebarOpen = false
    saveSidebarPref(false)
  }

  function setGenerating(chatId, isGenerating) {
    if (!chatId) return
    const current = generatingMap
    if (isGenerating) {
      if (current[chatId]) return
      generatingMap = { ...current, [chatId]: true }
      return
    }
    if (!current[chatId]) return
    const next = { ...current }
    delete next[chatId]
    generatingMap = next
  }

  function pruneGenerating(activeIds = []) {
    const allowed = new Set(activeIds)
    const current = generatingMap
    let changed = false
    const next = { ...current }
    for (const id of Object.keys(current)) {
      if (!allowed.has(id)) {
        delete next[id]
        changed = true
      }
    }
    if (changed) generatingMap = next
  }

  function onChatGeneratingChange(chatId, isGenerating) {
    setGenerating(chatId, isGenerating)
  }

  async function refresh() {
    try {
      // Show most recent chats first
      const list = (await getChats()).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      chats = list
      pruneGenerating(list.map(item => item.id).filter(Boolean))
      const saved = loadAll().selectedId
      if (saved && await getChat(saved)) {
        if (selectedId !== saved) selectedId = saved
      } else if (list.length) {
        const first = list[0]?.id || null
        if (selectedId !== first) selectedId = first
      } else if (selectedId !== null) {
        selectedId = null
      }
    } catch {
      chats = []
      selectedId = null
    }
  }

  function syncPresets() {
    try {
      const settings = loadSettings()
      presets = Array.isArray(settings?.presets) ? settings.presets : []
    } catch {
      presets = []
    }
  }

  async function ensureOneChat() {
    const all = await getChats()
    if (!all.length) {
      const c = await createChat()
      selectedId = c.id
    }
  }

  import { onMount } from 'svelte'
  import { migrateChatsToIndexedDB } from './lib/utils/storageMigration.js'

  async function ensureStartupModels() {
    try {
      const settings = loadSettings()
      const connections = Array.isArray(settings?.connections) ? settings.connections : []
      for (const connection of connections) {
        if (connection?.apiKey && connection?.id) {
          try { await ensureModels({ connectionId: connection.id }) } catch {}
        }
      }
    } catch {}
  }
  onMount(() => {
    initTheme()
    ensureStartupModels().catch(() => {})
    // Defer initial population to avoid mutating state during mount flush
    setTimeout(async () => {
      sidebarOpen = loadSidebarPref()
      syncPresets()

      // Migrate chats from localStorage to IndexedDB if needed
      try {
        const migrationResult = await migrateChatsToIndexedDB()
        if (migrationResult.success && migrationResult.migrated > 0) {
          console.log(`Successfully migrated ${migrationResult.migrated} chats to IndexedDB`)
        }
      } catch (err) {
        console.error('Failed to migrate chats:', err)
      }

      await unlockAllChats()
      await ensureOneChat()
      await refresh()
    }, 0)
  })

  onMount(() => {
    window.addEventListener('pointerdown', handleGlobalPointerDown)
    return () => {
      window.removeEventListener('pointerdown', handleGlobalPointerDown)
    }
  })

  function onSelectChat(id) {
    setSelected(id)
    selectedId = id
  }
  async function onNewChat(options = {}) {
    const settings = loadSettings()
    const list = Array.isArray(settings?.presets) ? settings.presets : []
    const requestedId = typeof options?.presetId === 'string' ? options.presetId : null
    const requested = requestedId ? list.find(p => p?.id === requestedId) : null
    const preset = requested || list[0] || null
    const initial = preset
      ? { presetId: preset.id, preset }
      : {}
    const c = await createChat(initial)
    selectedId = c.id
    // Optimized: instead of reloading all chats from storage, just add the new one
    chats = [c.chat, ...chats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  }
  // Coalesce sidebar refresh triggered by child updates
  let refreshTimer = null
  function scheduleRefresh() {
    if (refreshTimer) return
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      refresh()
    }, 0)
  }
  function onChatUpdated() {
    // Refresh list/titles without re-entrant updates during reconciliation
    scheduleRefresh()
  }

  function toggleSidebar() {
    const next = !sidebarOpen
    sidebarOpen = next
    saveSidebarPref(next)
  }

  function onOpenSettings() { showSettings = true }

  async function onDeleteChat(id) {
    if (!id) return
    await deleteChat(id)
    setGenerating(id, false)
    const wasSelected = selectedId === id
    if (wasSelected) selectedId = null
    const remaining = await getChats()
    if (!Array.isArray(remaining) || remaining.length === 0) {
      await onNewChat()
      return
    }
    await refresh()
  }

  async function onRenameChat(id, title) {
    if (!id) return
    await renameChat(id, title)
    await refresh()
  }
</script>

<div class="app-shell">
  <Sidebar
    open={sidebarOpen}
    chats={chats}
    selectedId={selectedId}
    presets={presets}
    generatingMap={generatingMap}
    onSelect={onSelectChat}
    onNewChat={onNewChat}
    onDeleteChat={onDeleteChat}
    onRenameChat={onRenameChat}
    onToggle={toggleSidebar}
    onOpenSettings={onOpenSettings}
  />
  <div class="chat-pane">
    {#each (chats || []) as c (c.id)}
      <div class={`chat-wrapper ${selectedId === c.id ? 'active' : ''}`} aria-hidden={selectedId === c.id ? 'false' : 'true'}>
        <Chat
          chatId={c.id}
          onNewChat={onNewChat}
          onChatUpdated={onChatUpdated}
          settingsVersion={settingsVersion}
          onGeneratingChange={onChatGeneratingChange}
        />
      </div>
    {/each}
  </div>
  <div class="app-fade"></div>
  <SettingsModal
    open={showSettings}
    onClose={() => (showSettings = false)}
    onSaved={() => {
      settingsVersion = Date.now()
      syncPresets()
    }}
  />
</div>

<style>
  :global(#app) { height: 100dvh; }
  .app-shell {
    position: relative;
    height: 100dvh;
    overflow: hidden;
  }
  .chat-pane {
    position: relative;
    height: 100%;
    overflow: hidden;
  }
  .chat-wrapper {
    position: absolute;
    inset: 0;
    display: none;
    height: 100%;
  }
  .chat-wrapper.active { display: block; }
  .app-fade { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(180deg, transparent, transparent 35%, rgba(0,0,0,0.06) 100%); opacity: .18; mix-blend-mode: multiply; }
</style>

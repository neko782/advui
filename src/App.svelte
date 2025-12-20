<script lang="ts">
  import Chat from './lib/Chat.svelte'
  import Sidebar from './lib/components/Sidebar.svelte'
  import SettingsModal from './lib/SettingsModal.svelte'
  import { loadAll, getChats, createChat, setSelected, getChat, deleteChat, renameChat, unlockAllChats } from './lib/chatsStore'
  import { loadSettings } from './lib/settingsStore'
  import { ensureModels } from './lib/modelsStore'
  import { initTheme } from './lib/themeStore'
  import type { Chat as ChatType, Preset, AppSettings } from './lib/types'

  let chats = $state<ChatType[]>([])
  let selectedId = $state<string | null>(null)
  let sidebarOpen = $state(true)
  let showSettings = $state(false)
  let settingsVersion = $state(0)
  let presets = $state<Preset[]>([])
  let generatingMap = $state<Record<string, boolean>>({})
  let appSettings = $state<AppSettings | null>(null)

  // Track previous selected chat to keep it mounted until user switches away
  let previousSelectedId = $state<string | null>(null)

  // Derive which chats should be mounted: selected + previous + generating
  let mountedChatIds = $derived.by(() => {
    const ids = new Set<string>()
    if (selectedId) ids.add(selectedId)
    // Keep previous chat mounted until user navigates away from current
    if (previousSelectedId && previousSelectedId !== selectedId) ids.add(previousSelectedId)
    for (const id of Object.keys(generatingMap)) {
      if (generatingMap[id]) ids.add(id)
    }
    return ids
  })

  const SIDEBAR_KEY = 'ui.sidebar.open.v1'
  // Threshold below which sidebar auto-collapses on outside clicks
  // Matches the CSS media query breakpoint in Sidebar.svelte
  const COLLAPSE_THRESHOLD = 1260

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

  function shouldCollapseForViewport() {
    if (!sidebarOpen) return false
    if (typeof window === 'undefined') return false
    const viewportWidth = window.innerWidth || 0
    if (!viewportWidth) return false
    // Use a fixed threshold that matches the CSS media query
    // The sidebar overlays the chat content, so we only need to check
    // if the viewport is narrow enough that the overlay becomes problematic
    return viewportWidth < COLLAPSE_THRESHOLD
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

  function syncSettings() {
    try {
      const settings = loadSettings()
      appSettings = settings
      presets = Array.isArray(settings?.presets) ? settings.presets : []
      // Apply fancy effects attribute to root element
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-fancy-effects', settings?.fancyEffects ? 'true' : 'false')
      }
    } catch {
      appSettings = null
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
  import { migrateChatsToIndexedDB } from './lib/utils/storageMigration'

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
      syncSettings()

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
    // Track previous selection before changing (for keeping chat mounted)
    if (selectedId && selectedId !== id) {
      previousSelectedId = selectedId
    }
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
    // Track previous selection before changing
    if (selectedId) {
      previousSelectedId = selectedId
    }
    selectedId = c.id
    // Optimized: instead of reloading all chats from storage, just add the new one
    chats = [c.chat, ...chats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  }
  // Coalesce sidebar refresh triggered by child updates
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
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
    // Clear previous if the deleted chat was the previous one
    if (previousSelectedId === id) {
      previousSelectedId = null
    }
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
    {#each (chats || []).filter(c => mountedChatIds.has(c.id)) as c (c.id)}
      <div class="chat-wrapper {selectedId === c.id ? 'active' : 'hidden'}">
        <Chat
          chatId={c.id}
          onNewChat={onNewChat}
          onChatUpdated={onChatUpdated}
          settingsVersion={settingsVersion}
          onGeneratingChange={onChatGeneratingChange}
          appSettings={appSettings}
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
      syncSettings()
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
    height: 100%;
    contain: layout style paint;
  }
  .chat-wrapper.hidden {
    visibility: hidden;
    pointer-events: none;
  }
  .app-fade { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(180deg, transparent, transparent 35%, rgba(0,0,0,0.06) 100%); opacity: .18; }
  :global(:root[data-fancy-effects="true"]) .app-fade { mix-blend-mode: multiply; }
</style>

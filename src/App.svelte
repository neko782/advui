<script>
  import Chat from './lib/Chat.svelte'
  import Sidebar from './lib/components/Sidebar.svelte'
  import SettingsModal from './lib/SettingsModal.svelte'
  import { loadAll, getChats, createChat, setSelected, getChat, deleteChat, renameChat } from './lib/chatsStore.js'

  let chats = $state([])
  let selectedId = $state(null)
  let sidebarOpen = $state(true)
  let showSettings = $state(false)
  let settingsVersion = $state(0)

  const SIDEBAR_KEY = 'ui.sidebar.open.v1'
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

  async function refresh() {
    try {
      // Show most recent chats first
      const list = (await getChats()).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      chats = list
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

  async function ensureOneChat() {
    const all = await getChats()
    if (!all.length) {
      const c = await createChat()
      selectedId = c.id
    }
  }

  import { onMount } from 'svelte'
  onMount(() => {
    // Defer initial population to avoid mutating state during mount flush
    setTimeout(async () => {
      sidebarOpen = loadSidebarPref()
      await ensureOneChat()
      await refresh()
    }, 0)
  })

  function onSelectChat(id) {
    setSelected(id)
    selectedId = id
  }
  async function onNewChat() {
    const c = await createChat()
    selectedId = c.id
    await refresh()
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
    if (selectedId === id) selectedId = null
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
    onSelect={onSelectChat}
    onNewChat={onNewChat}
    onDeleteChat={onDeleteChat}
    onRenameChat={onRenameChat}
    onToggle={toggleSidebar}
    onOpenSettings={onOpenSettings}
  />
  <div class="chat-pane">
    {#if selectedId}
      {#key selectedId}
        <Chat chatId={selectedId} onNewChat={onNewChat} onChatUpdated={onChatUpdated} settingsVersion={settingsVersion} />
      {/key}
    {/if}
  </div>
  <div class="app-fade"></div>
  <SettingsModal open={showSettings} onClose={() => (showSettings = false)} onSaved={() => { settingsVersion = Date.now() }} />
</div>

<style>
  :global(#app) { height: 100dvh; }
  .app-shell {
    position: relative;
    height: 100dvh;
    overflow: hidden;
  }
  .chat-pane { height: 100%; overflow: hidden; }
  .app-fade { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(180deg, transparent, transparent 35%, rgba(0,0,0,0.06) 100%); opacity: .18; mix-blend-mode: multiply; }
</style>

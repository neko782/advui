<script>
  import Chat from './lib/Chat.svelte'
  import Sidebar from './lib/components/Sidebar.svelte'
  import { loadAll, getChats, createChat, setSelected, getChat } from './lib/chatsStore.js'

  let chats = $state([])
  let selectedId = $state(null)
  let sidebarOpen = $state(true)

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

  function refresh() {
    try {
      // Show most recent chats first
      const list = getChats().slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      chats = list
      const saved = loadAll().selectedId
      if (saved && getChat(saved)) {
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

  function ensureOneChat() {
    const all = getChats()
    if (!all.length) {
      const c = createChat()
      selectedId = c.id
    }
  }

  import { onMount } from 'svelte'
  onMount(() => {
    // Defer initial population to avoid mutating state during mount flush
    setTimeout(() => {
      sidebarOpen = loadSidebarPref()
      ensureOneChat()
      refresh()
    }, 0)
  })

  function onSelectChat(id) {
    setSelected(id)
    selectedId = id
  }
  function onNewChat() {
    const c = createChat()
    selectedId = c.id
    refresh()
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
</script>

<div class="app-shell">
  {#if sidebarOpen}
    <Sidebar chats={chats} selectedId={selectedId} onSelect={onSelectChat} onNewChat={onNewChat} onClose={() => { sidebarOpen = false; saveSidebarPref(false) }} />
  {/if}
  <div class="chat-pane">
    {#if selectedId}
      {#key selectedId}
        <Chat chatId={selectedId} onNewChat={onNewChat} onChatUpdated={onChatUpdated} onToggleSidebar={toggleSidebar} />
      {/key}
    {/if}
  </div>
  <div class="app-fade"></div>
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

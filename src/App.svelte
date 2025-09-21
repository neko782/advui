<script>
  import Chat from './lib/Chat.svelte'
  import Sidebar from './lib/components/Sidebar.svelte'
  import { loadAll, getChats, createChat, setSelected, getChat } from './lib/chatsStore.js'

  let chats = $state([])
  let selectedId = $state(null)

  function refresh() {
    try {
      // Show most recent chats first
      const list = getChats().slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      chats = list
      const saved = loadAll().selectedId
      if (saved && getChat(saved)) {
        selectedId = saved
      } else if (list.length) {
        selectedId = list[0].id
      } else {
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
    ensureOneChat()
    refresh()
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
  function onChatUpdated() {
    // Refresh list/titles
    refresh()
  }
</script>

<div class="app-shell">
  <Sidebar chats={chats} selectedId={selectedId} onSelect={onSelectChat} onNewChat={onNewChat} />
  <div class="chat-pane">
    {#if selectedId}
      <Chat chatId={selectedId} onNewChat={onNewChat} onChatUpdated={onChatUpdated} />
    {/if}
  </div>
  <div class="app-fade"></div>
</div>

<style>
  :global(#app) { height: 100dvh; }
  .app-shell {
    position: relative;
    height: 100dvh;
    display: grid;
    grid-template-columns: 260px 1fr;
    overflow: hidden;
  }
  .chat-pane { height: 100%; overflow: hidden; }
  .app-fade { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(180deg, transparent, transparent 35%, rgba(0,0,0,0.06) 100%); opacity: .18; mix-blend-mode: multiply; }
</style>

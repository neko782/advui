<script lang="ts">
  import { tick, onMount, onDestroy } from 'svelte'
  import { IconMenu, IconEditSquare, IconClose, IconCheck, IconEdit, IconDelete, IconSettings, IconSearch, IconDescription, IconMoreVert, IconDownload } from '../icons'
  import ConfirmModal from './ConfirmModal.svelte'
  import EditModal from './EditModal.svelte'
  import { exportChat } from '../utils/exportImport'
  import type { Chat, Preset } from '../types'

  interface Props {
    open?: boolean
    chats?: Chat[]
    selectedId?: string | null
    presets?: Preset[]
    generatingMap?: Record<string, boolean>
    onSelect?: (id: string) => void
    onNewChat?: (options?: { presetId?: string }) => void
    onDeleteChat?: (id: string) => Promise<void>
    onRenameChat?: (id: string, title: string) => Promise<void>
    onToggle?: () => void
    onOpenSettings?: () => void
  }

  const props: Props = $props()

  // Git hash injected at build time
  const gitHash = __GIT_HASH__

  let confirmDeleteId = $state<string | null>(null)
  let editingId = $state<string | null>(null)
  let draftTitle = $state('')
  let editingInput = $state<HTMLInputElement | null>(null)
  let suppressBlur = $state(false)
  let presetMenuOpen = $state(false)
  let presetMenuEl = $state<HTMLDivElement | null>(null)
  let lastSidebarOpen = $state(props.open ?? true)
  let chatMenuOpen = $state<string | null>(null) // Track which chat's menu is open

  // Modal state
  let deleteModalOpen = $state(false)
  let deleteModalChatId = $state<string | null>(null)
  let editModalOpen = $state(false)
  let editModalChat = $state<Chat | null>(null)

  // Search state
  let searchQuery = $state('')
  let searchMode = $state<'title' | 'content'>('title')
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

  // Cache for extracted content to avoid re-processing
  let contentCache = new Map()

  function selectChat(id) {
    if (!id || editingId === id || confirmDeleteId === id) return
    props.onSelect?.(id)
  }

  function requestDelete(id) {
    confirmDeleteId = id
    if (editingId === id) {
      editingId = null
      draftTitle = ''
    }
  }

  function cancelDelete(id) {
    if (confirmDeleteId === id) confirmDeleteId = null
  }

  async function confirmDelete(id) {
    if (confirmDeleteId !== id) return
    confirmDeleteId = null
    await props.onDeleteChat?.(id)
  }

  async function startEdit(chat) {
    if (!chat) return
    confirmDeleteId = null
    editingId = chat.id
    draftTitle = chat.title || 'New Chat'
    await tick()
    editingInput?.focus()
    editingInput?.select?.()
  }

  function cancelEdit(id) {
    if (editingId === id) {
      editingId = null
      draftTitle = ''
      suppressBlur = false
    }
  }

  async function applyEdit(id, originalTitle) {
    if (editingId !== id) return
    const trimmed = (draftTitle || '').trim()
    const nextTitle = trimmed || 'New Chat'
    editingId = null
    draftTitle = ''
    suppressBlur = false
    if (nextTitle !== (originalTitle || 'New Chat')) {
      await props.onRenameChat?.(id, nextTitle)
    }
  }

  function handleInputBlur(id, originalTitle) {
    if (suppressBlur) {
      suppressBlur = false
      return
    }
    applyEdit(id, originalTitle)
  }

  function isGenerating(id) {
    if (!id) return false
    try {
      const map = props.generatingMap
      return !!(map && map[id])
    } catch { return false }
  }

  function closePresetMenu() { presetMenuOpen = false }

  function toggleChatMenu(chatId, event) {
    event?.stopPropagation()
    event?.preventDefault()
    chatMenuOpen = chatMenuOpen === chatId ? null : chatId
  }

  function closeChatMenu() { chatMenuOpen = null }

  function handleMenuEdit(chat, event) {
    event?.stopPropagation()
    closeChatMenu()
    editModalChat = chat
    editModalOpen = true
  }

  function handleMenuDelete(chatId, event) {
    event?.stopPropagation()
    closeChatMenu()
    deleteModalChatId = chatId
    deleteModalOpen = true
  }

  async function handleMenuExport(chatId, event) {
    event?.stopPropagation()
    closeChatMenu()
    try {
      await exportChat(chatId)
    } catch (err) {
      console.error('Failed to export chat:', err)
      alert('Failed to export chat. Please try again.')
    }
  }

  async function confirmEditModal(newTitle) {
    if (!editModalChat) return
    const trimmed = (newTitle || '').trim()
    const nextTitle = trimmed || 'New Chat'
    const chatId = editModalChat.id
    const originalTitle = editModalChat.title
    editModalOpen = false
    editModalChat = null
    if (nextTitle !== (originalTitle || 'New Chat')) {
      await props.onRenameChat?.(chatId, nextTitle)
    }
  }

  function cancelEditModal() {
    editModalOpen = false
    editModalChat = null
  }

  async function confirmDeleteModal() {
    if (!deleteModalChatId) return
    const chatId = deleteModalChatId
    deleteModalOpen = false
    deleteModalChatId = null
    try {
      await props.onDeleteChat?.(chatId)
    } catch (err) {
      console.error('Failed to delete chat:', err)
    }
  }

  function cancelDeleteModal() {
    deleteModalOpen = false
    deleteModalChatId = null
  }

  function handleNewChatClick() {
    const list = Array.isArray(props?.presets) ? props.presets : []
    if (list.length <= 1) {
      closePresetMenu()
      const first = list[0]
      if (first?.id) {
        props.onNewChat?.({ presetId: first.id })
      } else {
        props.onNewChat?.()
      }
      return
    }
    presetMenuOpen = !presetMenuOpen
  }

  function choosePreset(preset) {
    closePresetMenu()
    if (!preset) {
      props.onNewChat?.()
      return
    }
    props.onNewChat?.({ presetId: preset.id })
  }

  // Search functionality
  function toggleSearchMode() {
    searchMode = searchMode === 'title' ? 'content' : 'title'
  }

  function clearSearch() {
    searchQuery = ''
  }

  // Extract text content from chat nodes for content search
  function extractChatContent(chat) {
    if (!chat?.nodes || !Array.isArray(chat.nodes)) return ''

    // Create cache key from chat ID and updatedAt timestamp
    const cacheKey = `${chat.id}-${chat.updatedAt || 0}`

    // Return cached content if available
    if (contentCache.has(cacheKey)) {
      return contentCache.get(cacheKey)
    }

    let content = []
    const maxChars = 100000 // Limit to prevent memory issues
    let charCount = 0

    for (const node of chat.nodes) {
      if (charCount >= maxChars) break
      if (!node?.variants || !Array.isArray(node.variants)) continue

      for (const variant of node.variants) {
        if (charCount >= maxChars) break
        if (variant?.content && typeof variant.content === 'string') {
          const text = variant.content.trim()
          if (text) {
            content.push(text)
            charCount += text.length
          }
        }
      }
    }

    const result = content.join(' ')

    // Cache the result (with size limit to prevent memory issues)
    if (contentCache.size > 100) {
      // Remove oldest entries (first 20)
      const keysToDelete = Array.from(contentCache.keys()).slice(0, 20)
      keysToDelete.forEach(key => contentCache.delete(key))
    }
    contentCache.set(cacheKey, result)

    return result
  }

  // Extract all image IDs from chat nodes
  function extractImageIds(chat) {
    if (!chat?.nodes || !Array.isArray(chat.nodes)) return []

    const imageIds = []
    for (const node of chat.nodes) {
      if (!node?.variants || !Array.isArray(node.variants)) continue

      for (const variant of node.variants) {
        // Collect uploaded image IDs
        if (variant?.images && Array.isArray(variant.images)) {
          for (const img of variant.images) {
            if (img?.id) imageIds.push(img.id)
          }
        }
        // Collect generated image IDs
        if (variant?.generatedImages && Array.isArray(variant.generatedImages)) {
          for (const img of variant.generatedImages) {
            if (img?.id) imageIds.push(img.id)
          }
        }
      }
    }
    return imageIds
  }

  // Optimized search that handles large data
  function matchesSearch(chat, query, mode) {
    if (!query || !query.trim()) return true

    const searchTerm = query.toLowerCase().trim()

    // Always check chat ID silently (regardless of mode)
    const chatId = (chat?.id || '').toLowerCase()
    if (chatId.includes(searchTerm)) return true

    if (mode === 'title') {
      const title = (chat?.title || '').toLowerCase()
      return title.includes(searchTerm)
    } else {
      // Content search
      const title = (chat?.title || '').toLowerCase()
      if (title.includes(searchTerm)) return true

      // Check content first (cached)
      const content = extractChatContent(chat).toLowerCase()
      if (content.includes(searchTerm)) return true

      // Check image IDs last (not cached, requires iteration)
      const imageIds = extractImageIds(chat)
      for (const imgId of imageIds) {
        if (imgId.toLowerCase().includes(searchTerm)) return true
      }

      return false
    }
  }

  // Filtered chats based on search
  const filteredChats = $derived.by(() => {
    const query = searchQuery.trim()
    if (!query) return props.chats || []

    const chats = props.chats || []
    return chats.filter(chat => matchesSearch(chat, query, searchMode))
  })

  onMount(() => {
    function handlePointerDown(event) {
      if (presetMenuOpen) {
        const target = event.target
        const inNewChatWrapper = target.closest('.new-chat-wrapper')
        if (!presetMenuEl?.contains(target) && !inNewChatWrapper) {
          presetMenuOpen = false
        }
      }
      if (chatMenuOpen) {
        const target = event.target
        const chatMenuEl = target.closest('.chat-menu')
        const menuBtn = target.closest('.chat-menu-btn')
        if (!chatMenuEl && !menuBtn) {
          chatMenuOpen = null
        }
      }
    }
    function handleKeydown(event) {
      if (event.key === 'Escape') {
        if (presetMenuOpen) presetMenuOpen = false
        if (chatMenuOpen) chatMenuOpen = null
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeydown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeydown)
    }
  })

  $effect(() => {
    const isOpen = !!props.open
    if (!isOpen && lastSidebarOpen && presetMenuOpen) {
      presetMenuOpen = false
    }
    lastSidebarOpen = isOpen
    const count = Array.isArray(props?.presets) ? props.presets.length : 0
    if (count <= 1 && presetMenuOpen) presetMenuOpen = false
  })

  onDestroy(() => {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer)
    }
  })
</script>

<aside class="sidebar {props.open ? '' : 'collapsed'}">
  <div class="sidebar-inner">
    <!-- Compact header with only the collapse toggle -->
    <div class="side-header">
      <button class="icon-btn" title="Toggle sidebar" aria-label="Toggle sidebar" aria-expanded={props.open ? 'true' : 'false'} onclick={() => props.onToggle?.()}>
        <IconMenu style="font-size: 20px;" />
      </button>
      {#if props.open}
        <div class="brand">
          <span class="brand-name">advui</span>
          <span class="brand-beta">beta</span>
          <span class="brand-hash">{gitHash}</span>
        </div>
      {/if}
    </div>

    <!-- Body is always present so collapsed mode can show actions -->
    <div class="side-body">
      <!-- Primary nav actions -->
      <nav class="top-nav" aria-label="Primary">
        <div class="new-chat-wrapper">
          <button class="nav-item" onclick={handleNewChatClick} title="New chat" aria-label="New chat" aria-haspopup={(Array.isArray(props?.presets) && props.presets.length > 1) ? 'true' : 'false'} aria-expanded={presetMenuOpen ? 'true' : 'false'}>
            <IconEditSquare style="font-size: 20px;" />
            <span class="label">New chat</span>
          </button>
          {#if presetMenuOpen}
            <div class="preset-menu" bind:this={presetMenuEl} aria-label="Choose preset">
              {#each (props.presets || []) as preset (preset.id || preset.name)}
                <button
                  type="button"
                  class="preset-menu-item"
                  onclick={() => choosePreset(preset)}
                >
                  <span class="preset-menu-name">{preset?.name || 'Preset'}</span>
                  <span class="preset-menu-model">{preset?.model || ''}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </nav>

      {#if props.open}
        <!-- Chat list as simple ghost-text buttons -->
        <div class="chat-section">
          <div class="section-label">Chats</div>

          <!-- Search bar -->
          <div class="search-wrapper">
            <div class="search-input-wrapper">
              <IconSearch style="font-size: 18px; color: var(--muted);" />
              <input
                type="text"
                class="search-input"
                placeholder={searchMode === 'title' ? 'Search chats...' : 'Search in content...'}
                value={searchQuery}
                oninput={(e) => searchQuery = e.currentTarget.value}
                aria-label="Search chats"
              />
              <button
                type="button"
                class="search-mode-btn {searchMode === 'content' ? 'active' : ''}"
                onclick={toggleSearchMode}
                aria-label={searchMode === 'title' ? 'Switch to content search' : 'Switch to title search'}
                title={searchMode === 'title' ? 'Search in content' : 'Search in titles'}
              >
                <IconDescription style="font-size: 18px;" />
              </button>
              {#if searchQuery}
                <button
                  type="button"
                  class="search-clear-btn"
                  onclick={clearSearch}
                  aria-label="Clear search"
                  title="Clear search"
                >
                  <IconClose style="font-size: 18px;" />
                </button>
              {/if}
            </div>
          </div>

          <nav class="chat-list" aria-label="Chats">
            {#each filteredChats as c (c.id)}
              <div
                class={`chat-row ${props.selectedId === c.id ? 'active' : ''} ${(confirmDeleteId === c.id || editingId === c.id || props.selectedId === c.id || chatMenuOpen === c.id) ? 'show-actions' : ''}`}
                title={c.title || 'Chat'}
              >
                {#if editingId === c.id}
                  <div class="chat-main editing">
                    <input
                      class="chat-input"
                      bind:this={editingInput}
                      value={draftTitle}
                      oninput={(event) => (draftTitle = event.currentTarget.value)}
                      onblur={() => handleInputBlur(c.id, c.title)}
                      onkeydown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          applyEdit(c.id, c.title)
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          cancelEdit(c.id)
                        }
                      }}
                      aria-label="Edit chat title"
                    />
                  </div>
                {:else}
                  <button
                    type="button"
                    class="chat-link {props.selectedId === c.id ? 'active' : ''}"
                    onclick={() => selectChat(c.id)}
                    onkeydown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        selectChat(c.id)
                      }
                    }}
                  >
                    <span class="chat-label">
                      {#if isGenerating(c.id)}
                        <span class="chat-spinner" aria-hidden="true"></span>
                      {/if}
                      <span class="chat-title">{c.title || 'New Chat'}</span>
                    </span>
                  </button>
                {/if}
                <div class="chat-actions">
                  {#if confirmDeleteId === c.id}
                    <button type="button" class="chat-action-btn cancel" onclick={() => cancelDelete(c.id)} aria-label="Cancel delete">
                      <IconClose style="font-size: 18px;" />
                    </button>
                    <button type="button" class="chat-action-btn confirm" onclick={() => confirmDelete(c.id)} aria-label="Confirm delete">
                      <IconCheck style="font-size: 18px;" />
                    </button>
                  {:else if editingId === c.id}
                    <button
                      type="button"
                      class="chat-action-btn cancel"
                      onmousedown={() => (suppressBlur = true)}
                      onclick={() => cancelEdit(c.id)}
                      aria-label="Cancel edit"
                    >
                      <IconClose style="font-size: 18px;" />
                    </button>
                    <button
                      type="button"
                      class="chat-action-btn confirm"
                      onmousedown={() => (suppressBlur = true)}
                      onclick={() => applyEdit(c.id, c.title)}
                      aria-label="Confirm title"
                    >
                      <IconCheck style="font-size: 18px;" />
                    </button>
                  {:else}
                    <div class="chat-menu-wrapper">
                      <button
                        type="button"
                        class="chat-action-btn chat-menu-btn"
                        onclick={(e) => toggleChatMenu(c.id, e)}
                        aria-label="Chat options"
                        aria-haspopup="true"
                        aria-expanded={chatMenuOpen === c.id ? 'true' : 'false'}
                      >
                        <IconMoreVert style="font-size: 18px;" />
                      </button>
                      {#if chatMenuOpen === c.id}
                        <div class="chat-menu">
                          <button
                            type="button"
                            class="chat-menu-item"
                            onclick={(e) => handleMenuEdit(c, e)}
                          >
                            <IconEdit style="font-size: 18px;" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            class="chat-menu-item"
                            onclick={(e) => handleMenuExport(c.id, e)}
                          >
                            <IconDownload style="font-size: 18px;" />
                            <span>Export</span>
                          </button>
                          <button
                            type="button"
                            class="chat-menu-item"
                            onclick={(e) => handleMenuDelete(c.id, e)}
                          >
                            <IconDelete style="font-size: 18px;" />
                            <span>Delete</span>
                          </button>
                        </div>
                      {/if}
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          </nav>
        </div>
      {/if}

      <!-- Footer actions pinned at the bottom -->
      <div class="side-footer">
        <button class="nav-item" onclick={() => props.onOpenSettings?.()} title="Settings" aria-label="Settings">
          <IconSettings style="font-size: 20px;" />
          <span class="label">Settings</span>
        </button>
      </div>
    </div>
  </div>
  {#if props.open}
    <div class="side-fade"></div>
  {/if}
</aside>

<ConfirmModal
  open={deleteModalOpen}
  title="Delete Chat"
  message="Are you sure you want to delete this chat? This action cannot be undone."
  confirmText="Delete"
  cancelText="Cancel"
  danger={true}
  onConfirm={confirmDeleteModal}
  onCancel={cancelDeleteModal}
/>

<EditModal
  open={editModalOpen}
  title="Edit Chat Title"
  label="Chat title"
  placeholder="New Chat"
  value={editModalChat?.title || ''}
  confirmText="Save"
  cancelText="Cancel"
  onConfirm={confirmEditModal}
  onCancel={cancelEditModal}
/>

<style>
  .sidebar {
    --panel: color-mix(in srgb, #ffffff 92%, #e6e6e6);
    --border: color-mix(in srgb, #c8c8c8 60%, #0000);
    --text: color-mix(in srgb, #1b1f24 92%, #0000);
    --muted: #6b7280;
    /* Subtle hover surface derived from background + text for good contrast in light/dark */
    --hover-bg: color-mix(in oklab, var(--bg), var(--text) 8%);
    background: var(--bg);
    border-right: 1px solid var(--border);
    /* Overlay the chat area instead of shifting it */
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 280px;
    height: 100%;
    /* Prevent any horizontal bleed from long titles */
    overflow-x: hidden;
    z-index: 10;
    /* Respect viewport safe-area so the toggle button position stays consistent */
    padding-top: env(safe-area-inset-top, 0px);
    padding-right: env(safe-area-inset-right, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    padding-left: env(safe-area-inset-left, 0px);
  }
  .sidebar.collapsed { width: 52px; overflow-x: visible; padding: 0; }
  :global(:root[data-theme='dark']) .sidebar {
    --panel: #141414;
    --border: #2a2a2a;
    --text: #e6e6e6;
    --muted: #a3a3a3;
  }
  .sidebar-inner { height: 100%; display: grid; grid-template-rows: auto 1fr; }
  .side-body { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  .side-header { display: flex; align-items: center; gap: 8px; padding: 8px; }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
  }
  .brand-hash {
    font-size: 0.7rem;
    font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Consolas', monospace;
    font-weight: 500;
    color: var(--muted);
    opacity: 0.8;
  }
  .brand-beta {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 2px 6px;
    border-radius: 999px;
    background: var(--border);
    color: var(--text);
  }
  .icon-btn {
    min-width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    color: var(--text);
    transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease, transform 100ms ease;
  }
  .icon-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .icon-btn:active {
    transform: scale(0.94);
  }
  .sidebar.collapsed .brand { display: none; }
  .sidebar.collapsed .chat-list { display: none; }
  .top-nav { display: grid; gap: 6px; padding: 6px 8px 2px; }
  /* Left padding set to 8px for precise alignment */
  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    text-align: left;
    padding: 8px 10px 8px 8px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    transition: background-color 150ms ease, color 150ms ease, transform 100ms ease;
  }
  .nav-item:hover {
    background: var(--panel);
    color: var(--accent);
  }
  .nav-item:active {
    transform: scale(0.98);
  }
  .nav-item .label { white-space: nowrap; }
  .sidebar.collapsed .nav-item .label { display: none; }
  .new-chat-wrapper { position: relative; }
  .preset-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 6px;
    display: grid;
    gap: 4px;
    box-shadow: 0 8px 18px rgba(0,0,0,0.18);
    z-index: 200;
  }
  .sidebar.collapsed .preset-menu { left: 8px; right: auto; width: 220px; }
  .preset-menu-item {
    display: grid;
    align-items: start;
    gap: 2px;
    text-align: left;
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 10px 12px;
    background: transparent;
    color: var(--text);
    font: inherit;
    cursor: pointer;
    transition: background-color 120ms ease, border-color 120ms ease, transform 100ms ease;
  }
  .preset-menu-item:hover,
  .preset-menu-item:focus-visible {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border-color: color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .preset-menu-item:active {
    transform: scale(0.98);
  }
  .preset-menu-name { font-weight: 600; }
  .preset-menu-model { font-size: .85rem; color: var(--muted); }
  /* Collapsed nav items: icon-only ghost buttons (no border/background) */
  .sidebar.collapsed .nav-item {
    display: grid;
    place-items: center;
    padding: 0;
    min-width: 36px;
    height: 36px;
    border: 0;
    border-radius: 8px;
    /* Explicitly match the sidebar surface when collapsed */
    background: var(--bg);
    color: var(--text);
  }
  .sidebar.collapsed .nav-item:hover,
  .sidebar.collapsed .nav-item:active,
  .sidebar.collapsed .nav-item:focus-visible {
    background: var(--hover-bg);
    transform: translateY(-1px);
  }

  @media (max-width: 1260px) {
    .sidebar.collapsed {
      width: 0;
      border-right: 0;
      background: transparent;
    }
    .sidebar.collapsed .sidebar-inner {
      display: contents;
    }
    .sidebar.collapsed .side-header {
      position: fixed;
      top: 8px;
      left: 8px;
      top: calc(env(safe-area-inset-top, 0px) + 8px);
      left: calc(env(safe-area-inset-left, 0px) + 8px);
      z-index: 40;
      padding: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .sidebar.collapsed .side-body,
    .sidebar.collapsed .side-footer,
    .sidebar.collapsed .side-fade {
      display: none;
    }
  }

  /* Collapse button hover: use accent color and subtle lift */
  .side-header .icon-btn:hover,
  .side-header .icon-btn:focus-visible {
    transform: translateY(-1px);
    border-color: var(--accent);
    color: var(--accent);
  }
  .side-header .icon-btn:active {
    transform: scale(0.94);
  }

  /* Align label with chat buttons and add spacing from New chat */
  .chat-section {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }
  .section-label {
    font-size: .85rem;
    color: var(--muted);
    /* Left padding matches chat button left edge: chat-list(6px) + chat-link(10px) */
    padding: 8px 12px 0 16px;
    margin-top: 10px;
    margin-bottom: 8px; /* space between label and chat list */
  }
  .chat-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 6px 10px;
    /* Only vertical scrolling; clip horizontal overflow */
    overflow-y: auto;
    overflow-x: hidden;
    flex: 1;
    min-height: 0;
    /* Allow flex child to shrink and avoid overflow */
    min-width: 0;
  }
  .chat-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    padding: 2px 4px;
    padding-right: 36px;
    border-radius: 8px;
    overflow: visible;
    z-index: 1;
  }
  .chat-row.show-actions {
    z-index: 150;
  }
  .chat-row:has(.chat-menu) {
    z-index: 160;
  }
  .chat-row.active { background: var(--panel); }
  .chat-row:hover { background: var(--panel); }
  .chat-list:hover .chat-row.active { background: color-mix(in srgb, var(--panel) 90%, var(--hover-bg) 10%); }

  .chat-link {
    text-align: left;
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    padding: 6px 10px;
    border: 0;
    background: transparent;
    color: var(--muted);
    border-radius: 8px;
    font: inherit;
    transition: background-color 150ms ease, color 150ms ease;
    min-width: 0;
  }
  .chat-link:hover { background: color-mix(in srgb, var(--panel) 80%, var(--hover-bg) 20%); color: var(--text); }
  .chat-link.active { color: var(--text); }
  .chat-label {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1 1 auto;
    min-width: 0;
  }
  .chat-spinner {
    width: 12px;
    height: 12px;
    border-radius: 999px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    animation: chat-spinner-rotate 0.8s linear infinite;
    flex: 0 0 auto;
  }
  .chat-title { flex: 1 1 auto; min-width: 0; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  @keyframes chat-spinner-rotate {
    to { transform: rotate(360deg); }
  }

  .chat-main.editing {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--panel);
    min-width: 0;
  }
  .chat-input {
    flex: 1 1 auto;
    border: none;
    background: transparent;
    color: var(--text);
    font: inherit;
    outline: none;
    min-width: 0;
  }

  .chat-actions {
    position: absolute;
    top: 50%;
    right: 12px;
    transform: translateY(-50%);
    display: flex;
    gap: 4px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 150ms ease;
  }
  .chat-row:hover .chat-actions,
  .chat-row.show-actions .chat-actions {
    opacity: 1;
    pointer-events: auto;
  }

  .chat-action-btn {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: background-color 120ms ease, color 120ms ease, transform 100ms ease;
  }
  .chat-action-btn:hover,
  .chat-action-btn:focus-visible {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }
  .chat-action-btn:active {
    transform: scale(0.9);
  }

  .chat-action-btn.confirm { color: #16a34a; }
  .chat-action-btn.cancel { color: #dc2626; }
  .chat-action-btn.confirm:hover,
  .chat-action-btn.confirm:focus-visible {
    background: color-mix(in srgb, #16a34a 12%, transparent);
    color: #15803d;
  }
  .chat-action-btn.cancel:hover,
  .chat-action-btn.cancel:focus-visible {
    background: color-mix(in srgb, #dc2626 12%, transparent);
    color: #b91c1c;
  }

  .chat-menu-wrapper {
    position: relative;
  }

  .chat-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: -4px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    box-shadow:
      0 0 0 1px rgba(0,0,0,0.03),
      0 2px 4px rgba(0,0,0,0.04),
      0 8px 16px rgba(0,0,0,0.08),
      0 16px 32px rgba(0,0,0,0.06);
    z-index: 100;
    min-width: 150px;
    animation: chat-menu-enter 180ms cubic-bezier(0.2, 0.9, 0.3, 1);
    transform-origin: top right;
  }

  @keyframes chat-menu-enter {
    from {
      opacity: 0;
      transform: scale(0.92) translateY(-4px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  :global(:root[data-theme='dark']) .chat-menu {
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.04),
      0 2px 4px rgba(0,0,0,0.2),
      0 8px 16px rgba(0,0,0,0.3),
      0 16px 32px rgba(0,0,0,0.2);
  }

  .chat-menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    text-align: left;
    padding: 9px 12px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
    transition: background-color 150ms ease, transform 100ms ease;
    white-space: nowrap;
  }

  .chat-menu-item:hover,
  .chat-menu-item:focus-visible {
    background: var(--hover-bg);
  }

  .chat-menu-item:active {
    transform: scale(0.98);
  }

  .chat-menu-item:last-child {
    color: #ef4444;
  }

  .chat-menu-item:last-child:hover,
  .chat-menu-item:last-child:focus-visible {
    background: color-mix(in srgb, #ef4444 12%, transparent);
  }

  :global(:root[data-theme='dark']) .chat-menu-item:last-child {
    color: #f87171;
  }

  :global(:root[data-theme='dark']) .chat-menu-item:last-child:hover,
  :global(:root[data-theme='dark']) .chat-menu-item:last-child:focus-visible {
    background: color-mix(in srgb, #ef4444 18%, transparent);
  }

  .side-footer { padding: 8px; border-top: 1px solid var(--border); margin-top: auto; }
  /* Remove horizontal separator in collapsed mode */
  .sidebar.collapsed .side-footer { border-top: 0; }
  .side-fade { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(180deg, transparent, transparent 40%, rgba(0,0,0,0.04) 100%); mix-blend-mode: multiply; opacity: .35; }

  /* Search styles */
  .search-wrapper {
    padding: 0 16px 6px;
    margin-top: 2px;
  }

  .search-input-wrapper {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    transition: background-color 150ms ease;
    min-width: 0;
  }

  .search-input-wrapper:hover {
    background: color-mix(in srgb, var(--panel), transparent 60%);
  }

  .search-input-wrapper:focus-within {
    background: var(--panel);
  }

  .search-input {
    flex: 1 1 auto;
    border: none;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    outline: none;
    min-width: 0;
  }

  .search-input::placeholder {
    color: var(--muted);
    opacity: 0.7;
  }

  .search-clear-btn {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: background-color 120ms ease, color 120ms ease, transform 100ms ease;
    flex: 0 0 auto;
  }

  .search-clear-btn:hover,
  .search-clear-btn:focus-visible {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }
  .search-clear-btn:active {
    transform: scale(0.9);
  }

  .search-mode-btn {
    display: grid;
    place-items: center;
    min-width: 24px;
    height: 24px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: background-color 120ms ease, color 120ms ease, opacity 150ms ease, transform 100ms ease;
    flex: 0 0 auto;
    opacity: 0;
    pointer-events: none;
  }

  .search-input-wrapper:hover .search-mode-btn,
  .search-input-wrapper:focus-within .search-mode-btn {
    opacity: 1;
    pointer-events: auto;
  }

  .search-mode-btn:hover,
  .search-mode-btn:focus-visible {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }
  .search-mode-btn:active {
    transform: scale(0.9);
  }

  .search-mode-btn.active {
    color: var(--accent);
  }
</style>

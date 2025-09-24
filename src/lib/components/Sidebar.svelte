<script>
  import { tick, onMount } from 'svelte'
  import Icon from '../Icon.svelte'
  const props = $props()

  let confirmDeleteId = $state(null)
  let editingId = $state(null)
  let draftTitle = $state('')
  let editingInput = $state(null)
  let suppressBlur = $state(false)
  let presetMenuOpen = $state(false)
  let presetMenuEl = $state(null)
  let lastSidebarOpen = $state(props.open ?? true)

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

  onMount(() => {
    function handlePointerDown(event) {
      if (!presetMenuOpen) return
      if (presetMenuEl && !presetMenuEl.contains(event.target)) {
        presetMenuOpen = false
      }
    }
    function handleKeydown(event) {
      if (event.key === 'Escape' && presetMenuOpen) {
        presetMenuOpen = false
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
</script>

<aside class="sidebar {props.open ? '' : 'collapsed'}">
  <div class="sidebar-inner">
    <!-- Compact header with only the collapse toggle -->
    <div class="side-header">
      <button class="icon-btn" title="Toggle sidebar" aria-label="Toggle sidebar" aria-expanded={props.open ? 'true' : 'false'} onclick={() => props.onToggle?.()}>
        <Icon name="menu" size={20} />
      </button>
      {#if props.open}
        <div class="brand">
          <span class="brand-name">advui</span>
          <span class="brand-beta">beta</span>
        </div>
      {/if}
    </div>

    <!-- Body is always present so collapsed mode can show actions -->
    <div class="side-body">
      <!-- Primary nav actions -->
      <nav class="top-nav" aria-label="Primary">
        <div class="new-chat-wrapper">
          <button class="nav-item" onclick={handleNewChatClick} title="New chat" aria-label="New chat" aria-haspopup={(Array.isArray(props?.presets) && props.presets.length > 1) ? 'true' : 'false'} aria-expanded={presetMenuOpen ? 'true' : 'false'}>
            <Icon name="edit_square" size={20} />
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
          <nav class="chat-list" aria-label="Chats">
            {#each (props.chats || []) as c (c.id)}
              <div
                class={`chat-row ${props.selectedId === c.id ? 'active' : ''} ${(confirmDeleteId === c.id || editingId === c.id || props.selectedId === c.id) ? 'show-actions' : ''}`}
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
                      <Icon name="close" size={18} />
                    </button>
                    <button type="button" class="chat-action-btn confirm" onclick={() => confirmDelete(c.id)} aria-label="Confirm delete">
                      <Icon name="check" size={18} />
                    </button>
                  {:else if editingId === c.id}
                    <button
                      type="button"
                      class="chat-action-btn cancel"
                      onmousedown={() => (suppressBlur = true)}
                      onclick={() => cancelEdit(c.id)}
                      aria-label="Cancel edit"
                    >
                      <Icon name="close" size={18} />
                    </button>
                    <button
                      type="button"
                      class="chat-action-btn confirm"
                      onmousedown={() => (suppressBlur = true)}
                      onclick={() => applyEdit(c.id, c.title)}
                      aria-label="Confirm title"
                    >
                      <Icon name="check" size={18} />
                    </button>
                  {:else}
                    <button
                      type="button"
                      class="chat-action-btn"
                      onclick={() => startEdit(c)}
                      aria-label="Edit chat title"
                    >
                      <Icon name="edit" size={18} />
                    </button>
                    <button
                      type="button"
                      class="chat-action-btn"
                      onclick={() => requestDelete(c.id)}
                      aria-label="Delete chat"
                    >
                      <Icon name="delete" size={18} />
                    </button>
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
          <Icon name="settings" size={20} />
          <span class="label">Settings</span>
        </button>
      </div>
    </div>
  </div>
  {#if props.open}
    <div class="side-fade"></div>
  {/if}
</aside>

<style>
  .sidebar {
    --bg: color-mix(in oklab, canvas, #f3f4f6 10%);
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
  @media (prefers-color-scheme: dark) {
    .sidebar {
      --bg: #0f0f10;
      --panel: #141414;
      --border: #2a2a2a;
      --text: #e6e6e6;
      --muted: #a3a3a3;
    }
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
    transition: background-color 150ms ease, color 150ms ease, transform 120ms ease;
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
    transition: background-color 150ms ease, color 150ms ease, transform 120ms ease;
  }
  .nav-item:hover { background: var(--panel); }
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
    z-index: 20;
  }
  .sidebar.collapsed .preset-menu { left: 8px; right: auto; width: 220px; }
  .preset-menu-item {
    display: grid;
    align-items: start;
    gap: 2px;
    text-align: left;
    border: 0;
    border-radius: 8px;
    padding: 8px 10px;
    background: transparent;
    color: var(--text);
    font: inherit;
    cursor: pointer;
    transition: background-color 150ms ease;
  }
  .preset-menu-item:hover,
  .preset-menu-item:focus-visible { background: var(--hover-bg); }
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

  /* Collapse button hover: animate without changing border or background */
  .side-header .icon-btn:hover,
  .side-header .icon-btn:active,
  .side-header .icon-btn:focus-visible {
    transform: translateY(-1px);
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
    padding-right: 60px;
    border-radius: 8px;
    overflow: hidden;
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
    transition: background-color 120ms ease, color 120ms ease;
  }
  .chat-action-btn:hover,
  .chat-action-btn:focus-visible {
    background: var(--hover-bg);
    color: var(--text);
  }

  .chat-action-btn.confirm { color: #16a34a; }
  .chat-action-btn.cancel { color: #dc2626; }
  .chat-action-btn.confirm:hover,
  .chat-action-btn.confirm:focus-visible { color: #15803d; }
  .chat-action-btn.cancel:hover,
  .chat-action-btn.cancel:focus-visible { color: #b91c1c; }

  .side-footer { padding: 8px; border-top: 1px solid var(--border); margin-top: auto; }
  /* Remove horizontal separator in collapsed mode */
  .sidebar.collapsed .side-footer { border-top: 0; }
  .side-fade { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(180deg, transparent, transparent 40%, rgba(0,0,0,0.04) 100%); mix-blend-mode: multiply; opacity: .35; }
</style>

<script lang="ts">
  import { onMount } from 'svelte'
  import { IconMenu, IconEditSquare, IconSettings, IconUpload, IconAdd, IconChevronLeft, IconEdit, IconDelete, IconTune, IconPerson, IconMoreVert, IconDownload, IconContentCopy } from '../../icons'
  import ConfirmModal from '../ConfirmModal.svelte'
  import EditModal from '../EditModal.svelte'
  import { exportChat } from '../../utils/exportImport'
  import type { ChatListItem } from '../../types'
  import type { Character } from '../../types/tavern'

  interface Props {
    open?: boolean
    characters?: Character[]
    chats?: ChatListItem[]
    selectedCharacterId?: string | null
    selectedId?: string | null
    generatingMap?: Record<string, boolean>
    onSelectCharacter?: (id: string | null) => void
    onImportCharacterFiles?: (files: FileList | File[]) => void
    onNewCharacter?: () => void
    onEditCharacter?: (character: Character) => void
    onDeleteCharacter?: (id: string) => void
    onNewChat?: (characterId: string) => void
    onSelect?: (id: string) => void
    onDeleteChat?: (id: string) => Promise<void> | void
    onDuplicateChat?: (id: string) => Promise<void>
    onRenameChat?: (id: string, title: string) => Promise<void>
    onOpenTavernSettings?: () => void
    onToggle?: () => void
    onOpenSettings?: () => void
    onSwitchMode?: (mode: 'chat' | 'tavern') => void
  }

  const props: Props = $props()

  // Git hash injected at build time
  const gitHash = __GIT_HASH__

  let fileInput = $state<HTMLInputElement | null>(null)
  let deleteCharacterId = $state<string | null>(null)
  let deleteChatId = $state<string | null>(null)
  let chatMenuOpen = $state<string | null>(null)
  let editModalChat = $state<ChatListItem | null>(null)

  const selectedCharacter = $derived(
    (props.characters || []).find(c => c.id === props.selectedCharacterId) || null
  )

  const characterChats = $derived(
    (props.chats || [])
      .filter(c => c.characterId === props.selectedCharacterId)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  )

  function chatCountFor(characterId: string): number {
    return (props.chats || []).filter(c => c.characterId === characterId).length
  }

  function isGenerating(id: string): boolean {
    try { return !!props.generatingMap?.[id] } catch { return false }
  }

  function handleFileChange(event: Event) {
    const target = event.target as HTMLInputElement
    if (target.files?.length) {
      props.onImportCharacterFiles?.(target.files)
    }
    target.value = ''
  }

  async function confirmDeleteChat() {
    const id = deleteChatId
    deleteChatId = null
    if (id) await props.onDeleteChat?.(id)
  }

  function toggleChatMenu(chatId: string, event: MouseEvent) {
    event.stopPropagation()
    chatMenuOpen = chatMenuOpen === chatId ? null : chatId
  }

  function openEditChat(chat: ChatListItem, event: MouseEvent) {
    event.stopPropagation()
    chatMenuOpen = null
    editModalChat = chat
  }

  async function duplicateSelectedChat(chatId: string, event: MouseEvent) {
    event.stopPropagation()
    chatMenuOpen = null
    try {
      await props.onDuplicateChat?.(chatId)
    } catch (err) {
      console.error('Failed to duplicate chat:', err)
      alert('Failed to duplicate chat. Please try again.')
    }
  }

  async function exportSelectedChat(chatId: string, event: MouseEvent) {
    event.stopPropagation()
    chatMenuOpen = null
    try {
      await exportChat(chatId)
    } catch (err) {
      console.error('Failed to export chat:', err)
      alert('Failed to export chat. Please try again.')
    }
  }

  function requestDeleteChat(chatId: string, event: MouseEvent) {
    event.stopPropagation()
    chatMenuOpen = null
    deleteChatId = chatId
  }

  async function confirmEditChat(newTitle: string) {
    if (!editModalChat) return
    const chat = editModalChat
    editModalChat = null
    const nextTitle = newTitle.trim() || 'New Chat'
    if (nextTitle !== (chat.title || 'New Chat')) {
      await props.onRenameChat?.(chat.id, nextTitle)
    }
  }

  onMount(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!chatMenuOpen) return
      const target = event.target as Element | null
      if (!target?.closest('.chat-menu') && !target?.closest('.chat-menu-btn')) chatMenuOpen = null
    }
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') chatMenuOpen = null
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeydown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeydown)
    }
  })

  function confirmDeleteCharacter() {
    const id = deleteCharacterId
    deleteCharacterId = null
    if (id) props.onDeleteCharacter?.(id)
  }
</script>

<aside class="sidebar {props.open ? '' : 'collapsed'}">
  <div class="sidebar-inner">
    <div class="side-header">
      <button class="icon-btn" title="Toggle sidebar" aria-label="Toggle sidebar" aria-expanded={props.open ? 'true' : 'false'} onclick={() => props.onToggle?.()}>
        <IconMenu style="font-size: 20px;" />
      </button>
      {#if props.open}
        <div class="brand">
          <span class="brand-name">advui</span>
          <div class="mode-switch" role="tablist" aria-label="Mode">
            <button type="button" class="mode-btn" role="tab" aria-selected="false" onclick={() => props.onSwitchMode?.('chat')}>Chat</button>
            <button type="button" class="mode-btn active" role="tab" aria-selected="true">Tavern</button>
          </div>
        </div>
      {/if}
    </div>

    <div class="side-body">
      {#if !selectedCharacter}
        <!-- Character list view -->
        <nav class="top-nav" aria-label="Characters actions">
          <button class="nav-item" onclick={() => fileInput?.click()} title="Import character card" aria-label="Import character card">
            <IconUpload style="font-size: 20px;" />
            <span class="label">Import card</span>
          </button>
          <button class="nav-item" onclick={() => props.onNewCharacter?.()} title="New character" aria-label="New character">
            <IconAdd style="font-size: 20px;" />
            <span class="label">New character</span>
          </button>
          <input
            type="file"
            accept=".png,.json,image/png,application/json"
            multiple
            bind:this={fileInput}
            onchange={handleFileChange}
            style="display: none;"
          />
        </nav>
        {#if props.open}
          <div class="section-label">Characters</div>
          <div class="character-list" role="list">
            {#if !(props.characters || []).length}
              <div class="empty-hint">
                No characters yet. Import a SillyTavern card (.png / .json) or create one.
              </div>
            {/if}
            {#each (props.characters || []) as character (character.id)}
              <div class="character-card" role="listitem">
                <button
                  type="button"
                  class="character-btn"
                  onclick={() => props.onSelectCharacter?.(character.id)}
                >
                  {#if character.avatar}
                    <img class="character-avatar" src={character.avatar} alt={character.name} loading="lazy" />
                  {:else}
                    <div class="character-avatar placeholder">
                      <IconPerson style="font-size: 28px;" />
                    </div>
                  {/if}
                  <div class="character-info">
                    <div class="character-name">{character.name || 'Unnamed'}</div>
                    {#if character.creator}
                      <div class="character-creator">by {character.creator}</div>
                    {/if}
                    {#if character.creatorNotes}
                      <div class="character-notes">{character.creatorNotes}</div>
                    {/if}
                    <div class="character-meta">{chatCountFor(character.id)} chats</div>
                  </div>
                </button>
                <div class="character-actions">
                  <button type="button" class="chat-action-btn" title="Edit character" aria-label="Edit character" onclick={() => props.onEditCharacter?.(character)}>
                    <IconEdit style="font-size: 18px;" />
                  </button>
                  <button type="button" class="chat-action-btn danger" title="Delete character" aria-label="Delete character" onclick={() => (deleteCharacterId = character.id)}>
                    <IconDelete style="font-size: 18px;" />
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {:else}
        <!-- Per-character chat list view -->
        {#if props.open}
          <div class="char-header">
            <button type="button" class="icon-btn" title="Back to characters" aria-label="Back to characters" onclick={() => props.onSelectCharacter?.(null)}>
              <IconChevronLeft style="font-size: 20px;" />
            </button>
            {#if selectedCharacter.avatar}
              <img class="char-header-avatar" src={selectedCharacter.avatar} alt={selectedCharacter.name} />
            {:else}
              <div class="char-header-avatar placeholder"><IconPerson style="font-size: 18px;" /></div>
            {/if}
            <span class="char-header-name">{selectedCharacter.name}</span>
          </div>
        {/if}

        <nav class="top-nav" aria-label="Chat actions">
          <button class="nav-item" onclick={() => props.onNewChat?.(selectedCharacter.id)} title="New chat with {selectedCharacter.name}" aria-label="New chat">
            <IconEditSquare style="font-size: 20px;" />
            <span class="label">New chat</span>
          </button>
          <button class="nav-item" onclick={() => props.onEditCharacter?.(selectedCharacter)} title="Edit {selectedCharacter.name}" aria-label="Edit character">
            <IconEdit style="font-size: 20px;" />
            <span class="label">Edit character</span>
          </button>
        </nav>

        {#if props.open}
          <div class="section-label">Chats</div>
          <nav class="chat-list" aria-label="Chats">
            {#if !characterChats.length}
              <div class="empty-hint">No chats yet with {selectedCharacter.name}.</div>
            {/if}
            {#each characterChats as c (c.id)}
              <div class="chat-row {props.selectedId === c.id ? 'active' : ''}">
                <button
                  type="button"
                  class="chat-link {props.selectedId === c.id ? 'active' : ''}"
                  onclick={() => props.onSelect?.(c.id)}
                >
                  <span class="chat-label">
                    {#if isGenerating(c.id)}
                      <span class="chat-spinner" aria-hidden="true"></span>
                    {/if}
                    <span class="chat-title">{c.title || 'New Chat'}</span>
                  </span>
                </button>
                <div class="chat-actions">
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
                        <button type="button" class="chat-menu-item" onclick={(e) => openEditChat(c, e)}>
                          <IconEdit style="font-size: 18px;" /><span>Edit</span>
                        </button>
                        <button type="button" class="chat-menu-item" onclick={(e) => duplicateSelectedChat(c.id, e)}>
                          <IconContentCopy style="font-size: 18px;" /><span>Duplicate</span>
                        </button>
                        <button type="button" class="chat-menu-item" onclick={(e) => exportSelectedChat(c.id, e)}>
                          <IconDownload style="font-size: 18px;" /><span>Export</span>
                        </button>
                        <button type="button" class="chat-menu-item" onclick={(e) => requestDeleteChat(c.id, e)}>
                          <IconDelete style="font-size: 18px;" /><span>Delete</span>
                        </button>
                      </div>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
          </nav>
        {/if}
      {/if}

      <div class="side-footer">
        <div class="footer-row">
          <button class="nav-item" onclick={() => props.onOpenSettings?.()} title="Settings ({gitHash})" aria-label="Settings">
            <IconSettings style="font-size: 20px;" />
            <span class="label">Settings</span>
            <span class="brand-hash">{gitHash}</span>
          </button>
          <button class="nav-item tavern-settings" onclick={() => props.onOpenTavernSettings?.()} title="Tavern settings" aria-label="Tavern settings">
            <IconTune style="font-size: 20px;" />
          </button>
        </div>
      </div>
    </div>
  </div>
</aside>

<ConfirmModal
  open={deleteChatId !== null}
  title="Delete Chat"
  message="Are you sure you want to delete this chat? This action cannot be undone."
  confirmText="Delete"
  cancelText="Cancel"
  danger={true}
  onConfirm={confirmDeleteChat}
  onCancel={() => (deleteChatId = null)}
/>

<ConfirmModal
  open={deleteCharacterId !== null}
  title="Delete Character"
  message="Delete this character and all of their chats? This action cannot be undone."
  confirmText="Delete"
  cancelText="Cancel"
  danger={true}
  onConfirm={confirmDeleteCharacter}
  onCancel={() => (deleteCharacterId = null)}
/>

<EditModal
  open={editModalChat !== null}
  title="Edit Chat Title"
  label="Chat title"
  placeholder="New Chat"
  value={editModalChat?.title || ''}
  confirmText="Save"
  cancelText="Cancel"
  onConfirm={confirmEditChat}
  onCancel={() => (editModalChat = null)}
/>

<style>
  .sidebar {
    --panel: color-mix(in srgb, #ffffff 92%, #e6e6e6);
    --border: color-mix(in srgb, #c8c8c8 60%, #0000);
    --text: color-mix(in srgb, #1b1f24 92%, #0000);
    --muted: #6b7280;
    --hover-bg: color-mix(in oklab, var(--bg), var(--text) 8%);
    background: var(--bg);
    border-right: 1px solid var(--border);
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 280px;
    height: 100%;
    overflow-x: hidden;
    z-index: 10;
    padding-top: env(safe-area-inset-top, 0px);
    padding-right: env(safe-area-inset-right, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    padding-left: env(safe-area-inset-left, 0px);
    transition: width 200ms cubic-bezier(0.4, 0, 0.2, 1);
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
  .mode-switch {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border-radius: 999px;
    background: var(--border);
  }
  .mode-btn {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 2px 8px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: background-color 120ms ease, color 120ms ease;
  }
  .mode-btn:hover { color: var(--text); }
  .mode-btn.active {
    background: var(--panel);
    color: var(--text);
    font-weight: 600;
  }
  .brand-hash {
    font-size: 0.7rem;
    font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Consolas', monospace;
    font-weight: 500;
    color: var(--muted);
    opacity: 0.8;
    margin-left: auto;
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
  .icon-btn:hover { border-color: var(--accent); color: var(--accent); }
  .icon-btn:active { transform: scale(0.94); }
  .sidebar.collapsed .brand,
  .sidebar.collapsed .section-label,
  .sidebar.collapsed .character-list,
  .sidebar.collapsed .chat-list,
  .sidebar.collapsed .char-header,
  .sidebar.collapsed .brand-hash { display: none; }
  .top-nav { display: grid; gap: 6px; padding: 6px 8px 2px; }
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
  .nav-item:hover { background: var(--panel); color: var(--accent); }
  .nav-item:active { transform: scale(0.98); }
  .nav-item .label { white-space: nowrap; }
  .sidebar.collapsed .nav-item .label { display: none; }
  .sidebar.collapsed .nav-item {
    display: grid;
    place-items: center;
    padding: 0;
    min-width: 36px;
    height: 36px;
    border: 0;
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
  }
  .section-label {
    font-size: .85rem;
    color: var(--muted);
    padding: 8px 12px 0 16px;
    margin-top: 10px;
    margin-bottom: 8px;
  }
  .empty-hint {
    padding: 10px 16px;
    color: var(--muted);
    font-size: 0.85rem;
    line-height: 1.4;
  }

  /* Character cards */
  .character-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 8px 10px;
    overflow-y: auto;
    overflow-x: hidden;
    flex: 1;
    min-height: 0;
  }
  .character-card {
    position: relative;
    flex: 0 0 auto;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--panel);
    overflow: hidden;
    transition: border-color 150ms ease, transform 100ms ease;
  }
  .character-card:hover { border-color: var(--accent); }
  .character-btn {
    display: flex;
    align-items: stretch;
    gap: 10px;
    width: 100%;
    padding: 10px;
    border: 0;
    background: transparent;
    color: var(--text);
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  .character-avatar {
    /* Official character card aspect ratio (400x600 → 2:3) */
    width: 72px;
    min-width: 72px;
    aspect-ratio: 2 / 3;
    border-radius: 10px;
    object-fit: cover;
    background: var(--border);
  }
  .character-avatar.placeholder {
    display: grid;
    place-items: center;
    color: var(--muted);
  }
  .character-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .character-name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding-right: 48px;
  }
  .character-creator { font-size: 0.75rem; color: var(--muted); }
  .character-notes {
    font-size: 0.78rem;
    color: var(--muted);
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .character-meta { font-size: 0.72rem; color: var(--muted); opacity: 0.8; margin-top: 2px; }
  .character-actions {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 150ms ease;
  }
  .character-card:hover .character-actions,
  .character-card:focus-within .character-actions { opacity: 1; }

  /* Per-character view */
  .char-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 0;
  }
  .char-header-avatar {
    /* 2:3 like the card itself */
    width: 28px;
    height: 42px;
    border-radius: 6px;
    object-fit: cover;
    background: var(--border);
  }
  .char-header-avatar.placeholder { display: grid; place-items: center; color: var(--muted); }
  .char-header-name {
    font-weight: 600;
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chat-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0 6px 10px;
    overflow-y: auto;
    overflow-x: hidden;
    flex: 1;
    min-height: 0;
  }
  .chat-row {
    position: relative;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 2px 4px;
    border-radius: 8px;
  }
  .chat-row.active, .chat-row:hover { background: var(--panel); }
  .chat-row:has(.chat-menu) { z-index: 160; }
  .chat-row .chat-actions { opacity: 0; pointer-events: none; }
  .chat-row:hover .chat-actions,
  .chat-row.active .chat-actions,
  .chat-row:has(.chat-menu) .chat-actions { opacity: 1; pointer-events: auto; }
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
    min-width: 0;
    cursor: pointer;
  }
  .chat-link:hover, .chat-link.active { color: var(--text); }
  .chat-label { display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 0; }
  .chat-title { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chat-spinner {
    width: 12px;
    height: 12px;
    border-radius: 999px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    animation: chat-spinner-rotate 0.8s linear infinite;
    flex: 0 0 auto;
  }
  @keyframes chat-spinner-rotate { to { transform: rotate(360deg); } }

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
    transition: background-color 120ms ease, color 120ms ease, transform 100ms ease, opacity 150ms ease;
    flex: 0 0 auto;
  }
  .chat-action-btn:hover, .chat-action-btn:focus-visible {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }
  .chat-action-btn.danger:hover, .chat-action-btn.danger:focus-visible {
    background: color-mix(in srgb, #dc2626 12%, transparent);
    color: #dc2626;
  }
  .chat-action-btn:active { transform: scale(0.9); }

  .chat-actions { display: flex; flex: 0 0 auto; transition: opacity 150ms ease; }
  .chat-menu-wrapper { position: relative; }
  .chat-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: -4px;
    z-index: 100;
    min-width: 150px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--panel);
    box-shadow: 0 4px 12px rgba(0,0,0,0.12);
  }
  :global(:root[data-theme='dark']) .chat-menu { box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
  .chat-menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 9px 12px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }
  .chat-menu-item:hover, .chat-menu-item:focus-visible { background: var(--hover-bg); }
  .chat-menu-item:last-child { color: #ef4444; }
  .chat-menu-item:last-child:hover, .chat-menu-item:last-child:focus-visible {
    background: color-mix(in srgb, #ef4444 12%, transparent);
  }

  .side-footer {
    padding: 8px;
    border-top: 1px solid var(--border);
    margin-top: auto;
  }
  .sidebar.collapsed .side-footer { border-top: 0; }
  .footer-row { display: flex; align-items: center; gap: 4px; }
  .footer-row .nav-item:first-child { flex: 1 1 auto; min-width: 0; }
  .nav-item.tavern-settings {
    width: 36px;
    min-width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    padding: 0;
  }
  .sidebar.collapsed .footer-row { flex-direction: column; }

  @media (max-width: 1260px) {
    .sidebar.collapsed {
      width: 0;
      border-right: 0;
      background: transparent;
    }
    .sidebar.collapsed .sidebar-inner { display: contents; }
    .sidebar.collapsed .side-header {
      position: fixed;
      top: calc(env(safe-area-inset-top, 0px) + 8px);
      left: calc(env(safe-area-inset-left, 0px) + 8px);
      z-index: 40;
      padding: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .sidebar.collapsed .side-body,
    .sidebar.collapsed .side-footer { display: none; }
  }
</style>

///<reference types="svelte" />
;
import { onMount, onDestroy } from 'svelte'
import { IconMenu, IconEditSquare, IconClose, IconCheck, IconEdit, IconDelete, IconSettings, IconSearch, IconDescription, IconMoreVert, IconDownload, IconContentCopy } from '../icons'
import ConfirmModal from './ConfirmModal.svelte'
import EditModal from './EditModal.svelte'
import { exportChat } from '../utils/exportImport'
import { getChat } from '../chatsStore'
import type { Chat, ChatListItem, Preset } from '../types';
;

  interface Props {
    open?: boolean
    chats?: ChatListItem[]
    selectedId?: string | null
    presets?: Preset[]
    /** When set (and valid), new chats use this preset directly without asking. */
    defaultPresetId?: string
    generatingMap?: Record<string, boolean>
    onSelect?: (id: string) => void
    onNewChat?: (options?: { presetId?: string }) => void
    onDeleteChat?: (id: string) => Promise<void>
    onDuplicateChat?: (id: string) => Promise<void>
    onRenameChat?: (id: string, title: string) => Promise<void>
    onToggle?: () => void
    onOpenSettings?: () => void
    onSwitchMode?: (mode: 'chat' | 'tavern') => void
  };function $$render() {

  
  
  
  
  
  
  


  const props: Props = $props()

  // Git hash injected at build time
  const gitHash = __GIT_HASH__

  // Chat mode never offers tavern-only presets
  const chatPresets = $derived((Array.isArray(props?.presets) ? props.presets : []).filter(p => !p?.tavernOnly))
  const defaultPreset = $derived(chatPresets.find(p => p?.id && p.id === props.defaultPresetId) || null)

  let confirmDeleteId = $state<string | null>(null)
  let editingId = $state<string | null>(null)
  let draftTitle = $state('')
  let suppressBlur = $state(false)
  let presetMenuOpen = $state(false)
  let presetMenuEl = $state<HTMLDivElement | null>(null)
  let lastSidebarOpen = $state(props.open ?? true)
  let chatMenuOpen = $state<string | null>(null) // Track which chat's menu is open

  // Modal state
  let deleteModalOpen = $state(false)
  let deleteModalChatId = $state<string | null>(null)
  let editModalOpen = $state(false)
  let editModalChat = $state<ChatListItem | null>(null)

  // Search state
  let searchQuery = $state('')
  let searchMode = $state<'title' | 'content'>('title')
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

  // Cache for extracted content to avoid re-processing
  const contentCache = new Map<string, string>()
  let contentSearchMatches = $state<Record<string, boolean>>({})
  let contentSearchRun = 0

  // Virtualization state
  const ITEM_HEIGHT = 40 // Height of each chat row (36px) + gap (4px)
  const BUFFER_COUNT = 5 // Extra items to render above/below viewport
  let chatListEl = $state<HTMLElement | null>(null)
  let scrollTop = $state(0)
  let containerHeight = $state(400)

  function selectChat(id: string) {
    if (!id || editingId === id || confirmDeleteId === id) return
    props.onSelect?.(id)
  }

  function cancelDelete(id: string) {
    if (confirmDeleteId === id) confirmDeleteId = null
  }

  async function confirmDelete(id: string) {
    if (confirmDeleteId !== id) return
    confirmDeleteId = null
    await props.onDeleteChat?.(id)
  }

  function cancelEdit(id: string) {
    if (editingId === id) {
      editingId = null
      draftTitle = ''
      suppressBlur = false
    }
  }

  async function applyEdit(id: string, originalTitle: string | undefined) {
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

  function handleInputBlur(id: string, originalTitle: string | undefined) {
    if (suppressBlur) {
      suppressBlur = false
      return
    }
    applyEdit(id, originalTitle)
  }

  function armSuppressBlur() {
    suppressBlur = true
    // If the user drags off the button without clicking, no blur/click will
    // consume the flag; reset it once the press ends so it can't swallow a
    // later, unrelated blur.
    window.addEventListener('mouseup', () => { suppressBlur = false }, { once: true })
  }

  function isGenerating(id: string) {
    if (!id) return false
    try {
      const map = props.generatingMap
      return !!(map && map[id])
    } catch { return false }
  }

  function closePresetMenu() { presetMenuOpen = false }

  function toggleChatMenu(chatId: string, event?: Event) {
    event?.stopPropagation()
    event?.preventDefault()
    chatMenuOpen = chatMenuOpen === chatId ? null : chatId
  }

  function closeChatMenu() { chatMenuOpen = null }

  function handleMenuEdit(chat: ChatListItem, event?: Event) {
    event?.stopPropagation()
    closeChatMenu()
    editModalChat = chat
    editModalOpen = true
  }

  function handleMenuDelete(chatId: string, event?: Event) {
    event?.stopPropagation()
    closeChatMenu()
    deleteModalChatId = chatId
    deleteModalOpen = true
  }

  async function handleMenuExport(chatId: string, event?: Event) {
    event?.stopPropagation()
    closeChatMenu()
    try {
      await exportChat(chatId)
    } catch (err) {
      console.error('Failed to export chat:', err)
      alert('Failed to export chat. Please try again.')
    }
  }

  async function handleMenuDuplicate(chatId: string, event?: Event) {
    event?.stopPropagation()
    closeChatMenu()
    try {
      await props.onDuplicateChat?.(chatId)
    } catch (err) {
      console.error('Failed to duplicate chat:', err)
      alert('Failed to duplicate chat. Please try again.')
    }
  }

  async function confirmEditModal(newTitle: string) {
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
    // A default preset skips the preset menu entirely
    if (defaultPreset?.id) {
      closePresetMenu()
      props.onNewChat?.({ presetId: defaultPreset.id })
      return
    }
    const list = chatPresets
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

  function choosePreset(preset: Preset | null) {
    closePresetMenu()
    if (!preset) {
      props.onNewChat?.()
      return
    }
    props.onNewChat?.({ presetId: preset.id ?? undefined })
  }

  // Search functionality
  function toggleSearchMode() {
    searchMode = searchMode === 'title' ? 'content' : 'title'
  }

  function clearSearch() {
    searchQuery = ''
  }

  function getContentCacheKey(chat: ChatListItem): string {
    return `${chat.id}-${chat.updatedAt || 0}`
  }

  function trimContentCache(): void {
    if (contentCache.size <= 20) return
    const keysToDelete = Array.from(contentCache.keys()).slice(0, 5)
    keysToDelete.forEach(key => contentCache.delete(key))
  }

  function buildSearchBlob(chat: Chat | null): string {
    if (!chat?.nodes || !Array.isArray(chat.nodes)) return ''

    const parts: string[] = []
    const maxChars = 100000
    let charCount = 0

    for (const node of chat.nodes) {
      if (charCount >= maxChars) break
      if (!node?.variants || !Array.isArray(node.variants)) continue

      for (const variant of node.variants) {
        if (charCount >= maxChars) break
        if (variant?.content && typeof variant.content === 'string') {
          const text = variant.content.trim()
          if (text) {
            parts.push(text)
            charCount += text.length
          }
        }
        if (variant?.images && Array.isArray(variant.images)) {
          for (const img of variant.images) {
            if (img?.id) parts.push(img.id)
          }
        }
        if (variant?.generatedImages && Array.isArray(variant.generatedImages)) {
          for (const img of variant.generatedImages) {
            if (img?.id) parts.push(img.id)
          }
        }
      }
    }
    return parts.join(' ')
  }

  async function loadChatSearchBlob(chat: ChatListItem): Promise<string> {
    const cacheKey = getContentCacheKey(chat)
    const cached = contentCache.get(cacheKey)
    if (typeof cached === 'string') return cached

    const fullChat = await getChat(chat.id)
    const result = buildSearchBlob(fullChat)
    trimContentCache()
    contentCache.set(cacheKey, result)
    return result
  }

  function matchesTitleOrId(chat: ChatListItem, searchTerm: string): boolean {
    const chatId = (chat?.id || '').toLowerCase()
    if (chatId.includes(searchTerm)) return true
    const title = (chat?.title || '').toLowerCase()
    return title.includes(searchTerm)
  }

  $effect(() => {
    const chats = Array.isArray(props.chats) ? props.chats : []
    const query = searchQuery.trim().toLowerCase()
    const mode = searchMode
    const run = ++contentSearchRun

    if (mode !== 'content' || !query) {
      contentSearchMatches = {}
      return () => {
        if (contentSearchRun === run) contentSearchRun += 1
      }
    }

    const initialMatches: Record<string, boolean> = {}
    for (const chat of chats) {
      if (matchesTitleOrId(chat, query)) initialMatches[chat.id] = true
    }
    contentSearchMatches = initialMatches

    // Debounce the expensive IndexedDB content loads so we don't hit storage
    // for the whole chat list on every keystroke.
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null
      Promise.resolve().then(async () => {
        for (const chat of chats) {
          if (contentSearchRun !== run) return
          if (initialMatches[chat.id]) continue
          try {
            const content = await loadChatSearchBlob(chat)
            if (contentSearchRun !== run) return
            if (content.toLowerCase().includes(query)) {
              contentSearchMatches = { ...contentSearchMatches, [chat.id]: true }
            }
          } catch {
            // Ignore content search failures for individual chats.
          }
        }
      }).catch(() => {})
    }, 250)

    return () => {
      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer)
        searchDebounceTimer = null
      }
      if (contentSearchRun === run) contentSearchRun += 1
    }
  })

  const filteredChats = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return props.chats || []

    const chats = props.chats || []
    if (searchMode === 'title') {
      return chats.filter(chat => matchesTitleOrId(chat, query))
    }
    return chats.filter(chat => matchesTitleOrId(chat, query) || !!contentSearchMatches[chat.id])
  })

  // Virtualization calculations
  const totalHeight = $derived(filteredChats.length * ITEM_HEIGHT)
  
  const visibleRange = $derived.by(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER_COUNT)
    const visibleCount = Math.ceil(containerHeight / ITEM_HEIGHT) + BUFFER_COUNT * 2
    const endIndex = Math.min(filteredChats.length, startIndex + visibleCount)
    return { startIndex, endIndex }
  })

  const visibleChats = $derived.by(() => {
    const { startIndex, endIndex } = visibleRange
    return filteredChats.slice(startIndex, endIndex).map((chat, i) => ({
      chat,
      index: startIndex + i,
      offsetY: (startIndex + i) * ITEM_HEIGHT
    }))
  })

  function handleChatListScroll(event: Event) {
    const target = event.target as HTMLElement
    scrollTop = target.scrollTop
  }

  // Update container height on mount and resize
  function updateContainerHeight() {
    if (chatListEl) {
      containerHeight = chatListEl.clientHeight
    }
  }

  onMount(() => {
    function handlePointerDown(event: PointerEvent) {
      if (presetMenuOpen) {
        const target = event.target as Element
        const inNewChatWrapper = target.closest('.new-chat-wrapper')
        if (!presetMenuEl?.contains(target) && !inNewChatWrapper) {
          presetMenuOpen = false
        }
      }
      if (chatMenuOpen) {
        const target = event.target as Element
        const chatMenuEl = target.closest('.chat-menu')
        const menuBtn = target.closest('.chat-menu-btn')
        if (!chatMenuEl && !menuBtn) {
          chatMenuOpen = null
        }
      }
    }
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (presetMenuOpen) presetMenuOpen = false
        if (chatMenuOpen) chatMenuOpen = null
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeydown)

    // Initialize container height
    updateContainerHeight()
    
    // Use ResizeObserver for container height changes
    let resizeObserver: ResizeObserver | null = null
    if (chatListEl) {
      resizeObserver = new ResizeObserver(() => {
        updateContainerHeight()
      })
      resizeObserver.observe(chatListEl)
    }

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeydown)
      resizeObserver?.disconnect()
    }
  })

  // Re-observe when chatListEl changes
  $effect(() => {
    if (!chatListEl) return
    updateContainerHeight()
    const resizeObserver = new ResizeObserver(() => {
      updateContainerHeight()
    })
    resizeObserver.observe(chatListEl)
    return () => resizeObserver.disconnect()
  })

  $effect(() => {
    const isOpen = !!props.open
    if (!isOpen && lastSidebarOpen && presetMenuOpen) {
      presetMenuOpen = false
    }
    lastSidebarOpen = isOpen
    const count = chatPresets.length
    if ((count <= 1 || defaultPreset) && presetMenuOpen) presetMenuOpen = false
  })

  onDestroy(() => {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer)
    }
  })
;
async () => {

 { svelteHTML.createElement("aside", { "class":`sidebar ${props.open ? '' : 'collapsed'}`,});
   { svelteHTML.createElement("div", { "class":`sidebar-inner`,});
    
     { svelteHTML.createElement("div", { "class":`side-header`,});
       { svelteHTML.createElement("button", {         "class":`icon-btn`,"title":`Toggle sidebar`,"aria-label":`Toggle sidebar`,"aria-expanded":props.open ? 'true' : 'false',"onclick":() => props.onToggle?.(),});
         { const $$_uneMnocI4C = __sveltets_2_ensureComponent(IconMenu); new $$_uneMnocI4C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
       }
      if(props.open){
         { svelteHTML.createElement("div", { "class":`brand`,});
           { svelteHTML.createElement("span", { "class":`brand-name`,});  }
           { svelteHTML.createElement("div", {     "class":`mode-switch`,"role":`tablist`,"aria-label":`Mode`,});
             { svelteHTML.createElement("button", {       "type":`button`,"class":`mode-btn active`,"role":`tab`,"aria-selected":`true`,});  }
             { svelteHTML.createElement("button", {         "type":`button`,"class":`mode-btn`,"role":`tab`,"aria-selected":`false`,"onclick":() => props.onSwitchMode?.('tavern'),});  }
           }
         }
      }
     }

    
     { svelteHTML.createElement("div", { "class":`side-body`,});
      
       { svelteHTML.createElement("nav", {   "class":`top-nav`,"aria-label":`Primary`,});
         { svelteHTML.createElement("div", { "class":`new-chat-wrapper`,});
           { svelteHTML.createElement("button", {           "class":`nav-item`,"onclick":handleNewChatClick,"title":`New chat`,"aria-label":`New chat`,"aria-haspopup":(!defaultPreset && chatPresets.length > 1) ? 'true' : 'false',"aria-expanded":presetMenuOpen ? 'true' : 'false',});
             { const $$_erauqStidEnocI6C = __sveltets_2_ensureComponent(IconEditSquare); new $$_erauqStidEnocI6C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
             { svelteHTML.createElement("span", { "class":`label`,});  }
           }
          if(presetMenuOpen){
             { const $$_div5 = svelteHTML.createElement("div", {    "class":`preset-menu`,"aria-label":`Choose preset`,});presetMenuEl = $$_div5;
                 for(let preset of __sveltets_2_ensureArray(chatPresets)){preset.id || preset.name;
                 { svelteHTML.createElement("button", {       "type":`button`,"class":`preset-menu-item`,"onclick":() => choosePreset(preset),});
                   { svelteHTML.createElement("span", { "class":`preset-menu-name`,});preset?.name || 'Preset'; }
                   { svelteHTML.createElement("span", { "class":`preset-menu-model`,});preset?.model || ''; }
                 }
              }
             }
          }
         }
       }

      if(props.open){
        
         { svelteHTML.createElement("div", { "class":`chat-section`,});
           { svelteHTML.createElement("div", { "class":`section-label`,});  }

          
           { svelteHTML.createElement("div", { "class":`search-wrapper`,});
             { svelteHTML.createElement("div", { "class":`search-input-wrapper`,});
               { const $$_hcraeSnocI6C = __sveltets_2_ensureComponent(IconSearch); new $$_hcraeSnocI6C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px; color: var(--muted);`,}});}
               { svelteHTML.createElement("input", {             "type":`text`,"class":`search-input`,"placeholder":searchMode === 'title' ? 'Search chats...' : 'Search in content...',"value":searchQuery,"oninput":(e) => searchQuery = e.currentTarget.value,"aria-label":`Search chats`,});}
               { svelteHTML.createElement("button", {           "type":`button`,"class":`search-mode-btn ${searchMode === 'content' ? 'active' : ''}`,"onclick":toggleSearchMode,"aria-label":searchMode === 'title' ? 'Switch to content search' : 'Switch to title search',"title":searchMode === 'title' ? 'Search in content' : 'Search in titles',});
                 { const $$_noitpircseDnocI7C = __sveltets_2_ensureComponent(IconDescription); new $$_noitpircseDnocI7C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
               }
              if(searchQuery){
                 { svelteHTML.createElement("button", {           "type":`button`,"class":`search-clear-btn`,"onclick":clearSearch,"aria-label":`Clear search`,"title":`Clear search`,});
                   { const $$_esolCnocI7C = __sveltets_2_ensureComponent(IconClose); new $$_esolCnocI7C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
                 }
              }
             }
           }

           { const $$_nav4 = svelteHTML.createElement("nav", {      "class":`chat-list`,"aria-label":`Chats`,"onscroll":handleChatListScroll,});chatListEl = $$_nav4;
             { svelteHTML.createElement("div", {   "class":`chat-list-spacer`,"style":`height: ${totalHeight}px;`,});
                 for(let { chat: c, offsetY } of __sveltets_2_ensureArray(visibleChats)){c.id;
                 { svelteHTML.createElement("div", {       "class":`chat-row ${props.selectedId === c.id ? 'active' : ''} ${(confirmDeleteId === c.id || editingId === c.id || props.selectedId === c.id || chatMenuOpen === c.id) ? 'show-actions' : ''}`,"title":c.title || 'Chat',"style":`transform: translateY(${offsetY}px);`,});
                  if(editingId === c.id){
                     { svelteHTML.createElement("div", { "class":`chat-main editing`,});
                       { svelteHTML.createElement("input", {             "class":`chat-input`,"value":draftTitle,"oninput":(event) => (draftTitle = event.currentTarget.value),"onblur":() => handleInputBlur(c.id, c.title),"onkeydown":(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            applyEdit(c.id, c.title)
                          } else if (event.key === 'Escape') {
                            event.preventDefault()
                            cancelEdit(c.id)
                          }
                        },"aria-label":`Edit chat title`,});}
                     }
                  }else{
                     { svelteHTML.createElement("button", {         "type":`button`,"class":`chat-link ${props.selectedId === c.id ? 'active' : ''}`,"onclick":() => selectChat(c.id),"onkeydown":(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          selectChat(c.id)
                        }
                      },});
                       { svelteHTML.createElement("span", { "class":`chat-label`,});
                        if(isGenerating(c.id)){
                           { svelteHTML.createElement("span", {   "class":`chat-spinner`,"aria-hidden":`true`,}); }
                        }
                         { svelteHTML.createElement("span", { "class":`chat-title`,});c.title || 'New Chat'; }
                       }
                     }
                  }
                   { svelteHTML.createElement("div", { "class":`chat-actions`,});
                    if(confirmDeleteId === c.id){
                       { svelteHTML.createElement("button", {       "type":`button`,"class":`chat-action-btn cancel`,"onclick":() => cancelDelete(c.id),"aria-label":`Cancel delete`,});
                         { const $$_esolCnocI9C = __sveltets_2_ensureComponent(IconClose); new $$_esolCnocI9C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
                       }
                       { svelteHTML.createElement("button", {       "type":`button`,"class":`chat-action-btn confirm`,"onclick":() => confirmDelete(c.id),"aria-label":`Confirm delete`,});
                         { const $$_kcehCnocI9C = __sveltets_2_ensureComponent(IconCheck); new $$_kcehCnocI9C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
                       }
                    } else if (editingId === c.id){
                       { svelteHTML.createElement("button", {           "type":`button`,"class":`chat-action-btn cancel`,"onmousedown":armSuppressBlur,"onclick":() => cancelEdit(c.id),"aria-label":`Cancel edit`,});
                         { const $$_esolCnocI9C = __sveltets_2_ensureComponent(IconClose); new $$_esolCnocI9C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
                       }
                       { svelteHTML.createElement("button", {           "type":`button`,"class":`chat-action-btn confirm`,"onmousedown":armSuppressBlur,"onclick":() => applyEdit(c.id, c.title),"aria-label":`Confirm title`,});
                         { const $$_kcehCnocI9C = __sveltets_2_ensureComponent(IconCheck); new $$_kcehCnocI9C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
                       }
                    }else{
                       { svelteHTML.createElement("div", { "class":`chat-menu-wrapper`,});
                         { svelteHTML.createElement("button", {             "type":`button`,"class":`chat-action-btn chat-menu-btn`,"onclick":(e) => toggleChatMenu(c.id, e),"aria-label":`Chat options`,"aria-haspopup":`true`,"aria-expanded":chatMenuOpen === c.id ? 'true' : 'false',});
                           { const $$_treVeroMnocI10C = __sveltets_2_ensureComponent(IconMoreVert); new $$_treVeroMnocI10C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
                         }
                        if(chatMenuOpen === c.id){
                           { svelteHTML.createElement("div", { "class":`chat-menu`,});
                             { svelteHTML.createElement("button", {       "type":`button`,"class":`chat-menu-item`,"onclick":(e) => handleMenuEdit(c, e),});
                               { const $$_tidEnocI11C = __sveltets_2_ensureComponent(IconEdit); new $$_tidEnocI11C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
                               { svelteHTML.createElement("span", {});  }
                             }
                             { svelteHTML.createElement("button", {       "type":`button`,"class":`chat-menu-item`,"onclick":(e) => handleMenuDuplicate(c.id, e),});
                               { const $$_ypoCtnetnoCnocI11C = __sveltets_2_ensureComponent(IconContentCopy); new $$_ypoCtnetnoCnocI11C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
                               { svelteHTML.createElement("span", {});  }
                             }
                             { svelteHTML.createElement("button", {       "type":`button`,"class":`chat-menu-item`,"onclick":(e) => handleMenuExport(c.id, e),});
                               { const $$_daolnwoDnocI11C = __sveltets_2_ensureComponent(IconDownload); new $$_daolnwoDnocI11C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
                               { svelteHTML.createElement("span", {});  }
                             }
                             { svelteHTML.createElement("button", {       "type":`button`,"class":`chat-menu-item`,"onclick":(e) => handleMenuDelete(c.id, e),});
                               { const $$_eteleDnocI11C = __sveltets_2_ensureComponent(IconDelete); new $$_eteleDnocI11C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
                               { svelteHTML.createElement("span", {});  }
                             }
                           }
                        }
                       }
                    }
                   }
                 }
              }
             }
           }
         }
      }

      
       { svelteHTML.createElement("div", { "class":`side-footer`,});
         { svelteHTML.createElement("button", {       "class":`nav-item`,"onclick":() => props.onOpenSettings?.(),"title":`Settings (${gitHash})`,"aria-label":`Settings`,});
           { const $$_sgnitteSnocI5C = __sveltets_2_ensureComponent(IconSettings); new $$_sgnitteSnocI5C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
           { svelteHTML.createElement("span", { "class":`label`,});  }
           { svelteHTML.createElement("span", { "class":`brand-hash`,});gitHash; }
         }
       }
     }
   }
  if(props.open){
     { svelteHTML.createElement("div", { "class":`side-fade`,}); }
  }
 }

 { const $$_ladoMmrifnoC0C = __sveltets_2_ensureComponent(ConfirmModal); new $$_ladoMmrifnoC0C({ target: __sveltets_2_any(), props: {                 "open":deleteModalOpen,"title":`Delete Chat`,"message":`Are you sure you want to delete this chat? This action cannot be undone.`,"confirmText":`Delete`,"cancelText":`Cancel`,"danger":true,"onConfirm":confirmDeleteModal,"onCancel":cancelDeleteModal,}});}

 { const $$_ladoMtidE0C = __sveltets_2_ensureComponent(EditModal); new $$_ladoMtidE0C({ target: __sveltets_2_any(), props: {                   "open":editModalOpen,"title":`Edit Chat Title`,"label":`Chat title`,"placeholder":`New Chat`,"value":editModalChat?.title || '',"confirmText":`Save`,"cancelText":`Cancel`,"onConfirm":confirmEditModal,"onCancel":cancelEditModal,}});}


};
return { props: {} as any as Props, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Sidebar__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Sidebar__SvelteComponent_ = ReturnType<typeof Sidebar__SvelteComponent_>;
/*Ωignore_endΩ*/export default Sidebar__SvelteComponent_;
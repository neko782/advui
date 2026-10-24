///<reference types="svelte" />
;
import { onMount, onDestroy } from 'svelte'
import { IconMenu, IconEditSquare, IconSettings, IconUpload, IconAdd, IconChevronLeft, IconEdit, IconDelete, IconTune, IconPerson, IconMoreVert, IconDownload, IconContentCopy, IconSearch, IconDescription, IconClose, IconArrowDownward, IconArrowUpward } from '../../icons'
import ConfirmModal from '../ConfirmModal.svelte'
import EditModal from '../EditModal.svelte'
import { exportChat } from '../../utils/exportImport'
import { getChat } from '../../chatsStore'
import type { Chat, ChatListItem } from '../../types'
import type { Character } from '../../types/tavern';
;

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
  };function $$render() {

  
  
  
  
  
  
  
  


  const props: Props = $props()

  // Git hash injected at build time
  const gitHash = __GIT_HASH__

  let fileInput = $state<HTMLInputElement | null>(null)
  let deleteCharacterId = $state<string | null>(null)
  let deleteChatId = $state<string | null>(null)
  let chatMenuOpen = $state<string | null>(null)
  let editModalChat = $state<ChatListItem | null>(null)
  let globalSearchQuery = $state('')
  let characterSearchQuery = $state('')
  let searchMode = $state<'title' | 'content'>('title')
  let characterSort = $state<'updated' | 'created' | 'lastChat' | 'name'>('updated')
  let sortDescending = $state(true)
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
  let contentSearchMatches = $state<Record<string, boolean>>({})
  let contentSearchRun = 0
  const contentCache = new Map<string, string>()

  const selectedCharacter = $derived(
    (props.characters || []).find(c => c.id === props.selectedCharacterId) || null
  )

  const allCharacterChats = $derived(
    (props.chats || [])
      .filter(c => c.characterId === props.selectedCharacterId)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  )

  const activeSearchQuery = $derived(selectedCharacter ? characterSearchQuery : globalSearchQuery)

  function matchesChatTitle(chat: ChatListItem, query: string): boolean {
    return (chat.title || '').toLowerCase().includes(query) || (chat.id || '').toLowerCase().includes(query)
  }

  function characterSearchText(character: Character): string {
    return [
      character.name, character.nickname, character.creator, character.creatorNotes,
      character.description, character.personality, character.scenario,
      ...(character.tags || []),
    ].filter(Boolean).join(' ').toLowerCase()
  }

  function lastChatAt(characterId: string): number {
    let latest = 0
    for (const chat of props.chats || []) {
      if (chat.characterId === characterId) latest = Math.max(latest, chat.updatedAt || 0)
    }
    return latest
  }

  const sortedCharacters = $derived.by(() => {
    const direction = sortDescending ? -1 : 1
    return [...(props.characters || [])].sort((a, b) => {
      if (characterSort === 'name') {
        return direction * (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
      }
      const aValue = characterSort === 'created' ? a.createdAt || 0
        : characterSort === 'lastChat' ? lastChatAt(a.id)
        : a.updatedAt || 0
      const bValue = characterSort === 'created' ? b.createdAt || 0
        : characterSort === 'lastChat' ? lastChatAt(b.id)
        : b.updatedAt || 0
      return direction * (aValue - bValue) || (a.name || '').localeCompare(b.name || '')
    })
  })

  const filteredCharacters = $derived.by(() => {
    const query = globalSearchQuery.trim().toLowerCase()
    if (!query) return sortedCharacters
    return sortedCharacters.filter(character => characterSearchText(character).includes(query))
  })

  function chatMatchesSearch(chat: ChatListItem, query: string): boolean {
    return matchesChatTitle(chat, query) || (searchMode === 'content' && !!contentSearchMatches[chat.id])
  }

  const characterChats = $derived.by(() => {
    const query = characterSearchQuery.trim().toLowerCase()
    if (!query) return allCharacterChats
    return allCharacterChats.filter(chat => chatMatchesSearch(chat, query))
  })

  const globalChatResults = $derived.by(() => {
    const query = globalSearchQuery.trim().toLowerCase()
    if (!query) return []
    return (props.chats || [])
      .filter(chat => chatMatchesSearch(chat, query))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  })

  function buildSearchBlob(chat: Chat | null): string {
    if (!chat?.nodes || !Array.isArray(chat.nodes)) return ''
    const parts: string[] = []
    let length = 0
    for (const node of chat.nodes) {
      if (length >= 100000 || !Array.isArray(node?.variants)) break
      for (const variant of node.variants) {
        if (length >= 100000) break
        if (typeof variant?.content === 'string' && variant.content) {
          parts.push(variant.content)
          length += variant.content.length
        }
      }
    }
    return parts.join(' ')
  }

  async function loadChatSearchBlob(chat: ChatListItem): Promise<string> {
    const key = `${chat.id}-${chat.updatedAt || 0}`
    const cached = contentCache.get(key)
    if (cached !== undefined) return cached
    const blob = buildSearchBlob(await getChat(chat.id))
    if (contentCache.size > 30) contentCache.delete(contentCache.keys().next().value as string)
    contentCache.set(key, blob)
    return blob
  }

  $effect(() => {
    const query = activeSearchQuery.trim().toLowerCase()
    const candidates = selectedCharacter ? allCharacterChats : (props.chats || [])
    const mode = searchMode
    const run = ++contentSearchRun
    if (mode !== 'content' || !query) {
      contentSearchMatches = {}
      return
    }
    const initial: Record<string, boolean> = {}
    for (const chat of candidates) if (matchesChatTitle(chat, query)) initial[chat.id] = true
    contentSearchMatches = initial
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
    searchDebounceTimer = setTimeout(async () => {
      searchDebounceTimer = null
      for (const chat of candidates) {
        if (contentSearchRun !== run) return
        if (initial[chat.id]) continue
        try {
          const content = await loadChatSearchBlob(chat)
          if (contentSearchRun !== run) return
          if (content.toLowerCase().includes(query)) {
            contentSearchMatches = { ...contentSearchMatches, [chat.id]: true }
          }
        } catch { /* Ignore an unreadable chat and continue searching. */ }
      }
    }, 250)
    return () => {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
      searchDebounceTimer = null
      if (contentSearchRun === run) contentSearchRun += 1
    }
  })

  function characterNameFor(chat: ChatListItem): string {
    return (props.characters || []).find(character => character.id === chat.characterId)?.name || 'Unknown character'
  }

  function clearActiveSearch() {
    if (selectedCharacter) characterSearchQuery = ''
    else globalSearchQuery = ''
  }

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

  onDestroy(() => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
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
             { svelteHTML.createElement("button", {         "type":`button`,"class":`mode-btn`,"role":`tab`,"aria-selected":`false`,"onclick":() => props.onSwitchMode?.('chat'),});  }
             { svelteHTML.createElement("button", {       "type":`button`,"class":`mode-btn active`,"role":`tab`,"aria-selected":`true`,});  }
           }
         }
      }
     }

     { svelteHTML.createElement("div", { "class":`side-body`,});
      if(!selectedCharacter){
        
         { svelteHTML.createElement("nav", {   "class":`top-nav`,"aria-label":`Characters actions`,});
           { svelteHTML.createElement("button", {       "class":`nav-item`,"onclick":() => fileInput?.click(),"title":`Import character card`,"aria-label":`Import character card`,});
             { const $$_daolpUnocI5C = __sveltets_2_ensureComponent(IconUpload); new $$_daolpUnocI5C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
             { svelteHTML.createElement("span", { "class":`label`,});  }
           }
           { svelteHTML.createElement("button", {       "class":`nav-item`,"onclick":() => props.onNewCharacter?.(),"title":`New character`,"aria-label":`New character`,});
             { const $$_ddAnocI5C = __sveltets_2_ensureComponent(IconAdd); new $$_ddAnocI5C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
             { svelteHTML.createElement("span", { "class":`label`,});  }
           }
           { const $$_input4 = svelteHTML.createElement("input", {           "type":`file`,"accept":`.png,.json,image/png,application/json`,"multiple":true,"onchange":handleFileChange,"style":`display: none;`,});fileInput = $$_input4;}
         }
        if(props.open){
           { svelteHTML.createElement("div", { "class":`search-tools`,});
             { svelteHTML.createElement("div", { "class":`search-input-wrapper`,});
               { const $$_hcraeSnocI5C = __sveltets_2_ensureComponent(IconSearch); new $$_hcraeSnocI5C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px; color: var(--muted);`,}});}
               { svelteHTML.createElement("input", {             "class":`search-input`,"type":`search`,"placeholder":searchMode === 'title' ? 'Search characters & chats...' : 'Search characters & chat content...',"value":globalSearchQuery,"oninput":(event) => (globalSearchQuery = event.currentTarget.value),"aria-label":`Search all characters and chats`,});}
               { svelteHTML.createElement("button", {         "type":`button`,"class":`search-mode-btn ${searchMode === 'content' ? 'active' : ''}`,"onclick":() => (searchMode = searchMode === 'title' ? 'content' : 'title'),"title":searchMode === 'title' ? 'Search chat content too' : 'Search titles only',"aria-label":searchMode === 'title' ? 'Search chat content too' : 'Search titles only',});
                 { const $$_noitpircseDnocI6C = __sveltets_2_ensureComponent(IconDescription); new $$_noitpircseDnocI6C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
               }
              if(globalSearchQuery){
                 { svelteHTML.createElement("button", {         "type":`button`,"class":`search-clear-btn`,"onclick":clearActiveSearch,"title":`Clear search`,"aria-label":`Clear search`,}); { const $$_esolCnocI6C = __sveltets_2_ensureComponent(IconClose); new $$_esolCnocI6C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});} }
              }
             }
             { svelteHTML.createElement("div", { "class":`sort-row`,});
               { svelteHTML.createElement("label", {   "class":`sort-label`,"for":`character-sort`,});  }
               { svelteHTML.createElement("select", {     "id":`character-sort`,"class":`sort-select`,"bind:value":characterSort,});/*Ωignore_startΩ*/() => characterSort = __sveltets_2_any(null);/*Ωignore_endΩ*/
                 { svelteHTML.createElement("option", { "value":`updated`,});  }
                 { svelteHTML.createElement("option", { "value":`created`,});  }
                 { svelteHTML.createElement("option", { "value":`lastChat`,});  }
                 { svelteHTML.createElement("option", { "value":`name`,});  }
               }
               { svelteHTML.createElement("button", {         "type":`button`,"class":`sort-direction`,"onclick":() => (sortDescending = !sortDescending),"title":sortDescending ? 'Descending' : 'Ascending',"aria-label":sortDescending ? 'Sort descending' : 'Sort ascending',});
                if(sortDescending){ { const $$_drawnwoDworrAnocI6C = __sveltets_2_ensureComponent(IconArrowDownward); new $$_drawnwoDworrAnocI6C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}}else{ { const $$_drawpUworrAnocI6C = __sveltets_2_ensureComponent(IconArrowUpward); new $$_drawpUworrAnocI6C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}}
               }
             }
           }
           { svelteHTML.createElement("div", { "class":`browse-results`,});
             { svelteHTML.createElement("div", { "class":`section-label`,});  }
             { svelteHTML.createElement("div", {   "class":`character-list`,"role":`list`,});
              if(!(props.characters || []).length){
                 { svelteHTML.createElement("div", { "class":`empty-hint`,});
                              
                 }
              } else if (!filteredCharacters.length){
                 { svelteHTML.createElement("div", { "class":`empty-hint`,});   }
              }
                 for(let character of __sveltets_2_ensureArray(filteredCharacters)){character.id;
                 { svelteHTML.createElement("div", {   "class":`character-card`,"role":`listitem`,});
                   { svelteHTML.createElement("button", {       "type":`button`,"class":`character-btn`,"onclick":() => props.onSelectCharacter?.(character.id),});
                    if(character.avatar){
                       { svelteHTML.createElement("img", {        "class":`character-avatar`,"src":character.avatar,"alt":character.name,"loading":`lazy`,});}
                    }else{
                       { svelteHTML.createElement("div", { "class":`character-avatar placeholder`,});
                         { const $$_nosrePnocI8C = __sveltets_2_ensureComponent(IconPerson); new $$_nosrePnocI8C({ target: __sveltets_2_any(), props: {  "style":`font-size: 28px;`,}});}
                       }
                    }
                     { svelteHTML.createElement("div", { "class":`character-info`,});
                       { svelteHTML.createElement("div", { "class":`character-name`,});character.name || 'Unnamed'; }
                      if(character.creator){
                         { svelteHTML.createElement("div", { "class":`character-creator`,}); character.creator; }
                      }
                      if(character.creatorNotes){
                         { svelteHTML.createElement("div", { "class":`character-notes`,});character.creatorNotes; }
                      }
                       { svelteHTML.createElement("div", { "class":`character-meta`,});chatCountFor(character.id);  }
                     }
                   }
                   { svelteHTML.createElement("div", { "class":`character-actions`,});
                     { svelteHTML.createElement("button", {         "type":`button`,"class":`chat-action-btn`,"title":`Edit character`,"aria-label":`Edit character`,"onclick":() => props.onEditCharacter?.(character),});
                       { const $$_tidEnocI8C = __sveltets_2_ensureComponent(IconEdit); new $$_tidEnocI8C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
                     }
                     { svelteHTML.createElement("button", {         "type":`button`,"class":`chat-action-btn danger`,"title":`Delete character`,"aria-label":`Delete character`,"onclick":() => (deleteCharacterId = character.id),});
                       { const $$_eteleDnocI8C = __sveltets_2_ensureComponent(IconDelete); new $$_eteleDnocI8C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
                     }
                   }
                 }
              }
             }

            if(globalSearchQuery.trim()){
               { svelteHTML.createElement("div", { "class":`section-label result-heading`,});  }
               { svelteHTML.createElement("nav", {   "class":`chat-list global-results`,"aria-label":`Matching chats`,});
                if(!globalChatResults.length){
                   { svelteHTML.createElement("div", { "class":`empty-hint`,});   }
                }
                   for(let c of __sveltets_2_ensureArray(globalChatResults)){c.id;
                   { svelteHTML.createElement("div", { "class":`chat-row ${props.selectedId === c.id ? 'active' : ''}`,});
                     { svelteHTML.createElement("button", {     "type":`button`,"class":`chat-link ${props.selectedId === c.id ? 'active' : ''}`,"onclick":() => props.onSelect?.(c.id),});
                       { svelteHTML.createElement("span", { "class":`chat-label`,});
                        if(isGenerating(c.id)){ { svelteHTML.createElement("span", {   "class":`chat-spinner`,"aria-hidden":`true`,}); }}
                         { svelteHTML.createElement("span", { "class":`chat-result-copy`,}); { svelteHTML.createElement("span", { "class":`chat-title`,});c.title || 'New Chat'; } { svelteHTML.createElement("span", { "class":`chat-character`,});characterNameFor(c); } }
                       }
                     }
                     { svelteHTML.createElement("div", { "class":`chat-actions`,});
                       { svelteHTML.createElement("div", { "class":`chat-menu-wrapper`,});
                         { svelteHTML.createElement("button", {           "type":`button`,"class":`chat-action-btn chat-menu-btn`,"onclick":(e) => toggleChatMenu(c.id, e),"aria-label":`Chat options`,"aria-haspopup":`true`,"aria-expanded":chatMenuOpen === c.id ? 'true' : 'false',}); { const $$_treVeroMnocI9C = __sveltets_2_ensureComponent(IconMoreVert); new $$_treVeroMnocI9C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});} }
                        if(chatMenuOpen === c.id){
                           { svelteHTML.createElement("div", { "class":`chat-menu`,});
                             { svelteHTML.createElement("button", {     "type":`button`,"class":`chat-menu-item`,"onclick":(e) => openEditChat(c, e),}); { const $$_tidEnocI10C = __sveltets_2_ensureComponent(IconEdit); new $$_tidEnocI10C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});} { svelteHTML.createElement("span", {});  } }
                             { svelteHTML.createElement("button", {     "type":`button`,"class":`chat-menu-item`,"onclick":(e) => duplicateSelectedChat(c.id, e),}); { const $$_ypoCtnetnoCnocI10C = __sveltets_2_ensureComponent(IconContentCopy); new $$_ypoCtnetnoCnocI10C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});} { svelteHTML.createElement("span", {});  } }
                             { svelteHTML.createElement("button", {     "type":`button`,"class":`chat-menu-item`,"onclick":(e) => exportSelectedChat(c.id, e),}); { const $$_daolnwoDnocI10C = __sveltets_2_ensureComponent(IconDownload); new $$_daolnwoDnocI10C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});} { svelteHTML.createElement("span", {});  } }
                             { svelteHTML.createElement("button", {     "type":`button`,"class":`chat-menu-item`,"onclick":(e) => requestDeleteChat(c.id, e),}); { const $$_eteleDnocI10C = __sveltets_2_ensureComponent(IconDelete); new $$_eteleDnocI10C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});} { svelteHTML.createElement("span", {});  } }
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
      }else{
        
        if(props.open){
           { svelteHTML.createElement("div", { "class":`char-header`,});
             { svelteHTML.createElement("button", {         "type":`button`,"class":`icon-btn`,"title":`Back to characters`,"aria-label":`Back to characters`,"onclick":() => props.onSelectCharacter?.(null),});
               { const $$_tfeLnorvehCnocI5C = __sveltets_2_ensureComponent(IconChevronLeft); new $$_tfeLnorvehCnocI5C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
             }
            if(selectedCharacter.avatar){
               { svelteHTML.createElement("img", {      "class":`char-header-avatar`,"src":selectedCharacter.avatar,"alt":selectedCharacter.name,});}
            }else{
               { svelteHTML.createElement("div", { "class":`char-header-avatar placeholder`,}); { const $$_nosrePnocI5C = __sveltets_2_ensureComponent(IconPerson); new $$_nosrePnocI5C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});} }
            }
             { svelteHTML.createElement("span", { "class":`char-header-name`,});selectedCharacter.name; }
           }
        }

         { svelteHTML.createElement("nav", {   "class":`top-nav`,"aria-label":`Chat actions`,});
           { svelteHTML.createElement("button", {       "class":`nav-item`,"onclick":() => props.onNewChat?.(selectedCharacter.id),"title":`New chat with ${selectedCharacter.name}`,"aria-label":`New chat`,});
             { const $$_erauqStidEnocI5C = __sveltets_2_ensureComponent(IconEditSquare); new $$_erauqStidEnocI5C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
             { svelteHTML.createElement("span", { "class":`label`,});  }
           }
           { svelteHTML.createElement("button", {       "class":`nav-item`,"onclick":() => props.onEditCharacter?.(selectedCharacter),"title":`Edit ${selectedCharacter.name}`,"aria-label":`Edit character`,});
             { const $$_tidEnocI5C = __sveltets_2_ensureComponent(IconEdit); new $$_tidEnocI5C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
             { svelteHTML.createElement("span", { "class":`label`,});  }
           }
         }

        if(props.open){
           { svelteHTML.createElement("div", { "class":`section-label`,});  }
           { svelteHTML.createElement("div", { "class":`search-tools character-search`,});
             { svelteHTML.createElement("div", { "class":`search-input-wrapper`,});
               { const $$_hcraeSnocI5C = __sveltets_2_ensureComponent(IconSearch); new $$_hcraeSnocI5C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px; color: var(--muted);`,}});}
               { svelteHTML.createElement("input", {            "class":`search-input`,"type":`search`,"placeholder":searchMode === 'title' ? 'Search this character’s chats...' : 'Search this character’s chat content...',"value":characterSearchQuery,"oninput":(event) => (characterSearchQuery = event.currentTarget.value),"aria-label":`Search this character's chats`,});}
               { svelteHTML.createElement("button", {         "type":`button`,"class":`search-mode-btn ${searchMode === 'content' ? 'active' : ''}`,"onclick":() => (searchMode = searchMode === 'title' ? 'content' : 'title'),"title":searchMode === 'title' ? 'Search chat content too' : 'Search titles only',"aria-label":searchMode === 'title' ? 'Search chat content too' : 'Search titles only',}); { const $$_noitpircseDnocI6C = __sveltets_2_ensureComponent(IconDescription); new $$_noitpircseDnocI6C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});} }
              if(characterSearchQuery){ { svelteHTML.createElement("button", {         "type":`button`,"class":`search-clear-btn`,"onclick":clearActiveSearch,"title":`Clear search`,"aria-label":`Clear search`,}); { const $$_esolCnocI6C = __sveltets_2_ensureComponent(IconClose); new $$_esolCnocI6C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});} }}
             }
           }
           { svelteHTML.createElement("nav", {   "class":`chat-list`,"aria-label":`Chats`,});
            if(!characterChats.length){
               { svelteHTML.createElement("div", { "class":`empty-hint`,});characterSearchQuery.trim() ? 'No matching chats.' : `No chats yet with ${selectedCharacter.name}.`; }
            }
               for(let c of __sveltets_2_ensureArray(characterChats)){c.id;
               { svelteHTML.createElement("div", { "class":`chat-row ${props.selectedId === c.id ? 'active' : ''}`,});
                 { svelteHTML.createElement("button", {       "type":`button`,"class":`chat-link ${props.selectedId === c.id ? 'active' : ''}`,"onclick":() => props.onSelect?.(c.id),});
                   { svelteHTML.createElement("span", { "class":`chat-label`,});
                    if(isGenerating(c.id)){
                       { svelteHTML.createElement("span", {   "class":`chat-spinner`,"aria-hidden":`true`,}); }
                    }
                     { svelteHTML.createElement("span", { "class":`chat-title`,});c.title || 'New Chat'; }
                   }
                 }
                 { svelteHTML.createElement("div", { "class":`chat-actions`,});
                   { svelteHTML.createElement("div", { "class":`chat-menu-wrapper`,});
                     { svelteHTML.createElement("button", {             "type":`button`,"class":`chat-action-btn chat-menu-btn`,"onclick":(e) => toggleChatMenu(c.id, e),"aria-label":`Chat options`,"aria-haspopup":`true`,"aria-expanded":chatMenuOpen === c.id ? 'true' : 'false',});
                       { const $$_treVeroMnocI8C = __sveltets_2_ensureComponent(IconMoreVert); new $$_treVeroMnocI8C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
                     }
                    if(chatMenuOpen === c.id){
                       { svelteHTML.createElement("div", { "class":`chat-menu`,});
                         { svelteHTML.createElement("button", {     "type":`button`,"class":`chat-menu-item`,"onclick":(e) => openEditChat(c, e),});
                           { const $$_tidEnocI9C = __sveltets_2_ensureComponent(IconEdit); new $$_tidEnocI9C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});} { svelteHTML.createElement("span", {});  }
                         }
                         { svelteHTML.createElement("button", {     "type":`button`,"class":`chat-menu-item`,"onclick":(e) => duplicateSelectedChat(c.id, e),});
                           { const $$_ypoCtnetnoCnocI9C = __sveltets_2_ensureComponent(IconContentCopy); new $$_ypoCtnetnoCnocI9C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});} { svelteHTML.createElement("span", {});  }
                         }
                         { svelteHTML.createElement("button", {     "type":`button`,"class":`chat-menu-item`,"onclick":(e) => exportSelectedChat(c.id, e),});
                           { const $$_daolnwoDnocI9C = __sveltets_2_ensureComponent(IconDownload); new $$_daolnwoDnocI9C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});} { svelteHTML.createElement("span", {});  }
                         }
                         { svelteHTML.createElement("button", {     "type":`button`,"class":`chat-menu-item`,"onclick":(e) => requestDeleteChat(c.id, e),});
                           { const $$_eteleDnocI9C = __sveltets_2_ensureComponent(IconDelete); new $$_eteleDnocI9C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});} { svelteHTML.createElement("span", {});  }
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
         { svelteHTML.createElement("div", { "class":`footer-row`,});
           { svelteHTML.createElement("button", {       "class":`nav-item`,"onclick":() => props.onOpenSettings?.(),"title":`Settings (${gitHash})`,"aria-label":`Settings`,});
             { const $$_sgnitteSnocI6C = __sveltets_2_ensureComponent(IconSettings); new $$_sgnitteSnocI6C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
             { svelteHTML.createElement("span", { "class":`label`,});  }
             { svelteHTML.createElement("span", { "class":`brand-hash`,});gitHash; }
           }
           { svelteHTML.createElement("button", {       "class":`nav-item tavern-settings`,"onclick":() => props.onOpenTavernSettings?.(),"title":`Tavern settings`,"aria-label":`Tavern settings`,});
             { const $$_enuTnocI6C = __sveltets_2_ensureComponent(IconTune); new $$_enuTnocI6C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
           }
         }
       }
     }
   }
 }

 { const $$_ladoMmrifnoC0C = __sveltets_2_ensureComponent(ConfirmModal); new $$_ladoMmrifnoC0C({ target: __sveltets_2_any(), props: {                 "open":deleteChatId !== null,"title":`Delete Chat`,"message":`Are you sure you want to delete this chat? This action cannot be undone.`,"confirmText":`Delete`,"cancelText":`Cancel`,"danger":true,"onConfirm":confirmDeleteChat,"onCancel":() => (deleteChatId = null),}});}

 { const $$_ladoMmrifnoC0C = __sveltets_2_ensureComponent(ConfirmModal); new $$_ladoMmrifnoC0C({ target: __sveltets_2_any(), props: {                 "open":deleteCharacterId !== null,"title":`Delete Character`,"message":`Delete this character and all of their chats? This action cannot be undone.`,"confirmText":`Delete`,"cancelText":`Cancel`,"danger":true,"onConfirm":confirmDeleteCharacter,"onCancel":() => (deleteCharacterId = null),}});}

 { const $$_ladoMtidE0C = __sveltets_2_ensureComponent(EditModal); new $$_ladoMtidE0C({ target: __sveltets_2_any(), props: {                   "open":editModalChat !== null,"title":`Edit Chat Title`,"label":`Chat title`,"placeholder":`New Chat`,"value":editModalChat?.title || '',"confirmText":`Save`,"cancelText":`Cancel`,"onConfirm":confirmEditChat,"onCancel":() => (editModalChat = null),}});}


};
return { props: {} as any as Props, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const TavernSidebar__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type TavernSidebar__SvelteComponent_ = ReturnType<typeof TavernSidebar__SvelteComponent_>;
/*Ωignore_endΩ*/export default TavernSidebar__SvelteComponent_;
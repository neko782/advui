<script lang="ts">
  import Chat from './lib/Chat.svelte'
  import Sidebar from './lib/components/Sidebar.svelte'
  import TavernSidebar from './lib/components/tavern/TavernSidebar.svelte'
  import CharacterEditorModal from './lib/components/tavern/CharacterEditorModal.svelte'
  import TavernSettingsModal from './lib/components/tavern/TavernSettingsModal.svelte'
  import SettingsModal from './lib/SettingsModal.svelte'
  import { loadAll, getChatListItems, createChat, setSelected, getChat, deleteChat, renameChat, duplicateChat, toChatListItem, unlockAllChats } from './lib/chatsStore'
  import { loadSettings } from './lib/settingsStore'
  import { settingsStore, generationRegistry } from './lib/stores/appState.svelte'
  import { ensureModels } from './lib/modelsStore'
  import { initTheme } from './lib/themeStore'
  import { getAllCharacters, putCharacter, deleteCharacter } from './lib/tavern/charactersStore'
  import { parseCharacterFile, makeBlankCharacter } from './lib/tavern/characterCard'
  import { createCharacterChat } from './lib/tavern/tavernChat'
  import type { Chat as ChatType, ChatListItem, Preset } from './lib/types'
  import type { Character, PromptPreset, Persona } from './lib/types/tavern'

  let chats = $state<ChatListItem[]>([])
  let selectedId = $state<string | null>(null)
  let sidebarOpen = $state(true)
  let showSettings = $state(false)
  let presets = $derived<Preset[]>(Array.isArray(settingsStore.current?.presets) ? settingsStore.current.presets : [])

  // Tavern state
  const MODE_KEY = 'ui.mode.v1'
  let mode = $state<'chat' | 'tavern'>('chat')
  let characters = $state<Character[]>([])
  let selectedCharacterId = $state<string | null>(null)
  let showTavernSettings = $state(false)
  let characterEditorOpen = $state(false)
  let characterEditorTarget = $state<Character | null>(null)

  const normalChats = $derived(chats.filter(c => !c.characterId))
  const tavernChats = $derived(chats.filter(c => !!c.characterId))

  // Track previous selected chat to keep it mounted until user switches away
  let previousSelectedId = $state<string | null>(null)

  // Derive which chats should be mounted: selected + previous + generating
  let mountedChatIds = $derived.by(() => {
    const ids = new Set<string>()
    if (selectedId) ids.add(selectedId)
    // Keep previous chat mounted until user navigates away from current
    if (previousSelectedId && previousSelectedId !== selectedId) ids.add(previousSelectedId)
    for (const id of Object.keys(generationRegistry.map)) {
      if (generationRegistry.map[id]) ids.add(id)
    }
    return ids
  })

  // Apply fancy effects attribute to the root element whenever settings change
  $effect(() => {
    const fancy = !!settingsStore.current?.fancyEffects
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-fancy-effects', fancy ? 'true' : 'false')
    }
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

  function sortChats(list: ChatListItem[]): ChatListItem[] {
    return list.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  }

  function upsertChat(updated: ChatType): void {
    const summary = toChatListItem(updated)
    if (!summary?.id) return
    const current = Array.isArray(chats) ? chats : []
    const index = current.findIndex(chat => chat.id === summary.id)
    if (index === -1) {
      chats = sortChats([summary, ...current])
      return
    }
    const next = current.slice()
    next[index] = summary
    chats = sortChats(next)
  }

  async function refresh() {
    try {
      // Show most recent chats first
      const list = sortChats(await getChatListItems())
      chats = list
      generationRegistry.prune(list.map(item => item.id))
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
    const all = await getChatListItems()
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
  function loadModePref(): 'chat' | 'tavern' {
    try {
      return localStorage.getItem(MODE_KEY) === 'tavern' ? 'tavern' : 'chat'
    } catch { return 'chat' }
  }

  async function refreshCharacters() {
    characters = await getAllCharacters()
  }

  onMount(() => {
    initTheme()
    ensureStartupModels().catch(() => {})
    // Defer initial population to avoid mutating state during mount flush
    setTimeout(async () => {
      sidebarOpen = loadSidebarPref()
      mode = loadModePref()
      settingsStore.reload()
      refreshCharacters().catch(() => {})

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

  // Keep the app shell sized to the *visual* viewport so the on-screen
  // keyboard shrinks the layout instead of creating a second scrollable
  // region behind it (which used to push the input below the keyboard).
  onMount(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    const update = () => {
      // Only pin things when the keyboard actually eats space; otherwise
      // leave the browser alone (pinch-zoom also resizes the visual viewport).
      const keyboardOpen = window.innerHeight - vv.height > 80
      if (keyboardOpen) {
        root.style.setProperty('--app-height', `${Math.round(vv.height)}px`)
        // The shell owns all scrolling; keep the page itself pinned so the
        // browser can't scroll the input out from under the keyboard.
        if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0)
      } else {
        root.style.removeProperty('--app-height')
      }
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      root.style.removeProperty('--app-height')
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
    // No explicit preset: prefer the configured default for new chats
    const preferredDefault = !requested && settings?.defaultNewChatPresetId
      ? list.find(p => p?.id === settings.defaultNewChatPresetId)
      : null
    const preset = requested || preferredDefault || list.find(p => !p?.tavernOnly) || list[0] || null
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
    const summary = toChatListItem(c.chat)
    if (summary) chats = sortChats([summary, ...chats])
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
  function onChatUpdated(updated?: ChatType) {
    if (updated?.id) {
      upsertChat(updated)
      generationRegistry.prune((chats || []).map(item => item.id))
      return
    }
    // Fall back to full refresh when no payload is available
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
    generationRegistry.setGenerating(id, false)
    // Clear previous if the deleted chat was the previous one
    if (previousSelectedId === id) {
      previousSelectedId = null
    }
    const wasSelected = selectedId === id
    if (wasSelected) selectedId = null
    const remaining = await getChatListItems()
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

  async function onDuplicateChat(id) {
    if (!id) return
    const duplicated = await duplicateChat(id)
    if (!duplicated) return
    if (selectedId) previousSelectedId = selectedId
    selectedId = duplicated.id
    const summary = toChatListItem(duplicated.chat)
    if (summary) chats = sortChats([summary, ...chats])
    else await refresh()
  }

  // -------------------------------------------------------------------------
  // Tavern mode
  // -------------------------------------------------------------------------

  function switchMode(next: 'chat' | 'tavern') {
    if (mode === next) return
    mode = next
    try { localStorage.setItem(MODE_KEY, next) } catch {}
    const pool = next === 'tavern' ? tavernChats : normalChats
    if (!pool.some(c => c.id === selectedId)) {
      const first = pool[0]?.id || null
      if (first) onSelectChat(first)
    }
    if (next === 'tavern') {
      const item = tavernChats.find(c => c.id === selectedId)
      selectedCharacterId = item?.characterId || null
    }
  }

  function onSelectCharacter(id: string | null) {
    selectedCharacterId = id
    if (!id) return
    const recent = tavernChats
      .filter(c => c.characterId === id)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]
    if (recent) onSelectChat(recent.id)
  }

  async function onImportCharacterFiles(files: FileList | File[]) {
    const list = Array.from(files || [])
    const errors: string[] = []
    for (const file of list) {
      try {
        const character = await parseCharacterFile(file)
        await putCharacter(character)
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : 'import failed'}`)
      }
    }
    await refreshCharacters()
    if (errors.length) alert(`Some cards could not be imported:\n${errors.join('\n')}`)
  }

  function onNewCharacter() {
    characterEditorTarget = makeBlankCharacter()
    characterEditorOpen = true
  }

  function onEditCharacter(character: Character) {
    characterEditorTarget = character
    characterEditorOpen = true
  }

  async function onCharacterSave(character: Character) {
    try {
      await putCharacter(character)
      characterEditorOpen = false
      characterEditorTarget = null
      await refreshCharacters()
    } catch (err) {
      console.error('Failed to save character:', err)
      alert('Failed to save character. Please try again.')
    }
  }

  async function onDeleteCharacter(id: string) {
    if (!id) return
    // Delete the character's chats first
    const owned = tavernChats.filter(c => c.characterId === id)
    for (const chat of owned) {
      try { await deleteChat(chat.id) } catch {}
      generationRegistry.setGenerating(chat.id, false)
      if (selectedId === chat.id) selectedId = null
      if (previousSelectedId === chat.id) previousSelectedId = null
    }
    await deleteCharacter(id)
    if (selectedCharacterId === id) selectedCharacterId = null
    await refreshCharacters()
    await refresh()
  }

  async function onNewTavernChat(characterId: string) {
    const character = characters.find(c => c.id === characterId)
    if (!character) return
    const created = await createCharacterChat(character, settingsStore.current)
    if (selectedId) previousSelectedId = selectedId
    selectedId = created.id
    const summary = toChatListItem(created.chat)
    if (summary) chats = sortChats([summary, ...chats])
    else await refresh()
  }

  function onTavernSettingsSave(data: {
    tavernSelectedPresetId: string
    tavernPerChatPresets: boolean
    promptPresets: PromptPreset[]
    selectedPromptPresetId: string
    personas: Persona[]
    selectedPersonaId: string
    tavernAvatarShape: 'circle' | 'rounded' | 'card'
  }) {
    settingsStore.save({ ...settingsStore.current, ...data })
  }
</script>

<div class="app-shell">
  {#if mode === 'chat'}
    <Sidebar
      open={sidebarOpen}
      chats={normalChats}
      selectedId={selectedId}
      presets={presets}
      defaultPresetId={settingsStore.current?.defaultNewChatPresetId}
      generatingMap={generationRegistry.map}
      onSelect={onSelectChat}
      onNewChat={onNewChat}
      onDeleteChat={onDeleteChat}
      onDuplicateChat={onDuplicateChat}
      onRenameChat={onRenameChat}
      onToggle={toggleSidebar}
      onOpenSettings={onOpenSettings}
      onSwitchMode={switchMode}
    />
  {:else}
    <TavernSidebar
      open={sidebarOpen}
      characters={characters}
      chats={tavernChats}
      selectedCharacterId={selectedCharacterId}
      selectedId={selectedId}
      generatingMap={generationRegistry.map}
      onSelectCharacter={onSelectCharacter}
      onImportCharacterFiles={onImportCharacterFiles}
      onNewCharacter={onNewCharacter}
      onEditCharacter={onEditCharacter}
      onDeleteCharacter={onDeleteCharacter}
      onNewChat={onNewTavernChat}
      onSelect={onSelectChat}
      onDeleteChat={onDeleteChat}
      onDuplicateChat={onDuplicateChat}
      onRenameChat={onRenameChat}
      onOpenTavernSettings={() => (showTavernSettings = true)}
      onToggle={toggleSidebar}
      onOpenSettings={onOpenSettings}
      onSwitchMode={switchMode}
    />
  {/if}
  <div class="chat-pane">
    {#each (chats || []).filter(c => mountedChatIds.has(c.id)) as c (c.id)}
      <div class="chat-wrapper {selectedId === c.id ? 'active' : 'hidden'}">
        <Chat
          chatId={c.id}
          onNewChat={onNewChat}
          onChatUpdated={onChatUpdated}
        />
      </div>
    {/each}
  </div>
  <div class="app-fade"></div>
  <SettingsModal
    open={showSettings}
    onClose={() => (showSettings = false)}
    onSaved={() => settingsStore.reload()}
  />
  <TavernSettingsModal
    open={showTavernSettings}
    connectionPresets={presets}
    tavernSelectedPresetId={settingsStore.current?.tavernSelectedPresetId}
    tavernPerChatPresets={settingsStore.current?.tavernPerChatPresets}
    promptPresets={settingsStore.current?.promptPresets}
    selectedPromptPresetId={settingsStore.current?.selectedPromptPresetId}
    personas={settingsStore.current?.personas}
    selectedPersonaId={settingsStore.current?.selectedPersonaId}
    avatarShape={settingsStore.current?.tavernAvatarShape}
    onSave={onTavernSettingsSave}
    onClose={() => (showTavernSettings = false)}
  />
  <CharacterEditorModal
    open={characterEditorOpen}
    character={characterEditorTarget}
    canDelete={!!characterEditorTarget && characters.some(character => character.id === characterEditorTarget?.id)}
    onSave={onCharacterSave}
    onDelete={async (id) => {
      characterEditorOpen = false
      characterEditorTarget = null
      await onDeleteCharacter(id)
    }}
    onCancel={() => { characterEditorOpen = false; characterEditorTarget = null }}
  />
</div>

<style>
  :global(#app) { height: 100dvh; height: var(--app-height, 100dvh); }
  .app-shell {
    position: relative;
    height: 100dvh;
    height: var(--app-height, 100dvh);
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

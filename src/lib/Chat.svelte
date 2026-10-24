<script lang="ts">
  // Chat view: renders a ChatController and forwards user intent to it. All
  // conversation behavior lives in chat/chatController.svelte.ts; this
  // component only owns view state (popovers, dialogs, model list, scroll).
  import { onDestroy, untrack } from 'svelte'
  import { settingsStore, generationRegistry } from './stores/appState.svelte'
  import { ensureModels, loadModelsCache } from './modelsStore'
  import { copyText as copyToClipboard } from './utils/clipboard'
  import MessageList from './components/chat/MessageList.svelte'
  import Composer from './components/chat/Composer.svelte'
  import ConfirmModal from './components/ConfirmModal.svelte'
  import { ChatController } from './chat/chatController.svelte'
  import { toIntOrNull, toClampedNumber } from './utils/numbers'
  import { normalizeReasoning, normalizeVerbosity, normalizeReasoningSummary } from './utils/validation'
  import type { Character } from './types/tavern'
  import type { Chat as StoredChat, MessageRole } from './types'

  interface Props {
    chatId: string
    /** Current shared character card for this chat, kept live by the app shell. */
    tavernCharacter?: Character | null
    onNewChat?: (options?: { presetId?: string }) => void
    onChatUpdated?: (updated?: StoredChat) => void
  }

  const props: Props = $props()

  let listCmp: { scrollToBottom?: () => void } | undefined

  const chat = new ChatController({
    // The app shell keys each Chat by id; later id changes go through load().
    chatId: (() => props.chatId)(),
    initialSettings: settingsStore.current,
    registry: generationRegistry,
    saveSettings: (next) => { settingsStore.save(next) },
    getTavernCharacter: () => props.tavernCharacter,
    onChatUpdated: (updated) => props.onChatUpdated?.(updated),
    scrollToBottom: () => { try { listCmp?.scrollToBottom?.() } catch {} },
  })

  // View-only state
  let chatSettingsOpen = $state(false)
  let modelIds = $state<string[]>(loadModelsCache(chat.chatSettings.connectionId).ids || [])
  // Delete confirmation (session-only, resets on page refresh)
  let skipDeleteConfirm = $state(false)
  let deleteModalOpen = $state(false)
  let deleteModalMessageId = $state<number | null>(null)

  const settings = $derived(chat.settings)
  const chatSettings = $derived(chat.chatSettings)
  const modelConnectionId = $derived(chatSettings.connectionId)
  // Sidebar saves replace the chat summary object, even when its id is the
  // same. Only a different id should reset this view's open settings.
  const viewChatId = $derived(props.chatId)

  const connectionOptions = $derived.by(() => {
    const list = Array.isArray(settings?.connections) ? settings.connections : []
    return list
      .filter(conn => conn && typeof conn.id === 'string')
      .map(conn => ({ id: conn.id, name: conn.name || conn.id, apiMode: conn.apiMode, openRouterEnabled: conn.openRouterEnabled }))
  })

  // ---- Reactive inputs into the controller -------------------------------

  $effect(() => { chat.syncSettings(settingsStore.current) })
  $effect(() => { chat.syncCharacter(props.tavernCharacter) })
  $effect(() => { chat.followTavernPreset(settingsStore.current) })
  $effect(() => { chat.ensureValidConnection() })
  $effect(() => { chat.autoPersist() })
  $effect(() => {
    const cid = viewChatId
    untrack(() => {
      chatSettingsOpen = false
      void chat.load(cid)
    })
  })

  // Debounce image loading to reduce frequent effect runs
  $effect(() => {
    const visible = chat.visibleMessages
    const timer = setTimeout(() => chat.images.ensureVisibleImages(visible), 100)
    return () => clearTimeout(timer)
  })

  // ---- Model list ----------------------------------------------------------

  $effect(() => {
    const connectionId = modelConnectionId
    const cachedIds = loadModelsCache(connectionId)?.ids || []
    modelIds = cachedIds
    if (cachedIds.length) return
    ensureModels({ connectionId: connectionId ?? undefined }).then((fresh) => {
      if (chat.chatSettings?.connectionId === connectionId && Array.isArray(fresh?.ids)) {
        modelIds = fresh.ids
      }
    }).catch(() => {})
  })

  $effect(() => {
    if (chatSettingsOpen) {
      try { modelIds = loadModelsCache(modelConnectionId).ids || [] } catch {}
    }
  })

  onDestroy(() => chat.dispose())

  // ---- View handlers ---------------------------------------------------------

  async function copyMessage(text: string) {
    try { await copyToClipboard(text) } catch {}
  }

  function requestDeleteMessage(messageId: number) {
    if (chat.locked) return
    if (skipDeleteConfirm) {
      chat.deleteMessage(messageId)
      return
    }
    deleteModalMessageId = messageId
    deleteModalOpen = true
  }

  function confirmDeleteMessage() {
    if (deleteModalMessageId != null) chat.deleteMessage(deleteModalMessageId)
    deleteModalOpen = false
    deleteModalMessageId = null
  }

  function cancelDeleteMessage() {
    deleteModalOpen = false
    deleteModalMessageId = null
  }

  function onEditableInput(eOrText: string | Event) {
    const next = typeof eOrText === 'string'
      ? eOrText
      : (eOrText?.currentTarget as HTMLElement | null)?.innerText
    chat.setEditingText(next)
  }

  function onEditableKeydown(e: KeyboardEvent) {
    if ((e.key === 'Enter') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      chat.commitEdit()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      chat.cancelEdit()
    }
  }

  function changeConnection(val: unknown) {
    const newConnectionId = (typeof val === 'string' && val.trim()) ? val.trim() : null
    const newConnection = connectionOptions.find(c => c.id === newConnectionId)
    // Clear responses-API-only features when switching to non-responses API connection
    if (newConnection?.apiMode !== 'responses') {
      chat.updateChatSettings({
        connectionId: newConnectionId,
        webSearchEnabled: false,
        codeInterpreterEnabled: false,
        shellEnabled: false,
        imageGenerationEnabled: false,
        mcpEnabled: false,
      })
    } else {
      chat.updateChatSettings({ connectionId: newConnectionId })
    }
  }
</script>

<section class="chat-shell">
  {#if chat.status === 'error'}
    <div class="chat-load-error" role="alert">
      <p class="chat-load-error-title">This chat could not be opened.</p>
      <p class="chat-load-error-detail">{chat.loadError}</p>
      <p class="chat-load-error-detail">Nothing was changed. Your saved messages are still in browser storage.</p>
      <button type="button" class="ui-btn" onclick={() => chat.retryLoad()}>Retry</button>
    </div>
  {/if}
  <MessageList
    bind:this={listCmp}
    items={chat.visibleMessages}
    character={chat.characterId ? chat.character : null}
    personaName={settings?.persona?.name}
    avatarShape={settings?.tavernAvatarShape}
    imageCache={chat.images.imageCache}
    chatId={props.chatId}
    notice={chat.visibleNotice}
    total={chat.nodes.length}
    locked={chat.locked}
    debug={chat.debug}
    editingId={chat.editingId}
    editingText={chat.editingText}
    insertedMessageId={chat.insertedMessageId}
    allowInlineHtml={settings?.allowInlineHtml}
    renderLatex={settings?.renderLatex !== false}
    messageActions={settings?.messageActions}
    editorActions={settings?.editorActions}
    disableRoleSwitching={settings?.disableRoleSwitching}
    showInsertButtons={settings?.showInsertButtons !== false}
    followingMap={chat.followingMap}
    onDismissNotice={() => chat.dismissNotice()}
    onSetRole={(id, role) => chat.setRole(id, role as MessageRole)}
    onEditInput={(t) => onEditableInput(t)}
    onEditKeydown={onEditableKeydown}
    onApplyEditSend={() => chat.commitEditAndSend()}
    onApplyEditBranch={() => chat.commitEditAsBranch()}
    onApplyEditReplace={() => chat.commitEdit()}
    onCancelEdit={() => chat.cancelEdit()}
    onChangeVariant={(id, d) => chat.changeVariant(id, d)}
    onRefreshAssistant={(id) => chat.regenerate(id)}
    onRefreshAfterUserIndex={(i) => chat.regenerateAfter(i)}
    onCopy={(text) => copyMessage(text)}
    onDelete={(id) => requestDeleteMessage(id)}
    onEdit={(id) => chat.startEdit(id)}
    onMoveDown={(id) => chat.moveDown(id)}
    onMoveUp={(id) => chat.moveUp(id)}
    onFork={(id) => chat.fork(id)}
    onDeleteInserted={() => chat.deleteInsertedMessage()}
    onDebugFuckBranch={(id) => chat.debugDuplicateBranch(id)}
    onDebugMessageDeath={(id) => chat.debugMessageDeath(id)}
    onInsertBetween={(afterIndex) => chat.insertBetween(afterIndex)}
  />

  <Composer
    input={chat.input}
    sending={chat.sending}
    locked={chat.locked}
    chatSettingsOpen={chatSettingsOpen}
    chatModel={chatSettings.model}
    chatStreaming={chatSettings.streaming}
    chatMaxOutputTokens={chatSettings.maxOutputTokens}
    chatTopP={chatSettings.topP}
    chatTemperature={chatSettings.temperature}
    chatReasoningEffort={chatSettings.reasoningEffort}
    chatReasoningSummary={chatSettings.reasoningSummary}
    chatTextVerbosity={chatSettings.textVerbosity}
    chatOpenRouterProvider={chatSettings.openRouterProvider}
    chatThinkingEnabled={chatSettings.thinkingEnabled}
    chatThinkingBudgetTokens={chatSettings.thinkingBudgetTokens}
    chatWebSearchEnabled={chatSettings.webSearchEnabled}
    chatCodeInterpreterEnabled={chatSettings.codeInterpreterEnabled}
    chatCodeInterpreterNetworkEnabled={chatSettings.codeInterpreterNetworkEnabled}
    chatCodeInterpreterAllowedDomains={chatSettings.codeInterpreterAllowedDomains}
    chatShellEnabled={chatSettings.shellEnabled}
    chatShellNetworkEnabled={chatSettings.shellNetworkEnabled}
    chatShellAllowedDomains={chatSettings.shellAllowedDomains}
    chatImageGenerationEnabled={chatSettings.imageGenerationEnabled}
    chatImageGenerationModel={chatSettings.imageGenerationModel}
    chatMcpEnabled={chatSettings.mcpEnabled}
    chatMcpServers={chatSettings.mcpServers}
    modelIds={modelIds}
    connections={connectionOptions}
    chatConnectionId={chatSettings.connectionId}
    attachedImages={chat.images.attachedImages}
    keybinds={settings?.keybinds}
    showThinkingControls={!!settings?.showThinkingSettings}
    presets={chat.characterId ? settings?.presets : (settings?.presets || []).filter(p => !p?.tavernOnly)}
    onToggleChatSettings={() => (chatSettingsOpen = !chatSettingsOpen)}
    onCloseChatSettings={() => (chatSettingsOpen = false)}
    onChangeConnection={changeConnection}
    onChangeModel={(val) => chat.updateChatSettings({ model: val })}
    onChangeStreaming={(val) => chat.updateChatSettings({ streaming: !!val })}
    onChangeMaxOutputTokens={(val) => chat.updateChatSettings({ maxOutputTokens: toIntOrNull(val) })}
    onChangeTopP={(val) => chat.updateChatSettings({ topP: toClampedNumber(val, 0, 1) })}
    onChangeTemperature={(val) => chat.updateChatSettings({ temperature: toClampedNumber(val, 0, 2) })}
    onChangeReasoningEffort={(val) => chat.updateChatSettings({ reasoningEffort: normalizeReasoning(val) })}
    onChangeReasoningSummary={(val) => chat.updateChatSettings({ reasoningSummary: normalizeReasoningSummary(val) })}
    onChangeTextVerbosity={(val) => chat.updateChatSettings({ textVerbosity: normalizeVerbosity(val) })}
    onChangeOpenRouterProvider={(val) => chat.setOpenRouterProvider(val)}
    onChangeThinkingEnabled={(val) => chat.updateChatSettings({ thinkingEnabled: !!val })}
    onChangeThinkingBudgetTokens={(val) => chat.updateChatSettings({ thinkingBudgetTokens: toIntOrNull(val) })}
    onChangeWebSearchEnabled={(val) => chat.updateChatSettings({ webSearchEnabled: !!val })}
    onChangeCodeInterpreterEnabled={(val) => chat.updateChatSettings({ codeInterpreterEnabled: !!val })}
    onChangeCodeInterpreterNetworkEnabled={(val) => chat.updateChatSettings({ codeInterpreterNetworkEnabled: !!val })}
    onChangeCodeInterpreterAllowedDomains={(val) => chat.updateChatSettings({ codeInterpreterAllowedDomains: val || undefined })}
    onChangeShellEnabled={(val) => chat.updateChatSettings({ shellEnabled: !!val })}
    onChangeShellNetworkEnabled={(val) => chat.updateChatSettings({ shellNetworkEnabled: !!val })}
    onChangeShellAllowedDomains={(val) => chat.updateChatSettings({ shellAllowedDomains: val || undefined })}
    onChangeImageGenerationEnabled={(val) => chat.updateChatSettings({ imageGenerationEnabled: !!val })}
    onChangeImageGenerationModel={(val) => chat.updateChatSettings({ imageGenerationModel: val || undefined })}
    onChangeMcpEnabled={(val) => chat.updateChatSettings({ mcpEnabled: !!val })}
    onChangeMcpServers={(servers) => chat.updateChatSettings({ mcpServers: servers })}
    onSelectPreset={(preset) => chat.selectPreset(preset)}
    disableSendRolePopup={settings?.disableSendRolePopup}
    showAddWithoutSend={settings?.showAddWithoutSend}
    onInput={(val) => chat.setInput(val)}
    onAdd={(role) => chat.addToChat(role)}
    onStop={() => chat.stop()}
    onSend={(role) => chat.send(role)}
    onFilesSelected={(files) => chat.images.handleFilesSelected(files)}
    onRemoveImage={(id) => chat.images.removeAttachedImage(id)}
  />
  {#if chat.debug}
    <button
      type="button"
      class="hidden-debug-lock"
      onclick={() => chat.toggleDebugLock()}
      aria-label={chat.forcedLock ? 'Clear simulated lock' : 'Simulate persisted lock leak'}
      aria-pressed={chat.forcedLock ? 'true' : 'false'}
      title={chat.forcedLock ? 'Clear simulated lock' : 'Simulate persisted lock leak'}
    ></button>
  {/if}

  <ConfirmModal
    open={deleteModalOpen}
    title="Delete message"
    message="Are you sure you want to delete this message?"
    confirmText="Delete"
    cancelText="Cancel"
    danger={true}
    checkbox={true}
    checkboxLabel="Don't ask again this session"
    checkboxChecked={skipDeleteConfirm}
    onCheckboxChange={(checked) => (skipDeleteConfirm = checked)}
    onConfirm={confirmDeleteMessage}
    onCancel={cancelDeleteMessage}
  />
</section>

<style>
  .chat-shell {
    position: relative;
    --panel: color-mix(in srgb, #ffffff 92%, #e6e6e6);
    --border: color-mix(in srgb, #c8c8c8 60%, #0000);
    --text: color-mix(in srgb, #1b1f24 92%, #0000);
    --muted: #6b7280;
    --accent: #3584e4;
    --assistant: #f3f4f6;
    --user: #e5e7eb;
    --page-gutter: clamp(14px, 4vw, 32px);
    --page-max: 980px;
    --float-shadow: 0 10px 30px rgba(0,0,0,0.08), 0 2px 10px rgba(0,0,0,0.06);
    --float-border: color-mix(in srgb, var(--border), transparent 55%);
    --bubble-pad-x: 12px;
    --actions-inset-x: clamp(0px, calc(var(--bubble-pad-x) - 4px), 100vw);
  }

  :global(:root[data-theme='dark']) .chat-shell {
    --panel: #141414;
    --border: #2a2a2a;
    --text: #e6e6e6;
    --muted: #a3a3a3;
    --assistant: #1c1c1c;
    --user: #222222;
  }

  .chat-load-error {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 6px;
    padding: 24px;
    text-align: center;
    background: var(--bg);
  }
  .chat-load-error-title { margin: 0; font-weight: 600; }
  .chat-load-error-detail { margin: 0; color: var(--muted); max-width: 48ch; }
  .chat-load-error .ui-btn { margin-top: 8px; }

  .hidden-debug-lock {
    position: absolute;
    bottom: 6px;
    right: 6px;
    width: 18px;
    height: 18px;
    border: none;
    border-radius: 50%;
    background: color-mix(in srgb, var(--accent), transparent 35%);
    opacity: 0.75;
    box-shadow: 0 1px 3px rgba(0,0,0,0.18);
    cursor: pointer;
  }

  .hidden-debug-lock:focus-visible,
  .hidden-debug-lock:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--accent), transparent 20%);
  }

  .hidden-debug-lock[aria-pressed='true'] {
    opacity: 1;
    background: color-mix(in srgb, var(--accent), transparent 10%);
  }

  .chat-shell {
    height: 100%;
    display: grid;
    grid-template-rows: 1fr auto;
    background: var(--bg);
    color: var(--text);
    padding-inline: var(--page-gutter);
    padding-top: 0;
    padding-bottom: 0;
    overflow-x: hidden;
  }
</style>

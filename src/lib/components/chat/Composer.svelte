<script lang="ts">
  import { IconAdd, IconClose, IconStop, IconSend } from '../../icons'
  import { autoGrow } from '../../utils/dom'
  import ChatSettingsPopover from './ChatSettingsPopover.svelte'
  import { onMount } from 'svelte'
  import type { Image, Preset, Connection, Keybinds, ReasoningEffort, TextVerbosity, ReasoningSummary, MessageRole } from '../../types'

  interface Props {
    input?: string
    sending?: boolean
    locked?: boolean
    chatSettingsOpen?: boolean
    chatModel?: string
    chatStreaming?: boolean
    chatMaxOutputTokens?: number | null
    chatTopP?: number | null
    chatTemperature?: number | null
    chatReasoningEffort?: ReasoningEffort
    chatReasoningSummary?: ReasoningSummary
    chatTextVerbosity?: TextVerbosity
    chatThinkingEnabled?: boolean
    chatThinkingBudgetTokens?: number | null
    chatWebSearchEnabled?: boolean
    chatImageGenerationEnabled?: boolean
    chatImageGenerationModel?: string
    modelIds?: string[]
    connections?: { id: string; name: string }[]
    chatConnectionId?: string | null
    attachedImages?: Image[]
    keybinds?: Keybinds
    showThinkingControls?: boolean
    presets?: Preset[]
    onToggleChatSettings?: () => void
    onCloseChatSettings?: () => void
    onChangeConnection?: (val: string) => void
    onChangeModel?: (val: string) => void
    onChangeStreaming?: (val: boolean) => void
    onChangeMaxOutputTokens?: (val: string) => void
    onChangeTopP?: (val: string) => void
    onChangeTemperature?: (val: string) => void
    onChangeReasoningEffort?: (val: string) => void
    onChangeReasoningSummary?: (val: string) => void
    onChangeTextVerbosity?: (val: string) => void
    onChangeThinkingEnabled?: (val: boolean) => void
    onChangeThinkingBudgetTokens?: (val: string) => void
    onChangeWebSearchEnabled?: (val: boolean) => void
    onChangeImageGenerationEnabled?: (val: boolean) => void
    onChangeImageGenerationModel?: (val: string) => void
    onSelectPreset?: (preset: Preset) => void
    onInput?: (val: string) => void
    onAdd?: (role: MessageRole) => void
    onStop?: () => void
    onSend?: (role: MessageRole) => void
    onFilesSelected?: (files: File[]) => void
    onRemoveImage?: (id: string) => void
  }

  const props: Props = $props()
  let inputEl: HTMLTextAreaElement | undefined
  let fileInputEl: HTMLInputElement | undefined
  let isDragging = $state(false)
  // Auto-grow on mount
  $effect(() => { queueMicrotask(() => autoGrow(inputEl)) })
  // Also auto-grow whenever parent updates the input value (e.g., after send/add clears it)
  $effect(() => { void props.input; queueMicrotask(() => autoGrow(inputEl)) })

  let isInputFocused = $state(false)
  let isMobileViewport = $state(false)
  const hideAuxControls = $derived(isInputFocused && isMobileViewport)

  onMount(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia('(max-width: 640px)')
    const update = () => { isMobileViewport = mql.matches }
    update()
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', update)
      return () => { mql.removeEventListener('change', update) }
    }
    if (typeof mql.addListener === 'function') {
      mql.addListener(update)
      return () => { mql.removeListener(update) }
    }
  })

  function isSupportedAttachment(file) {
    if (!file) return false
    const type = typeof file.type === 'string' ? file.type : ''
    if (type.startsWith('image/')) return true
    if (type.startsWith('video/')) return true
    if (type.startsWith('audio/')) return true
    if (type === 'application/pdf') return true
    if (!type && typeof file.name === 'string') {
      const name = file.name.toLowerCase()
      return name.endsWith('.pdf') || 
             name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mov') || name.endsWith('.avi') ||
             name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.ogg') || name.endsWith('.m4a')
    }
    if (type === 'application/octet-stream' && typeof file.name === 'string') {
      const name = file.name.toLowerCase()
      return name.endsWith('.pdf') || 
             name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mov') || name.endsWith('.avi') ||
             name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.ogg') || name.endsWith('.m4a')
    }
    return false
  }

  function isImageAttachment(attachment) {
    if (!attachment || typeof attachment !== 'object') return false
    const mime = typeof attachment.mimeType === 'string' ? attachment.mimeType : ''
    if (mime.startsWith('image/')) return true
    if (!mime && typeof attachment.name === 'string') {
      return /\.(png|jpe?g|gif|webp)$/i.test(attachment.name)
    }
    return false
  }

  function getAttachmentDisplayName(attachment) {
    if (!attachment || typeof attachment !== 'object') return ''
    if (typeof attachment.name === 'string' && attachment.name.trim()) return attachment.name.trim()
    if (typeof attachment.id === 'string' && attachment.id.trim()) return attachment.id.trim()
    return 'attachment'
  }

  function onKey(e) {
    if (isMobileViewport) return
    if (props.locked) return
    if (e.key !== 'Enter') return

    const keybinds = props.keybinds || { sendMessage: 'Enter', newLine: 'Shift+Enter' }

    // Determine which key combination was pressed
    let pressedKey = 'Enter'
    if (e.shiftKey) pressedKey = 'Shift+Enter'
    else if (e.ctrlKey || e.metaKey) pressedKey = 'Ctrl+Enter'
    else if (e.altKey) pressedKey = 'Alt+Enter'

    // Check if this key combination matches any action
    let action = null
    if (keybinds.sendMessage === pressedKey) action = 'send'
    else if (keybinds.newLine === pressedKey) action = 'newline'

    // Perform the action
    if (action === 'send') {
      e.preventDefault()
      props.onSend?.('user')
    } else if (action === 'newline') {
      // Let default behavior happen (insert newline)
    } else {
      // No action bound to this key combination, prevent default
      e.preventDefault()
    }
  }

  function handleFileSelect(e) {
    const files = e.target.files
    if (files && files.length > 0) {
      const accepted = Array.from(files).filter(isSupportedAttachment)
      if (accepted.length > 0) {
        props.onFilesSelected?.(accepted)
      }
    }
    if (fileInputEl) fileInputEl.value = ''
  }

  function handleDragOver(e) {
    e.preventDefault()
    e.stopPropagation()
    if (!isDragging) isDragging = true
  }

  function handleDragLeave(e) {
    e.preventDefault()
    e.stopPropagation()
    if (isDragging) isDragging = false
  }

  function handleDrop(e) {
    e.preventDefault()
    e.stopPropagation()
    isDragging = false

    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      const acceptedFiles = Array.from(files).filter(isSupportedAttachment)
      if (acceptedFiles.length > 0) {
        props.onFilesSelected?.(acceptedFiles)
      }
    }
  }

  function triggerFileInput() {
    fileInputEl?.click()
  }

  function handlePaste(e) {
    const clipboard = e?.clipboardData
    if (!clipboard) return

    const imageFiles = []
    const items = clipboard.items
    if (items && items.length > 0) {
      for (const item of items) {
        if (!item || item.kind !== 'file') continue
        const file = item.getAsFile?.()
        if (file && typeof file.type === 'string' && file.type.startsWith('image/')) {
          imageFiles.push(file)
        }
      }
    }

    if (imageFiles.length === 0 && clipboard.files?.length > 0) {
      for (const file of Array.from(clipboard.files)) {
        if (file && typeof file.type === 'string' && file.type.startsWith('image/')) {
          imageFiles.push(file)
        }
      }
    }

    if (imageFiles.length === 0) return

    const hasTextData = (() => {
      try {
        if (!clipboard.types) return false
        for (const type of clipboard.types) {
          if (type === 'text/plain' || type === 'text/html') {
            const data = clipboard.getData?.(type)
            if (typeof data === 'string' && data.trim()) return true
          }
        }
      } catch {}
      return false
    })()

    if (!hasTextData) {
      e.preventDefault()
    }

    props.onFilesSelected?.(imageFiles)
  }
</script>

<footer class="composer" class:dragging={isDragging} ondragover={handleDragOver} ondragleave={handleDragLeave} ondrop={handleDrop}>
  <input
    type="file"
    accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,application/pdf,video/mp4,video/webm,video/quicktime,video/x-msvideo,audio/mpeg,audio/wav,audio/ogg,audio/webm,audio/mp4"
    multiple
    style="display: none"
    onchange={handleFileSelect}
    bind:this={fileInputEl}
  />
  <div class="composer-inner" class:mobile-input-focused={hideAuxControls}>
    <div class="chat-settings-slot">
      <ChatSettingsPopover
        open={props.chatSettingsOpen}
        model={props.chatModel}
        streaming={props.chatStreaming}
        maxOutputTokens={props.chatMaxOutputTokens}
        topP={props.chatTopP}
        temperature={props.chatTemperature}
        reasoningEffort={props.chatReasoningEffort}
        reasoningSummary={props.chatReasoningSummary}
        textVerbosity={props.chatTextVerbosity}
        thinkingEnabled={props.chatThinkingEnabled}
        thinkingBudgetTokens={props.chatThinkingBudgetTokens}
        webSearchEnabled={props.chatWebSearchEnabled}
        imageGenerationEnabled={props.chatImageGenerationEnabled}
        imageGenerationModel={props.chatImageGenerationModel}
        modelIds={props.modelIds}
        connections={props.connections}
        connectionId={props.chatConnectionId}
        showThinkingControls={props.showThinkingControls}
        presets={props.presets}
        onToggle={props.onToggleChatSettings}
        onClose={props.onCloseChatSettings}
        onChangeConnection={props.onChangeConnection}
        onInputModel={props.onChangeModel}
        onInputStreaming={props.onChangeStreaming}
        onInputMaxOutputTokens={props.onChangeMaxOutputTokens}
        onInputTopP={props.onChangeTopP}
        onInputTemperature={props.onChangeTemperature}
        onInputReasoningEffort={props.onChangeReasoningEffort}
        onInputReasoningSummary={props.onChangeReasoningSummary}
        onInputTextVerbosity={props.onChangeTextVerbosity}
        onInputThinkingEnabled={props.onChangeThinkingEnabled}
        onInputThinkingBudgetTokens={props.onChangeThinkingBudgetTokens}
        onInputWebSearchEnabled={props.onChangeWebSearchEnabled}
        onInputImageGenerationEnabled={props.onChangeImageGenerationEnabled}
        onInputImageGenerationModel={props.onChangeImageGenerationModel}
        onSelectPreset={props.onSelectPreset}
      />
    </div>

    <button class="icon-btn attachment-btn" onclick={triggerFileInput} disabled={props.locked} aria-label="Attach image" title="Attach image">
      <IconAdd style="font-size: 22px;" />
    </button>

    <div class="input-wrapper">
      {#if props.attachedImages && props.attachedImages.length > 0}
        <div class="image-previews">
          {#each props.attachedImages as img (img.id)}
            <div class={`attachment-preview ${isImageAttachment(img) ? 'image' : 'file'}`}>
              {#if img?.data}
                {#if isImageAttachment(img)}
                  <img src={`data:${img.mimeType || 'image/png'};base64,${img.data}`} alt={img.name || img.id || 'Attached image'} />
                {:else}
                  <a
                    class="file-chip"
                    href={`data:${img.mimeType || 'application/pdf'};base64,${img.data}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={getAttachmentDisplayName(img)}
                  >
                    <span class="file-chip-icon">PDF</span>
                    <span class="file-chip-name">{getAttachmentDisplayName(img)}</span>
                  </a>
                {/if}
              {/if}
              <button class="remove-image-btn" onclick={() => props.onRemoveImage?.(img.id)} aria-label="Remove image">
                <IconClose style="font-size: 16px;" />
              </button>
            </div>
          {/each}
        </div>
      {/if}
      <textarea
        class="composer-input"
        rows="1"
        placeholder="Type a message…"
        value={props.input}
        oninput={(e) => { props.onInput?.(e.currentTarget.value); queueMicrotask(() => autoGrow(inputEl)) }}
        onkeydown={onKey}
        onpaste={handlePaste}
        onfocus={() => { isInputFocused = true }}
        onblur={() => { isInputFocused = false }}
        bind:this={inputEl}
      ></textarea>
    </div>

    <!-- Send group (single send button shows the menu on hover/focus) -->
    {#if props.sending}
      <div class="send-group" title="Stop response">
        <button class="float-btn stop-btn" onclick={() => props.onStop?.()} aria-label="Stop response" disabled={!props.onStop}>
          <IconStop style="font-size: 22px;" />
        </button>
      </div>
    {:else}
      <div class="send-group" data-side="top" aria-haspopup="menu" title="Send as">
        <button class="float-btn" onclick={() => props.onSend?.('user')} disabled={props.locked} aria-label="Send">
          <IconSend style="font-size: 22px;" />
        </button>
        <div class="send-menu" role="menu" aria-label="Send as">
          <button role="menuitem" class="menu-item" onclick={() => props.onSend?.('user')} disabled={props.locked} aria-label="Send as user">
            <IconSend style="font-size: 18px;" />
            User
          </button>
          <button role="menuitem" class="menu-item" onclick={() => props.onSend?.('assistant')} disabled={props.locked} aria-label="Send as assistant">
            <IconSend style="font-size: 18px;" />
            Assistant
          </button>
          <button role="menuitem" class="menu-item" onclick={() => props.onSend?.('system')} disabled={props.locked} aria-label="Send as system">
            <IconSend style="font-size: 18px;" />
            System
          </button>
        </div>
      </div>
    {/if}
  </div>
</footer>

<style>
  .composer {
    position: sticky;
    bottom: 0;
    left: 0;
    right: 0;
    background: transparent;
  }
  .composer.dragging::before {
    content: '';
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border: 2px dashed var(--accent);
    border-radius: 12px;
    pointer-events: none;
    z-index: 1;
  }
  .composer-inner {
    max-width: var(--page-max);
    margin-inline: auto;
    padding: 12px 0;
    display: grid;
    grid-template-columns: auto auto 1fr auto;
    align-items: end;
    gap: 14px;
  }
  .icon-btn {
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    min-width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    line-height: 1;
    color: var(--text);
    transition: background-color .15s ease, border-color .15s ease, color .15s ease, transform .1s ease, box-shadow .15s ease;
  }
  .icon-btn:hover:not(:disabled) {
    background: var(--panel);
    border-color: var(--accent);
    color: var(--accent);
  }
  .icon-btn:active:not(:disabled) {
    transform: scale(0.95);
  }
  .icon-btn:disabled {
    opacity: .5;
    cursor: not-allowed;
  }
  .input-wrapper {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .image-previews {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px;
  }
  .attachment-preview {
    position: relative;
    width: 80px;
    height: 80px;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--border);
    background: var(--panel);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .attachment-preview.image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .attachment-preview.file {
    padding: 8px;
  }
  .file-chip {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    text-decoration: none;
    color: var(--text);
    width: 100%;
    height: 100%;
    border-radius: 6px;
    border: 1px dashed var(--border);
    background: color-mix(in srgb, var(--panel), transparent 30%);
    padding: 6px;
    text-align: center;
    font-size: 0.75rem;
    line-height: 1.2;
  }
  .file-chip:hover {
    border-color: var(--accent);
  }
  .file-chip-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 0.75rem;
    padding: 4px 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent), transparent 20%);
    color: var(--accent);
  }
  .file-chip-name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: normal;
    word-break: break-word;
  }
  .remove-image-btn {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    border: none;
    display: grid;
    place-items: center;
    cursor: pointer;
    opacity: 0.8;
    transition: opacity 0.2s;
  }
  .remove-image-btn:hover {
    opacity: 1;
  }
  .composer-input {
    resize: none;
    width: 100%;
    min-height: 44px;
    height: 44px;
    max-height: 240px;
    overflow: hidden;
    overflow-y: hidden;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    line-height: 1.35;
    font: inherit;
    box-sizing: border-box;
    transition: border-color .15s ease, box-shadow .15s ease;
  }
  .composer-input:hover {
    border-color: color-mix(in srgb, var(--border) 70%, var(--accent));
  }
  .composer-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent);
  }
  .float-btn {
    min-width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    border: 1px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, var(--bg));
    color: var(--accent);
    line-height: 1;
    transition: background-color .15s ease, border-color .15s ease, color .15s ease, transform .1s ease, box-shadow .15s ease;
    box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 15%, transparent);
  }
  .float-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 20%, var(--bg));
    border-color: var(--accent);
    box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 25%, transparent);
  }
  .float-btn:active:not(:disabled) {
    transform: scale(0.95);
    box-shadow: 0 1px 4px color-mix(in srgb, var(--accent) 15%, transparent);
  }
  .float-btn:disabled { background: var(--bg); border-color: var(--muted); color: var(--muted); cursor: not-allowed; opacity: 0.6; box-shadow: none; }
  .stop-btn { background: #ef4444; border-color: #ef4444; color: #fff; box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3); }
  .stop-btn:hover:not(:disabled) { background: #dc2626; border-color: #dc2626; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4); }
  .stop-btn:active:not(:disabled) { box-shadow: 0 1px 4px rgba(239, 68, 68, 0.25); }
  .send-group { position: relative; display: grid; place-items: center; z-index: 0; }
  .send-group::before { content: ''; position: absolute; left: 50%; transform: translateX(-50%); width: max(100%, 44px); height: 16px; pointer-events: none; }
  .send-group:not([data-side])::before { display: none; }
  .send-group[data-side="top"]::before { bottom: 100%; }
  .send-group:hover::before, .send-group:focus-within::before { pointer-events: auto; }
  .send-group:hover, .send-group:focus-within { z-index: 20; }
  .send-menu {
    position: absolute;
    bottom: calc(100% + 10px);
    right: 0;
    display: grid;
    gap: 6px;
    padding: 10px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    opacity: 0;
    pointer-events: none;
    min-width: 160px;
    z-index: 10;
  }
  :global(:root[data-fancy-effects="true"]) .send-menu {
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15), 0 2px 8px rgba(0, 0, 0, 0.1);
    transform: translateY(8px) scale(0.96);
    transition: opacity .15s ease, transform .15s ease;
  }
  .send-group:hover .send-menu, .send-group:focus-within .send-menu { opacity: 1; pointer-events: auto; }
  :global(:root[data-fancy-effects="true"]) .send-group:hover .send-menu,
  :global(:root[data-fancy-effects="true"]) .send-group:focus-within .send-menu { transform: translateY(0) scale(1); }
  .menu-item {
    width: 100%;
    text-align: left;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    padding: 8px 12px;
    font: inherit;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: background-color .12s ease, border-color .12s ease, color .12s ease, transform .1s ease;
  }
  .menu-item:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border-color: var(--accent);
    color: var(--accent);
  }
  .menu-item:active:not(:disabled) {
    transform: scale(0.98);
  }
  .menu-item:disabled { opacity: .5; cursor: not-allowed; }
  .chat-settings-slot { display: grid; place-items: center; }

  @media (max-width: 640px) {
    .composer-inner.mobile-input-focused {
      grid-template-columns: 1fr auto;
      gap: 10px;
    }
    .composer-inner.mobile-input-focused .chat-settings-slot,
    .composer-inner.mobile-input-focused .attachment-btn {
      display: none;
    }
    .composer-inner.mobile-input-focused .chat-settings-group {
      display: none;
    }
    .composer-input::placeholder {
      color: transparent;
      opacity: 0;
    }
  }
</style>

<script>
  import { IconAdd, IconClose, IconAddComment, IconPerson, IconSmartToy, IconTune, IconStop, IconSend } from '../../icons.js'
  import { autoGrow } from '../../utils/dom.js'
  import ChatSettingsPopover from './ChatSettingsPopover.svelte'
  import { onMount } from 'svelte'
  const props = $props()
  let inputEl
  let fileInputEl
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
      props.onFilesSelected?.(Array.from(files))
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
      const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'))
      if (imageFiles.length > 0) {
        props.onFilesSelected?.(imageFiles)
      }
    }
  }

  function triggerFileInput() {
    fileInputEl?.click()
  }
</script>

<footer class="composer" class:dragging={isDragging} ondragover={handleDragOver} ondragleave={handleDragLeave} ondrop={handleDrop}>
  <input
    type="file"
    accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
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
        modelIds={props.modelIds}
        connections={props.connections}
        connectionId={props.chatConnectionId}
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
      />
    </div>

    <button class="icon-btn" onclick={triggerFileInput} disabled={props.locked} aria-label="Attach image" title="Attach image">
      <IconAdd style="font-size: 22px;" />
    </button>

    <div class="input-wrapper">
      {#if props.attachedImages && props.attachedImages.length > 0}
        <div class="image-previews">
          {#each props.attachedImages as img (img.id)}
            <div class="image-preview">
              <img src={`data:${img.mimeType};base64,${img.data}`} alt={img.name || 'Attached image'} />
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
        onfocus={() => { isInputFocused = true }}
        onblur={() => { isInputFocused = false }}
        bind:this={inputEl}
      ></textarea>
    </div>

    <div class="send-group add-group" aria-haspopup="menu" title="Add to chat as">
      <button class="float-btn" onclick={() => props.onAdd?.('user')} disabled={props.locked} aria-label="Add to chat">
        <IconAddComment style="font-size: 22px;" />
      </button>
      <div class="send-menu" role="menu" aria-label="Add to chat as">
        <button role="menuitem" class="menu-item" onclick={() => props.onAdd?.('user')} disabled={props.locked} aria-label="Add as user">
          <IconPerson style="font-size: 18px;" />
          User
        </button>
        <button role="menuitem" class="menu-item" onclick={() => props.onAdd?.('assistant')} disabled={props.locked} aria-label="Add as assistant">
          <IconSmartToy style="font-size: 18px;" />
          Assistant
        </button>
        <button role="menuitem" class="menu-item" onclick={() => props.onAdd?.('system')} disabled={props.locked} aria-label="Add as system">
          <IconTune style="font-size: 18px;" />
          System
        </button>
      </div>
    </div>

    <!-- Send group (single send button shows the menu on hover/focus) -->
    {#if props.sending}
      <div class="send-group" title="Stop response">
        <button class="float-btn stop-btn" onclick={() => props.onStop?.()} aria-label="Stop response" disabled={!props.onStop}>
          <IconStop style="font-size: 22px;" />
        </button>
      </div>
    {:else}
      <div class="send-group" aria-haspopup="menu" title="Send as">
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
    grid-template-columns: auto auto 1fr auto auto;
    align-items: end;
    gap: 14px;
  }
  .icon-btn {
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    min-width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    line-height: 1;
    color: var(--text);
  }
  .icon-btn:disabled {
    opacity: .6;
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
  .image-preview {
    position: relative;
    width: 80px;
    height: 80px;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--border);
  }
  .image-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
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
    padding: 12px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    line-height: 1.35;
    font: inherit;
    box-sizing: border-box;
  }
  .float-btn {
    min-width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    border: none;
    background: var(--accent);
    color: #fff;
    line-height: 1;
    transition: background-color .15s ease, color .15s ease, border-color .15s ease, opacity .15s ease;
  }
  .float-btn:disabled { background: #1f2937; color: #ffffff; cursor: not-allowed; }
  .stop-btn { background: #ef4444; }
  .stop-btn:hover,
  .stop-btn:focus-visible { background: #dc2626; }
  .send-group { position: relative; display: grid; place-items: center; z-index: 0; }
  .send-group::before { content: ''; position: absolute; right: 0; bottom: 100%; width: 220px; height: 12px; }
  .send-group:hover, .send-group:focus-within { z-index: 20; }
  .send-menu { position: absolute; bottom: calc(100% + 10px); right: 0; display: grid; gap: 6px; padding: 8px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--float-shadow); opacity: 0; transform: translateY(6px); transition: opacity .12s ease, transform .12s ease; pointer-events: none; min-width: 160px; z-index: 10; }
  .send-group:hover .send-menu, .send-group:focus-within .send-menu { opacity: 1; transform: translateY(0); pointer-events: auto; }
  .menu-item { width: 100%; text-align: left; background: transparent; border: 1px solid var(--border); border-radius: 8px; color: var(--text); padding: 8px 10px; font: inherit; display: flex; align-items: center; gap: 8px; }
  .menu-item:disabled { opacity: .6; cursor: not-allowed; }
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
    .composer-inner.mobile-input-focused .chat-settings-group,
    .composer-inner.mobile-input-focused .add-group {
      display: none;
    }
    .composer-input::placeholder {
      color: transparent;
      opacity: 0;
    }
  }
</style>

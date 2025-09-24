<script>
  import Icon from '../../Icon.svelte'
  import { autoGrow } from '../../utils/dom.js'
  import ChatSettingsPopover from './ChatSettingsPopover.svelte'
  const props = $props()
  let inputEl
  // Auto-grow on mount
  $effect(() => { queueMicrotask(() => autoGrow(inputEl)) })
  // Also auto-grow whenever parent updates the input value (e.g., after send/add clears it)
  $effect(() => { void props.input; queueMicrotask(() => autoGrow(inputEl)) })

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (props.locked) return
      e.preventDefault()
      props.onSend?.('user')
    }
  }
</script>

<footer class="composer">
  <div class="composer-inner">
    <ChatSettingsPopover
      open={props.chatSettingsOpen}
      disabled={props.locked}
      model={props.chatModel}
      streaming={props.chatStreaming}
      maxOutputTokens={props.chatMaxOutputTokens}
      topP={props.chatTopP}
      temperature={props.chatTemperature}
      reasoningEffort={props.chatReasoningEffort}
      reasoningSummary={props.chatReasoningSummary}
      textVerbosity={props.chatTextVerbosity}
      modelIds={props.modelIds}
      onToggle={props.onToggleChatSettings}
      onClose={props.onCloseChatSettings}
      onInputModel={props.onChangeModel}
      onInputStreaming={props.onChangeStreaming}
      onInputMaxOutputTokens={props.onChangeMaxOutputTokens}
      onInputTopP={props.onChangeTopP}
      onInputTemperature={props.onChangeTemperature}
      onInputReasoningEffort={props.onChangeReasoningEffort}
      onInputReasoningSummary={props.onChangeReasoningSummary}
      onInputTextVerbosity={props.onChangeTextVerbosity}
    />

    <textarea
      class="composer-input"
      rows="1"
      placeholder="Type a message…"
      value={props.input}
      oninput={(e) => { props.onInput?.(e.currentTarget.value); queueMicrotask(() => autoGrow(inputEl)) }}
      onkeydown={onKey}
      bind:this={inputEl}
    ></textarea>

    <div class="send-group" aria-haspopup="menu" title="Add to chat as">
      <button class="float-btn" onclick={() => props.onAdd?.('user')} disabled={props.locked} aria-label="Add to chat">
        <Icon name="add_comment" size={22} />
      </button>
      <div class="send-menu" role="menu" aria-label="Add to chat as">
        <button role="menuitem" class="menu-item" onclick={() => props.onAdd?.('user')} disabled={props.locked} aria-label="Add as user">
          <Icon name="person" size={18} />
          User
        </button>
        <button role="menuitem" class="menu-item" onclick={() => props.onAdd?.('assistant')} disabled={props.locked} aria-label="Add as assistant">
          <Icon name="smart_toy" size={18} />
          Assistant
        </button>
        <button role="menuitem" class="menu-item" onclick={() => props.onAdd?.('system')} disabled={props.locked} aria-label="Add as system">
          <Icon name="tune" size={18} />
          System
        </button>
      </div>
    </div>

    <!-- Send group (single send button shows the menu on hover/focus) -->
    {#if props.sending}
      <div class="send-group" title="Stop response">
        <button class="float-btn stop-btn" onclick={() => props.onStop?.()} aria-label="Stop response" disabled={!props.onStop}>
          <Icon name="stop" size={22} />
        </button>
      </div>
    {:else}
      <div class="send-group" aria-haspopup="menu" title="Send as">
        <button class="float-btn" onclick={() => props.onSend?.('user')} disabled={props.locked} aria-label="Send">
          <Icon name="send" size={22} />
        </button>
        <div class="send-menu" role="menu" aria-label="Send as">
          <button role="menuitem" class="menu-item" onclick={() => props.onSend?.('user')} disabled={props.locked} aria-label="Send as user">
            <Icon name="send" size={18} />
            User
          </button>
          <button role="menuitem" class="menu-item" onclick={() => props.onSend?.('assistant')} disabled={props.locked} aria-label="Send as assistant">
            <Icon name="send" size={18} />
            Assistant
          </button>
          <button role="menuitem" class="menu-item" onclick={() => props.onSend?.('system')} disabled={props.locked} aria-label="Send as system">
            <Icon name="send" size={18} />
            System
          </button>
        </div>
      </div>
    {/if}
  </div>
</footer>

<style>
  .composer { position: sticky; bottom: 0; left: 0; right: 0; background: transparent; }
  .composer-inner {
    max-width: var(--page-max);
    margin-inline: auto;
    padding: 12px 0;
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    gap: 14px;
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
</style>

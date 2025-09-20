<script>
  import Icon from '../../Icon.svelte'
  import { autoGrow } from '../../utils/dom.js'
  import ChatSettingsPopover from './ChatSettingsPopover.svelte'
  const props = $props()
  let inputEl
  $effect(() => { queueMicrotask(() => autoGrow(inputEl)) })

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      props.onSend?.('user')
    }
  }
</script>

<footer class="composer">
  <div class="composer-inner">
    <ChatSettingsPopover
      open={props.chatSettingsOpen}
      model={props.chatModel}
      modelIds={props.modelIds}
      onToggle={props.onToggleChatSettings}
      onClose={props.onCloseChatSettings}
      onInputModel={props.onChangeModel}
    />

    <textarea
      class="input"
      rows="1"
      placeholder="Message..."
      value={props.input}
      oninput={(e) => { props.onInput?.(e.currentTarget.value); queueMicrotask(() => autoGrow(inputEl)) }}
      onkeydown={onKey}
      bind:this={inputEl}
    ></textarea>

    <div class="send-group" aria-haspopup="menu" title="Add to chat as">
      <button class="float-btn" onclick={() => props.onAdd?.('user')} disabled={!props.input?.trim()} aria-label="Add to chat">
        <Icon name="add_comment" size={22} />
      </button>
      <div class="send-menu" role="menu" aria-label="Add to chat as">
        <button role="menuitem" class="menu-item" onclick={() => props.onAdd?.('user')} disabled={!props.input?.trim()} aria-label="Add as user">
          <Icon name="person" size={18} />
          User
        </button>
        <button role="menuitem" class="menu-item" onclick={() => props.onAdd?.('assistant')} disabled={!props.input?.trim()} aria-label="Add as assistant">
          <Icon name="smart_toy" size={18} />
          Assistant
        </button>
        <button role="menuitem" class="menu-item" onclick={() => props.onAdd?.('system')} disabled={!props.input?.trim()} aria-label="Add as system">
          <Icon name="tune" size={18} />
          System
        </button>
      </div>
    </div>

    <div class="send-group" aria-haspopup="menu" title="Send as">
      <button class="icon-btn" aria-label="Send as">
        <Icon name="unfold_more" size={22} />
      </button>
      <div class="send-menu" role="menu" aria-label="Send as">
        <button role="menuitem" class="menu-item" onclick={() => props.onSend?.('user')} disabled={!props.input?.trim() || props.sending} aria-label="Send as user">
          <Icon name="send" size={18} />
          User
        </button>
        <button role="menuitem" class="menu-item" onclick={() => props.onSend?.('assistant')} disabled={!props.input?.trim() || props.sending} aria-label="Send as assistant">
          <Icon name="send" size={18} />
          Assistant
        </button>
        <button role="menuitem" class="menu-item" onclick={() => props.onSend?.('system')} disabled={!props.input?.trim() || props.sending} aria-label="Send as system">
          <Icon name="send" size={18} />
          System
        </button>
      </div>
    </div>

    <button class="float-btn" title="Send" aria-label="Send" onclick={() => props.onSend?.('user')} disabled={!props.input?.trim() || props.sending}>
      <Icon name="send" size={22} />
    </button>
  </div>
</footer>

<style>
  .composer { position: sticky; bottom: 0; left: 0; right: 0; background: var(--bg); }
  .composer-inner {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    gap: 10px;
    padding: 10px 0 12px;
    max-width: var(--page-max);
    margin-inline: auto;
  }
  .icon-btn { border: 1px solid var(--border); border-radius: 10px; background: transparent; min-width: 44px; height: 44px; display: grid; place-items: center; line-height: 1; }
  .input {
    min-height: 44px;
    max-height: 240px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--text);
    resize: none;
    overflow: hidden;
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
  }
  .float-btn:disabled { background: #9ca3af; color: #ffffff; cursor: not-allowed; }
  .send-group { position: relative; display: grid; place-items: center; z-index: 0; }
  .send-group::before { content: ''; position: absolute; right: 0; bottom: 100%; width: 220px; height: 12px; }
  .send-group:hover, .send-group:focus-within { z-index: 20; }
  .send-menu { position: absolute; bottom: calc(100% + 10px); right: 0; display: grid; gap: 6px; padding: 8px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--float-shadow); opacity: 0; transform: translateY(6px); transition: opacity .12s ease, transform .12s ease; pointer-events: none; min-width: 160px; z-index: 10; }
  .send-group:hover .send-menu, .send-group:focus-within .send-menu { opacity: 1; transform: translateY(0); pointer-events: auto; }
  .menu-item { width: 100%; text-align: left; background: transparent; border: 1px solid var(--border); border-radius: 8px; color: var(--text); padding: 8px 10px; font: inherit; display: flex; align-items: center; gap: 8px; }
  .menu-item:disabled { opacity: .6; cursor: not-allowed; }
</style>

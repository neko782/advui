<script>
  const props = $props()
  let root

  // Close when clicking outside or pressing Escape
  $effect(() => {
    function onDocClick(e) {
      try { if (props.open && root && !root.contains(e.target)) props.onClose?.() } catch {}
    }
    function onKeydown(e) { if (e.key === 'Escape' && props.open) props.onClose?.() }
    window.addEventListener('click', onDocClick, true)
    window.addEventListener('keydown', onKeydown)
    return () => {
      window.removeEventListener('click', onDocClick, true)
      window.removeEventListener('keydown', onKeydown)
    }
  })
</script>

<div class={`chat-settings-group ${props.open ? 'open' : ''}`} bind:this={root}>
  <button class="icon-btn" aria-label="Chat settings" disabled={props.disabled} onclick={() => (!props.disabled && props.onToggle?.())}>
    <span class="material-symbols-rounded icon">tune</span>
  </button>
  <div class="send-menu chat-settings-menu" role="menu" aria-label="Chat settings">
    <!-- Connection comes first so people can quickly switch APIs -->
    <div class="menu-section">
      <div class="menu-label">Connection</div>
      <select
        value={props.connectionId || ''}
        disabled={props.disabled}
        onchange={(e) => (!props.disabled && props.onChangeConnection?.(e.currentTarget.value))}
        aria-label="Connection"
      >
        {#each (props.connections || []) as conn (conn?.id || conn?.name)}
          <option value={conn?.id || ''}>{conn?.name || conn?.id || 'Connection'}</option>
        {/each}
      </select>
    </div>
    <!-- Remaining chat settings follow the preset menu order -->
    <div class="menu-section">
      <div class="menu-label">Text verbosity</div>
      <select
        value={props.textVerbosity || 'medium'}
        disabled={props.disabled}
        onchange={(e) => (!props.disabled && props.onInputTextVerbosity?.(e.currentTarget.value))}
        aria-label="Text verbosity"
      >
        <option value="low">low</option>
        <option value="medium">medium</option>
        <option value="high">high</option>
      </select>
    </div>
    <div class="menu-section">
      <div class="menu-label">Reasoning summary</div>
      <select
        value={props.reasoningSummary || 'auto'}
        disabled={props.disabled}
        onchange={(e) => (!props.disabled && props.onInputReasoningSummary?.(e.currentTarget.value))}
        aria-label="Reasoning summary"
      >
        <option value="auto">auto</option>
        <option value="concise">concise</option>
        <option value="detailed">detailed</option>
      </select>
    </div>
    <div class="menu-section">
      <div class="menu-label">Reasoning effort</div>
      <select
        value={props.reasoningEffort || 'none'}
        disabled={props.disabled}
        onchange={(e) => (!props.disabled && props.onInputReasoningEffort?.(e.currentTarget.value))}
        aria-label="Reasoning effort"
      >
        <option value="none">none</option>
        <option value="minimal">minimal</option>
        <option value="low">low</option>
        <option value="medium">medium</option>
        <option value="high">high</option>
      </select>
    </div>
    <div class="menu-section">
      <div class="menu-label">Temperature</div>
      <input
        type="number"
        min="0"
        max="2"
        step="0.1"
        placeholder="Default"
        value={props.temperature ?? ''}
        disabled={props.disabled}
        oninput={(e) => (!props.disabled && props.onInputTemperature?.(e.currentTarget.value))}
        aria-label="Temperature"
      />
    </div>
    <div class="menu-section">
      <div class="menu-label">Top P</div>
      <input
        type="number"
        min="0"
        max="1"
        step="0.1"
        placeholder="Default"
        value={props.topP ?? ''}
        disabled={props.disabled}
        oninput={(e) => (!props.disabled && props.onInputTopP?.(e.currentTarget.value))}
        aria-label="top_p"
      />
    </div>
    <div class="menu-section">
      <div class="menu-label">Max output tokens</div>
      <input
        type="number"
        min="1"
        step="1024"
        placeholder="Auto"
        value={props.maxOutputTokens ?? ''}
        disabled={props.disabled}
        oninput={(e) => (!props.disabled && props.onInputMaxOutputTokens?.(e.currentTarget.value))}
        aria-label="Max output tokens"
      />
    </div>
    <div class="menu-section">
      <label class="switch" title="Stream">
        <input
          type="checkbox"
          checked={!!props.streaming}
          disabled={props.disabled}
          onchange={(e) => (!props.disabled && props.onInputStreaming?.(e.currentTarget.checked))}
          aria-label="Stream"
        />
        <span class="switch-ui" aria-hidden="true"></span>
        <span class="switch-label">Stream</span>
      </label>
    </div>
    <div class="menu-section">
      <div class="menu-label">Model</div>
      <input
        type="text"
        placeholder="gpt-5"
        value={props.model}
        disabled={props.disabled}
        oninput={(e) => (!props.disabled && props.onInputModel?.(e.currentTarget.value))}
        list="model-suggestions"
        aria-label="Model"
      />
      {#if props.modelIds?.length}
        <datalist id="model-suggestions">
          {#each props.modelIds as mid}
            <option value={mid}>{mid}</option>
          {/each}
        </datalist>
      {/if}
    </div>
  </div>
</div>

<style>
  .icon-btn { border: 1px solid var(--border); border-radius: 10px; background: transparent; min-width: 44px; height: 44px; display: grid; place-items: center; line-height: 1; }
  .icon-btn:disabled { opacity: .6; cursor: not-allowed; }
  .icon { font-size: 22px; }
  .chat-settings-menu { min-width: 260px; gap: 12px; padding: 12px; }
  .menu-section { display: grid; gap: 8px; }
  .menu-label { font-size: .9rem; color: var(--muted); }
  input[type="text"],
  input[type="number"],
  select {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    box-sizing: border-box;
  }
  /* Toggle switch */
  .switch { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; }
  .switch > input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
  .switch-ui { width: 38px; height: 22px; border-radius: 999px; background: var(--border); position: relative; transition: background-color .15s ease; box-shadow: inset 0 0 0 1px var(--border); }
  .switch-ui::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.15); transition: transform .15s ease, background-color .15s ease; }
  @media (prefers-color-scheme: dark) {
    .switch-ui { background: #2a2a2a; box-shadow: inset 0 0 0 1px #2f2f2f; }
    .switch-ui::after { background: #e6e6e6; }
  }
  .switch > input:checked + .switch-ui { background: color-mix(in srgb, var(--accent), #0000 70%); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent), #0000 60%); }
  .switch > input:checked + .switch-ui::after { transform: translateX(16px); }
  .switch-label { font-size: .95rem; }
  .chat-settings-group { position: relative; display: grid; place-items: center; }
  .chat-settings-menu {
    display: grid;
    gap: 12px;
    position: absolute;
    top: auto;
    bottom: calc(100% + 10px);
    left: 8px;
    right: auto;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--float-shadow);
    opacity: 0;
    transform: translateY(6px);
    transition: opacity .12s ease, transform .12s ease;
    pointer-events: none;
    z-index: 20;
  }
  .chat-settings-group.open .chat-settings-menu { opacity: 1; pointer-events: auto; transform: translateY(0); }
  .chat-settings-group::before { content: ''; position: absolute; left: 0; bottom: 100%; width: 220px; height: 12px; }
</style>

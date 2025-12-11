<script lang="ts">
  import { IconTune, IconLayers } from '../../icons'
  import type { Preset, ReasoningEffort, TextVerbosity, ReasoningSummary } from '../../types'

  interface Props {
    open?: boolean
    disabled?: boolean
    model?: string
    streaming?: boolean
    maxOutputTokens?: number | null
    topP?: number | null
    temperature?: number | null
    reasoningEffort?: ReasoningEffort
    reasoningSummary?: ReasoningSummary
    textVerbosity?: TextVerbosity
    thinkingEnabled?: boolean
    thinkingBudgetTokens?: number | null
    webSearchEnabled?: boolean
    modelIds?: string[]
    connections?: { id: string; name: string }[]
    connectionId?: string | null
    showThinkingControls?: boolean
    presets?: Preset[]
    onToggle?: () => void
    onClose?: () => void
    onChangeConnection?: (val: string) => void
    onInputModel?: (val: string) => void
    onInputStreaming?: (val: boolean) => void
    onInputMaxOutputTokens?: (val: string) => void
    onInputTopP?: (val: string) => void
    onInputTemperature?: (val: string) => void
    onInputReasoningEffort?: (val: string) => void
    onInputReasoningSummary?: (val: string) => void
    onInputTextVerbosity?: (val: string) => void
    onInputThinkingEnabled?: (val: boolean) => void
    onInputThinkingBudgetTokens?: (val: string) => void
    onInputWebSearchEnabled?: (val: boolean) => void
    onSelectPreset?: (preset: Preset) => void
  }

  const props: Props = $props()
  let root: HTMLDivElement | undefined
  let menu: HTMLDivElement | undefined
  let wasOpen = false
  let activeTab = $state<'general' | 'sampling' | 'reasoning'>('general')
  let presetMenuOpen = $state(false)
  let presetMenuEl = $state<HTMLDivElement | null>(null)
  let presetButtonEl = $state<HTMLButtonElement | null>(null)
  let presetMenuPosition = $state({ bottom: 0, left: 0 })

  function togglePresetMenu() {
    if (!presetMenuOpen && presetButtonEl) {
      const rect = presetButtonEl.getBoundingClientRect()
      const menuWidth = 220 // min-width from CSS
      const padding = 8

      // Calculate position, checking if it would overflow
      let leftPos = rect.left

      // If menu would overflow right side, align to right edge instead
      if (leftPos + menuWidth > window.innerWidth - padding) {
        leftPos = rect.right - menuWidth
        // If still overflowing on left, align to padding from right edge
        if (leftPos < padding) {
          leftPos = window.innerWidth - menuWidth - padding
        }
      }

      presetMenuPosition = {
        bottom: window.innerHeight - rect.top + 4,
        left: Math.max(padding, leftPos)
      }
    }
    presetMenuOpen = !presetMenuOpen
  }

  function closePresetMenu() {
    presetMenuOpen = false
  }

  function selectPreset(preset) {
    closePresetMenu()
    props.onSelectPreset?.(preset)
  }

  // Close when clicking outside or pressing Escape
  $effect(() => {
    function onDocClick(e) {
      try {
        // Check if click is on preset menu (which is rendered outside root)
        const isInPresetMenu = presetMenuEl && presetMenuEl.contains(e.target)
        const isPresetWrapper = e.target.closest('.preset-toggle-wrapper')

        // Close settings if clicked outside, but not if clicking preset menu
        if (props.open && root && !root.contains(e.target) && !isInPresetMenu && !isPresetWrapper) {
          props.onClose?.()
        }

        // Close preset menu if clicked outside both the menu and the button
        if (presetMenuOpen && !isInPresetMenu && !isPresetWrapper) {
          closePresetMenu()
        }
      } catch {}
    }
    function onKeydown(e) {
      if (e.key === 'Escape') {
        if (presetMenuOpen) {
          closePresetMenu()
        } else if (props.open) {
          props.onClose?.()
        }
      }
    }
    window.addEventListener('click', onDocClick, true)
    window.addEventListener('keydown', onKeydown)
    return () => {
      window.removeEventListener('click', onDocClick, true)
      window.removeEventListener('keydown', onKeydown)
    }
  })

  $effect(() => {
    wasOpen = !!props.open
  })
</script>

<div class={`chat-settings-group ${props.open ? 'open' : ''}`} bind:this={root}>
  <button class="icon-btn" aria-label="Chat settings" disabled={props.disabled} onclick={() => (!props.disabled && props.onToggle?.())}>
    <IconTune style="font-size: 22px;" />
  </button>
  <div class="send-menu chat-settings-menu" role="menu" aria-label="Chat settings" bind:this={menu}>
    <!-- Tab content -->
    <div class="tab-content">
      {#if activeTab === 'general'}
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
          <label class="switch" title="Web search">
            <input
              type="checkbox"
              checked={!!props.webSearchEnabled}
              disabled={props.disabled}
              onchange={(e) => (!props.disabled && props.onInputWebSearchEnabled?.(e.currentTarget.checked))}
              aria-label="Web search"
            />
            <span class="switch-ui" aria-hidden="true"></span>
            <span class="switch-label">Web search</span>
          </label>
        </div>
        <div class="menu-section">
          <div class="menu-label">Text verbosity</div>
          <select
            value={props.textVerbosity || 'medium'}
            disabled={props.disabled}
            onchange={(e) => (!props.disabled && props.onInputTextVerbosity?.(e.currentTarget.value))}
            aria-label="Text verbosity"
          >
            <option value="none">none</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </div>
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
      {:else if activeTab === 'sampling'}
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
      {:else if activeTab === 'reasoning'}
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
            <option value="xhigh">xhigh</option>
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
            <option value="none">none</option>
            <option value="auto">auto</option>
            <option value="concise">concise</option>
            <option value="detailed">detailed</option>
          </select>
        </div>
        {#if props.showThinkingControls}
          <div class="menu-section">
            <label class="switch" title="Enable Anthropic thinking">
              <input
                type="checkbox"
                checked={!!props.thinkingEnabled}
                disabled={props.disabled}
                onchange={(e) => (!props.disabled && props.onInputThinkingEnabled?.(e.currentTarget.checked))}
                aria-label="Enable Anthropic thinking"
              />
              <span class="switch-ui" aria-hidden="true"></span>
              <span class="switch-label">Anthropic thinking</span>
            </label>
            <input
              type="number"
              min="1"
              step="100"
              placeholder="Budget tokens"
              value={props.thinkingBudgetTokens ?? ''}
              disabled={props.disabled || !props.thinkingEnabled}
              oninput={(e) => (!props.disabled && props.onInputThinkingBudgetTokens?.(e.currentTarget.value))}
              aria-label="Thinking budget tokens"
            />
          </div>
        {/if}
      {/if}
    </div>

    <!-- Tabs -->
    <div class="settings-tabs" role="tablist">
      <button
        class={`settings-tab ${activeTab === 'general' ? 'active' : ''}`}
        role="tab"
        aria-selected={activeTab === 'general'}
        onclick={() => activeTab = 'general'}
      >General</button>
      <button
        class={`settings-tab ${activeTab === 'sampling' ? 'active' : ''}`}
        role="tab"
        aria-selected={activeTab === 'sampling'}
        onclick={() => activeTab = 'sampling'}
      >Sampling</button>
      <button
        class={`settings-tab ${activeTab === 'reasoning' ? 'active' : ''}`}
        role="tab"
        aria-selected={activeTab === 'reasoning'}
        onclick={() => activeTab = 'reasoning'}
      >Reasoning</button>
    </div>

    <!-- Model -->
    <div class="menu-section">
      <div class="menu-label">Model</div>
      <div class="model-input-wrapper">
        <input
          type="text"
          placeholder="gpt-5"
          value={props.model}
          disabled={props.disabled}
          oninput={(e) => (!props.disabled && props.onInputModel?.(e.currentTarget.value))}
          list="model-suggestions"
          aria-label="Model"
        />
        {#if Array.isArray(props.presets) && props.presets.length > 0}
          <div class="preset-toggle-wrapper">
            <button
              type="button"
              class="preset-toggle-btn"
              bind:this={presetButtonEl}
              onclick={togglePresetMenu}
              disabled={props.disabled}
              aria-label="Switch preset"
              title="Switch preset"
            >
              <IconLayers style="font-size: 18px;" />
            </button>
          </div>
        {/if}
      </div>
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

{#if presetMenuOpen}
  <div
    class="preset-menu"
    bind:this={presetMenuEl}
    aria-label="Choose preset"
    style="bottom: {presetMenuPosition.bottom}px; left: {presetMenuPosition.left}px;"
  >
    {#each (props.presets || []) as preset (preset.id || preset.name)}
      <button
        type="button"
        class="preset-menu-item"
        onclick={() => selectPreset(preset)}
      >
        <span class="preset-menu-name">{preset?.name || 'Preset'}</span>
        <span class="preset-menu-model">{preset?.model || ''}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .icon-btn { border: 1px solid var(--border); border-radius: 10px; background: transparent; min-width: 44px; height: 44px; display: grid; place-items: center; line-height: 1; }
  .icon-btn:disabled { opacity: .6; cursor: not-allowed; }
  .icon { font-size: 22px; }
  .chat-settings-menu { min-width: 270px; padding: 14px; }
  .menu-section { display: grid; gap: 6px; margin-bottom: 10px; }
  .menu-label { font-size: .9rem; color: var(--muted); font-weight: 500; }
  .group-divider { height: 1px; background: var(--border); margin: 4px 0; }

  /* Tab styles */
  .settings-tabs {
    display: flex;
    gap: 2px;
    margin: 6px 0 10px;
    background: var(--bg);
    border-radius: 8px;
    padding: 3px;
  }
  .settings-tab {
    flex: 1;
    padding: 6px 10px;
    font-size: .8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    border: none;
    background: transparent;
    color: var(--muted);
    border-radius: 6px;
    cursor: pointer;
    transition: background-color .15s ease, color .15s ease;
    user-select: none;
  }
  .settings-tab:hover {
    color: var(--text);
  }
  .settings-tab.active {
    background: var(--panel);
    color: var(--text);
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }
  .tab-content > .menu-section:last-child {
    margin-bottom: 0;
  }
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
    transition: border-color .15s ease;
  }
  input[type="text"]:focus,
  input[type="number"]:focus,
  select:focus {
    outline: none;
    border-color: var(--accent);
  }
  /* Toggle switch */
  .switch { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; }
  .switch > input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
  .switch-ui { width: 38px; height: 22px; border-radius: 999px; background: var(--border); position: relative; transition: background-color .15s ease; box-shadow: inset 0 0 0 1px var(--border); }
  .switch-ui::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.15); transition: transform .15s ease, background-color .15s ease; }
  :global(:root[data-theme='dark']) .switch-ui { background: #2a2a2a; box-shadow: inset 0 0 0 1px #2f2f2f; }
  :global(:root[data-theme='dark']) .switch-ui::after { background: #e6e6e6; }
  .switch > input:checked + .switch-ui { background: color-mix(in srgb, var(--accent), #0000 70%); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent), #0000 60%); }
  .switch > input:checked + .switch-ui::after { transform: translateX(16px); }
  .switch-label { font-size: .95rem; }
  .chat-settings-group { position: relative; display: grid; place-items: center; }
  .chat-settings-menu {
    display: grid;
    gap: 0;
    position: absolute;
    top: auto;
    bottom: calc(100% + 10px);
    left: 8px;
    right: auto;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--float-shadow);
    max-height: calc(100vh - 120px);
    overflow-y: auto;
    overscroll-behavior: contain;
    opacity: 0;
    transform: translateY(6px);
    transition: opacity .12s ease, transform .12s ease;
    pointer-events: none;
    z-index: 20;
  }
  .chat-settings-group.open .chat-settings-menu { opacity: 1; pointer-events: auto; transform: translateY(0); }
  .chat-settings-group::before { content: ''; position: absolute; left: 0; bottom: 100%; width: 220px; height: 12px; }

  /* Model section with preset button */
  .model-input-wrapper {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 6px;
    align-items: center;
  }
  .model-input-wrapper > input {
    min-width: 0;
  }
  .preset-toggle-wrapper {
    position: relative;
  }
  .preset-toggle-btn {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
    transition: background-color .15s ease, border-color .15s ease;
    flex-shrink: 0;
  }
  .preset-toggle-btn:hover {
    background: var(--panel);
    border-color: var(--accent);
  }
  .preset-toggle-btn:disabled {
    opacity: .6;
    cursor: not-allowed;
  }
  .preset-menu {
    position: fixed;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 6px;
    display: grid;
    gap: 4px;
    box-shadow: 0 8px 18px rgba(0,0,0,0.18);
    z-index: 300;
    max-height: 300px;
    overflow-y: auto;
    min-width: 220px;
  }
  .preset-menu-item {
    display: grid;
    align-items: start;
    gap: 2px;
    text-align: left;
    border: 0;
    border-radius: 8px;
    padding: 8px 10px;
    background: transparent;
    color: var(--text);
    font: inherit;
    cursor: pointer;
    transition: background-color 150ms ease;
  }
  .preset-menu-item:hover,
  .preset-menu-item:focus-visible {
    background: var(--hover-bg);
  }
  .preset-menu-name {
    font-weight: 600;
  }
  .preset-menu-model {
    font-size: .85rem;
    color: var(--muted);
  }
  /* Hover background for preset menu */
  :global(:root[data-theme='light']) .preset-menu-item:hover,
  :global(:root[data-theme='light']) .preset-menu-item:focus-visible {
    background: color-mix(in oklab, var(--bg), var(--text) 8%);
  }
  :global(:root[data-theme='dark']) .preset-menu-item:hover,
  :global(:root[data-theme='dark']) .preset-menu-item:focus-visible {
    background: color-mix(in oklab, var(--bg), var(--text) 8%);
  }
</style>

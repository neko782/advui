<script lang="ts">
  import { IconTune, IconLayers } from '../../icons'
  import type { Preset, ReasoningEffort, TextVerbosity, ReasoningSummary, ConnectionOption, ApiMode, McpServerConfig } from '../../types'

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
    codeInterpreterEnabled?: boolean
    codeInterpreterNetworkEnabled?: boolean
    codeInterpreterAllowedDomains?: string
    shellEnabled?: boolean
    shellNetworkEnabled?: boolean
    shellAllowedDomains?: string
    imageGenerationEnabled?: boolean
    imageGenerationModel?: string
    mcpEnabled?: boolean
    mcpServers?: McpServerConfig[]
    modelIds?: string[]
    connections?: ConnectionOption[]
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
    onInputCodeInterpreterEnabled?: (val: boolean) => void
    onInputCodeInterpreterNetworkEnabled?: (val: boolean) => void
    onInputCodeInterpreterAllowedDomains?: (val: string) => void
    onInputShellEnabled?: (val: boolean) => void
    onInputShellNetworkEnabled?: (val: boolean) => void
    onInputShellAllowedDomains?: (val: string) => void
    onInputImageGenerationEnabled?: (val: boolean) => void
    onInputImageGenerationModel?: (val: string) => void
    onInputMcpEnabled?: (val: boolean) => void
    onChangeMcpServers?: (servers: McpServerConfig[]) => void
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

  // Per-tool floating popup
  let activeToolPopup = $state<string | null>(null)
  let toolPopupEl = $state<HTMLDivElement | null>(null)
  let toolPopupPosition = $state({ bottom: 0, left: 0 })
  const toolPopupBtnEls: Record<string, HTMLButtonElement | null> = {}

  const supportsResponsesApiFeatures = $derived((() => {
    const conns = props.connections || []
    const currentConn = conns.find(c => c.id === props.connectionId) || conns[0]
    return currentConn?.apiMode === 'responses'
  })())

  function updateMcpServers(transform: (servers: McpServerConfig[]) => McpServerConfig[]) {
    if (props.disabled) return
    const current = Array.isArray(props.mcpServers)
      ? props.mcpServers.map((server) => ({ label: server?.label || '', url: server?.url || '' }))
      : []
    props.onChangeMcpServers?.(transform(current))
  }

  function addMcpServer() {
    updateMcpServers((servers) => [...servers, { label: '', url: '' }])
  }

  function removeMcpServer(index: number) {
    updateMcpServers((servers) => servers.filter((_, i) => i !== index))
  }

  function updateMcpServerUrl(index: number, value: string) {
    updateMcpServers((servers) => servers.map((server, i) => (
      i === index ? { ...server, url: value } : server
    )))
  }

  function togglePresetMenu() {
    if (!presetMenuOpen && presetButtonEl) {
      const rect = presetButtonEl.getBoundingClientRect()
      const menuWidth = 220
      const padding = 8
      let leftPos = rect.left
      if (leftPos + menuWidth > window.innerWidth - padding) {
        leftPos = rect.right - menuWidth
        if (leftPos < padding) leftPos = window.innerWidth - menuWidth - padding
      }
      presetMenuPosition = { bottom: window.innerHeight - rect.top + 4, left: Math.max(padding, leftPos) }
    }
    presetMenuOpen = !presetMenuOpen
  }

  function closePresetMenu() { presetMenuOpen = false }

  function selectPreset(preset) {
    closePresetMenu()
    props.onSelectPreset?.(preset)
  }

  function toggleToolPopup(tool: string, btn?: HTMLButtonElement | null) {
    if (activeToolPopup === tool) { activeToolPopup = null; return }
    const el = btn || toolPopupBtnEls[tool]
    if (el) {
      const rect = el.getBoundingClientRect()
      const popupWidth = 280
      const padding = 8
      let leftPos = rect.left
      if (leftPos + popupWidth > window.innerWidth - padding) {
        leftPos = rect.right - popupWidth
        if (leftPos < padding) leftPos = window.innerWidth - popupWidth - padding
      }
      toolPopupPosition = { bottom: window.innerHeight - rect.top + 4, left: Math.max(padding, leftPos) }
    }
    activeToolPopup = tool
  }

  $effect(() => {
    function onDocClick(e) {
      try {
        const isInPresetMenu = presetMenuEl && presetMenuEl.contains(e.target)
        const isPresetWrapper = e.target.closest('.preset-toggle-wrapper')
        const isInToolPopup = toolPopupEl && toolPopupEl.contains(e.target)
        const isToolBtn = e.target.closest('.tool-settings-btn')

        if (props.open && root && !root.contains(e.target) && !isInPresetMenu && !isPresetWrapper && !isInToolPopup && !isToolBtn) {
          props.onClose?.()
        }
        if (presetMenuOpen && !isInPresetMenu && !isPresetWrapper) closePresetMenu()
        if (activeToolPopup && !isInToolPopup && !isToolBtn) activeToolPopup = null
      } catch {}
    }
    function onKeydown(e) {
      if (e.key === 'Escape') {
        if (activeToolPopup) { activeToolPopup = null }
        else if (presetMenuOpen) closePresetMenu()
        else if (props.open) props.onClose?.()
      }
    }
    window.addEventListener('click', onDocClick, true)
    window.addEventListener('keydown', onKeydown)
    return () => { window.removeEventListener('click', onDocClick, true); window.removeEventListener('keydown', onKeydown) }
  })

  $effect(() => { wasOpen = !!props.open })
  $effect(() => { if (!props.open) activeToolPopup = null })
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
            <input type="checkbox" checked={!!props.streaming} disabled={props.disabled}
              onchange={(e) => (!props.disabled && props.onInputStreaming?.(e.currentTarget.checked))} aria-label="Stream" />
            <span class="switch-ui" aria-hidden="true"></span>
            <span class="switch-label">Stream</span>
          </label>
        </div>
        {#if supportsResponsesApiFeatures}
          <div class="menu-section">
            <label class="switch">
              <input type="checkbox" checked={!!props.webSearchEnabled} disabled={props.disabled}
                onchange={(e) => (!props.disabled && props.onInputWebSearchEnabled?.(e.currentTarget.checked))} aria-label="Web search" />
              <span class="switch-ui" aria-hidden="true"></span>
              <span class="switch-label">Web search</span>
            </label>
          </div>
          <div class="menu-section">
            <div class="tool-header-row">
              <label class="switch">
                <input type="checkbox" checked={!!props.codeInterpreterEnabled} disabled={props.disabled}
                  onchange={(e) => (!props.disabled && props.onInputCodeInterpreterEnabled?.(e.currentTarget.checked))} aria-label="Code interpreter" />
                <span class="switch-ui" aria-hidden="true"></span>
                <span class="switch-label">Code interpreter</span>
              </label>
              {#if props.codeInterpreterEnabled}
                <button type="button" class="tool-settings-btn"
                  bind:this={toolPopupBtnEls['codeInterpreter']}
                  onclick={() => toggleToolPopup('codeInterpreter', toolPopupBtnEls['codeInterpreter'])}
                  disabled={props.disabled} title="Network settings" aria-label="Network settings">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points={activeToolPopup === 'codeInterpreter' ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}></polyline>
                  </svg>
                </button>
              {/if}
            </div>
          </div>
          <div class="menu-section">
            <div class="tool-header-row">
              <label class="switch">
                <input type="checkbox" checked={!!props.shellEnabled} disabled={props.disabled}
                  onchange={(e) => (!props.disabled && props.onInputShellEnabled?.(e.currentTarget.checked))} aria-label="Shell" />
                <span class="switch-ui" aria-hidden="true"></span>
                <span class="switch-label">Shell</span>
              </label>
              {#if props.shellEnabled}
                <button type="button" class="tool-settings-btn"
                  bind:this={toolPopupBtnEls['shell']}
                  onclick={() => toggleToolPopup('shell', toolPopupBtnEls['shell'])}
                  disabled={props.disabled} title="Network settings" aria-label="Network settings">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points={activeToolPopup === 'shell' ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}></polyline>
                  </svg>
                </button>
              {/if}
            </div>
          </div>
          <div class="menu-section">
            <div class="tool-header-row">
              <label class="switch">
                <input type="checkbox" checked={!!props.imageGenerationEnabled} disabled={props.disabled}
                  onchange={(e) => (!props.disabled && props.onInputImageGenerationEnabled?.(e.currentTarget.checked))} aria-label="Image generation" />
                <span class="switch-ui" aria-hidden="true"></span>
                <span class="switch-label">Image generation</span>
              </label>
              {#if props.imageGenerationEnabled}
                <button type="button" class="tool-settings-btn"
                  bind:this={toolPopupBtnEls['imageGeneration']}
                  onclick={() => toggleToolPopup('imageGeneration', toolPopupBtnEls['imageGeneration'])}
                  disabled={props.disabled} title="Model settings" aria-label="Model settings">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points={activeToolPopup === 'imageGeneration' ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}></polyline>
                  </svg>
                </button>
              {/if}
            </div>
          </div>
          <div class="menu-section">
            <div class="tool-header-row">
              <label class="switch">
                <input type="checkbox" checked={!!props.mcpEnabled} disabled={props.disabled}
                  onchange={(e) => (!props.disabled && props.onInputMcpEnabled?.(e.currentTarget.checked))} aria-label="MCP" />
                <span class="switch-ui" aria-hidden="true"></span>
                <span class="switch-label">MCP</span>
              </label>
              {#if props.mcpEnabled}
                <button type="button" class="tool-settings-btn"
                  bind:this={toolPopupBtnEls['mcp']}
                  onclick={() => toggleToolPopup('mcp', toolPopupBtnEls['mcp'])}
                  disabled={props.disabled} title="Server settings" aria-label="Server settings">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points={activeToolPopup === 'mcp' ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}></polyline>
                  </svg>
                </button>
              {/if}
            </div>
          </div>
        {/if}
        <div class="menu-section">
          <div class="menu-label">Text verbosity</div>
          <select value={props.textVerbosity || 'medium'} disabled={props.disabled}
            onchange={(e) => (!props.disabled && props.onInputTextVerbosity?.(e.currentTarget.value))} aria-label="Text verbosity">
            <option value="none">none</option><option value="low">low</option>
            <option value="medium">medium</option><option value="high">high</option>
          </select>
        </div>
        <div class="menu-section">
          <div class="menu-label">Connection</div>
          <select value={props.connectionId || ''} disabled={props.disabled}
            onchange={(e) => (!props.disabled && props.onChangeConnection?.(e.currentTarget.value))} aria-label="Connection">
            {#each (props.connections || []) as conn (conn?.id || conn?.name)}
              <option value={conn?.id || ''}>{conn?.name || conn?.id || 'Connection'}</option>
            {/each}
          </select>
        </div>
      {:else if activeTab === 'sampling'}
        <div class="menu-section">
          <div class="menu-label">Top P</div>
          <input type="number" min="0" max="1" step="0.1" placeholder="Default" value={props.topP ?? ''}
            disabled={props.disabled} oninput={(e) => (!props.disabled && props.onInputTopP?.(e.currentTarget.value))} aria-label="top_p" />
        </div>
        <div class="menu-section">
          <div class="menu-label">Temperature</div>
          <input type="number" min="0" max="2" step="0.1" placeholder="Default" value={props.temperature ?? ''}
            disabled={props.disabled} oninput={(e) => (!props.disabled && props.onInputTemperature?.(e.currentTarget.value))} aria-label="Temperature" />
        </div>
      {:else if activeTab === 'reasoning'}
        <div class="menu-section">
          <div class="menu-label">Reasoning effort</div>
          <select value={props.reasoningEffort || 'none'} disabled={props.disabled}
            onchange={(e) => (!props.disabled && props.onInputReasoningEffort?.(e.currentTarget.value))} aria-label="Reasoning effort">
            <option value="none">none</option><option value="minimal">minimal</option><option value="low">low</option>
            <option value="medium">medium</option><option value="high">high</option><option value="xhigh">xhigh</option>
          </select>
        </div>
        <div class="menu-section">
          <div class="menu-label">Reasoning summary</div>
          <select value={props.reasoningSummary || 'auto'} disabled={props.disabled}
            onchange={(e) => (!props.disabled && props.onInputReasoningSummary?.(e.currentTarget.value))} aria-label="Reasoning summary">
            <option value="none">none</option><option value="auto">auto</option>
            <option value="concise">concise</option><option value="detailed">detailed</option>
          </select>
        </div>
        {#if props.showThinkingControls}
          <div class="menu-section">
            <label class="switch" title="Enable Anthropic thinking">
              <input type="checkbox" checked={!!props.thinkingEnabled} disabled={props.disabled}
                onchange={(e) => (!props.disabled && props.onInputThinkingEnabled?.(e.currentTarget.checked))} aria-label="Enable Anthropic thinking" />
              <span class="switch-ui" aria-hidden="true"></span>
              <span class="switch-label">Anthropic thinking</span>
            </label>
            <input type="number" min="1" step="100" placeholder="Budget tokens" value={props.thinkingBudgetTokens ?? ''}
              disabled={props.disabled || !props.thinkingEnabled}
              oninput={(e) => (!props.disabled && props.onInputThinkingBudgetTokens?.(e.currentTarget.value))} aria-label="Thinking budget tokens" />
          </div>
        {/if}
      {/if}
    </div>
    <!-- Tabs -->
    <div class="settings-tabs" role="tablist">
      <button class={`settings-tab ${activeTab === 'general' ? 'active' : ''}`} role="tab" aria-selected={activeTab === 'general'} onclick={() => activeTab = 'general'}>General</button>
      <button class={`settings-tab ${activeTab === 'sampling' ? 'active' : ''}`} role="tab" aria-selected={activeTab === 'sampling'} onclick={() => activeTab = 'sampling'}>Sampling</button>
      <button class={`settings-tab ${activeTab === 'reasoning' ? 'active' : ''}`} role="tab" aria-selected={activeTab === 'reasoning'} onclick={() => activeTab = 'reasoning'}>Reasoning</button>
    </div>
    <!-- Model -->
    <div class="menu-section">
      <div class="menu-label">Model</div>
      <div class="model-input-wrapper">
        <input type="text" placeholder="gpt-5" value={props.model} disabled={props.disabled}
          oninput={(e) => (!props.disabled && props.onInputModel?.(e.currentTarget.value))} list="model-suggestions" aria-label="Model" />
        {#if Array.isArray(props.presets) && props.presets.length > 0}
          <div class="preset-toggle-wrapper">
            <button type="button" class="preset-toggle-btn" bind:this={presetButtonEl}
              onclick={togglePresetMenu} disabled={props.disabled} aria-label="Switch preset" title="Switch preset">
              <IconLayers style="font-size: 18px;" />
            </button>
          </div>
        {/if}
      </div>
      {#if props.modelIds?.length}
        <datalist id="model-suggestions">
          {#each props.modelIds as mid}<option value={mid}>{mid}</option>{/each}
        </datalist>
      {/if}
    </div>
  </div>
</div>

{#if presetMenuOpen}
  <div class="preset-menu" bind:this={presetMenuEl} aria-label="Choose preset"
    style="bottom: {presetMenuPosition.bottom}px; left: {presetMenuPosition.left}px;">
    {#each (props.presets || []) as preset (preset.id || preset.name)}
      <button type="button" class="preset-menu-item" onclick={() => selectPreset(preset)}>
        <span class="preset-menu-name">{preset?.name || 'Preset'}</span>
        <span class="preset-menu-model">{preset?.model || ''}</span>
      </button>
    {/each}
  </div>
{/if}

{#if activeToolPopup}
  <div class="tool-popup" bind:this={toolPopupEl}
    style="bottom: {toolPopupPosition.bottom}px; left: {toolPopupPosition.left}px;">
    {#if activeToolPopup === 'codeInterpreter'}
      <div class="tool-popup-content">
        <label class="switch">
          <input type="checkbox" checked={!!props.codeInterpreterNetworkEnabled} disabled={props.disabled}
            onchange={(e) => (!props.disabled && props.onInputCodeInterpreterNetworkEnabled?.(e.currentTarget.checked))} aria-label="Allow network" />
          <span class="switch-ui" aria-hidden="true"></span>
          <span class="switch-label">Allow network</span>
        </label>
        {#if props.codeInterpreterNetworkEnabled}
          <input type="text" placeholder="Allowed domains (comma-separated)" value={props.codeInterpreterAllowedDomains || ''}
            disabled={props.disabled} oninput={(e) => (!props.disabled && props.onInputCodeInterpreterAllowedDomains?.(e.currentTarget.value))}
            aria-label="Allowed domains" class="tool-popup-input" />
          <div class="tool-popup-hint">Leave empty for unrestricted.</div>
        {/if}
      </div>
    {:else if activeToolPopup === 'shell'}
      <div class="tool-popup-content">
        <label class="switch">
          <input type="checkbox" checked={!!props.shellNetworkEnabled} disabled={props.disabled}
            onchange={(e) => (!props.disabled && props.onInputShellNetworkEnabled?.(e.currentTarget.checked))} aria-label="Allow network" />
          <span class="switch-ui" aria-hidden="true"></span>
          <span class="switch-label">Allow network</span>
        </label>
        {#if props.shellNetworkEnabled}
          <input type="text" placeholder="Allowed domains (comma-separated)" value={props.shellAllowedDomains || ''}
            disabled={props.disabled} oninput={(e) => (!props.disabled && props.onInputShellAllowedDomains?.(e.currentTarget.value))}
            aria-label="Allowed domains" class="tool-popup-input" />
          <div class="tool-popup-hint">Leave empty for unrestricted.</div>
        {/if}
      </div>
    {:else if activeToolPopup === 'imageGeneration'}
      <div class="tool-popup-content">
        <input type="text" placeholder="gpt-image-1" value={props.imageGenerationModel || ''}
          disabled={props.disabled} oninput={(e) => (!props.disabled && props.onInputImageGenerationModel?.(e.currentTarget.value))}
          aria-label="Image generation model" class="tool-popup-input" />
      </div>
    {:else if activeToolPopup === 'mcp'}
      <div class="tool-popup-content mcp-popup">
        {#if props.mcpServers?.length}
          {#each props.mcpServers as server, index (index)}
            <div class="mcp-server-row">
              <input type="text" placeholder="https://example.com/mcp" value={server?.url || ''}
                disabled={props.disabled} oninput={(e) => updateMcpServerUrl(index, e.currentTarget.value)}
                aria-label={`MCP server URL ${index + 1}`} class="tool-popup-input" />
              <button type="button" class="mcp-remove-btn" onclick={() => removeMcpServer(index)}
                disabled={props.disabled} aria-label={`Remove server ${index + 1}`} title="Remove">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          {/each}
        {:else}
          <div class="tool-popup-hint">No servers configured.</div>
        {/if}
        <button type="button" class="mcp-add-btn" onclick={addMcpServer} disabled={props.disabled}>+ Add server</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .icon-btn { border: 1px solid var(--border); border-radius: 10px; background: var(--bg); min-width: 44px; height: 44px; display: grid; place-items: center; line-height: 1; color: var(--text); transition: background-color .15s ease, border-color .15s ease, color .15s ease, transform .1s ease; }
  .icon-btn:hover:not(:disabled) { background: var(--panel); border-color: var(--accent); color: var(--accent); }
  .icon-btn:active:not(:disabled) { transform: scale(0.95); }
  .icon-btn:disabled { opacity: .5; cursor: not-allowed; }
  .chat-settings-menu { min-width: 270px; padding: 14px; }
  .menu-section { display: grid; gap: 6px; margin-bottom: 10px; }
  .menu-label { font-size: .9rem; color: var(--muted); font-weight: 500; }
  .settings-tabs { display: flex; gap: 2px; margin: 6px 0 10px; background: var(--bg); border-radius: 8px; padding: 3px; }
  .settings-tab { flex: 1; padding: 6px 10px; font-size: .8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; border: none; background: transparent; color: var(--muted); border-radius: 6px; cursor: pointer; transition: background-color .15s ease, color .15s ease, transform .1s ease; user-select: none; }
  .settings-tab:hover:not(.active) { color: var(--text); background: color-mix(in srgb, var(--panel) 50%, transparent); }
  .settings-tab:active { transform: scale(0.97); }
  .settings-tab.active { background: var(--panel); color: var(--accent); box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .tab-content > .menu-section:last-child { margin-bottom: 0; }
  input[type="text"], input[type="number"], select { width: 100%; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; background: var(--bg); color: var(--text); font: inherit; box-sizing: border-box; transition: border-color .15s ease, box-shadow .15s ease; }
  input[type="text"]:hover, input[type="number"]:hover, select:hover { border-color: color-mix(in srgb, var(--border) 70%, var(--accent)); }
  input[type="text"]:focus, input[type="number"]:focus, select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent); }
  .switch { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; }
  .switch > input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
  .switch-ui { width: 38px; height: 22px; border-radius: 999px; background: var(--border); position: relative; transition: background-color .15s ease; box-shadow: inset 0 0 0 1px var(--border); flex-shrink: 0; }
  .switch-ui::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.15); transition: transform .15s ease, background-color .15s ease; }
  :global(:root[data-theme='dark']) .switch-ui { background: #2a2a2a; box-shadow: inset 0 0 0 1px #2f2f2f; }
  :global(:root[data-theme='dark']) .switch-ui::after { background: #e6e6e6; }
  .switch > input:checked + .switch-ui { background: color-mix(in srgb, var(--accent), #0000 70%); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent), #0000 60%); }
  .switch > input:checked + .switch-ui::after { transform: translateX(16px); }
  .switch-label { font-size: .95rem; }
  .chat-settings-group { position: relative; display: grid; place-items: center; }
  .chat-settings-menu { display: grid; gap: 0; position: absolute; top: auto; bottom: calc(100% + 10px); left: 8px; right: auto; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--float-shadow); max-height: calc(100vh - 120px); overflow-y: auto; overscroll-behavior: contain; opacity: 0; transform: scale(0.95) translateY(8px); transform-origin: bottom left; transition: opacity 180ms cubic-bezier(0.2, 0.9, 0.3, 1), transform 180ms cubic-bezier(0.2, 0.9, 0.3, 1); pointer-events: none; z-index: 20; }
  .chat-settings-group.open .chat-settings-menu { opacity: 1; pointer-events: auto; transform: scale(1) translateY(0); }
  .chat-settings-group::before { content: ''; position: absolute; left: 0; bottom: 100%; width: 220px; height: 12px; }
  .model-input-wrapper { display: grid; grid-template-columns: 1fr auto; gap: 6px; align-items: center; }
  .model-input-wrapper > input { min-width: 0; }
  .preset-toggle-wrapper { position: relative; }
  .preset-toggle-btn { width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); cursor: pointer; transition: background-color .15s ease, border-color .15s ease, color .15s ease, transform .1s ease; flex-shrink: 0; }
  .preset-toggle-btn:hover:not(:disabled) { background: var(--panel); border-color: var(--accent); color: var(--accent); }
  .preset-toggle-btn:active:not(:disabled) { transform: scale(0.92); }
  .preset-toggle-btn:disabled { opacity: .5; cursor: not-allowed; }
  .preset-menu { position: fixed; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 6px; display: grid; gap: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.12); z-index: 300; max-height: 300px; overflow-y: auto; min-width: 220px; transform-origin: bottom left; }
  :global(:root[data-fancy-effects="true"]) .preset-menu { box-shadow: 0 8px 18px rgba(0,0,0,0.18); animation: popup-enter 180ms cubic-bezier(0.2, 0.9, 0.3, 1); }
  @keyframes popup-enter { from { opacity: 0; transform: scale(0.92) translateY(4px); } to { opacity: 1; transform: scale(1) translateY(0); } }
  .preset-menu-item { display: grid; align-items: start; gap: 2px; text-align: left; border: 1px solid transparent; border-radius: 8px; padding: 10px 12px; background: transparent; color: var(--text); font: inherit; cursor: pointer; transition: background-color .12s ease, border-color .12s ease, transform .1s ease; }
  .preset-menu-item:hover, .preset-menu-item:focus-visible { background: color-mix(in oklab, var(--bg), var(--text) 8%); border-color: color-mix(in srgb, var(--accent) 30%, transparent); }
  .preset-menu-item:active { transform: scale(0.98); }
  .preset-menu-name { font-weight: 600; }
  .preset-menu-model { font-size: .85rem; color: var(--muted); }
  /* Tool row with settings button */
  .tool-header-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .tool-settings-btn { width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--muted); cursor: pointer; transition: background-color .15s ease, border-color .15s ease, color .15s ease; flex-shrink: 0; }
  .tool-settings-btn:hover { background: var(--panel); border-color: var(--accent); color: var(--text); }
  .tool-settings-btn:disabled { opacity: .6; cursor: not-allowed; }
  /* Per-tool floating popup */
  .tool-popup { position: fixed; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.14); z-index: 300; min-width: 240px; max-width: 320px; max-height: 360px; overflow-y: auto; overscroll-behavior: contain; transform-origin: bottom left; }
  :global(:root[data-fancy-effects="true"]) .tool-popup { box-shadow: 0 8px 24px rgba(0,0,0,0.2); animation: popup-enter 180ms cubic-bezier(0.2, 0.9, 0.3, 1); }
  .tool-popup-content { display: grid; gap: 8px; }
  .tool-popup-input { width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; background: var(--bg); color: var(--text); font: inherit; font-size: .85rem; box-sizing: border-box; transition: border-color .15s ease, box-shadow .15s ease; }
  .tool-popup-input:hover { border-color: color-mix(in srgb, var(--border) 70%, var(--accent)); }
  .tool-popup-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent); }
  .tool-popup-hint { font-size: .75rem; color: var(--muted); opacity: 0.7; }
  .mcp-popup { gap: 6px; }
  .mcp-server-row { display: grid; grid-template-columns: 1fr auto; gap: 4px; align-items: center; }
  .mcp-remove-btn { width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer; transition: background-color .12s ease, border-color .12s ease, color .12s ease; flex-shrink: 0; }
  .mcp-remove-btn:hover:not(:disabled) { background: color-mix(in srgb, #ef4444 10%, transparent); border-color: color-mix(in srgb, #ef4444 30%, transparent); color: #ef4444; }
  .mcp-remove-btn:disabled { opacity: .4; cursor: not-allowed; }
  .mcp-add-btn { padding: 6px 10px; border: 1px dashed var(--border); border-radius: 6px; background: transparent; color: var(--muted); font: inherit; font-size: .85rem; cursor: pointer; transition: border-color .12s ease, color .12s ease, background-color .12s ease; }
  .mcp-add-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 5%, transparent); }
  .mcp-add-btn:disabled { opacity: .5; cursor: not-allowed; }
</style>

<script lang="ts">
  import OpenRouterProviderInput from '../OpenRouterProviderInput.svelte'
  import ModelInput from '../ModelInput.svelte'
  import ToolsPicker, { type ToolsValue } from '../ToolsPicker.svelte'
  import { reasoningLevelOptions } from '../../utils/reasoningLevels'
  import { IconTune, IconLayers } from '../../icons'
  import type { Preset, ReasoningEffort, TextVerbosity, ReasoningSummary, ConnectionOption, McpServerConfig } from '../../types'

  interface Props {
    open?: boolean
    disabled?: boolean
    model?: string
    streaming?: boolean
    maxOutputTokens?: number | null
    topP?: number | null
    temperature?: number | null
    thinkingEnabled?: boolean
    thinkingBudgetTokens?: number | null
    /** Offer deprecated controls (sampling, Anthropic thinking, retired reasoning levels). */
    showLegacyParams?: boolean
    reasoningEffort?: ReasoningEffort
    reasoningSummary?: ReasoningSummary
    textVerbosity?: TextVerbosity
    openRouterProvider?: string
    onInputOpenRouterProvider?: (val: string) => void
    openRouterZdr?: boolean
    onInputOpenRouterZdr?: (val: boolean) => void
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
    presets?: Preset[]
    onToggle?: () => void
    onClose?: () => void
    onChangeConnection?: (val: string) => void
    onInputModel?: (val: string) => void
    onInputStreaming?: (val: boolean) => void
    onInputMaxOutputTokens?: (val: string) => void
    onInputTopP?: (val: string) => void
    onInputTemperature?: (val: string) => void
    onInputThinkingEnabled?: (val: boolean) => void
    onInputThinkingBudgetTokens?: (val: string) => void
    onInputReasoningEffort?: (val: string) => void
    onInputReasoningSummary?: (val: string) => void
    onInputTextVerbosity?: (val: string) => void
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
  let menuBounds = $state({ left: 8, width: 300, height: 500 })
  let activeTab = $state<'general' | 'generation'>('general')
  let presetMenuOpen = $state(false)
  let presetMenuEl = $state<HTMLDivElement | null>(null)
  let presetButtonEl = $state<HTMLButtonElement | null>(null)
  let presetMenuPosition = $state({ bottom: 0, left: 0 })

  const supportsResponsesApiFeatures = $derived((() => {
    const conns = props.connections || []
    const currentConn = conns.find(c => c.id === props.connectionId) || conns[0]
    return currentConn?.apiMode === 'responses'
  })())

  const supportsOpenRouter = $derived((() => {
    const conns = props.connections || []
    const conn = conns.find(c => c.id === props.connectionId) || conns[0]
    return conn?.openRouterEnabled === true && conn.apiMode !== 'gemini'
  })())

  const currentConnection = $derived((props.connections || []).find(c => c.id === props.connectionId) || (props.connections || [])[0])
  const reasoningLevels = $derived(reasoningLevelOptions(currentConnection?.apiMode, {
    legacy: props.showLegacyParams,
    selected: props.reasoningEffort,
  }))

  const toolsValue = $derived<ToolsValue>({
    webSearchEnabled: props.webSearchEnabled,
    codeInterpreterEnabled: props.codeInterpreterEnabled,
    codeInterpreterNetworkEnabled: props.codeInterpreterNetworkEnabled,
    codeInterpreterAllowedDomains: props.codeInterpreterAllowedDomains,
    shellEnabled: props.shellEnabled,
    shellNetworkEnabled: props.shellNetworkEnabled,
    shellAllowedDomains: props.shellAllowedDomains,
    imageGenerationEnabled: props.imageGenerationEnabled,
    imageGenerationModel: props.imageGenerationModel,
    mcpEnabled: props.mcpEnabled,
    mcpServers: props.mcpServers,
  })

  function patchTools(patch: ToolsValue) {
    if (props.disabled) return
    if ('webSearchEnabled' in patch) props.onInputWebSearchEnabled?.(!!patch.webSearchEnabled)
    if ('codeInterpreterEnabled' in patch) props.onInputCodeInterpreterEnabled?.(!!patch.codeInterpreterEnabled)
    if ('codeInterpreterNetworkEnabled' in patch) props.onInputCodeInterpreterNetworkEnabled?.(!!patch.codeInterpreterNetworkEnabled)
    if ('codeInterpreterAllowedDomains' in patch) props.onInputCodeInterpreterAllowedDomains?.(patch.codeInterpreterAllowedDomains || '')
    if ('shellEnabled' in patch) props.onInputShellEnabled?.(!!patch.shellEnabled)
    if ('shellNetworkEnabled' in patch) props.onInputShellNetworkEnabled?.(!!patch.shellNetworkEnabled)
    if ('shellAllowedDomains' in patch) props.onInputShellAllowedDomains?.(patch.shellAllowedDomains || '')
    if ('imageGenerationEnabled' in patch) props.onInputImageGenerationEnabled?.(!!patch.imageGenerationEnabled)
    if ('imageGenerationModel' in patch) props.onInputImageGenerationModel?.(patch.imageGenerationModel || '')
    if ('mcpEnabled' in patch) props.onInputMcpEnabled?.(!!patch.mcpEnabled)
    if (patch.mcpServers) props.onChangeMcpServers?.(patch.mcpServers)
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

  function selectPreset(preset: Preset) {
    closePresetMenu()
    props.onSelectPreset?.(preset)
  }

  $effect(() => {
    // Only listen while something is actually open; avoids document-level
    // listeners for every mounted (but closed) instance.
    if (!props.open && !presetMenuOpen) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Element
      try {
        const isInPresetMenu = presetMenuEl && presetMenuEl.contains(target)
        const isPresetWrapper = target.closest('.preset-toggle-wrapper')

        if (props.open && root && !root.contains(target) && !isInPresetMenu && !isPresetWrapper) {
          props.onClose?.()
        }
        if (presetMenuOpen && !isInPresetMenu && !isPresetWrapper) closePresetMenu()
      } catch {}
    }
    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (presetMenuOpen) closePresetMenu()
        else if (props.open) props.onClose?.()
      }
    }
    window.addEventListener('click', onDocClick, true)
    window.addEventListener('keydown', onKeydown)
    return () => { window.removeEventListener('click', onDocClick, true); window.removeEventListener('keydown', onKeydown) }
  })

  $effect(() => {
    if (!props.open || !root) return
    const viewport = window.visualViewport
    let frame = 0
    const measure = () => {
      if (!root) return
      const rect = root.getBoundingClientRect()
      const left = viewport?.offsetLeft ?? 0
      const top = viewport?.offsetTop ?? 0
      const width = Math.min(360, (viewport?.width ?? window.innerWidth) - 16)
      // Leave room for the floating sidebar button on narrow screens.
      const topInset = (viewport?.width ?? window.innerWidth) <= 640 ? 52 : 8
      const height = Math.max(0, rect.top - top - 10 - topInset)
      menuBounds = {
        left: Math.max(left + 8, Math.min(rect.left + 8, left + (viewport?.width ?? window.innerWidth) - width - 8)) - rect.left,
        width,
        height,
      }
    }
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(root)
    const composer = root.closest('.composer')
    if (composer) observer?.observe(composer)
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  })
</script>

<div class={`chat-settings-group ${props.open ? 'open' : ''}`} bind:this={root}>
  <button class="icon-btn" aria-label="Chat settings" disabled={props.disabled} onclick={() => (!props.disabled && props.onToggle?.())}>
    <IconTune style="font-size: 22px;" />
  </button>
  <div class="send-menu chat-settings-menu" role="menu" aria-label="Chat settings"
    style={`--settings-left: ${menuBounds.left}px; --settings-width: ${menuBounds.width}px; --settings-height: ${menuBounds.height}px`}>
    <div class="settings-scroll">
      {#if activeTab === 'general'}
        {#if supportsResponsesApiFeatures}
          <div class="menu-section">
            <div class="menu-label">Tools</div>
            <ToolsPicker compact value={toolsValue} onChange={patchTools} disabled={props.disabled} />
          </div>
        {/if}
        <div class="menu-section">
          <div class="menu-label">Connection</div>
          <div class="connection-input-wrapper">
            <select value={props.connectionId || ''} disabled={props.disabled}
              onchange={(e) => (!props.disabled && props.onChangeConnection?.(e.currentTarget.value))} aria-label="Connection">
              {#each (props.connections || []) as conn (conn?.id || conn?.name)}
                <option value={conn?.id || ''}>{conn?.name || conn?.id || 'Connection'}</option>
              {/each}
            </select>
            {#if supportsOpenRouter}
              <OpenRouterProviderInput value={props.openRouterProvider} disabled={props.disabled}
                active={!!props.open} onInput={props.onInputOpenRouterProvider}
                zdr={props.openRouterZdr} onZdr={props.onInputOpenRouterZdr} />
            {/if}
          </div>
        </div>
      {:else}
        <div class="menu-grid">
          <label class="menu-field">
            <span class="menu-label">Reasoning effort</span>
            <select value={props.reasoningEffort || 'default'} disabled={props.disabled}
              onchange={(e) => (!props.disabled && props.onInputReasoningEffort?.(e.currentTarget.value))} aria-label="Reasoning effort">
              {#each reasoningLevels as level (level.value)}
                <option value={level.value}>{level.label}</option>
              {/each}
            </select>
          </label>
          <label class="menu-field">
            <span class="menu-label">Reasoning summary</span>
            <select value={props.reasoningSummary || 'auto'} disabled={props.disabled}
              onchange={(e) => (!props.disabled && props.onInputReasoningSummary?.(e.currentTarget.value))} aria-label="Reasoning summary">
              <option value="none">none</option><option value="auto">auto</option>
              <option value="concise">concise</option><option value="detailed">detailed</option>
            </select>
          </label>
          <label class="menu-field">
            <span class="menu-label">Text verbosity</span>
            <select value={props.textVerbosity || 'medium'} disabled={props.disabled}
              onchange={(e) => (!props.disabled && props.onInputTextVerbosity?.(e.currentTarget.value))} aria-label="Text verbosity">
              <option value="none">none</option><option value="low">low</option>
              <option value="medium">medium</option><option value="high">high</option>
            </select>
          </label>
          <div class="menu-field">
            <span class="menu-label">Streaming</span>
            <label class="ui-switch ui-switch-cell" title="Stream">
              <input type="checkbox" checked={!!props.streaming} disabled={props.disabled}
                onchange={(e) => (!props.disabled && props.onInputStreaming?.(e.currentTarget.checked))} aria-label="Stream" />
              <span class="ui-switch-ui" aria-hidden="true"></span>
              <span class="ui-switch-label">{props.streaming ? 'On' : 'Off'}</span>
            </label>
          </div>
          {#if props.showLegacyParams}
            <label class="menu-field">
              <span class="menu-label">Temperature</span>
              <input type="number" min="0" max="2" step="0.1" placeholder="Default" value={props.temperature ?? ''}
                disabled={props.disabled} oninput={(e) => (!props.disabled && props.onInputTemperature?.(e.currentTarget.value))} aria-label="Temperature" />
            </label>
            <label class="menu-field">
              <span class="menu-label">Top P</span>
              <input type="number" min="0" max="1" step="0.1" placeholder="Default" value={props.topP ?? ''}
                disabled={props.disabled} oninput={(e) => (!props.disabled && props.onInputTopP?.(e.currentTarget.value))} aria-label="top_p" />
            </label>
            {#if currentConnection?.apiMode !== 'gemini'}
              <div class="menu-field">
                <span class="menu-label">Anthropic thinking</span>
                <label class="ui-switch ui-switch-cell" title="Enable Anthropic thinking">
                  <input type="checkbox" checked={!!props.thinkingEnabled} disabled={props.disabled}
                    onchange={(e) => (!props.disabled && props.onInputThinkingEnabled?.(e.currentTarget.checked))} aria-label="Enable Anthropic thinking" />
                  <span class="ui-switch-ui" aria-hidden="true"></span>
                  <span class="ui-switch-label">{props.thinkingEnabled ? 'On' : 'Off'}</span>
                </label>
              </div>
              <label class="menu-field">
                <span class="menu-label">Thinking budget</span>
                <input type="number" min="1" step="100" placeholder="Tokens" value={props.thinkingBudgetTokens ?? ''}
                  disabled={props.disabled || !props.thinkingEnabled}
                  oninput={(e) => (!props.disabled && props.onInputThinkingBudgetTokens?.(e.currentTarget.value))} aria-label="Thinking budget tokens" />
              </label>
            {/if}
          {/if}
        </div>
      {/if}
    </div>
    <div class="settings-tabs" role="tablist">
      <button class={`settings-tab ${activeTab === 'general' ? 'active' : ''}`} role="tab" aria-selected={activeTab === 'general'} onclick={() => activeTab = 'general'}>General</button>
      <button class={`settings-tab ${activeTab === 'generation' ? 'active' : ''}`} role="tab" aria-selected={activeTab === 'generation'} onclick={() => activeTab = 'generation'}>Generation</button>
    </div>
    <!-- Model stays pinned next to the button that opened the panel -->
    <div class="menu-section model-section">
      <div class="menu-label">Model</div>
      <div class="model-input-wrapper">
        <ModelInput value={props.model} models={props.modelIds} disabled={props.disabled}
          active={!!props.open} onInput={props.onInputModel} />
        {#if Array.isArray(props.presets) && props.presets.length > 0}
          <div class="preset-toggle-wrapper">
            <button type="button" class="preset-toggle-btn" bind:this={presetButtonEl}
              onclick={togglePresetMenu} disabled={props.disabled} aria-label="Switch preset" title="Switch preset">
              <IconLayers style="font-size: 18px;" />
            </button>
          </div>
        {/if}
      </div>
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

<style>
  .icon-btn { border: 1px solid var(--border); border-radius: 10px; background: var(--bg); width: 44px; height: 44px; padding: 0; flex-shrink: 0; display: grid; place-items: center; line-height: 1; color: var(--text); transition: background-color .15s ease, border-color .15s ease, color .15s ease, transform .1s ease; }
  .icon-btn:hover:not(:disabled) { background: var(--panel); border-color: var(--accent); color: var(--accent); }
  .icon-btn:active:not(:disabled) { transform: scale(0.95); }
  .icon-btn:disabled { opacity: .5; cursor: not-allowed; }
  .menu-section { display: grid; gap: 6px; }
  .menu-label { font-size: .8rem; color: var(--muted); font-weight: 500; }
  .menu-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .menu-field { display: grid; gap: 4px; min-width: 0; }
  .settings-scroll { display: grid; gap: 12px; align-content: start; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; padding: 14px 14px 12px; }
  .model-section { flex-shrink: 0; padding: 0 14px 14px; }
  .settings-tabs { flex-shrink: 0; display: flex; gap: 2px; margin: 0 14px 10px; background: var(--bg); border-radius: 8px; padding: 3px; }
  .settings-tab { flex: 1; padding: 6px 10px; font-size: .8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; border: none; background: transparent; color: var(--muted); border-radius: 6px; cursor: pointer; transition: background-color .15s ease, color .15s ease, transform .1s ease; user-select: none; }
  .settings-tab:hover:not(.active) { color: var(--text); background: color-mix(in srgb, var(--panel) 50%, transparent); }
  .settings-tab:active { transform: scale(0.97); }
  .settings-tab.active { background: var(--panel); color: var(--accent); box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .chat-settings-menu { min-width: 0; width: var(--settings-width); box-sizing: border-box; padding: 0; }
  input[type="number"], select { width: 100%; height: 38px; border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; background: var(--bg); color: var(--text); font: inherit; font-size: .9rem; box-sizing: border-box; transition: border-color .15s ease, box-shadow .15s ease; }
  input:disabled, select:disabled { opacity: .5; cursor: not-allowed; }
  input[type="number"]:hover, select:hover { border-color: color-mix(in srgb, var(--border) 70%, var(--accent)); }
  input[type="number"]:focus, select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent); }
  .chat-settings-group { position: relative; display: grid; place-items: center; }
  .chat-settings-menu { display: flex; flex-direction: column; gap: 0; position: absolute; top: auto; bottom: calc(100% + 10px); left: var(--settings-left); right: auto; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--float-shadow); max-height: var(--settings-height); overflow: hidden; opacity: 0; transform: scale(0.95) translateY(8px); transform-origin: bottom left; transition: opacity 180ms cubic-bezier(0.2, 0.9, 0.3, 1), transform 180ms cubic-bezier(0.2, 0.9, 0.3, 1); pointer-events: none; z-index: 20; }
  .chat-settings-group.open .chat-settings-menu { opacity: 1; pointer-events: auto; transform: scale(1) translateY(0); }
  .chat-settings-group::before { content: ''; position: absolute; left: 0; bottom: 100%; width: 220px; height: 12px; }
  .model-input-wrapper, .connection-input-wrapper { display: flex; gap: 6px; align-items: center; min-width: 0; }
  .model-input-wrapper > :global(:first-child), .connection-input-wrapper > :first-child { flex: 1; min-width: 0; }
  .preset-toggle-wrapper { position: relative; }
  .preset-toggle-btn { width: 36px; height: 36px; padding: 0; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); cursor: pointer; transition: background-color .15s ease, border-color .15s ease, color .15s ease, transform .1s ease; flex-shrink: 0; }
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
</style>

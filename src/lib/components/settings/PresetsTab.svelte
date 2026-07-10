<script lang="ts">
  import { onMount } from 'svelte'
  import { IconAdd, IconDelete, IconDragHandle, IconTravelExplore, IconCodeBlocks, IconTerminal, IconImagesmode, IconExtension } from '../../icons'
  import { DEFAULT_MODEL, DEFAULT_SYSTEM_PROMPT } from '../../utils/presetHelpers'
  import {
    parseMaxTokens,
    parseTopP,
    parseTemperature,
    parseReasoning,
    parseVerbosity,
    parseReasoningSummary,
    parseThinkingBudget,
  } from './settingsDraft.svelte'
  import type { SettingsDraft } from './settingsDraft.svelte'

  interface Props {
    draft: SettingsDraft
  }

  const props: Props = $props()
  const draft = $derived(props.draft)
  const local = $derived(props.draft.local)

  const presetsForRender = () => draft.presets
  const activePreset = $derived(draft.activePreset)
  const activePresetId = $derived(draft.activePresetId)
  const activePresetModels = $derived(draft.activePresetModels)
  const activePresetSupportsResponsesApiFeatures = $derived(draft.activePresetSupportsResponsesApiFeatures)

  const selectPreset = (id) => draft.selectPreset(id)
  const addPreset = () => draft.addPreset()
  const removePreset = (id) => draft.removePreset(id)
  const updateActivePreset = (patch) => draft.updateActivePreset(patch)

  onMount(() => {
    // Model suggestions come from the shared cache; hydrate it lazily
    if (!draft.modelCacheLoaded) {
      requestAnimationFrame(() => draft.loadModelCaches())
    }
  })

  let expandedPresetGroups = $state<{ general: boolean, sampling: boolean, reasoning: boolean }>({ general: false, sampling: false, reasoning: false })

  function togglePresetGroup(group) {
    expandedPresetGroups = { ...expandedPresetGroups, [group]: !expandedPresetGroups[group] }
  }

  // Drag and drop state
  let draggedPresetId = $state<string | null>(null)
  let dragOverPresetId = $state<string | null>(null)

  // Touch drag state for mobile
  let touchDragId = $state<string | null>(null)
  let touchListRef = $state<HTMLElement | null>(null)

  function handlePresetDragStart(e: DragEvent, id: string) {
    draggedPresetId = id
    e.dataTransfer!.effectAllowed = 'move'
    e.dataTransfer!.setData('text/plain', id)
  }

  function handlePresetDragOver(e: DragEvent, id: string) {
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'
    if (!draggedPresetId || draggedPresetId === id) return
    dragOverPresetId = id
  }

  function handlePresetDrop(e: DragEvent) {
    e.preventDefault()
    if (draggedPresetId && dragOverPresetId && draggedPresetId !== dragOverPresetId) {
      draft.reorderPresets(draggedPresetId, dragOverPresetId)
    }
    draggedPresetId = null
    dragOverPresetId = null
  }

  function handlePresetDragEnd() {
    draggedPresetId = null
    dragOverPresetId = null
  }

  function handlePresetTouchStart(e: TouchEvent, id: string) {
    touchDragId = id
    draggedPresetId = id
    const listEl = (e.currentTarget as HTMLElement).closest('.item-list')
    if (listEl) touchListRef = listEl as HTMLElement
  }

  function handlePresetTouchMove(e: TouchEvent) {
    if (!touchDragId || !touchListRef) return
    e.preventDefault()
    const touchY = e.touches[0].clientY

    // Find which item the touch is over
    const items = touchListRef.querySelectorAll('.list-item')
    for (const item of items) {
      const id = item.getAttribute('data-id')
      if (id && id !== touchDragId) {
        const rect = item.getBoundingClientRect()
        if (touchY >= rect.top && touchY <= rect.bottom) {
          dragOverPresetId = id
          return
        }
      }
    }
  }

  function handlePresetTouchEnd() {
    if (touchDragId && dragOverPresetId) {
      draft.reorderPresets(touchDragId, dragOverPresetId)
    }
    touchDragId = null
    touchListRef = null
    draggedPresetId = null
    dragOverPresetId = null
  }
</script>

            <section class="group presets">
              <div class="group-head">
                <div class="group-title">Presets</div>
                <button type="button" class="icon-btn add-btn" title="Add preset" aria-label="Add preset" onclick={addPreset}>
                  <IconAdd style="font-size: 20px;" />
                </button>
              </div>
              <p class="hint section-hint">Configure model presets for different use cases. Drag to reorder.</p>
              <div class="item-list reorder-list">
                {#each presetsForRender() as preset (preset.id)}
                  {@const presetConnection = (local?.connections || []).find(c => c.id === preset.connectionId)}
                  {@const isDragging = draggedPresetId === preset.id}
                  {@const isDragOver = dragOverPresetId === preset.id && draggedPresetId !== preset.id}
                  <div
                    class="list-item {preset.id === activePresetId ? 'active' : ''} {isDragging ? 'dragging' : ''} {isDragOver ? 'drag-over' : ''}"
                    data-id={preset.id}
                    draggable="true"
                    ondragstart={(e) => handlePresetDragStart(e, preset.id)}
                    ondragover={(e) => handlePresetDragOver(e, preset.id)}
                    ondrop={handlePresetDrop}
                    ondragend={handlePresetDragEnd}
                    role="listitem"
                  >
                    <div
                      class="drag-handle"
                      aria-label="Drag to reorder"
                      ontouchstart={(e) => handlePresetTouchStart(e, preset.id)}
                      ontouchmove={handlePresetTouchMove}
                      ontouchend={handlePresetTouchEnd}
                      ontouchcancel={resetTouchState}
                    >
                      <IconDragHandle style="font-size: 20px;" />
                    </div>
                    <button
                      type="button"
                      class="item-content"
                      onclick={() => selectPreset(preset.id)}
                    >
                      <span class="item-name">{preset.name || 'Untitled'}</span>
                      <span class="item-meta">{preset.model || 'No model'} · {presetConnection?.name || 'No connection'}</span>
                    </button>
                    {#if (local?.presets?.length || 0) > 1}
                      <button
                        type="button"
                        class="item-delete"
                        onclick={() => removePreset(preset.id)}
                        title="Delete preset"
                        aria-label="Delete preset"
                      >
                        <IconDelete style="font-size: 18px;" />
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>
              {#if activePreset}
                <div class="form-section">
                  <div class="form-section-title">Edit: {activePreset.name || 'Preset'}</div>
                  <label class="field">
                    <span>Name</span>
                    <input
                      type="text"
                      placeholder="Preset name"
                      value={activePreset.name || ''}
                      oninput={(event) => updateActivePreset({ name: event.currentTarget.value })}
                      aria-label="Preset name"
                    />
                  </label>
                  <label class="field">
                    <span>System prompt</span>
                    <textarea
                      rows="3"
                      placeholder={DEFAULT_SYSTEM_PROMPT}
                      value={typeof activePreset.systemPrompt === 'string' ? activePreset.systemPrompt : ''}
                      oninput={(event) => updateActivePreset({ systemPrompt: event.currentTarget.value })}
                      aria-label="System prompt"
                    ></textarea>
                  </label>
                  <label class="field">
                    <span>Model</span>
                    <input
                      type="text"
                      placeholder={DEFAULT_MODEL}
                      value={activePreset.model || ''}
                      oninput={(event) => updateActivePreset({ model: event.currentTarget.value })}
                      list="preset-model-suggestions"
                      aria-label="Model"
                    />
                    {#if activePresetModels?.length}
                      <datalist id="preset-model-suggestions">
                        {#each activePresetModels as mid}
                          <option value={mid}>{mid}</option>
                        {/each}
                      </datalist>
                    {/if}
                  </label>

                <div class="preset-group-divider"></div>
                <button class="preset-group-header" onclick={() => togglePresetGroup('general')}>
                  <span>General</span>
                  <svg class={`chevron ${expandedPresetGroups.general ? 'expanded' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>

                {#if expandedPresetGroups.general}
                  <label class="switch" title="Stream">
                    <input
                      type="checkbox"
                      checked={!!activePreset.streaming}
                      onchange={(event) => updateActivePreset({ streaming: !!event.currentTarget.checked })}
                      aria-label="Stream"
                    />
                    <span class="switch-ui" aria-hidden="true"></span>
                    <span class="switch-label">Stream</span>
                  </label>
                  {#if activePresetSupportsResponsesApiFeatures}
                    <label class="switch" title="Web search (Responses API only)">
                      <input
                        type="checkbox"
                        checked={!!activePreset.webSearchEnabled}
                        onchange={(event) => updateActivePreset({ webSearchEnabled: !!event.currentTarget.checked })}
                        aria-label="Web search"
                      />
                      <span class="switch-ui" aria-hidden="true"></span>
                      <span class="switch-label">Web search</span>
                    </label>
                    <label class="switch" title="Code interpreter (Responses API only)">
                      <input
                        type="checkbox"
                        checked={!!activePreset.codeInterpreterEnabled}
                        onchange={(event) => updateActivePreset({ codeInterpreterEnabled: !!event.currentTarget.checked })}
                        aria-label="Code interpreter"
                      />
                      <span class="switch-ui" aria-hidden="true"></span>
                      <span class="switch-label">Code interpreter</span>
                    </label>
                    {#if activePreset.codeInterpreterEnabled}
                      <div class="tool-network-settings">
                        <label class="switch" title="Allow network access for code interpreter">
                          <input
                            type="checkbox"
                            checked={!!activePreset.codeInterpreterNetworkEnabled}
                            onchange={(event) => updateActivePreset({ codeInterpreterNetworkEnabled: !!event.currentTarget.checked })}
                            aria-label="Code interpreter network access"
                          />
                          <span class="switch-ui" aria-hidden="true"></span>
                          <span class="switch-label">Allow network</span>
                        </label>
                        {#if activePreset.codeInterpreterNetworkEnabled}
                          <label class="field">
                            <span>Allowed domains</span>
                            <input
                              type="text"
                              placeholder="e.g. api.github.com, pypi.org"
                              value={activePreset.codeInterpreterAllowedDomains || ''}
                              oninput={(event) => updateActivePreset({ codeInterpreterAllowedDomains: event.currentTarget.value || undefined })}
                              aria-label="Code interpreter allowed domains"
                            />
                          </label>
                        {/if}
                      </div>
                    {/if}
                    <label class="switch" title="Shell (Responses API only)">
                      <input
                        type="checkbox"
                        checked={!!activePreset.shellEnabled}
                        onchange={(event) => updateActivePreset({ shellEnabled: !!event.currentTarget.checked })}
                        aria-label="Shell"
                      />
                      <span class="switch-ui" aria-hidden="true"></span>
                      <span class="switch-label">Shell</span>
                    </label>
                    {#if activePreset.shellEnabled}
                      <div class="tool-network-settings">
                        <label class="switch" title="Allow network access for shell">
                          <input
                            type="checkbox"
                            checked={!!activePreset.shellNetworkEnabled}
                            onchange={(event) => updateActivePreset({ shellNetworkEnabled: !!event.currentTarget.checked })}
                            aria-label="Shell network access"
                          />
                          <span class="switch-ui" aria-hidden="true"></span>
                          <span class="switch-label">Allow network</span>
                        </label>
                        {#if activePreset.shellNetworkEnabled}
                          <label class="field">
                            <span>Allowed domains</span>
                            <input
                              type="text"
                              placeholder="e.g. api.github.com, registry.npmjs.org"
                              value={activePreset.shellAllowedDomains || ''}
                              oninput={(event) => updateActivePreset({ shellAllowedDomains: event.currentTarget.value || undefined })}
                              aria-label="Shell allowed domains"
                            />
                          </label>
                        {/if}
                      </div>
                    {/if}
                    <label class="switch" title="Image generation (Responses API only)">
                      <input
                        type="checkbox"
                        checked={!!activePreset.imageGenerationEnabled}
                        onchange={(event) => updateActivePreset({ imageGenerationEnabled: !!event.currentTarget.checked })}
                        aria-label="Image generation"
                      />
                      <span class="switch-ui" aria-hidden="true"></span>
                      <span class="switch-label">Image generation</span>
                    </label>
                    {#if activePreset.imageGenerationEnabled}
                      <label class="field">
                        <span>Image generation model</span>
                        <input
                          type="text"
                          placeholder="gpt-image-1"
                          value={activePreset.imageGenerationModel || ''}
                          oninput={(event) => updateActivePreset({ imageGenerationModel: event.currentTarget.value })}
                          aria-label="Image generation model"
                        />
                      </label>
                    {/if}
                    <label class="switch" title="MCP (Responses API only)">
                      <input
                        type="checkbox"
                        checked={!!activePreset.mcpEnabled}
                        onchange={(event) => updateActivePreset({ mcpEnabled: !!event.currentTarget.checked })}
                        aria-label="MCP"
                      />
                      <span class="switch-ui" aria-hidden="true"></span>
                      <span class="switch-label">MCP</span>
                    </label>
                    {#if activePreset.mcpEnabled}
                      <div class="tool-network-settings mcp-settings">
                        {#if activePreset.mcpServers?.length}
                          {#each activePreset.mcpServers as server, index (index)}
                            <div class="mcp-server-row">
                              <input
                                type="text"
                                placeholder="https://example.com/mcp"
                                value={server?.url || ''}
                                oninput={(event) => updateActivePreset({
                                  mcpServers: (activePreset.mcpServers || []).map((entry, entryIndex) => (
                                    entryIndex === index
                                      ? { ...entry, url: event.currentTarget.value }
                                      : entry
                                  )),
                                })}
                                aria-label={`MCP server URL ${index + 1}`}
                              />
                              <button
                                type="button"
                                class="mcp-remove-btn"
                                onclick={() => updateActivePreset({
                                  mcpServers: (activePreset.mcpServers || []).filter((_, entryIndex) => entryIndex !== index),
                                })}
                                aria-label={`Remove MCP server ${index + 1}`}
                                title="Remove MCP server"
                              >
                                <IconDelete style="font-size: 14px;" />
                              </button>
                            </div>
                          {/each}
                        {:else}
                          <div class="field-hint">No servers configured.</div>
                        {/if}
                        <button
                          type="button"
                          class="reset-btn mcp-add-btn"
                          onclick={() => updateActivePreset({
                            mcpServers: [...(activePreset.mcpServers || []), { label: '', url: '' }],
                          })}
                        >
                          Add MCP server
                        </button>
                      </div>
                    {/if}
                  {/if}
                  <label class="field">
                    <span>Text verbosity</span>
                    <select
                      value={activePreset.textVerbosity || 'medium'}
                      onchange={(event) => updateActivePreset({ textVerbosity: parseVerbosity(event.currentTarget.value) })}
                      aria-label="Text verbosity"
                    >
                      <option value="none">none</option>
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                    </select>
                  </label>
                  <label class="field">
                    <span>Connection</span>
                    <select
                      value={activePreset.connectionId || ''}
                      onchange={(event) => updateActivePreset({ connectionId: event.currentTarget.value })}
                      aria-label="Connection"
                    >
                      {#each (local?.connections || []) as connection (connection.id)}
                        <option value={connection.id}>{connection?.name || connection?.id || 'Connection'}</option>
                      {/each}
                    </select>
                  </label>
                {/if}

                <div class="preset-group-divider"></div>
                <button class="preset-group-header" onclick={() => togglePresetGroup('sampling')}>
                  <span>Sampling</span>
                  <svg class={`chevron ${expandedPresetGroups.sampling ? 'expanded' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>

                {#if expandedPresetGroups.sampling}
                  <label class="field">
                    <span>Top P</span>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.1"
                      placeholder="Default"
                      value={activePreset.topP ?? ''}
                      oninput={(event) => updateActivePreset({ topP: parseTopP(event.currentTarget.value) })}
                      aria-label="top_p"
                    />
                  </label>
                  <label class="field">
                    <span>Temperature</span>
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      placeholder="Default"
                      value={activePreset.temperature ?? ''}
                      oninput={(event) => updateActivePreset({ temperature: parseTemperature(event.currentTarget.value) })}
                      aria-label="Temperature"
                    />
                  </label>
                {/if}

                <div class="preset-group-divider"></div>
                <button class="preset-group-header" onclick={() => togglePresetGroup('reasoning')}>
                  <span>Reasoning</span>
                  <svg class={`chevron ${expandedPresetGroups.reasoning ? 'expanded' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>

                {#if expandedPresetGroups.reasoning}
                  <label class="field">
                    <span>Reasoning effort</span>
                    <select
                      value={activePreset.reasoningEffort || 'default'}
                      onchange={(event) => updateActivePreset({ reasoningEffort: parseReasoning(event.currentTarget.value) })}
                      aria-label="Reasoning effort"
                    >
                      <option value="default">Default</option>
                      <option value="none">none</option>
                      <option value="minimal">minimal</option>
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                      <option value="xhigh">xhigh</option>
                    </select>
                  </label>
                  <label class="field">
                    <span>Reasoning summary</span>
                    <select
                      value={activePreset.reasoningSummary || 'auto'}
                      onchange={(event) => updateActivePreset({ reasoningSummary: parseReasoningSummary(event.currentTarget.value) })}
                      aria-label="Reasoning summary"
                    >
                      <option value="none">none</option>
                      <option value="auto">auto</option>
                      <option value="concise">concise</option>
                      <option value="detailed">detailed</option>
                    </select>
                  </label>
                  {#if local.showThinkingSettings}
                    <label class="switch" title="Enable Anthropic thinking">
                      <input
                        type="checkbox"
                        checked={!!activePreset.thinkingEnabled}
                        onchange={(event) => updateActivePreset({ thinkingEnabled: !!event.currentTarget.checked })}
                        aria-label="Enable Anthropic thinking"
                      />
                      <span class="switch-ui" aria-hidden="true"></span>
                      <span class="switch-label">Anthropic thinking</span>
                    </label>
                    <label class="field">
                      <span>Thinking budget tokens</span>
                      <input
                        type="number"
                        min="1"
                        step="100"
                        placeholder="Budget tokens"
                        value={activePreset.thinkingBudgetTokens ?? ''}
                        oninput={(event) => updateActivePreset({ thinkingBudgetTokens: parseThinkingBudget(event.currentTarget.value) })}
                        aria-label="Thinking budget tokens"
                        disabled={!activePreset.thinkingEnabled}
                      />
                    </label>
                  {/if}
                {/if}
                </div>
              {/if}
            </section>

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    z-index: 1000;
    border: 0;
    padding: 0;
  }
  :global(:root[data-fancy-effects="true"]) .backdrop {
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    animation: backdrop-fade-in 0.2s ease-out;
  }
  @keyframes backdrop-fade-in {
    from { opacity: 0;
    }
    to { opacity: 1;
    }
  }
  .modal {
    position: fixed; inset: 0;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    z-index: 1001;
  }
  .panel {
    width: min(calc(100vw - 48px), 1080px);
    height: min(calc(100vh - 48px), 900px);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 20px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    color: var(--text);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  :global(:root[data-fancy-effects="true"]) .panel {
    box-shadow:
      0 0 0 1px rgba(0,0,0,0.03),
      0 4px 12px rgba(0,0,0,0.08),
      0 16px 48px rgba(0,0,0,0.12),
      0 24px 64px rgba(0,0,0,0.08);
    animation: panel-slide-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }
  :global(:root[data-theme='dark']) .panel {
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }
  :global(:root[data-theme='dark'][data-fancy-effects="true"]) .panel {
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.05),
      0 4px 12px rgba(0,0,0,0.3),
      0 16px 48px rgba(0,0,0,0.4),
      0 24px 64px rgba(0,0,0,0.3);
  }
  @keyframes panel-slide-in {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(8px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }
  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 28px;
    border-bottom: 1px solid var(--border);
    background: linear-gradient(180deg, var(--panel), color-mix(in srgb, var(--panel) 95%, var(--bg) 5%));
  }
  .title {
    font-weight: 700;
    font-size: 1.15rem;
    letter-spacing: -0.01em;
  }
  .tab-bar {
    display: flex;
    gap: 6px;
    padding: 12px 24px;
    border-bottom: 1px solid var(--border);
    overflow: hidden;
    background: color-mix(in srgb, var(--panel) 98%, var(--bg) 2%);
  }
  .tab {
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-weight: 500;
    padding: 10px 18px;
    position: relative;
    white-space: nowrap;
    cursor: pointer;
    border-radius: 10px;
    transition: color 0.15s ease, background 0.15s ease;
  }
  .tab:hover:not(.active) {
    color: var(--text);
    background: color-mix(in srgb, var(--border) 40%, transparent);
  }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px;
  }
  .tab.active {
    color: var(--text);
    background: color-mix(in srgb, var(--border) 60%, transparent);
  }
  .modal-body { flex: 1; overflow: hidden;
  }
  .modal-scroller {
    height: 100%;
    overflow-y: auto;
    padding: 28px;
    display: grid;
    gap: 20px;
    align-content: start;
  }
  .icon-btn {
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--panel);
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    line-height: 1;
    color: var(--text);
    transition: all 0.15s ease;
  }
  .icon-btn:hover:not(:disabled) {
    background: var(--bg);
    border-color: color-mix(in srgb, var(--border) 70%, var(--accent) 30%);
    transform: translateY(-1px);
  }
  .icon-btn:active:not(:disabled) {
    transform: translateY(0);
  }
  .icon-btn:disabled { opacity: .5; cursor: not-allowed;
  }
  .tool-network-settings {
    display: grid;
    gap: 10px;
    padding: 10px 12px;
    margin-left: 12px;
    border-left: 2px solid var(--border);
  }
  .mcp-settings {
    gap: 8px;
  }
  .mcp-server-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    align-items: center;
  }
  .mcp-remove-btn {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--panel);
    color: #d64545;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
  }
  .mcp-remove-btn:hover {
    background: color-mix(in srgb, #d64545 8%, var(--panel));
    border-color: color-mix(in srgb, #d64545 35%, var(--border));
  }
  .mcp-remove-btn:active {
    transform: scale(0.96);
  }
  .mcp-add-btn {
    width: fit-content;
  }
  .field-hint {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .field { display: grid; gap: 6px;
  }
  .field > span {
    font-size: .875rem;
    font-weight: 500;
    color: var(--muted);
  }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
  }
  input[type="text"], input[type="number"], select, textarea {
    flex: 1;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 11px 14px;
    background: var(--panel);
    color: var(--text);
    font: inherit;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  input[type="text"]:focus, input[type="number"]:focus, select:focus, textarea:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent);
  }
  input[type="text"]:hover:not(:focus), input[type="number"]:hover:not(:focus), select:hover:not(:focus), textarea:hover:not(:focus) {
    border-color: color-mix(in srgb, var(--border) 70%, var(--text) 30%);
  }
  textarea {
    min-height: 96px;
    line-height: 1.5;
    resize: vertical;
  }
  .hint {
    color: var(--muted);
    font-size: .85rem;
    margin-top: 2px;
    line-height: 1.4;
  }
  /* API key action buttons size */
  .group {
    display: grid;
    gap: 12px;
    padding: 20px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    transition: border-color 0.15s ease;
  }
  .group:hover {
    border-color: color-mix(in srgb, var(--border) 80%, var(--text) 20%);
  }
  .group-title {
    font-weight: 600;
    font-size: 1rem;
    letter-spacing: -0.01em;
    color: var(--text);
  }
  .group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 4px;
  }
  .group-head .icon-btn { flex-shrink: 0;
  }
  .presets .group-head .icon-btn { width: 32px; height: 32px; border-radius: 8px;
  }
  .preset-group-divider {
    height: 1px;
    background: var(--border);
    margin: 4px 0 0;
  }
  .preset-group-header {
    font-size: .75rem;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.6px;
    margin: 0;
    width: 100%;
    border: none;
    background: transparent;
    padding: 4px 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    user-select: none;
    transition: color 0.15s ease;
  }
  .preset-group-header:hover { color: var(--text);
  }
  .chevron {
    transition: transform .2s ease;
    flex-shrink: 0;
    opacity: 0.7;
  }
  .preset-group-header:hover .chevron {
    opacity: 1;
  }
  .chevron.expanded {
    transform: rotate(180deg);
  }
  .developer-group {
    background: color-mix(in srgb, var(--panel) 95%, var(--muted) 5%);
    border-style: dashed;
  }
  .legal-group {
    background: color-mix(in srgb, var(--panel) 96%, var(--accent) 4%);
  }
  .legal-link {
    color: var(--accent);
    font-size: 0.9rem;
    text-decoration: underline;
    text-underline-offset: 2px;
    word-break: break-all;
  }
  .legal-link:hover, .legal-link:focus-visible {
    color: color-mix(in srgb, var(--accent) 80%, var(--text) 20%);
  }
  /* Item list for connections and presets */
  .section-hint {
    margin: 0 0 8px;
    opacity: 0.9;
  }
  .item-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 20px;
  }
  .list-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px;
    border-radius: 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .list-item:hover {
    border-color: color-mix(in srgb, var(--border) 60%, var(--accent) 40%);
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  }
  .list-item.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, var(--bg) 94%);
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--accent) 12%, transparent),
      0 2px 8px rgba(0,0,0,0.06);
  }
  .list-item.dragging {
    opacity: 0.5;
    border-style: dashed;
    border-color: var(--accent);
    transform: scale(0.98);
    z-index: 10;
    background: color-mix(in srgb, var(--accent) 8%, var(--bg) 92%);
  }
  /* Reorder list with smooth transitions */
  .reorder-list .list-item {
    transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1), opacity 0.15s ease, border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
  }
  .reorder-list .list-item.dragging {
    transition: opacity 0.15s ease, border-color 0.15s ease;
  }
  /* Remove old drag-over highlight - items now shift visually */
  .list-item.drag-over {
    /* Items shift position instead of just highlighting */
  }
  .drag-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 44px;
    color: var(--muted);
    cursor: grab;
    border: none;
    background: transparent;
    border-radius: 8px;
    flex-shrink: 0;
    transition: color 0.15s ease, background 0.15s ease;
    opacity: 0.7;
    touch-action: none;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }
  .list-item:hover .drag-handle {
    opacity: 1;
  }
  .drag-handle:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--border) 40%, transparent);
  }
  .drag-handle:active {
    cursor: grabbing;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  /* Mobile: always show drag handle clearly */
  @media (pointer: coarse) {
    .drag-handle {
      opacity: 1;
      width: 44px;
      height: 48px;
    }
  }
  .item-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    padding: 8px 10px;
    text-align: left;
    border: none;
    background: transparent;
    border-radius: 8px;
    min-width: 0;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .item-content:hover {
    background: color-mix(in srgb, var(--border) 25%, transparent);
  }
  .item-name {
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .item-meta {
    font-size: 0.8rem;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .item-delete {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    color: var(--muted);
    border: none;
    background: transparent;
    border-radius: 8px;
    flex-shrink: 0;
    cursor: pointer;
    transition: all 0.15s ease;
    opacity: 0.6;
  }
  .list-item:hover .item-delete {
    opacity: 1;
  }
  .item-delete:hover {
    color: #e53935;
    background: rgba(229, 57, 53, 0.12);
  }
  :global(:root[data-theme='dark']) .item-delete:hover {
    background: rgba(229, 57, 53, 0.18);
  }
  /* Form section styling */
  .form-section {
    display: grid;
    gap: 10px;
    padding: 20px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: inset 0 1px 2px rgba(0,0,0,0.02);
  }
  .form-section-title {
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--text);
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
  .status-msg {
    padding: 10px 14px;
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--accent) 15%, transparent);
    font-size: 0.9rem;
  }
  /* Add button styling */
  .add-btn {
    background: color-mix(in srgb, var(--accent) 10%, var(--panel) 90%);
    border-color: color-mix(in srgb, var(--accent) 25%, transparent);
    color: var(--accent);
  }
  .add-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 18%, var(--panel) 82%);
    border-color: color-mix(in srgb, var(--accent) 50%, transparent);
    transform: translateY(-1px);
  }
  /* Legacy styles kept for backward compatibility */
  .preset-strip { display: flex; flex-wrap: wrap; gap: 6px;
  }
  .preset-pill { border: 1px solid var(--border); border-radius: 999px; padding: 4px 10px; background: var(--bg); color: var(--text); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-size: .85rem; transition: background-color .15s ease, color .15s ease, border-color .15s ease;
  }
  .preset-pill:hover { border-color: color-mix(in srgb, var(--border) 55%, var(--accent) 45%);
  }
  .preset-pill.active { background: var(--accent); border-color: transparent; color: #fff; box-shadow: 0 2px 5px rgba(0,0,0,0.14);
  }
  .preset-pill-name { pointer-events: none;
  }
  .preset-delete { display: inline-flex; align-items: center; gap: 6px; border: 1px solid rgba(214,69,69,0.4); border-radius: 8px; padding: 4px 8px; background: transparent; color: #d64545; cursor: pointer; width: fit-content; font-size: .85rem;
  }
  .preset-delete:hover { background: rgba(214,69,69,0.06);
  }
  .preset-delete:focus-visible { outline: 2px solid rgba(214,69,69,0.6); outline-offset: 2px;
  }
  .connection-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
  }
  /* Toggle switch */
  .switch {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    user-select: none;
  }
  .switch > input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none;
  }
  .switch-ui {
    width: 46px;
    height: 26px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--border) 80%, var(--muted) 20%);
    position: relative;
    transition: background-color .2s ease, box-shadow .2s ease;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
  }
  .switch-ui::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2), 0 2px 6px rgba(0,0,0,0.1);
    transition: transform .2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .switch:hover .switch-ui {
    background: color-mix(in srgb, var(--border) 60%, var(--muted) 40%);
  }
  :global(:root[data-theme='dark']) .switch-ui {
    background: #2a2a2a;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.3);
  }
  :global(:root[data-theme='dark']) .switch-ui::after { background: #e6e6e6;
  }
  .switch > input:checked + .switch-ui {
    background: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
  }
  .switch > input:checked + .switch-ui::after { transform: translateX(20px);
  }
  .switch-label {
    font-size: .95rem;
    font-weight: 500;
    color: var(--text);
  }
  .data-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .data-action-btn {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .data-action-btn:hover:not(:disabled) {
    background: var(--panel);
    border-color: color-mix(in srgb, var(--border) 60%, var(--accent) 40%);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  }
  .data-action-btn:active:not(:disabled) {
    transform: translateY(0);
  }
  .data-action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  @media (max-width: 640px) {
    .modal { padding: 0;
    }
    .panel {
      width: 100%;
      height: 100%;
      border-radius: 0;
      border: none;
    }
    .modal-head { padding: 16px 20px;
    }
    .tab-bar { padding: 10px 16px; gap: 4px;
    }
    .tab { padding: 8px 14px; font-size: 0.9rem;
    }
    .modal-scroller { padding: 20px; gap: 16px;
    }
    .group { padding: 16px; border-radius: 12px;
    }
    .data-actions { flex-direction: column;
    }
    .data-action-btn { width: 100%; justify-content: center;
    }
  }
  /* Smooth scrollbar styling */
  .modal-scroller::-webkit-scrollbar {
    width: 8px;
  }
  .modal-scroller::-webkit-scrollbar-track {
    background: transparent;
  }
  .modal-scroller::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 4px;
  }
  .modal-scroller::-webkit-scrollbar-thumb:hover {
    background: var(--muted);
  }
  /* Reset button */
  .reset-btn {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    color: var(--muted);
    font: inherit;
    font-size: 0.8rem;
    font-weight: 500;
    padding: 6px 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .reset-btn:hover {
    color: var(--text);
    border-color: color-mix(in srgb, var(--border) 60%, var(--text) 30%);
    background: var(--bg);
  }
  /* Action item in message buttons list */
  .action-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    flex-wrap: wrap;
  }
  .action-item-label {
    flex: 1;
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--text);
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 8px 4px;
  }
  .action-item.disabled-action {
    opacity: 0.7;
    background: color-mix(in srgb, var(--bg) 90%, var(--muted) 10%);
  }
  .message-role-checks {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-left: auto;
  }
  .role-check {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.8rem;
    color: var(--muted);
    user-select: none;
  }
  .action-toggle {
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    flex-shrink: 0;
    user-select: none;
  }
  /* Tools grid */
  .tools-grid {
    display: grid;
    gap: 8px;
  }
  .tool-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 16px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    user-select: none;
  }
  .tool-card:hover {
    border-color: color-mix(in srgb, var(--border) 60%, var(--accent) 40%);
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  }
  .tool-card-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--accent) 10%, var(--panel) 90%);
    color: var(--accent);
    flex-shrink: 0;
    transition: background 0.15s ease;
  }
  .tool-card-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .tool-card-name {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
  }
  .tool-card-desc {
    font-size: 0.8rem;
    color: var(--muted);
    line-height: 1.3;
  }
  .tool-card-toggle {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }
</style>

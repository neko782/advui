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

  // Default preset for new chat-mode chats (skips the preset menu)
  const isDefaultForNewChats = $derived(
    !!activePreset?.id && local?.defaultNewChatPresetId === activePreset.id
  )
  function toggleDefaultForNewChats(checked: boolean) {
    if (!activePreset?.id) return
    local.defaultNewChatPresetId = checked ? activePreset.id : ''
    draft.persist()
  }
  function toggleTavernOnly(checked: boolean) {
    updateActivePreset({ tavernOnly: checked })
    // A tavern-only preset can't be the chat-mode default
    if (checked && local?.defaultNewChatPresetId === activePreset?.id) {
      local.defaultNewChatPresetId = ''
      draft.persist()
    }
  }

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
    const listEl = (e.currentTarget as HTMLElement).closest('.ui-item-list')
    if (listEl) touchListRef = listEl as HTMLElement
  }

  function handlePresetTouchMove(e: TouchEvent) {
    if (!touchDragId || !touchListRef) return
    e.preventDefault()
    const touchY = e.touches[0].clientY

    // Find which item the touch is over
    const items = touchListRef.querySelectorAll('.ui-list-item')
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

  function resetTouchState() {
    touchDragId = null
    touchListRef = null
    draggedPresetId = null
    dragOverPresetId = null
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

            <section class="ui-group presets">
              <div class="ui-group-head">
                <div class="ui-group-title">Presets</div>
                <button type="button" class="ui-icon-btn accent" title="Add preset" aria-label="Add preset" onclick={addPreset}>
                  <IconAdd style="font-size: 20px;" />
                </button>
              </div>
              <p class="ui-hint">Configure model presets for different use cases. Drag to reorder.</p>
              <div class="ui-item-list ui-reorder-list">
                {#each presetsForRender() as preset (preset.id)}
                  {@const presetConnection = (local?.connections || []).find(c => c.id === preset.connectionId)}
                  {@const isDragging = draggedPresetId === preset.id}
                  {@const isDragOver = dragOverPresetId === preset.id && draggedPresetId !== preset.id}
                  <div
                    class="ui-list-item {preset.id === activePresetId ? 'active' : ''} {isDragging ? 'dragging' : ''} {isDragOver ? 'drag-over' : ''}"
                    data-id={preset.id}
                    draggable="true"
                    ondragstart={(e) => handlePresetDragStart(e, preset.id)}
                    ondragover={(e) => handlePresetDragOver(e, preset.id)}
                    ondrop={handlePresetDrop}
                    ondragend={handlePresetDragEnd}
                    role="listitem"
                  >
                    <div
                      class="ui-drag-handle"
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
                      class="ui-item-content"
                      onclick={() => selectPreset(preset.id)}
                    >
                      <span class="ui-item-name">
                        {preset.name || 'Untitled'}
                        {#if local?.defaultNewChatPresetId && preset.id === local.defaultNewChatPresetId}
                          <span class="ui-item-badge">default</span>
                        {/if}
                        {#if preset.tavernOnly}
                          <span class="ui-item-badge neutral">tavern</span>
                        {/if}
                      </span>
                      <span class="ui-item-meta">{preset.model || 'No model'} · {presetConnection?.name || 'No connection'}</span>
                    </button>
                    {#if (local?.presets?.length || 0) > 1}
                      <button
                        type="button"
                        class="ui-item-delete"
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
                <div class="ui-form-section">
                  <div class="ui-form-section-title">Edit: {activePreset.name || 'Preset'}</div>
                  <label class="ui-field">
                    <span>Name</span>
                    <input
                      class="ui-input"
                      type="text"
                      placeholder="Preset name"
                      value={activePreset.name || ''}
                      oninput={(event) => updateActivePreset({ name: event.currentTarget.value })}
                      aria-label="Preset name"
                    />
                  </label>
                  <label class="ui-switch" title="Only offer this preset in tavern mode">
                    <input
                      type="checkbox"
                      checked={!!activePreset.tavernOnly}
                      onchange={(event) => toggleTavernOnly(!!event.currentTarget.checked)}
                      aria-label="Tavern only"
                    />
                    <span class="ui-switch-ui" aria-hidden="true"></span>
                    <span class="ui-switch-label">Tavern only</span>
                  </label>
                  <p class="ui-hint">Hide this preset from Chat mode — it only shows up in tavern preset pickers.</p>
                  {#if !activePreset.tavernOnly}
                    <label class="ui-switch" title="Use this preset for new chats without asking">
                      <input
                        type="checkbox"
                        checked={isDefaultForNewChats}
                        onchange={(event) => toggleDefaultForNewChats(!!event.currentTarget.checked)}
                        aria-label="Default for new chats"
                      />
                      <span class="ui-switch-ui" aria-hidden="true"></span>
                      <span class="ui-switch-label">Default for new chats</span>
                    </label>
                    <p class="ui-hint">New chats use this preset immediately instead of asking which preset to use.</p>
                  {/if}
                  <label class="ui-field">
                    <span>System prompt</span>
                    <textarea
                      class="ui-textarea"
                      rows="3"
                      placeholder={DEFAULT_SYSTEM_PROMPT}
                      value={typeof activePreset.systemPrompt === 'string' ? activePreset.systemPrompt : ''}
                      oninput={(event) => updateActivePreset({ systemPrompt: event.currentTarget.value })}
                      aria-label="System prompt"
                    ></textarea>
                  </label>
                  <label class="ui-field">
                    <span>Model</span>
                    <input
                      class="ui-input"
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
                  <label class="ui-switch" title="Stream">
                    <input
                      type="checkbox"
                      checked={!!activePreset.streaming}
                      onchange={(event) => updateActivePreset({ streaming: !!event.currentTarget.checked })}
                      aria-label="Stream"
                    />
                    <span class="ui-switch-ui" aria-hidden="true"></span>
                    <span class="ui-switch-label">Stream</span>
                  </label>
                  {#if activePresetSupportsResponsesApiFeatures}
                    <label class="ui-switch" title="Web search (Responses API only)">
                      <input
                        type="checkbox"
                        checked={!!activePreset.webSearchEnabled}
                        onchange={(event) => updateActivePreset({ webSearchEnabled: !!event.currentTarget.checked })}
                        aria-label="Web search"
                      />
                      <span class="ui-switch-ui" aria-hidden="true"></span>
                      <span class="ui-switch-label">Web search</span>
                    </label>
                    <label class="ui-switch" title="Code interpreter (Responses API only)">
                      <input
                        type="checkbox"
                        checked={!!activePreset.codeInterpreterEnabled}
                        onchange={(event) => updateActivePreset({ codeInterpreterEnabled: !!event.currentTarget.checked })}
                        aria-label="Code interpreter"
                      />
                      <span class="ui-switch-ui" aria-hidden="true"></span>
                      <span class="ui-switch-label">Code interpreter</span>
                    </label>
                    {#if activePreset.codeInterpreterEnabled}
                      <div class="tool-network-settings">
                        <label class="ui-switch" title="Allow network access for code interpreter">
                          <input
                            type="checkbox"
                            checked={!!activePreset.codeInterpreterNetworkEnabled}
                            onchange={(event) => updateActivePreset({ codeInterpreterNetworkEnabled: !!event.currentTarget.checked })}
                            aria-label="Code interpreter network access"
                          />
                          <span class="ui-switch-ui" aria-hidden="true"></span>
                          <span class="ui-switch-label">Allow network</span>
                        </label>
                        {#if activePreset.codeInterpreterNetworkEnabled}
                          <label class="ui-field">
                            <span>Allowed domains</span>
                            <input
                              class="ui-input"
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
                    <label class="ui-switch" title="Shell (Responses API only)">
                      <input
                        type="checkbox"
                        checked={!!activePreset.shellEnabled}
                        onchange={(event) => updateActivePreset({ shellEnabled: !!event.currentTarget.checked })}
                        aria-label="Shell"
                      />
                      <span class="ui-switch-ui" aria-hidden="true"></span>
                      <span class="ui-switch-label">Shell</span>
                    </label>
                    {#if activePreset.shellEnabled}
                      <div class="tool-network-settings">
                        <label class="ui-switch" title="Allow network access for shell">
                          <input
                            type="checkbox"
                            checked={!!activePreset.shellNetworkEnabled}
                            onchange={(event) => updateActivePreset({ shellNetworkEnabled: !!event.currentTarget.checked })}
                            aria-label="Shell network access"
                          />
                          <span class="ui-switch-ui" aria-hidden="true"></span>
                          <span class="ui-switch-label">Allow network</span>
                        </label>
                        {#if activePreset.shellNetworkEnabled}
                          <label class="ui-field">
                            <span>Allowed domains</span>
                            <input
                              class="ui-input"
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
                    <label class="ui-switch" title="Image generation (Responses API only)">
                      <input
                        type="checkbox"
                        checked={!!activePreset.imageGenerationEnabled}
                        onchange={(event) => updateActivePreset({ imageGenerationEnabled: !!event.currentTarget.checked })}
                        aria-label="Image generation"
                      />
                      <span class="ui-switch-ui" aria-hidden="true"></span>
                      <span class="ui-switch-label">Image generation</span>
                    </label>
                    {#if activePreset.imageGenerationEnabled}
                      <label class="ui-field">
                        <span>Image generation model</span>
                        <input
                          class="ui-input"
                          type="text"
                          placeholder="gpt-image-1"
                          value={activePreset.imageGenerationModel || ''}
                          oninput={(event) => updateActivePreset({ imageGenerationModel: event.currentTarget.value })}
                          aria-label="Image generation model"
                        />
                      </label>
                    {/if}
                    <label class="ui-switch" title="MCP (Responses API only)">
                      <input
                        type="checkbox"
                        checked={!!activePreset.mcpEnabled}
                        onchange={(event) => updateActivePreset({ mcpEnabled: !!event.currentTarget.checked })}
                        aria-label="MCP"
                      />
                      <span class="ui-switch-ui" aria-hidden="true"></span>
                      <span class="ui-switch-label">MCP</span>
                    </label>
                    {#if activePreset.mcpEnabled}
                      <div class="tool-network-settings mcp-settings">
                        {#if activePreset.mcpServers?.length}
                          {#each activePreset.mcpServers as server, index (index)}
                            <div class="mcp-server-row">
                              <input
                                class="ui-input"
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
                                class="ui-icon-btn ui-icon-btn-sm danger"
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
                          <div class="ui-hint">No servers configured.</div>
                        {/if}
                        <button
                          type="button"
                          class="ui-btn ui-btn-outline ui-btn-sm mcp-add-btn"
                          onclick={() => updateActivePreset({
                            mcpServers: [...(activePreset.mcpServers || []), { label: '', url: '' }],
                          })}
                        >
                          Add MCP server
                        </button>
                      </div>
                    {/if}
                  {/if}
                  <label class="ui-field">
                    <span>Text verbosity</span>
                    <select
                      class="ui-select"
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
                  <label class="ui-field">
                    <span>Connection</span>
                    <select
                      class="ui-select"
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
                  <label class="ui-field">
                    <span>Top P</span>
                    <input
                      class="ui-input"
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
                  <label class="ui-field">
                    <span>Temperature</span>
                    <input
                      class="ui-input"
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
                  <label class="ui-field">
                    <span>Reasoning effort</span>
                    <select
                      class="ui-select"
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
                  <label class="ui-field">
                    <span>Reasoning summary</span>
                    <select
                      class="ui-select"
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
                    <label class="ui-switch" title="Enable Anthropic thinking">
                      <input
                        type="checkbox"
                        checked={!!activePreset.thinkingEnabled}
                        onchange={(event) => updateActivePreset({ thinkingEnabled: !!event.currentTarget.checked })}
                        aria-label="Enable Anthropic thinking"
                      />
                      <span class="ui-switch-ui" aria-hidden="true"></span>
                      <span class="ui-switch-label">Anthropic thinking</span>
                    </label>
                    <label class="ui-field">
                      <span>Thinking budget tokens</span>
                      <input
                        class="ui-input"
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
  /* Chrome, form controls, lists, switches and buttons come from shared ui.css.
     Only preset-specific styles remain. */
  .preset-group-divider {
    height: 1px;
    background: var(--border);
  }
  .preset-group-header {
    font-size: 0.75rem;
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
    transition: color var(--dur) var(--ease);
  }
  .preset-group-header:hover { color: var(--text); }
  .chevron {
    transition: transform 0.2s ease;
    flex-shrink: 0;
    opacity: 0.7;
  }
  .preset-group-header:hover .chevron { opacity: 1; }
  .chevron.expanded { transform: rotate(180deg); }
  .tool-network-settings {
    display: grid;
    gap: var(--s2);
    padding: var(--s2) var(--s3);
    margin-left: var(--s3);
    border-left: 2px solid var(--border);
  }
  .mcp-server-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--s2);
    align-items: center;
  }
</style>

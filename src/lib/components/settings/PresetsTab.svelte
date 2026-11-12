<script lang="ts">
  import OpenRouterProviderInput from '../OpenRouterProviderInput.svelte'
  import ModelInput from '../ModelInput.svelte'
  import ToolsPicker, { TOOLS } from '../ToolsPicker.svelte'
  import { onMount } from 'svelte'
  import { IconAdd, IconDelete, IconDragHandle } from '../../icons'
  import { DEFAULT_SYSTEM_PROMPT } from '../../utils/presetHelpers'
  import { parseReasoning, parseVerbosity, parseReasoningSummary } from './settingsDraft.svelte'
  import { parseTopP, parseTemperature, parseThinkingBudgetTokens } from '../../utils/validation'
  import { reasoningLevelOptions } from '../../utils/reasoningLevels'
  import type { SettingsDraft } from './settingsDraft.svelte'

  interface Props {
    draft: SettingsDraft
    active?: boolean
  }

  const props: Props = $props()
  const draft = $derived(props.draft)
  const local = $derived(props.draft.local)

  const presetsForRender = () => draft.presets
  const activePreset = $derived(draft.activePreset)
  const presetConnection = $derived((local?.connections || []).find(c => c.id === activePreset?.connectionId))
  const activePresetId = $derived(draft.activePresetId)
  const reasoningLevels = $derived(reasoningLevelOptions(presetConnection?.apiMode, {
    legacy: !!local?.showLegacyParams,
    selected: activePreset?.reasoningEffort,
  }))
  const activePresetModels = $derived(draft.activePresetModels)
  const activePresetSupportsResponsesApiFeatures = $derived(draft.activePresetSupportsResponsesApiFeatures)

  const selectPreset = (id: string) => draft.selectPreset(id)
  const addPreset = () => draft.addPreset()
  const removePreset = (id: string) => draft.removePreset(id)
  const updateActivePreset = (patch: Parameters<SettingsDraft['updateActivePreset']>[0]) => draft.updateActivePreset(patch)

  // Where a preset is offered. "Default for new chats" and "Tavern only"
  // exclude each other, so they are one choice rather than two switches.
  type Availability = 'everywhere' | 'default' | 'tavern'
  const AVAILABILITY: { id: Availability, label: string, hint: string }[] = [
    { id: 'everywhere', label: 'Everywhere', hint: 'Offered in both Chat and Tavern preset pickers.' },
    { id: 'default', label: 'Default for new chats', hint: 'New chats use this preset immediately instead of asking which preset to use.' },
    { id: 'tavern', label: 'Tavern only', hint: 'Hidden from Chat mode — it only shows up in Tavern preset pickers.' },
  ]
  const availability = $derived<Availability>(
    activePreset?.tavernOnly ? 'tavern'
      : activePreset?.id && local?.defaultNewChatPresetId === activePreset.id ? 'default'
      : 'everywhere'
  )
  function setAvailability(next: Availability) {
    if (!activePreset?.id || next === availability) return
    if (!!activePreset.tavernOnly !== (next === 'tavern')) updateActivePreset({ tavernOnly: next === 'tavern' })
    const isDefault = local.defaultNewChatPresetId === activePreset.id
    if (next === 'default' && !isDefault) {
      local.defaultNewChatPresetId = activePreset.id
      draft.persist()
    } else if (next !== 'default' && isDefault) {
      local.defaultNewChatPresetId = ''
      draft.persist()
    }
  }

  const anyToolAvailable = $derived(TOOLS.some(tool => !draft.disabledTools[tool.id]))

  onMount(() => {
    // Model suggestions come from the shared cache; hydrate it lazily
    if (!draft.modelCacheLoaded) {
      requestAnimationFrame(() => draft.loadModelCaches())
    }
  })

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
    const touchY = e.touches[0]?.clientY ?? 0

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
                    ondragstart={(e) => handlePresetDragStart(e, preset.id ?? '')}
                    ondragover={(e) => handlePresetDragOver(e, preset.id ?? '')}
                    ondrop={handlePresetDrop}
                    ondragend={handlePresetDragEnd}
                    role="listitem"
                  >
                    <div
                      class="ui-drag-handle"
                      aria-label="Drag to reorder"
                      ontouchstart={(e) => handlePresetTouchStart(e, preset.id ?? '')}
                      ontouchmove={handlePresetTouchMove}
                      ontouchend={handlePresetTouchEnd}
                      ontouchcancel={resetTouchState}
                    >
                      <IconDragHandle style="font-size: 20px;" />
                    </div>
                    <button
                      type="button"
                      class="ui-item-content"
                      onclick={() => selectPreset(preset.id ?? '')}
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
                        onclick={() => removePreset(preset.id ?? '')}
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
                  <div class="ui-field">
                    <span>Available in</span>
                    <div class="ui-segmented ui-segmented-bordered" role="radiogroup" aria-label="Preset availability">
                      {#each AVAILABILITY as option (option.id)}
                        <button
                          type="button"
                          role="radio"
                          class="ui-segment"
                          class:active={availability === option.id}
                          aria-checked={availability === option.id}
                          onclick={() => setAvailability(option.id)}
                        >{option.label}</button>
                      {/each}
                    </div>
                    <p class="ui-hint">{AVAILABILITY.find(option => option.id === availability)?.hint}</p>
                  </div>
                  <div class="ui-grid-2 preset-grid">
                    <div class="ui-field">
                      <span>Connection</span>
                      <div class="connection-row">
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
                        {#if presetConnection?.openRouterEnabled && presetConnection.apiMode !== 'gemini'}
                          <OpenRouterProviderInput value={activePreset.openRouterProvider} active={props.active ?? true}
                            onInput={(value) => updateActivePreset({ openRouterProvider: value })}
                            zdr={activePreset.openRouterZdr} onZdr={(value) => updateActivePreset({ openRouterZdr: value })} />
                        {/if}
                      </div>
                    </div>
                    <div class="ui-field">
                      <span>Model</span>
                      <ModelInput active={props.active ?? true} value={activePreset.model || ''} models={activePresetModels}
                        onInput={(value) => updateActivePreset({ model: value })} />
                    </div>
                  </div>
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

                  {#if anyToolAvailable}
                    <div class="ui-subhead">Tools</div>
                    {#if activePresetSupportsResponsesApiFeatures}
                      <ToolsPicker value={activePreset} onChange={updateActivePreset} hidden={draft.disabledTools} />
                    {:else}
                      <p class="ui-hint">Tools are available on Responses API connections.</p>
                    {/if}
                  {/if}

                  <div class="ui-subhead">Generation</div>
                  <div class="ui-grid-2 preset-grid">
                    <label class="ui-field">
                      <span>Reasoning effort</span>
                      <select
                        class="ui-select"
                        value={activePreset.reasoningEffort || 'default'}
                        onchange={(event) => updateActivePreset({ reasoningEffort: parseReasoning(event.currentTarget.value) })}
                        aria-label="Reasoning effort"
                      >
                        {#each reasoningLevels as level (level.value)}
                          <option value={level.value}>{level.label}</option>
                        {/each}
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
                    <div class="ui-field">
                      <span>Streaming</span>
                      <label class="ui-switch ui-switch-cell" title="Stream">
                        <input
                          type="checkbox"
                          checked={!!activePreset.streaming}
                          onchange={(event) => updateActivePreset({ streaming: !!event.currentTarget.checked })}
                          aria-label="Stream"
                        />
                        <span class="ui-switch-ui" aria-hidden="true"></span>
                        <span class="ui-switch-label">{activePreset.streaming ? 'On' : 'Off'}</span>
                      </label>
                    </div>
                    {#if local.showLegacyParams}
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
                      {#if presetConnection?.apiMode !== 'gemini'}
                        <div class="ui-field">
                          <span>Anthropic thinking</span>
                          <label class="ui-switch ui-switch-cell" title="Enable Anthropic thinking">
                            <input
                              type="checkbox"
                              checked={!!activePreset.thinkingEnabled}
                              onchange={(event) => updateActivePreset({ thinkingEnabled: !!event.currentTarget.checked })}
                              aria-label="Enable Anthropic thinking"
                            />
                            <span class="ui-switch-ui" aria-hidden="true"></span>
                            <span class="ui-switch-label">{activePreset.thinkingEnabled ? 'On' : 'Off'}</span>
                          </label>
                        </div>
                        <label class="ui-field">
                          <span>Thinking budget</span>
                          <input
                            class="ui-input"
                            type="number"
                            min="1"
                            step="100"
                            placeholder="Tokens"
                            value={activePreset.thinkingBudgetTokens ?? ''}
                            oninput={(event) => updateActivePreset({ thinkingBudgetTokens: parseThinkingBudgetTokens(event.currentTarget.value) })}
                            aria-label="Thinking budget tokens"
                            disabled={!activePreset.thinkingEnabled}
                          />
                        </label>
                      {/if}
                    {/if}
                  </div>
                </div>
              {/if}
            </section>

<style>
  /* Chrome, form controls, lists, switches, chips and buttons come from
     shared ui.css. Only preset-specific layout remains. */
  .connection-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px; }
  .ui-segmented { flex-wrap: wrap; }
  @media (max-width: 520px) {
    .preset-grid { grid-template-columns: minmax(0, 1fr); }
    .ui-segmented { width: 100%; }
    .ui-segment { flex: 1 1 auto; }
  }
</style>

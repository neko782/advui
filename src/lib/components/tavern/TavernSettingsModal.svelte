<script lang="ts">
  import { IconClose, IconAdd, IconDelete, IconDownload, IconUpload, IconArrowUpward, IconArrowDownward, IconContentCopy, IconChevronRight } from '../../icons'
  import {
    generatePromptPresetId,
    generatePromptBlockId,
    generatePersonaId,
    makeDefaultPromptPreset,
    exportPromptPreset,
    importPromptPreset,
  } from '../../tavern/promptPresets'
  import type { Preset } from '../../types'
  import type { PromptPreset, PromptBlock, PromptBlockMarker, Persona } from '../../types/tavern'

  type AvatarShape = 'circle' | 'rounded' | 'card'

  interface Props {
    open?: boolean
    /** Connection presets (selection only; edited in the main Settings). */
    connectionPresets?: Preset[]
    tavernSelectedPresetId?: string
    tavernPerChatPresets?: boolean
    promptPresets?: PromptPreset[]
    selectedPromptPresetId?: string
    personas?: Persona[]
    selectedPersonaId?: string
    avatarShape?: AvatarShape
    onSave?: (data: {
      tavernSelectedPresetId: string
      tavernPerChatPresets: boolean
      promptPresets: PromptPreset[]
      selectedPromptPresetId: string
      personas: Persona[]
      selectedPersonaId: string
      tavernAvatarShape: AvatarShape
    }) => void
    onClose?: () => void
  }

  const props: Props = $props()

  const TABS = [
    { id: 'general', label: 'General' },
    { id: 'prompts', label: 'Prompts' },
    { id: 'personas', label: 'Personas' },
  ] as const

  let tab = $state<'general' | 'prompts' | 'personas'>('general')
  let presets = $state<PromptPreset[]>([])
  let selectedId = $state('')
  let personas = $state<Persona[]>([])
  let selectedPersonaId = $state('')
  let connectionPresetId = $state('')
  let perChatPresets = $state(false)
  let avatarShape = $state<AvatarShape>('circle')
  let expandedBlockId = $state<string | null>(null)
  let errorText = $state('')
  let wasOpen = $state(false)
  let importInput = $state<HTMLInputElement | null>(null)

  $effect(() => {
    if (props.open && !wasOpen) {
      tab = 'general'
      presets = JSON.parse(JSON.stringify(props.promptPresets || []))
      if (!presets.length) presets = [makeDefaultPromptPreset()]
      selectedId = presets.some(p => p.id === props.selectedPromptPresetId)
        ? props.selectedPromptPresetId!
        : presets[0].id
      personas = JSON.parse(JSON.stringify(props.personas || []))
      if (!personas.length) personas = [{ id: 'persona-default', name: 'User', description: '' }]
      selectedPersonaId = personas.some(p => p.id === props.selectedPersonaId)
        ? props.selectedPersonaId!
        : personas[0].id!
      connectionPresetId = props.tavernSelectedPresetId || (props.connectionPresets?.[0]?.id ?? '') || ''
      perChatPresets = !!props.tavernPerChatPresets
      avatarShape = props.avatarShape === 'rounded' || props.avatarShape === 'card' ? props.avatarShape : 'circle'
      expandedBlockId = null
      errorText = ''
    }
    wasOpen = !!props.open
  })

  // Live save (same behavior as the main Settings modal): persist every change
  // immediately, no Save/Cancel buttons.
  let persistInitialized = $state(false)
  let lastPersistSig = $state('')
  $effect(() => {
    const sig = JSON.stringify({
      presets, selectedId, personas, selectedPersonaId,
      connectionPresetId, perChatPresets, avatarShape,
    })
    if (!props.open) {
      persistInitialized = false
      lastPersistSig = ''
      return
    }
    if (!persistInitialized) {
      persistInitialized = true
      lastPersistSig = sig
      return
    }
    if (sig === lastPersistSig) return
    lastPersistSig = sig
    props.onSave?.({
      tavernSelectedPresetId: connectionPresetId,
      tavernPerChatPresets: perChatPresets,
      promptPresets: JSON.parse(JSON.stringify(presets)),
      selectedPromptPresetId: selectedId,
      personas: JSON.parse(JSON.stringify(personas)),
      selectedPersonaId,
      tavernAvatarShape: avatarShape,
    })
  })

  const current = $derived(presets.find(p => p.id === selectedId) || presets[0] || null)

  const MARKER_LABELS: Record<PromptBlockMarker, string> = {
    chatHistory: 'Chat History',
    charDescription: 'Character Description',
    persona: 'Persona',
  }

  const MARKER_HINTS: Record<PromptBlockMarker, string> = {
    chatHistory: 'Chat messages go here. Blocks below become post-history instructions.',
    charDescription: "Filled with the character's description, personality, scenario and example dialogue.",
    persona: 'Filled with your active persona description.',
  }

  // ----- prompt preset helpers -----

  function updateCurrent(mutate: (preset: PromptPreset) => PromptPreset) {
    if (!current) return
    presets = presets.map(p => (p.id === current.id ? mutate(p) : p))
  }

  function updateBlock(blockId: string, patch: Partial<PromptBlock>) {
    updateCurrent(preset => ({
      ...preset,
      blocks: preset.blocks.map(b => (b.id === blockId ? { ...b, ...patch } : b)),
    }))
  }

  function moveBlock(blockId: string, delta: number) {
    updateCurrent(preset => {
      const index = preset.blocks.findIndex(b => b.id === blockId)
      const target = index + delta
      if (index < 0 || target < 0 || target >= preset.blocks.length) return preset
      const blocks = preset.blocks.slice()
      const [moved] = blocks.splice(index, 1)
      blocks.splice(target, 0, moved)
      return { ...preset, blocks }
    })
  }

  function removeBlock(blockId: string) {
    if (expandedBlockId === blockId) expandedBlockId = null
    updateCurrent(preset => ({
      ...preset,
      blocks: preset.blocks.filter(b => b.id !== blockId),
    }))
  }

  function addBlock() {
    const id = generatePromptBlockId()
    updateCurrent(preset => ({
      ...preset,
      blocks: [...preset.blocks, { id, name: 'New block', role: 'system', content: '', enabled: true }],
    }))
    expandedBlockId = id
  }

  function addMarker(marker: PromptBlockMarker) {
    updateCurrent(preset => ({
      ...preset,
      blocks: [...preset.blocks, {
        id: generatePromptBlockId(),
        name: MARKER_LABELS[marker],
        role: 'system',
        content: '',
        enabled: true,
        marker,
      }],
    }))
  }

  function toggleExpand(block: PromptBlock) {
    expandedBlockId = expandedBlockId === block.id ? null : block.id
  }

  const missingMarkers = $derived.by(() => {
    const existing = new Set((current?.blocks || []).map(b => b.marker).filter(Boolean))
    return (Object.keys(MARKER_LABELS) as PromptBlockMarker[]).filter(m => !existing.has(m))
  })

  function addPreset() {
    const preset: PromptPreset = { ...makeDefaultPromptPreset(), id: generatePromptPresetId(), name: `Prompt ${presets.length + 1}` }
    presets = [...presets, preset]
    selectedId = preset.id
  }

  function duplicatePreset() {
    if (!current) return
    const copy: PromptPreset = JSON.parse(JSON.stringify(current))
    copy.id = generatePromptPresetId()
    copy.name = `${current.name} (copy)`
    copy.blocks = copy.blocks.map(b => ({ ...b, id: generatePromptBlockId() }))
    presets = [...presets, copy]
    selectedId = copy.id
  }

  function deletePreset() {
    if (!current || presets.length <= 1) return
    const id = current.id
    presets = presets.filter(p => p.id !== id)
    selectedId = presets[0]?.id || ''
  }

  function handleExport() {
    if (!current) return
    const blob = new Blob([exportPromptPreset(current)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(current.name || 'prompt-preset').replace(/[^\w\- ]+/g, '').trim() || 'prompt-preset'}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  async function handleImportFile(event: Event) {
    const target = event.target as HTMLInputElement
    const file = target.files?.[0]
    target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const preset = importPromptPreset(text)
      presets = [...presets, preset]
      selectedId = preset.id
      errorText = ''
    } catch (err) {
      errorText = err instanceof Error ? err.message : 'Failed to import prompt preset.'
    }
  }

  // ----- persona helpers -----

  function addPersona() {
    const persona: Persona = { id: generatePersonaId(), name: `Persona ${personas.length + 1}`, description: '' }
    personas = [...personas, persona]
    selectedPersonaId = persona.id!
  }

  function updatePersona(id: string, patch: Partial<Persona>) {
    personas = personas.map(p => (p.id === id ? { ...p, ...patch } : p))
  }

  function deletePersona(id: string) {
    if (personas.length <= 1) return
    personas = personas.filter(p => p.id !== id)
    if (selectedPersonaId === id) selectedPersonaId = personas[0]?.id || ''
  }

</script>

<svelte:window onkeydown={(e) => { if (props.open && e.key === 'Escape') props.onClose?.() }} />

{#if props.open}
  <button type="button" class="ui-backdrop" aria-label="Close tavern settings overlay" onclick={() => props.onClose?.()}></button>
  <div
    class="ui-modal"
    role="dialog"
    aria-modal="true"
    aria-label="Tavern settings"
    tabindex="-1"
    onpointerdown={(event) => { if (event.target === event.currentTarget) props.onClose?.() }}
  >
    <div class="ui-panel ui-panel-full panel">
      <header class="ui-modal-head">
        <div class="ui-modal-title">Tavern Settings</div>
        <button class="ui-icon-btn" onclick={() => props.onClose?.()} aria-label="Close">
          <IconClose style="font-size: 20px;" />
        </button>
      </header>
      <div class="ui-tab-bar" role="tablist" aria-label="Tavern settings sections">
        <div class="ui-segmented">
        {#each TABS as t (t.id)}
          <button
            type="button"
            role="tab"
            class={`ui-segment ${t.id === tab ? 'active' : ''}`}
            aria-selected={t.id === tab}
            onclick={() => (tab = t.id)}
          >
            {t.label}
          </button>
        {/each}
        </div>
      </div>
      <div class="ui-modal-body" role="tabpanel">
        <div class="ui-modal-scroller">
          {#if tab === 'general'}
            <div class="ui-group">
              <div class="ui-group-title">Preset</div>
              <div class="ui-field">
                <span class="ui-field-label">{perChatPresets ? 'Preset for new tavern chats' : 'Preset for all tavern chats'}</span>
                <select class="ui-select" value={connectionPresetId} onchange={(e) => (connectionPresetId = e.currentTarget.value)} aria-label="Tavern preset">
                  {#each (props.connectionPresets || []) as preset (preset.id)}
                    <option value={preset.id}>{preset.name || 'Preset'}{preset.model ? ` — ${preset.model}` : ''}</option>
                  {/each}
                </select>
              </div>
              <label class="ui-switch">
                <input type="checkbox" checked={perChatPresets} onchange={(e) => (perChatPresets = e.currentTarget.checked)} style="display: none;" />
                <span class="ui-switch-ui" data-on={perChatPresets}></span>
                <span class="ui-switch-label">Per-chat presets (like Chat mode)</span>
              </label>
              {#if perChatPresets}
                <div class="ui-hint">Each character chat keeps its own settings. Picking a preset in the composer or tweaking chat settings only affects that chat — the preset itself is never modified.</div>
              {:else}
                <div class="ui-hint">Applies to all tavern chats. The chat settings button in a character chat quick-edits this preset. Presets are managed in the main Settings and are never exported.</div>
              {/if}
            </div>

            <div class="ui-group">
              <div class="ui-group-title">Appearance</div>
              <div class="ui-field">
                <span class="ui-field-label">Message avatar shape</span>
                <div class="shape-switch" role="radiogroup" aria-label="Avatar shape">
                  <button type="button" class="shape-option {avatarShape === 'circle' ? 'active' : ''}" role="radio" aria-checked={avatarShape === 'circle'} onclick={() => (avatarShape = 'circle')}>
                    <span class="shape-preview circle"></span> Circle
                  </button>
                  <button type="button" class="shape-option {avatarShape === 'rounded' ? 'active' : ''}" role="radio" aria-checked={avatarShape === 'rounded'} onclick={() => (avatarShape = 'rounded')}>
                    <span class="shape-preview rounded"></span> Rounded
                  </button>
                  <button type="button" class="shape-option {avatarShape === 'card' ? 'active' : ''}" role="radio" aria-checked={avatarShape === 'card'} onclick={() => (avatarShape = 'card')}>
                    <span class="shape-preview card"></span> Card (2:3)
                  </button>
                </div>
                <div class="ui-hint">Card keeps the original character card aspect ratio (400×600).</div>
              </div>
            </div>
          {:else if tab === 'prompts'}
            <div class="ui-group">
              <div class="ui-group-head">
                <div class="ui-group-title">Prompt preset</div>
                <div class="ui-row">
                  <button type="button" class="ui-icon-btn ui-icon-btn-sm" title="New preset" onclick={addPreset}><IconAdd style="font-size: 18px;" /></button>
                  <button type="button" class="ui-icon-btn ui-icon-btn-sm" title="Duplicate preset" onclick={duplicatePreset}><IconContentCopy style="font-size: 18px;" /></button>
                  <button type="button" class="ui-icon-btn ui-icon-btn-sm" title="Import (shareable JSON)" onclick={() => importInput?.click()}><IconUpload style="font-size: 18px;" /></button>
                  <button type="button" class="ui-icon-btn ui-icon-btn-sm" title="Export (shareable JSON)" onclick={handleExport}><IconDownload style="font-size: 18px;" /></button>
                  <button type="button" class="ui-icon-btn ui-icon-btn-sm danger" title="Delete preset" disabled={presets.length <= 1} onclick={deletePreset}><IconDelete style="font-size: 18px;" /></button>
                  <input type="file" accept=".json,application/json" bind:this={importInput} onchange={handleImportFile} style="display: none;" />
                </div>
              </div>
              <div class="ui-row">
                <select class="ui-select" value={selectedId} onchange={(e) => (selectedId = e.currentTarget.value)} aria-label="Prompt preset">
                  {#each presets as preset (preset.id)}
                    <option value={preset.id}>{preset.name}</option>
                  {/each}
                </select>
              </div>
              {#if current}
                <div class="ui-field">
                  <span class="ui-field-label">Name</span>
                  <input class="ui-input" value={current.name} oninput={(e) => updateCurrent(p => ({ ...p, name: e.currentTarget.value }))} aria-label="Preset name" />
                </div>
              {/if}
              <div class="ui-hint">Prompt presets are shareable — they contain no API keys.</div>
            </div>

            {#if current}
              <div class="ui-group">
                <div class="ui-group-title">Blocks (in order)</div>
                <div class="blocks">
                  {#each current.blocks as block, index (block.id)}
                    <div class="block {block.enabled ? '' : 'disabled'} {block.marker ? 'marker' : ''} {expandedBlockId === block.id ? 'open' : ''}">
                      <div class="block-head">
                        <input
                          type="checkbox"
                          checked={block.enabled}
                          onchange={(e) => updateBlock(block.id, { enabled: e.currentTarget.checked })}
                          aria-label="Enable block"
                        />
                        <button type="button" class="block-title" onclick={() => toggleExpand(block)} aria-expanded={expandedBlockId === block.id}>
                          <IconChevronRight style="font-size: 16px;" />
                          <span class="block-name">{block.marker ? MARKER_LABELS[block.marker] : (block.name || 'Block')}</span>
                          {#if block.marker}
                            <span class="ui-item-badge neutral">marker</span>
                          {:else}
                            <span class="ui-item-badge">{block.role}</span>
                          {/if}
                        </button>
                        <div class="block-actions">
                          <button type="button" class="ui-icon-btn ui-icon-btn-sm" title="Move up" disabled={index === 0} onclick={() => moveBlock(block.id, -1)}><IconArrowUpward style="font-size: 15px;" /></button>
                          <button type="button" class="ui-icon-btn ui-icon-btn-sm" title="Move down" disabled={index === current.blocks.length - 1} onclick={() => moveBlock(block.id, 1)}><IconArrowDownward style="font-size: 15px;" /></button>
                          <button type="button" class="ui-icon-btn ui-icon-btn-sm danger" title="Delete block" onclick={() => removeBlock(block.id)}><IconDelete style="font-size: 15px;" /></button>
                        </div>
                      </div>
                      {#if expandedBlockId === block.id}
                        <div class="block-body">
                          {#if block.marker}
                            <div class="ui-hint">{MARKER_HINTS[block.marker]}</div>
                          {:else}
                            <div class="ui-row">
                              <input class="ui-input" value={block.name} oninput={(e) => updateBlock(block.id, { name: e.currentTarget.value })} aria-label="Block name" placeholder="Block name" />
                              <select class="ui-select" value={block.role} onchange={(e) => updateBlock(block.id, { role: e.currentTarget.value as PromptBlock['role'] })} aria-label="Block role">
                                <option value="system">system</option>
                                <option value="user">user</option>
                                <option value="assistant">assistant</option>
                              </select>
                            </div>
                            <textarea
                              class="ui-textarea"
                              value={block.content}
                              oninput={(e) => updateBlock(block.id, { content: e.currentTarget.value })}
                              placeholder={'Prompt text... supports {{char}}, {{user}}, {{persona}}, {{description}}'}
                            ></textarea>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
                <div class="ui-row">
                  <button type="button" class="ui-btn ui-btn-accent" onclick={addBlock}><IconAdd style="font-size: 18px;" /> Block</button>
                  {#each missingMarkers as marker (marker)}
                    <button type="button" class="ui-btn ui-btn-accent" onclick={() => addMarker(marker)}><IconAdd style="font-size: 18px;" /> {MARKER_LABELS[marker]}</button>
                  {/each}
                </div>
              </div>
            {/if}
          {:else}
            <div class="ui-group">
              <div class="ui-group-head">
                <div class="ui-group-title">Personas</div>
                <button type="button" class="ui-btn ui-btn-accent" onclick={addPersona}><IconAdd style="font-size: 18px;" /> Persona</button>
              </div>
              <div class="ui-hint">The active persona replaces {'{{user}}'} and fills the Persona prompt block.</div>
              <div class="personas">
                {#each personas as persona (persona.id)}
                  <div class="persona {selectedPersonaId === persona.id ? 'active' : ''}">
                    <div class="persona-head">
                      <input class="ui-input" value={persona.name} oninput={(e) => updatePersona(persona.id!, { name: e.currentTarget.value })} aria-label="Persona name" placeholder="Name" />
                      <label class="active-toggle" title="Use this persona as {'{{user}}'}">
                        <input
                          type="radio"
                          name="active-persona"
                          checked={selectedPersonaId === persona.id}
                          onchange={() => (selectedPersonaId = persona.id!)}
                        />
                        <span>Active</span>
                      </label>
                      <button type="button" class="ui-icon-btn ui-icon-btn-sm danger" title="Delete persona" disabled={personas.length <= 1} onclick={() => deletePersona(persona.id!)}><IconDelete style="font-size: 15px;" /></button>
                    </div>
                    <textarea
                      class="ui-textarea"
                      value={persona.description}
                      oninput={(e) => updatePersona(persona.id!, { description: e.currentTarget.value })}
                      placeholder={'Who {{user}} is... (injected via the Persona block)'}
                    ></textarea>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          {#if errorText}
            <div class="ui-error-text">{errorText}</div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Chrome, tabs, groups, fields, switches and buttons come from shared ui.css.
     Only the panel size and tavern-specific widgets are local. */
  @media (min-width: 641px) {
    .panel {
      width: min(calc(100vw - 48px), 760px);
      height: min(calc(100vh - 48px), 780px);
      height: min(calc(100dvh - 48px), 780px);
    }
  }

  /* Avatar shape picker */
  .shape-switch { display: flex; gap: var(--s2); flex-wrap: wrap; }
  .shape-option {
    display: inline-flex;
    align-items: center;
    gap: var(--s2);
    padding: 10px var(--s4);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
    transition: border-color var(--dur) var(--ease), background-color var(--dur) var(--ease), color var(--dur) var(--ease);
  }
  .shape-option:hover { border-color: color-mix(in srgb, var(--border) 55%, var(--accent) 45%); }
  .shape-option.active {
    border-color: var(--accent);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, var(--bg));
  }
  .shape-preview {
    width: 22px;
    height: 22px;
    background: color-mix(in srgb, currentColor 35%, transparent);
    display: inline-block;
  }
  .shape-preview.circle { border-radius: 50%; }
  .shape-preview.rounded { border-radius: var(--r-xs); }
  .shape-preview.card { width: 16px; height: 24px; border-radius: 4px; }

  /* Prompt blocks */
  .blocks { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .block {
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--bg);
    transition: border-color var(--dur) var(--ease);
  }
  .block:hover { border-color: color-mix(in srgb, var(--border) 55%, var(--accent) 45%); }
  .block.disabled { opacity: 0.55; }
  .block.marker { border-style: dashed; }
  .block-head { display: flex; align-items: center; gap: var(--s2); padding: var(--s2) 10px; min-width: 0; }
  .block-head input[type='checkbox'] { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; flex: 0 0 auto; }
  .block-title {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1 1 auto;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    padding: 2px 0;
  }
  .block-title :global(svg) { transition: transform var(--dur) var(--ease); color: var(--muted); flex: 0 0 auto; }
  .block.open .block-title :global(svg) { transform: rotate(90deg); }
  .block-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .block-actions { display: flex; gap: 1px; flex: 0 0 auto; opacity: 0.6; transition: opacity 120ms ease; }
  .block:hover .block-actions, .block:focus-within .block-actions { opacity: 1; }
  .block-body { padding: 0 10px 10px; display: flex; flex-direction: column; gap: var(--s2); }

  /* Personas */
  .personas { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .persona {
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    padding: 10px;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    transition: border-color var(--dur) var(--ease), background-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
  }
  .persona:hover { border-color: color-mix(in srgb, var(--border) 55%, var(--accent) 45%); }
  .persona.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, var(--bg));
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 15%, transparent);
  }
  .persona-head { display: flex; align-items: center; gap: var(--s2); min-width: 0; flex-wrap: wrap; }
  .persona-head .ui-input { flex: 1 1 140px; width: auto; }
  .active-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85rem;
    color: var(--muted);
    cursor: pointer;
    flex: 0 0 auto;
    padding: 6px 10px;
    border-radius: var(--r-sm);
    user-select: none;
    transition: background-color var(--dur) var(--ease);
  }
  .active-toggle:hover { background: var(--hover-bg); }
  .persona.active .active-toggle { color: var(--accent); }
  .active-toggle input[type='radio'] { accent-color: var(--accent); cursor: pointer; margin: 0; }

  @media (max-width: 640px) {
    /* Icon-button toolbars (prompt preset actions) wrap under the title
       instead of forcing the group wider than the screen. The wrapped row
       keeps its own gap, so undo the header overflow compensation. */
    .ui-group-head .ui-row {
      flex: 1 1 100%;
      justify-content: flex-start;
      margin-top: 0;
      margin-bottom: 0;
    }
    .block-actions { opacity: 1; }
  }
</style>

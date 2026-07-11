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

  type AvatarShape = 'circle' | 'rounded'

  interface Props {
    open?: boolean
    /** Connection presets (selection only; edited in the main Settings). */
    connectionPresets?: Preset[]
    tavernSelectedPresetId?: string
    tavernSharePresetSelection?: boolean
    chatSelectedPresetId?: string
    promptPresets?: PromptPreset[]
    selectedPromptPresetId?: string
    personas?: Persona[]
    selectedPersonaId?: string
    avatarShape?: AvatarShape
    onSave?: (data: {
      tavernSelectedPresetId: string
      tavernSharePresetSelection: boolean
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
  let shareSelection = $state(false)
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
      shareSelection = !!props.tavernSharePresetSelection
      avatarShape = props.avatarShape === 'rounded' ? 'rounded' : 'circle'
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
      connectionPresetId, shareSelection, avatarShape,
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
      tavernSharePresetSelection: shareSelection,
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
  <button type="button" class="backdrop" aria-label="Close tavern settings overlay" onclick={() => props.onClose?.()}></button>
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-label="Tavern settings"
    tabindex="-1"
    onpointerdown={(event) => { if (event.target === event.currentTarget) props.onClose?.() }}
  >
    <div class="panel">
      <header class="modal-head">
        <div class="title">Tavern Settings</div>
        <button class="icon-btn" onclick={() => props.onClose?.()} aria-label="Close">
          <IconClose style="font-size: 20px;" />
        </button>
      </header>
      <div class="tab-bar" role="tablist" aria-label="Tavern settings sections">
        {#each TABS as t (t.id)}
          <button
            type="button"
            role="tab"
            class={`tab ${t.id === tab ? 'active' : ''}`}
            aria-selected={t.id === tab}
            onclick={() => (tab = t.id)}
          >
            {t.label}
          </button>
        {/each}
      </div>
      <div class="modal-body" role="tabpanel">
        <div class="modal-scroller">
          {#if tab === 'general'}
            <div class="group">
              <div class="group-title">Preset</div>
              <label class="switch">
                <input type="checkbox" checked={shareSelection} onchange={(e) => (shareSelection = e.currentTarget.checked)} style="display: none;" />
                <span class="switch-ui" data-on={shareSelection}></span>
                <span class="switch-label">Follow Chat mode preset selection</span>
              </label>
              {#if shareSelection}
                <div class="hint">Tavern chats use whatever preset is selected in Chat mode.</div>
              {:else}
                <div class="field">
                  <select class="select" value={connectionPresetId} onchange={(e) => (connectionPresetId = e.currentTarget.value)} aria-label="Tavern preset">
                    {#each (props.connectionPresets || []) as preset (preset.id)}
                      <option value={preset.id}>{preset.name || 'Preset'}{preset.model ? ` — ${preset.model}` : ''}</option>
                    {/each}
                  </select>
                  <div class="hint">Applies to all tavern chats. The chat settings button in a character chat quick-edits this preset. Presets are managed in the main Settings and are never exported.</div>
                </div>
              {/if}
            </div>

            <div class="group">
              <div class="group-title">Appearance</div>
              <div class="field">
                <span class="field-label">Message avatar shape</span>
                <div class="shape-switch" role="radiogroup" aria-label="Avatar shape">
                  <button type="button" class="shape-option {avatarShape === 'circle' ? 'active' : ''}" role="radio" aria-checked={avatarShape === 'circle'} onclick={() => (avatarShape = 'circle')}>
                    <span class="shape-preview circle"></span> Circle
                  </button>
                  <button type="button" class="shape-option {avatarShape === 'rounded' ? 'active' : ''}" role="radio" aria-checked={avatarShape === 'rounded'} onclick={() => (avatarShape = 'rounded')}>
                    <span class="shape-preview rounded"></span> Rounded
                  </button>
                </div>
              </div>
            </div>
          {:else if tab === 'prompts'}
            <div class="group">
              <div class="group-head">
                <div class="group-title">Prompt preset</div>
                <div class="row">
                  <button type="button" class="icon-btn small" title="New preset" onclick={addPreset}><IconAdd style="font-size: 18px;" /></button>
                  <button type="button" class="icon-btn small" title="Duplicate preset" onclick={duplicatePreset}><IconContentCopy style="font-size: 18px;" /></button>
                  <button type="button" class="icon-btn small" title="Import (shareable JSON)" onclick={() => importInput?.click()}><IconUpload style="font-size: 18px;" /></button>
                  <button type="button" class="icon-btn small" title="Export (shareable JSON)" onclick={handleExport}><IconDownload style="font-size: 18px;" /></button>
                  <button type="button" class="icon-btn small danger" title="Delete preset" disabled={presets.length <= 1} onclick={deletePreset}><IconDelete style="font-size: 18px;" /></button>
                  <input type="file" accept=".json,application/json" bind:this={importInput} onchange={handleImportFile} style="display: none;" />
                </div>
              </div>
              <div class="row">
                <select class="select grow" value={selectedId} onchange={(e) => (selectedId = e.currentTarget.value)} aria-label="Prompt preset">
                  {#each presets as preset (preset.id)}
                    <option value={preset.id}>{preset.name}</option>
                  {/each}
                </select>
              </div>
              {#if current}
                <div class="field">
                  <span class="field-label">Name</span>
                  <input class="input" value={current.name} oninput={(e) => updateCurrent(p => ({ ...p, name: e.currentTarget.value }))} aria-label="Preset name" />
                </div>
              {/if}
              <div class="hint">Prompt presets are shareable — they contain no API keys.</div>
            </div>

            {#if current}
              <div class="group">
                <div class="group-title">Blocks (in order)</div>
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
                            <span class="badge">marker</span>
                          {:else}
                            <span class="badge role">{block.role}</span>
                          {/if}
                        </button>
                        <div class="block-actions">
                          <button type="button" class="mini-btn" title="Move up" disabled={index === 0} onclick={() => moveBlock(block.id, -1)}><IconArrowUpward style="font-size: 15px;" /></button>
                          <button type="button" class="mini-btn" title="Move down" disabled={index === current.blocks.length - 1} onclick={() => moveBlock(block.id, 1)}><IconArrowDownward style="font-size: 15px;" /></button>
                          <button type="button" class="mini-btn danger" title="Delete block" onclick={() => removeBlock(block.id)}><IconDelete style="font-size: 15px;" /></button>
                        </div>
                      </div>
                      {#if expandedBlockId === block.id}
                        <div class="block-body">
                          {#if block.marker}
                            <div class="hint">{MARKER_HINTS[block.marker]}</div>
                          {:else}
                            <div class="row">
                              <input class="input grow" value={block.name} oninput={(e) => updateBlock(block.id, { name: e.currentTarget.value })} aria-label="Block name" placeholder="Block name" />
                              <select class="select" value={block.role} onchange={(e) => updateBlock(block.id, { role: e.currentTarget.value as PromptBlock['role'] })} aria-label="Block role">
                                <option value="system">system</option>
                                <option value="user">user</option>
                                <option value="assistant">assistant</option>
                              </select>
                            </div>
                            <textarea
                              class="textarea"
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
                <div class="row">
                  <button type="button" class="add-btn" onclick={addBlock}><IconAdd style="font-size: 18px;" /> Block</button>
                  {#each missingMarkers as marker (marker)}
                    <button type="button" class="add-btn" onclick={() => addMarker(marker)}><IconAdd style="font-size: 18px;" /> {MARKER_LABELS[marker]}</button>
                  {/each}
                </div>
              </div>
            {/if}
          {:else}
            <div class="group">
              <div class="group-head">
                <div class="group-title">Personas</div>
                <button type="button" class="add-btn" onclick={addPersona}><IconAdd style="font-size: 18px;" /> Persona</button>
              </div>
              <div class="hint">The active persona replaces {'{{user}}'} and fills the Persona prompt block.</div>
              <div class="personas">
                {#each personas as persona (persona.id)}
                  <div class="persona {selectedPersonaId === persona.id ? 'active' : ''}">
                    <div class="persona-head">
                      <input class="input grow" value={persona.name} oninput={(e) => updatePersona(persona.id!, { name: e.currentTarget.value })} aria-label="Persona name" placeholder="Name" />
                      <label class="active-toggle" title="Use this persona as {'{{user}}'}">
                        <input
                          type="radio"
                          name="active-persona"
                          checked={selectedPersonaId === persona.id}
                          onchange={() => (selectedPersonaId = persona.id!)}
                        />
                        <span>Active</span>
                      </label>
                      <button type="button" class="mini-btn danger" title="Delete persona" disabled={personas.length <= 1} onclick={() => deletePersona(persona.id!)}><IconDelete style="font-size: 15px;" /></button>
                    </div>
                    <textarea
                      class="textarea"
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
            <div class="error-text">{errorText}</div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Chrome mirrors SettingsModal for a consistent look */
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
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .modal {
    position: fixed; inset: 0;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    z-index: 1001;
  }
  .panel {
    width: min(calc(100vw - 48px), 760px);
    height: min(calc(100vh - 48px), 780px);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 20px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    color: var(--text);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  :global(:root[data-fancy-effects="true"]) .panel {
    animation: panel-slide-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes panel-slide-in {
    from { opacity: 0; transform: scale(0.96) translateY(8px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
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
    white-space: nowrap;
    cursor: pointer;
    border-radius: 10px;
    transition: color 0.15s ease, background 0.15s ease;
  }
  .tab:hover:not(.active) {
    color: var(--text);
    background: color-mix(in srgb, var(--border) 40%, transparent);
  }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .tab.active {
    color: var(--text);
    background: color-mix(in srgb, var(--border) 60%, transparent);
  }
  .modal-body { flex: 1; overflow: hidden; }
  .modal-scroller {
    height: 100%;
    overflow-y: auto;
    padding: 28px;
    display: grid;
    gap: 20px;
    align-content: start;
  }
  .modal-scroller::-webkit-scrollbar { width: 8px; }
  .modal-scroller::-webkit-scrollbar-track { background: transparent; }
  .modal-scroller::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
  .modal-scroller::-webkit-scrollbar-thumb:hover { background: var(--muted); }
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
    cursor: pointer;
  }
  .icon-btn:hover:not(:disabled) {
    background: var(--bg);
    border-color: color-mix(in srgb, var(--border) 70%, var(--accent) 30%);
    transform: translateY(-1px);
  }
  .icon-btn:disabled { opacity: .5; cursor: not-allowed; }
  .icon-btn.small { width: 34px; height: 34px; background: var(--bg); }
  .icon-btn.danger:hover:not(:disabled) {
    color: #e53935;
    border-color: color-mix(in srgb, #e53935 35%, var(--border));
  }

  /* Group cards, fields — same vocabulary as SettingsModal */
  .group {
    display: grid;
    gap: 12px;
    padding: 20px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    transition: border-color 0.15s ease;
  }
  .group:hover { border-color: color-mix(in srgb, var(--border) 80%, var(--text) 20%); }
  .group-title { font-weight: 600; font-size: 1rem; letter-spacing: -0.01em; color: var(--text); }
  .group-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .field { display: grid; gap: 6px; }
  .field-label { font-size: 0.85rem; color: var(--muted); }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .grow { flex: 1 1 auto; min-width: 0; }
  .hint { color: var(--muted); font-size: .85rem; line-height: 1.4; }
  .input, .select, .textarea {
    box-sizing: border-box;
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
    min-width: 0;
  }
  .input:hover, .select:hover, .textarea:hover { border-color: color-mix(in srgb, var(--border) 70%, var(--accent)); }
  .input:focus, .select:focus, .textarea:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent);
  }
  .textarea { width: 100%; min-height: 90px; resize: vertical; }

  /* Toggle switch — same as SettingsModal */
  .switch { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; }
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
  .switch-ui[data-on="true"] { background: var(--accent); }
  .switch-ui[data-on="true"]::after { transform: translateX(20px); }
  :global(:root[data-theme='dark']) .switch-ui { background: #2a2a2a; box-shadow: inset 0 1px 3px rgba(0,0,0,0.3); }
  :global(:root[data-theme='dark']) .switch-ui[data-on="true"] { background: var(--accent); }
  :global(:root[data-theme='dark']) .switch-ui::after { background: #e6e6e6; }
  .switch-label { font-size: .95rem; font-weight: 500; color: var(--text); }

  /* Add buttons — same as SettingsModal .add-btn */
  .add-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 9px 14px;
    border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
    border-radius: 10px;
    background: color-mix(in srgb, var(--accent) 10%, var(--panel) 90%);
    color: var(--accent);
    font: inherit;
    font-weight: 500;
    font-size: 0.88rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .add-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 18%, var(--panel) 82%);
    border-color: color-mix(in srgb, var(--accent) 50%, transparent);
    transform: translateY(-1px);
  }

  /* Avatar shape picker */
  .shape-switch { display: flex; gap: 8px; }
  .shape-option {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .shape-option:hover { border-color: color-mix(in srgb, var(--border) 60%, var(--accent) 40%); }
  .shape-option.active { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, var(--bg) 94%); }
  .shape-preview {
    width: 22px;
    height: 22px;
    background: color-mix(in srgb, currentColor 35%, transparent);
    display: inline-block;
  }
  .shape-preview.circle { border-radius: 50%; }
  .shape-preview.rounded { border-radius: 6px; }

  /* Prompt blocks */
  .blocks { display: flex; flex-direction: column; gap: 6px; }
  .block {
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg);
    transition: border-color 0.15s ease;
  }
  .block:hover { border-color: color-mix(in srgb, var(--border) 60%, var(--accent) 40%); }
  .block.disabled { opacity: 0.55; }
  .block.marker { border-style: dashed; }
  .block-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; }
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
  .block-title :global(svg) { transition: transform 150ms ease; color: var(--muted); flex: 0 0 auto; }
  .block.open .block-title :global(svg) { transform: rotate(90deg); }
  .block-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .badge {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 2px 7px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--border) 60%, transparent);
    color: var(--muted);
    flex: 0 0 auto;
  }
  .badge.role { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
  .block-actions { display: flex; gap: 1px; flex: 0 0 auto; opacity: 0.6; transition: opacity 120ms ease; }
  .block:hover .block-actions, .block:focus-within .block-actions { opacity: 1; }
  .mini-btn {
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .mini-btn:hover:not(:disabled) { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .mini-btn.danger:hover:not(:disabled) { color: #e53935; background: rgba(229, 57, 53, 0.12); }
  .mini-btn:disabled { opacity: 0.35; cursor: default; }
  .block-body { padding: 0 10px 10px; display: flex; flex-direction: column; gap: 8px; }

  /* Personas */
  .personas { display: flex; flex-direction: column; gap: 10px; }
  .persona {
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 10px;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: all 0.15s ease;
  }
  .persona:hover { border-color: color-mix(in srgb, var(--border) 60%, var(--accent) 40%); }
  .persona.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, var(--bg) 94%);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .persona-head { display: flex; align-items: center; gap: 8px; }
  .active-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85rem;
    color: var(--muted);
    cursor: pointer;
    flex: 0 0 auto;
    padding: 6px 10px;
    border-radius: 8px;
    user-select: none;
  }
  .active-toggle:hover { background: color-mix(in srgb, var(--text) 6%, transparent); }
  .persona.active .active-toggle { color: var(--accent); }
  .active-toggle input[type='radio'] { accent-color: var(--accent); cursor: pointer; margin: 0; }

  .error-text { color: #e53935; font-size: 0.85rem; }

  @media (max-width: 640px) {
    .modal { padding: 0; }
    .panel { width: 100%; height: 100%; border-radius: 0; border: none; }
    .modal-head { padding: 16px 20px; }
    .tab-bar { padding: 10px 16px; gap: 4px; }
    .tab { padding: 8px 14px; font-size: 0.9rem; }
    .modal-scroller { padding: 20px; gap: 16px; }
    .group { padding: 16px; border-radius: 12px; }
  }
</style>

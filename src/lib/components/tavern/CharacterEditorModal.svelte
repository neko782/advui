<script lang="ts">
  import { IconClose, IconAdd, IconDelete, IconDownload, IconPerson, IconChevronRight } from '../../icons'
  import { exportCharacterCard } from '../../tavern/characterCard'
  import type { Character } from '../../types/tavern'

  interface Props {
    open?: boolean
    character?: Character | null
    onSave?: (character: Character) => void
    onCancel?: () => void
  }

  const props: Props = $props()

  type SectionId = 'description' | 'greetings' | 'behavior' | 'overrides' | 'meta'

  let draft = $state<Character | null>(null)
  let tagsText = $state('')
  let avatarInput = $state<HTMLInputElement | null>(null)
  let errorText = $state('')
  let lastLoadedKey = $state('')
  let openSection = $state<SectionId | null>('description')

  // Re-seed the draft whenever the modal opens for a (possibly different) character
  $effect(() => {
    if (!props.open) {
      lastLoadedKey = ''
      return
    }
    const source = props.character
    const key = source ? source.id : 'new'
    if (lastLoadedKey === key) return
    lastLoadedKey = key
    errorText = ''
    openSection = 'description'
    draft = source
      ? { ...source, alternateGreetings: [...(source.alternateGreetings || [])], tags: [...(source.tags || [])] }
      : null
    tagsText = source ? (source.tags || []).join(', ') : ''
  })

  function toggleSection(id: SectionId) {
    openSection = openSection === id ? null : id
  }

  function updateField<K extends keyof Character>(key: K, value: Character[K]) {
    if (!draft) return
    draft = { ...draft, [key]: value }
  }

  function addGreeting() {
    if (!draft) return
    draft = { ...draft, alternateGreetings: [...draft.alternateGreetings, ''] }
  }

  function updateGreeting(index: number, value: string) {
    if (!draft) return
    const next = draft.alternateGreetings.slice()
    next[index] = value
    draft = { ...draft, alternateGreetings: next }
  }

  function removeGreeting(index: number) {
    if (!draft) return
    draft = { ...draft, alternateGreetings: draft.alternateGreetings.filter((_, i) => i !== index) }
  }

  function handleAvatarChange(event: Event) {
    const target = event.target as HTMLInputElement
    const file = target.files?.[0]
    target.value = ''
    if (!file || !draft) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') updateField('avatar', reader.result)
    }
    reader.readAsDataURL(file)
  }

  function applyTags(base: Character): Character {
    return {
      ...base,
      tags: tagsText.split(',').map(t => t.trim()).filter(Boolean),
    }
  }

  function handleExport() {
    if (!draft) return
    try {
      const { blob, filename } = exportCharacterCard(applyTags(draft))
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (err) {
      errorText = err instanceof Error ? err.message : 'Failed to export card.'
    }
  }

  function handleSave() {
    if (!draft) return
    if (!draft.name.trim()) {
      errorText = 'Name is required.'
      return
    }
    props.onSave?.(applyTags({ ...draft, name: draft.name.trim() }))
  }

  const sections: Array<{ id: SectionId; label: string }> = [
    { id: 'description', label: 'Description' },
    { id: 'greetings', label: 'Greetings' },
    { id: 'behavior', label: 'Personality & Scenario' },
    { id: 'overrides', label: 'Prompt overrides' },
    { id: 'meta', label: 'Creator & tags' },
  ]
</script>

<svelte:window onkeydown={(e) => { if (props.open && e.key === 'Escape') props.onCancel?.() }} />

{#if props.open && draft}
  <button type="button" class="backdrop" aria-label="Close character editor overlay" onclick={() => props.onCancel?.()}></button>
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="char-editor-title"
    tabindex="-1"
    onpointerdown={(event) => { if (event.target === event.currentTarget) props.onCancel?.() }}
  >
    <div class="panel">
      <header class="modal-head">
        <div id="char-editor-title" class="title">Character</div>
        <button type="button" class="icon-btn" aria-label="Close" onclick={() => props.onCancel?.()}>
          <IconClose style="font-size: 20px;" />
        </button>
      </header>

      <div class="modal-body">
        <div class="modal-scroller">
          <!-- Identity: always visible, everything else folds away -->
          <div class="identity">
            <button type="button" class="avatar-wrap" title="Change avatar" aria-label="Change avatar" onclick={() => avatarInput?.click()}>
              {#if draft.avatar}
                <img class="avatar" src={draft.avatar} alt={draft.name || 'Avatar'} />
              {:else}
                <div class="avatar placeholder"><IconPerson style="font-size: 32px;" /></div>
              {/if}
              <span class="avatar-hint">change</span>
            </button>
            <input type="file" accept="image/png,image/jpeg,image/webp" bind:this={avatarInput} onchange={handleAvatarChange} style="display: none;" />
            <div class="identity-fields">
              <input class="input name-input" value={draft.name} oninput={(e) => updateField('name', e.currentTarget.value)} placeholder="Name" aria-label="Name" />
              <input class="input" value={draft.nickname} oninput={(e) => updateField('nickname', e.currentTarget.value)} placeholder={'Nickname — replaces {{char}} (optional)'} aria-label="Nickname" />
            </div>
          </div>

          {#each sections as section (section.id)}
            <div class="section {openSection === section.id ? 'open' : ''}">
              <button type="button" class="section-head" aria-expanded={openSection === section.id} onclick={() => toggleSection(section.id)}>
                <IconChevronRight style="font-size: 18px;" />
                <span>{section.label}</span>
              </button>
              {#if openSection === section.id}
                <div class="section-body">
                  {#if section.id === 'description'}
                    <textarea class="textarea tall" value={draft.description} oninput={(e) => updateField('description', e.currentTarget.value)} placeholder={'Who {{char}} is...'} aria-label="Description"></textarea>
                  {:else if section.id === 'greetings'}
                    <label class="field">
                      <span class="field-label">First message</span>
                      <textarea class="textarea" value={draft.firstMes} oninput={(e) => updateField('firstMes', e.currentTarget.value)}></textarea>
                    </label>
                    {#each draft.alternateGreetings as greeting, index (index)}
                      <div class="greeting-row">
                        <textarea class="textarea" value={greeting} oninput={(e) => updateGreeting(index, e.currentTarget.value)} placeholder={`Alternate greeting ${index + 1}`}></textarea>
                        <button type="button" class="small-btn danger" aria-label="Remove greeting" onclick={() => removeGreeting(index)}>
                          <IconDelete style="font-size: 16px;" />
                        </button>
                      </div>
                    {/each}
                    <button type="button" class="small-btn" onclick={addGreeting}>
                      <IconAdd style="font-size: 16px;" /> Alternate greeting
                    </button>
                  {:else if section.id === 'behavior'}
                    <label class="field">
                      <span class="field-label">Personality</span>
                      <textarea class="textarea" value={draft.personality} oninput={(e) => updateField('personality', e.currentTarget.value)}></textarea>
                    </label>
                    <label class="field">
                      <span class="field-label">Scenario</span>
                      <textarea class="textarea" value={draft.scenario} oninput={(e) => updateField('scenario', e.currentTarget.value)}></textarea>
                    </label>
                    <label class="field">
                      <span class="field-label">Example dialogue</span>
                      <textarea class="textarea" value={draft.mesExample} oninput={(e) => updateField('mesExample', e.currentTarget.value)}></textarea>
                    </label>
                  {:else if section.id === 'overrides'}
                    <label class="field">
                      <span class="field-label">System prompt (replaces the main prompt; supports {'{{original}}'})</span>
                      <textarea class="textarea" value={draft.systemPrompt} oninput={(e) => updateField('systemPrompt', e.currentTarget.value)}></textarea>
                    </label>
                    <label class="field">
                      <span class="field-label">Post-history instructions (supports {'{{original}}'})</span>
                      <textarea class="textarea" value={draft.postHistoryInstructions} oninput={(e) => updateField('postHistoryInstructions', e.currentTarget.value)}></textarea>
                    </label>
                  {:else}
                    <div class="grid-2">
                      <label class="field">
                        <span class="field-label">Creator</span>
                        <input class="input" value={draft.creator} oninput={(e) => updateField('creator', e.currentTarget.value)} />
                      </label>
                      <label class="field">
                        <span class="field-label">Version</span>
                        <input class="input" value={draft.characterVersion} oninput={(e) => updateField('characterVersion', e.currentTarget.value)} />
                      </label>
                    </div>
                    <label class="field">
                      <span class="field-label">Tags (comma separated)</span>
                      <input class="input" value={tagsText} oninput={(e) => (tagsText = e.currentTarget.value)} />
                    </label>
                    <label class="field">
                      <span class="field-label">Creator notes (not sent to the model)</span>
                      <textarea class="textarea" value={draft.creatorNotes} oninput={(e) => updateField('creatorNotes', e.currentTarget.value)}></textarea>
                    </label>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}

          {#if errorText}
            <div class="error-text">{errorText}</div>
          {/if}
        </div>
      </div>

      <footer class="modal-foot">
        <button type="button" class="icon-btn" onclick={handleExport} title="Export card (PNG/JSON)" aria-label="Export card">
          <IconDownload style="font-size: 20px;" />
        </button>
        <div class="foot-spacer"></div>
        <button type="button" class="foot-btn" onclick={() => props.onCancel?.()}>Cancel</button>
        <button type="button" class="foot-btn primary" onclick={handleSave}>Save</button>
      </footer>
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
    width: min(calc(100vw - 48px), 640px);
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
  .modal-body { flex: 1; overflow: hidden; }
  .modal-scroller {
    height: 100%;
    overflow-y: auto;
    padding: 28px;
    display: grid;
    gap: 12px;
    align-content: start;
  }
  .modal-scroller::-webkit-scrollbar { width: 8px; }
  .modal-scroller::-webkit-scrollbar-track { background: transparent; }
  .modal-scroller::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
  .modal-scroller::-webkit-scrollbar-thumb:hover { background: var(--muted); }
  .modal-foot {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 28px;
    border-top: 1px solid var(--border);
  }
  .foot-spacer { flex: 1 1 auto; }
  .foot-btn {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 10px 18px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .foot-btn:hover {
    background: var(--panel);
    border-color: color-mix(in srgb, var(--border) 60%, var(--accent) 40%);
    transform: translateY(-1px);
  }
  .foot-btn.primary {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
  }
  .foot-btn.primary:hover {
    background: color-mix(in srgb, var(--accent) 85%, black 15%);
  }

  .identity { display: flex; gap: 12px; align-items: stretch; margin-bottom: 4px; }
  .avatar-wrap {
    position: relative;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
    border-radius: 10px;
    overflow: hidden;
    flex: 0 0 auto;
  }
  .avatar {
    /* Official card aspect ratio (2:3) */
    width: 72px;
    aspect-ratio: 2 / 3;
    border-radius: 10px;
    object-fit: cover;
    background: var(--border);
    display: block;
  }
  .avatar.placeholder { display: grid; place-items: center; color: var(--muted); }
  .avatar-hint {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    font-size: 0.65rem;
    text-align: center;
    padding: 2px 0;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .avatar-wrap:hover .avatar-hint { opacity: 1; }
  .identity-fields { flex: 1 1 auto; display: flex; flex-direction: column; gap: 8px; justify-content: center; min-width: 0; }
  .name-input { font-weight: 600; }

  .section {
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg);
    overflow: hidden;
    transition: border-color 0.15s ease;
  }
  .section:hover { border-color: color-mix(in srgb, var(--border) 60%, var(--accent) 40%); }
  .section-head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 12px 14px;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 0.92rem;
    font-weight: 600;
    cursor: pointer;
    text-align: left;
  }
  .section-head :global(svg) { transition: transform 150ms ease; color: var(--muted); }
  .section.open .section-head :global(svg) { transform: rotate(90deg); }
  .section-head:hover { background: color-mix(in srgb, var(--border) 25%, transparent); }
  .section-body {
    padding: 4px 14px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .field { display: grid; gap: 6px; min-width: 0; }
  .field-label { font-size: 0.85rem; color: var(--muted); }
  .input, .textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--panel);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
  }
  .input:hover, .textarea:hover { border-color: color-mix(in srgb, var(--border) 70%, var(--accent)); }
  .input:focus, .textarea:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent);
  }
  .textarea { min-height: 68px; resize: vertical; }
  .textarea.tall { min-height: 130px; }
  .greeting-row { display: flex; gap: 6px; align-items: flex-start; }
  .greeting-row .textarea { flex: 1 1 auto; }
  .small-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
    border-radius: 10px;
    background: color-mix(in srgb, var(--accent) 10%, var(--panel) 90%);
    color: var(--accent);
    font: inherit;
    font-weight: 500;
    font-size: 0.85rem;
    cursor: pointer;
    align-self: flex-start;
    transition: all 0.15s ease;
  }
  .small-btn:hover {
    background: color-mix(in srgb, var(--accent) 18%, var(--panel) 82%);
    border-color: color-mix(in srgb, var(--accent) 50%, transparent);
    transform: translateY(-1px);
  }
  .small-btn.danger {
    border-color: var(--border);
    background: var(--panel);
    color: var(--muted);
    padding: 8px 10px;
  }
  .small-btn.danger:hover {
    border-color: color-mix(in srgb, #e53935 35%, var(--border));
    background: rgba(229, 57, 53, 0.08);
    color: #e53935;
  }
  .error-text { color: #e53935; font-size: 0.85rem; }

  @media (max-width: 640px) {
    .modal { padding: 0; }
    .panel { width: 100%; height: 100%; border-radius: 0; border: none; }
    .modal-head { padding: 16px 20px; }
    .modal-scroller { padding: 20px; }
    .modal-foot { padding: 12px 20px; }
    .grid-2 { grid-template-columns: 1fr; }
  }
</style>

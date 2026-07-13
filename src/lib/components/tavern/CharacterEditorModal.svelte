<script lang="ts">
  import { IconClose, IconAdd, IconDelete, IconDownload, IconPerson } from '../../icons'
  import ConfirmModal from '../ConfirmModal.svelte'
  import { exportCharacterCard } from '../../tavern/characterCard'
  import type { Character } from '../../types/tavern'

  interface Props {
    open?: boolean
    character?: Character | null
    canDelete?: boolean
    onSave?: (character: Character) => void
    onDelete?: (id: string) => Promise<void> | void
    onCancel?: () => void
  }

  const props: Props = $props()

  type SectionId = 'description' | 'greetings' | 'behavior' | 'overrides' | 'meta'

  let draft = $state<Character | null>(null)
  let tagsText = $state('')
  let avatarInput = $state<HTMLInputElement | null>(null)
  let errorText = $state('')
  let lastLoadedKey = $state('')
  let activeSection = $state<SectionId>('description')
  let deleteConfirmOpen = $state(false)
  let modalEl = $state<HTMLDivElement | null>(null)
  let scrollerEl = $state<HTMLDivElement | null>(null)
  let tabsEl = $state<HTMLElement | null>(null)

  // Re-seed the draft whenever the modal opens for a (possibly different) character
  $effect(() => {
    if (!props.open) {
      lastLoadedKey = ''
      deleteConfirmOpen = false
      return
    }
    const source = props.character
    const key = source ? source.id : 'new'
    if (lastLoadedKey === key) return
    lastLoadedKey = key
    errorText = ''
    deleteConfirmOpen = false
    activeSection = 'description'
    draft = source
      ? { ...source, alternateGreetings: [...(source.alternateGreetings || [])], tags: [...(source.tags || [])] }
      : null
    tagsText = source ? (source.tags || []).join(', ') : ''
  })

  function selectSection(id: SectionId, event: MouseEvent) {
    const changed = activeSection !== id
    activeSection = id
    // Center the tapped bubble by scrolling ONLY the tab strip horizontally,
    // so the tap never drags the vertical scroll position around.
    const btn = event.currentTarget as HTMLElement | null
    if (btn && tabsEl) {
      const left = btn.offsetLeft - (tabsEl.clientWidth - btn.offsetWidth) / 2
      tabsEl.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
    }
    // Section content swapped underneath: reset to the top so the view never
    // lands on a random mid-scroll position of the new content.
    if (changed && scrollerEl) scrollerEl.scrollTo({ top: 0 })
  }

  // Keep the modal pinned to the *visual* viewport so the on-screen keyboard
  // resizes the panel instead of letting the browser scroll the page.
  $effect(() => {
    if (!props.open) return
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      if (!modalEl) return
      modalEl.style.setProperty('--vv-height', `${Math.round(vv.height)}px`)
      modalEl.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`)
      // The inner scroller owns all scrolling; keep the page itself pinned.
      if (window.scrollY !== 0) window.scrollTo(0, 0)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      if (modalEl) {
        modalEl.style.removeProperty('--vv-height')
        modalEl.style.removeProperty('--vv-top')
      }
    }
  })

  // On touch devices, when a field gains focus (keyboard opens + field expands),
  // align it just below the sticky bubbles inside our own scroller instead of
  // letting the browser yank the page around.
  function handleFocusIn(event: FocusEvent) {
    const target = event.target as HTMLElement
    if (!(target instanceof HTMLTextAreaElement)) return
    if (!window.matchMedia('(max-width: 640px)').matches) return
    // Wait for the expansion transition + keyboard viewport change to settle.
    setTimeout(() => {
      if (!scrollerEl || document.activeElement !== target) return
      const tabsH = tabsEl?.offsetHeight ?? 0
      const sRect = scrollerEl.getBoundingClientRect()
      const tRect = target.getBoundingClientRect()
      const delta = tRect.top - sRect.top - tabsH - 8
      if (Math.abs(delta) > 4) scrollerEl.scrollBy({ top: delta, behavior: 'smooth' })
    }, 250)
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

  async function handleDelete() {
    if (!draft || !props.canDelete) return
    deleteConfirmOpen = false
    await props.onDelete?.(draft.id)
  }

  const sections: Array<{ id: SectionId; label: string }> = [
    { id: 'description', label: 'Description' },
    { id: 'greetings', label: 'Greetings' },
    { id: 'behavior', label: 'Personality & Scenario' },
    { id: 'overrides', label: 'Prompt overrides' },
    { id: 'meta', label: 'Creator & tags' },
  ]
</script>

<svelte:window onkeydown={(e) => { if (props.open && !deleteConfirmOpen && e.key === 'Escape') props.onCancel?.() }} />

{#if props.open && draft}
  <button type="button" class="backdrop" aria-label="Close character editor overlay" onclick={() => props.onCancel?.()}></button>
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="char-editor-title"
    tabindex="-1"
    bind:this={modalEl}
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
        <div class="modal-scroller" bind:this={scrollerEl} onfocusin={handleFocusIn}>
          <!-- Identity: always visible, everything else lives behind the bubbles -->
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

          <!-- Section bubbles: one compact row replaces five collapsed headers -->
          <div class="section-tabs" role="tablist" aria-label="Character sections" bind:this={tabsEl}>
            {#each sections as section (section.id)}
              <button
                type="button"
                class="tab-bubble {activeSection === section.id ? 'active' : ''}"
                role="tab"
                aria-selected={activeSection === section.id}
                onclick={(e) => selectSection(section.id, e)}
              >{section.label}</button>
            {/each}
          </div>

          <div class="section-body" role="tabpanel">
            {#if activeSection === 'description'}
              <textarea class="textarea tall" value={draft.description} oninput={(e) => updateField('description', e.currentTarget.value)} placeholder={'Who {{char}} is...'} aria-label="Description"></textarea>
            {:else if activeSection === 'greetings'}
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
            {:else if activeSection === 'behavior'}
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
            {:else if activeSection === 'overrides'}
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

          {#if errorText}
            <div class="error-text">{errorText}</div>
          {/if}
        </div>
      </div>

      <footer class="modal-foot">
        <button type="button" class="icon-btn" onclick={handleExport} title="Export card (PNG/JSON)" aria-label="Export card">
          <IconDownload style="font-size: 20px;" />
        </button>
        {#if props.canDelete}
          <button type="button" class="icon-btn delete-btn" onclick={() => (deleteConfirmOpen = true)} title="Delete character" aria-label="Delete character">
            <IconDelete style="font-size: 20px;" />
          </button>
        {/if}
        <div class="foot-spacer"></div>
        <button type="button" class="foot-btn" onclick={() => props.onCancel?.()}>Cancel</button>
        <button type="button" class="foot-btn primary" onclick={handleSave}>Save</button>
      </footer>
    </div>
  </div>
{/if}

<ConfirmModal
  open={deleteConfirmOpen}
  title="Delete Character"
  message="Delete this character and all of their chats? This action cannot be undone."
  confirmText="Delete"
  cancelText="Cancel"
  danger={true}
  onConfirm={handleDelete}
  onCancel={() => (deleteConfirmOpen = false)}
/>

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
    box-sizing: border-box;
    overflow: hidden;
  }
  .panel {
    width: min(calc(100vw - 48px), 640px);
    height: min(calc(100vh - 48px), 780px);
    height: min(calc(100dvh - 48px), 780px);
    min-height: 0;
    max-height: calc(100dvh - 48px);
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
    flex: 0 0 auto;
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
  .icon-btn.delete-btn { color: #dc5050; }
  .icon-btn.delete-btn:hover { border-color: #dc5050; background: rgba(220, 80, 80, 0.1); }
  .modal-body { flex: 1 1 auto; min-height: 0; overflow: hidden; }
  .modal-scroller {
    height: 100%;
    box-sizing: border-box;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    padding: 0 28px 48px;
    scroll-padding-bottom: 48px;
    scroll-padding-top: 56px;
    display: grid;
    gap: 12px;
    align-content: start;
  }
  .modal-scroller::-webkit-scrollbar { width: 8px; }
  .modal-scroller::-webkit-scrollbar-track { background: transparent; }
  .modal-scroller::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
  .modal-scroller::-webkit-scrollbar-thumb:hover { background: var(--muted); }
  .modal-foot {
    flex: 0 0 auto;
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

  .identity { display: flex; gap: 12px; align-items: stretch; margin-bottom: 4px; padding-top: 20px; }
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

  /* Bubble row: replaces the stack of collapsed section headers */
  .section-tabs {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    gap: 6px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    /* Bleed into the scroller padding so stuck content can't peek through */
    margin: 0 -28px;
    padding: 8px 28px;
    background: var(--panel);
    box-shadow: 0 6px 8px -8px rgba(0,0,0,0.25);
  }
  .section-tabs::-webkit-scrollbar { display: none; }
  .tab-bubble {
    flex: 0 0 auto;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 6px 13px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color .15s ease, color .15s ease, border-color .15s ease;
  }
  .tab-bubble:hover { border-color: color-mix(in srgb, var(--border) 55%, var(--accent) 45%); }
  .tab-bubble.active {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
    box-shadow: 0 2px 5px rgba(0,0,0,0.14);
  }
  .section-body {
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
    /* Keep natively focus-scrolled fields clear of the sticky bubble row */
    scroll-margin-top: 56px;
  }
  .input:hover, .textarea:hover { border-color: color-mix(in srgb, var(--border) 70%, var(--accent)); }
  .input:focus, .textarea:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent);
  }
  .textarea {
    min-height: 68px;
    resize: vertical;
    /* Expand-on-hover/focus: collapse is delayed so sweeping the pointer
       across fields doesn't cause jittery reflows. */
    transition: min-height .18s ease .25s;
  }
  .textarea.tall { min-height: 130px; }
  @media (hover: hover) and (pointer: fine) {
    .textarea:hover { min-height: 320px; transition-delay: .12s; }
  }
  .textarea:focus { min-height: 320px; transition-delay: 0s; }
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
    .modal { padding: 0; align-items: flex-start; }
    .panel {
      width: 100%;
      height: 100dvh;
      /* Track the visual viewport: the keyboard shrinks the panel instead of
         scrolling the page, so the footer stays reachable and nothing jumps. */
      height: var(--vv-height, 100dvh);
      transform: translateY(var(--vv-top, 0px));
      border-radius: 0;
      border: none;
    }
    /* Compact chrome so the content gets the space */
    .modal-head { padding: 8px 12px; }
    .title { font-size: 1rem; }
    .modal-head .icon-btn { width: 32px; height: 32px; }
    .modal-scroller {
      padding: 0 12px 24px;
      scroll-padding-bottom: 24px;
      scroll-padding-top: 52px;
      gap: 8px;
    }
    .identity { padding-top: 10px; gap: 10px; }
    .avatar { width: 56px; }
    .identity-fields { gap: 6px; }
    .section-tabs { margin: 0 -12px; padding: 6px 12px; }
    .input, .textarea { scroll-margin-top: 52px; }
    .modal-foot {
      padding: 8px 12px;
      padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
      gap: 8px;
    }
    .foot-btn { flex: 1 1 auto; justify-content: center; padding: 9px 14px; }
    .modal-foot .icon-btn { flex: 0 0 auto; }
    .grid-2 { grid-template-columns: 1fr; }
    /* Fields stay compact until focused, then take all the room the keyboard
       leaves us (tracked via --vv-height). Drag-resize is useless on touch. */
    .textarea { min-height: 72px; resize: none; }
    .textarea.tall { min-height: 120px; }
    .textarea:focus,
    .textarea.tall:focus {
      min-height: max(140px, calc(var(--vv-height, 100dvh) - 240px));
    }
  }
</style>

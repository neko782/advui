<script lang="ts">
  import { IconClose, IconAdd, IconDelete, IconDownload, IconPerson, IconCollapseContent } from '../../icons'
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

  // On mobile a focused textarea takes over the whole modal body (CSS
  // :focus-within), so no scrolling ever happens while typing. This state
  // just drives the floating "collapse" button.
  let fieldExpanded = $state(false)

  function handleFocusIn(event: FocusEvent) {
    if (event.target instanceof HTMLTextAreaElement) fieldExpanded = true
  }

  function handleFocusOut(event: FocusEvent) {
    if (!(event.relatedTarget instanceof HTMLTextAreaElement)) fieldExpanded = false
  }

  function collapseField() {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
    fieldExpanded = false
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
  <button type="button" class="ui-backdrop" aria-label="Close character editor overlay" onclick={() => props.onCancel?.()}></button>
  <div
    class="ui-modal modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="char-editor-title"
    tabindex="-1"
    bind:this={modalEl}
    onpointerdown={(event) => { if (event.target === event.currentTarget) props.onCancel?.() }}
  >
    <div class="ui-panel ui-panel-full panel">
      <header class="ui-modal-head">
        <div id="char-editor-title" class="ui-modal-title">Character</div>
        <button type="button" class="ui-icon-btn" aria-label="Close" onclick={() => props.onCancel?.()}>
          <IconClose style="font-size: 20px;" />
        </button>
      </header>

      <div class="ui-modal-body modal-body">
        <div class="ui-modal-scroller modal-scroller" bind:this={scrollerEl} onfocusin={handleFocusIn} onfocusout={handleFocusOut}>
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
              <input class="ui-input name-input" value={draft.name} oninput={(e) => updateField('name', e.currentTarget.value)} placeholder="Name" aria-label="Name" />
              <input class="ui-input" value={draft.nickname} oninput={(e) => updateField('nickname', e.currentTarget.value)} placeholder={'Nickname — replaces {{char}} (optional)'} aria-label="Nickname" />
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
              <label class="ui-field">
                <span class="ui-field-label">Description</span>
                <textarea class="ui-textarea tall" value={draft.description} oninput={(e) => updateField('description', e.currentTarget.value)} placeholder={'Who {{char}} is...'} aria-label="Description"></textarea>
              </label>
            {:else if activeSection === 'greetings'}
              <label class="ui-field">
                <span class="ui-field-label">First message</span>
                <textarea class="ui-textarea" value={draft.firstMes} oninput={(e) => updateField('firstMes', e.currentTarget.value)}></textarea>
              </label>
              {#each draft.alternateGreetings as greeting, index (index)}
                <div class="greeting-row">
                  <textarea class="ui-textarea" value={greeting} oninput={(e) => updateGreeting(index, e.currentTarget.value)} placeholder={`Alternate greeting ${index + 1}`}></textarea>
                  <button type="button" class="ui-icon-btn ui-icon-btn-sm danger" aria-label="Remove greeting" onclick={() => removeGreeting(index)}>
                    <IconDelete style="font-size: 16px;" />
                  </button>
                </div>
              {/each}
              <button type="button" class="ui-btn ui-btn-accent ui-btn-sm" onclick={addGreeting}>
                <IconAdd style="font-size: 16px;" /> Alternate greeting
              </button>
            {:else if activeSection === 'behavior'}
              <label class="ui-field">
                <span class="ui-field-label">Personality</span>
                <textarea class="ui-textarea" value={draft.personality} oninput={(e) => updateField('personality', e.currentTarget.value)}></textarea>
              </label>
              <label class="ui-field">
                <span class="ui-field-label">Scenario</span>
                <textarea class="ui-textarea" value={draft.scenario} oninput={(e) => updateField('scenario', e.currentTarget.value)}></textarea>
              </label>
              <label class="ui-field">
                <span class="ui-field-label">Example dialogue</span>
                <textarea class="ui-textarea" value={draft.mesExample} oninput={(e) => updateField('mesExample', e.currentTarget.value)}></textarea>
              </label>
            {:else if activeSection === 'overrides'}
              <label class="ui-field">
                <span class="ui-field-label">System prompt (replaces the main prompt; supports {'{{original}}'})</span>
                <textarea class="ui-textarea" value={draft.systemPrompt} oninput={(e) => updateField('systemPrompt', e.currentTarget.value)}></textarea>
              </label>
              <label class="ui-field">
                <span class="ui-field-label">Post-history instructions (supports {'{{original}}'})</span>
                <textarea class="ui-textarea" value={draft.postHistoryInstructions} oninput={(e) => updateField('postHistoryInstructions', e.currentTarget.value)}></textarea>
              </label>
            {:else}
              <div class="grid-2">
                <label class="ui-field">
                  <span class="ui-field-label">Creator</span>
                  <input class="ui-input" value={draft.creator} oninput={(e) => updateField('creator', e.currentTarget.value)} />
                </label>
                <label class="ui-field">
                  <span class="ui-field-label">Version</span>
                  <input class="ui-input" value={draft.characterVersion} oninput={(e) => updateField('characterVersion', e.currentTarget.value)} />
                </label>
              </div>
              <label class="ui-field">
                <span class="ui-field-label">Tags (comma separated)</span>
                <input class="ui-input" value={tagsText} oninput={(e) => (tagsText = e.currentTarget.value)} />
              </label>
              <label class="ui-field">
                <span class="ui-field-label">Creator notes (not sent to the model)</span>
                <textarea class="ui-textarea" value={draft.creatorNotes} oninput={(e) => updateField('creatorNotes', e.currentTarget.value)}></textarea>
              </label>
            {/if}
          </div>

          {#if errorText}
            <div class="ui-error-text">{errorText}</div>
          {/if}
        </div>
        {#if fieldExpanded}
          <button
            type="button"
            class="collapse-btn"
            onpointerdown={(e) => e.preventDefault()}
            onclick={collapseField}
          >
            <IconCollapseContent style="font-size: 16px;" /> Collapse
          </button>
        {/if}
      </div>

      <footer class="modal-foot">
        <button type="button" class="ui-icon-btn" onclick={handleExport} title="Export card (PNG/JSON)" aria-label="Export card">
          <IconDownload style="font-size: 20px;" />
        </button>
        {#if props.canDelete}
          <button type="button" class="ui-icon-btn danger" onclick={() => (deleteConfirmOpen = true)} title="Delete character" aria-label="Delete character">
            <IconDelete style="font-size: 20px;" />
          </button>
        {/if}
        <div class="foot-spacer"></div>
        <button type="button" class="ui-btn ui-btn-outline" onclick={() => props.onCancel?.()}>Cancel</button>
        <button type="button" class="ui-btn ui-btn-primary" onclick={handleSave}>Save</button>
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
  /* Chrome, fields, switches and buttons come from shared ui.css.
     Local: panel sizing, visual-viewport pinning, identity block,
     sticky section tabs and the mobile fullscreen-field behavior. */
  .modal {
    box-sizing: border-box;
    overflow: hidden;
  }
  @media (min-width: 641px) {
    .panel {
      width: min(calc(100vw - 48px), 640px);
      height: min(calc(100vh - 48px), 780px);
      height: min(calc(100dvh - 48px), 780px);
      min-height: 0;
      max-height: calc(100dvh - 48px);
    }
  }
  .modal-body { position: relative; }
  /* Floating collapse control for the mobile fullscreen field editor */
  .collapse-btn {
    display: none;
    position: absolute;
    top: 8px;
    right: 12px;
    z-index: 11;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-pill);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    box-shadow: var(--modal-shadow);
  }
  .modal-scroller {
    box-sizing: border-box;
    scrollbar-gutter: stable;
    padding: 0 var(--s5) var(--s6);
    gap: var(--s4);
    scroll-padding-bottom: var(--s6);
    scroll-padding-top: 56px;
  }
  .modal-foot {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--s2);
    padding: var(--s3) var(--s5);
    border-top: 1px solid var(--border);
  }
  .foot-spacer { flex: 1 1 auto; }

  .identity { display: flex; gap: var(--s3); align-items: stretch; padding-top: var(--s4); }
  .avatar-wrap {
    position: relative;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
    border-radius: var(--r-md);
    overflow: hidden;
    flex: 0 0 auto;
  }
  .avatar {
    /* Official card aspect ratio (2:3) */
    width: 72px;
    aspect-ratio: 2 / 3;
    border-radius: var(--r-md);
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
  .identity-fields { flex: 1 1 auto; display: flex; flex-direction: column; gap: var(--s2); justify-content: center; min-width: 0; }
  .name-input { font-weight: 600; }

  /* Bubble row: replaces the stack of collapsed section headers */
  .section-tabs {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    gap: 2px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    /* Bleed into the scroller padding so stuck content can't peek through */
    margin: 0 calc(-1 * var(--s5));
    padding: var(--s2) var(--s5);
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }
  .section-tabs::-webkit-scrollbar { display: none; }
  .tab-bubble {
    flex: 0 0 auto;
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    padding: 6px var(--s3);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 0.85rem;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color var(--dur) var(--ease), color var(--dur) var(--ease);
  }
  .tab-bubble:hover { color: var(--text); background: var(--hover-bg); }
  .tab-bubble.active {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }
  .section-body {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
  }

  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s3); }
  .ui-textarea {
    /* Keep natively focus-scrolled fields clear of the sticky bubble row */
    scroll-margin-top: 56px;
    min-height: 68px;
    /* Expand-on-hover/focus: collapse is delayed so sweeping the pointer
       across fields doesn't cause jittery reflows. */
    transition:
      min-height .18s ease .25s,
      border-color var(--dur) var(--ease),
      box-shadow var(--dur) var(--ease);
  }
  .ui-textarea.tall { min-height: 130px; }
  @media (hover: hover) and (pointer: fine) {
    .ui-textarea:hover { min-height: 320px; transition-delay: .12s; }
  }
  .ui-textarea:focus { min-height: 320px; transition-delay: 0s; }
  .greeting-row { display: flex; gap: var(--s2); align-items: flex-start; }
  .greeting-row .ui-textarea { width: auto; flex: 1 1 auto; }

  @media (max-width: 640px) {
    .modal { align-items: flex-start; }
    .panel {
      /* Track the visual viewport: the keyboard shrinks the panel instead of
         scrolling the page, so the footer stays reachable and nothing jumps. */
      height: var(--vv-height, 100dvh);
      transform: translateY(var(--vv-top, 0px));
    }
    .modal-scroller {
      padding: 0 var(--s4) var(--s5);
      scroll-padding-bottom: var(--s5);
      gap: var(--s3);
    }
    .identity { padding-top: 10px; gap: 10px; }
    .avatar { width: 56px; }
    .identity-fields { gap: 6px; }
    .section-tabs { margin: 0 calc(-1 * var(--s4)); padding: 6px var(--s4); }
    .ui-textarea { scroll-margin-top: 52px; min-height: 72px; resize: none; transition: none; }
    .ui-textarea.tall { min-height: 120px; }
    .modal-foot {
      padding: var(--s2) var(--s4);
      padding-bottom: calc(var(--s2) + env(safe-area-inset-bottom, 0px));
    }
    .modal-foot .ui-btn { flex: 1 1 auto; }
    .modal-foot .ui-icon-btn { flex: 0 0 auto; }
    .grid-2 { grid-template-columns: 1fr; }
    /* Focused textarea takes over the entire modal body, covering the
       identity block and bubbles: nothing underneath can scroll while the
       keyboard is open. The floating button collapses it back. */
    .ui-field:has(.ui-textarea):focus-within,
    .greeting-row:focus-within {
      position: absolute;
      inset: 0;
      z-index: 10;
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0;
      padding: 10px 12px 12px;
      box-sizing: border-box;
      background: var(--panel);
    }
    .ui-field:has(.ui-textarea):focus-within .ui-field-label {
      /* Keep the label clear of the floating collapse button */
      padding-right: 110px;
      min-height: 24px;
      display: flex;
      align-items: center;
    }
    .ui-field:has(.ui-textarea):focus-within .ui-textarea,
    .greeting-row:focus-within .ui-textarea {
      flex: 1 1 auto;
      min-height: 0;
      height: auto;
    }
    /* Greeting rows have no label; pad for the collapse button instead */
    .greeting-row:focus-within { padding-top: 44px; }
    .greeting-row:focus-within .ui-icon-btn { display: none; }
    .collapse-btn { display: inline-flex; }
  }
</style>

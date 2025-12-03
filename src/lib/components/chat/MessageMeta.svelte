<script lang="ts">
  import { IconPerson, IconSmartToy, IconTune } from '../../icons'
  import type { MessageRole } from '../../types'

  interface Props {
    role: MessageRole
    label?: string
    locked?: boolean
    debug?: boolean
    messageId?: number
    onSetRole?: (role: MessageRole) => void
  }

  const props: Props = $props()
  let open = $state(false)
  let groupEl = $state<HTMLDivElement | null>(null)
  let triggerEl = $state<HTMLButtonElement | null>(null)
  const menuId = `role-menu-${props.messageId ?? 'unknown'}`

  function toggleMenu() {
    if (props.locked) return
    open = !open
  }

  function closeMenu() {
    open = false
  }

  function handleSelect(role) {
    props.onSetRole?.(role)
    closeMenu()
    triggerEl?.focus()
  }

  function handleMenuKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
      triggerEl?.focus()
    }
  }

  function handleFocusOut(event) {
    if (!open) return
    if (groupEl && !groupEl.contains(event.relatedTarget)) {
      closeMenu()
    }
  }

  $effect(() => {
    if (!open) return

    const handlePointerDown = (event) => {
      if (!groupEl?.contains(event.target)) {
        closeMenu()
      }
    }

    const handleKeydown = (event) => {
      if (event.key === 'Escape') {
        closeMenu()
        triggerEl?.focus()
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeydown)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeydown)
    }
  })

  $effect(() => {
    if (props.locked && open) {
      closeMenu()
    }
  })
</script>

<div class={`meta ${props.role}`} data-open={open}>
  <div
    class="send-group"
    aria-haspopup="menu"
    title="Change role"
    data-open={open}
    data-side="bottom"
    bind:this={groupEl}
    onfocusout={handleFocusOut}
  >
    <button
      class="role-badge"
      aria-label={`Role: ${props.label || props.role}`}
      aria-expanded={open}
      aria-controls={menuId}
      disabled={props.locked}
      type="button"
      onclick={toggleMenu}
      bind:this={triggerEl}
    >
      {props.label || props.role}
    </button>
    <div
      class="send-menu"
      role="menu"
      aria-label="Change role"
      id={menuId}
      aria-hidden={!open}
      hidden={!open}
      data-open={open}
      onkeydown={handleMenuKeydown}
    >
      <button role="menuitem" class="menu-item" onclick={() => handleSelect('user')} aria-label="Set role user" disabled={props.locked}>
        <IconPerson style="font-size: 18px;" />
        User
      </button>
      <button role="menuitem" class="menu-item" onclick={() => handleSelect('assistant')} aria-label="Set role assistant" disabled={props.locked}>
        <IconSmartToy style="font-size: 18px;" />
        Assistant
      </button>
      <button role="menuitem" class="menu-item" onclick={() => handleSelect('system')} aria-label="Set role system" disabled={props.locked}>
        <IconTune style="font-size: 18px;" />
        System
      </button>
    </div>
  </div>
  {#if props.debug}
    <span class="id-tag" title={`ID: ${props.messageId}`}>· {props.messageId}</span>
  {/if}
</div>

<style>
  .meta { font-size: .8rem; color: var(--muted); padding: 0 2px; margin-bottom: 6px; display: inline-flex; align-items: center; gap: 8px; position: relative; z-index: 1; }
  .meta[data-open="true"] { z-index: 30; }
  .meta.assistant { padding-inline-start: 0; }
  .meta.user { justify-self: end; }
  .meta.assistant { justify-self: start; }
  .meta.system { justify-self: center; text-align: center; }
  .role-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--muted); line-height: 1.2; font: inherit; cursor: pointer; transition: color .12s ease, border-color .12s ease, background-color .12s ease; }
  .role-badge:hover, .role-badge:focus-visible { color: var(--text); border-color: color-mix(in srgb, var(--border), #ffffff 16%); }
  .role-badge:disabled { cursor: not-allowed; }
  .send-group { position: relative; display: grid; place-items: center; z-index: 0; }
  .send-group::before { content: ''; position: absolute; left: 50%; transform: translateX(-50%); width: max(100%, 44px); height: 12px; pointer-events: none; }
  .send-group:not([data-side])::before { display: none; }
  .send-group[data-side="bottom"]::before { top: 100%; }
  .send-group[data-open="true"]::before { pointer-events: auto; }
  .send-group[data-open="true"] { z-index: 20; }
  .send-menu { position: absolute; top: calc(100% + 8px); display: grid; gap: 6px; padding: 8px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--float-shadow); opacity: 0; transform: translateY(-6px); transition: opacity .12s ease, transform .12s ease; pointer-events: none; min-width: 160px; z-index: 1000; }
  .send-group[data-open="true"] .send-menu { opacity: 1; transform: translateY(0); pointer-events: auto; }
  /* Side-aware anchoring for role menu */
  .meta.assistant .send-group .send-menu { left: 0; right: auto; }
  .meta.user .send-group .send-menu { right: 0; left: auto; }
  .meta.system .send-group .send-menu { left: 50%; right: auto; transform: translate(-50%, -6px); }
  .meta.system .send-group[data-open="true"] .send-menu { transform: translate(-50%, 0); }
  .menu-item { width: 100%; text-align: left; background: transparent; border: 1px solid var(--border); border-radius: 8px; color: var(--text); padding: 8px 10px; font: inherit; display: flex; align-items: center; gap: 8px; }
  .menu-item:disabled { opacity: .6; cursor: not-allowed; }
  .role-badge:disabled { opacity: .6; }
  .id-tag { opacity: .7; font-feature-settings: 'tnum' 1; }
  :global(.row:has(.meta[data-open="true"])) { position: relative; z-index: 20; }
</style>

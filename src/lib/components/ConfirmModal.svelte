<script lang="ts">
  interface Props {
    open?: boolean
    title?: string
    message?: string
    confirmText?: string
    cancelText?: string
    danger?: boolean
    checkbox?: boolean
    checkboxLabel?: string
    checkboxChecked?: boolean
    onCheckboxChange?: (checked: boolean) => void
    onConfirm?: () => void
    onCancel?: () => void
  }

  const props: Props = $props()

  let dialogEl = $state<HTMLDivElement | null>(null)

  // Move focus into the dialog when it opens so the Escape keydown handler works.
  $effect(() => {
    if (props.open && dialogEl) {
      dialogEl.focus()
    }
  })

  async function handleConfirm() {
    try {
      await props.onConfirm?.()
    } catch (err) {
      console.error('ConfirmModal onConfirm error:', err)
    }
  }

  function handleCancel() {
    props.onCancel?.()
  }

  function handleCheckbox(e: Event) {
    const target = e.target as HTMLInputElement
    props.onCheckboxChange?.(target.checked)
  }
</script>

{#if props.open}
  <div class="modal-overlay" role="presentation">
    <button type="button" class="ui-backdrop" aria-label="Close dialog" onclick={handleCancel}></button>
    <div
      class="ui-modal modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      tabindex="-1"
      bind:this={dialogEl}
      onkeydown={(event) => { if (event.key === 'Escape') handleCancel() }}
    >
      <div class="ui-panel panel" class:danger={props.danger}>
        <div class="modal-content">
          {#if props.danger}
            <div class="icon-wrapper danger">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
          {/if}
          <div class="text-content">
            <div id="modal-title" class="title">{props.title || 'Confirm'}</div>
            <p class="message">{props.message || 'Are you sure?'}</p>
          </div>
          {#if props.checkbox}
            <label class="checkbox-row">
              <input type="checkbox" checked={props.checkboxChecked} onchange={handleCheckbox} />
              <span class="checkbox-label">{props.checkboxLabel || "Don't ask again"}</span>
            </label>
          {/if}
        </div>
        <footer class="modal-footer">
          <button type="button" class="ui-btn ui-btn-secondary" onclick={handleCancel}>
            {props.cancelText || 'Cancel'}
          </button>
          <button type="button" class={`ui-btn ${props.danger ? 'ui-btn-danger' : 'ui-btn-primary'}`} onclick={handleConfirm}>
            {props.confirmText || 'Confirm'}
          </button>
        </footer>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Overlay stacking + panel size are local; chrome and buttons are shared */
  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 1100;
  }
  .modal {
    pointer-events: none;
  }
  .panel {
    width: min(calc(100vw - 48px), 360px);
    pointer-events: auto;
  }

  .modal-content {
    padding: var(--s5) var(--s5) 20px var(--s5);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--s4);
  }

  .icon-wrapper {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  .icon-wrapper.danger {
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    color: var(--danger);
  }

  .text-content {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: var(--s2);
    cursor: pointer;
    margin-top: 4px;
  }

  .checkbox-row input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .checkbox-label {
    font-size: 0.85rem;
    color: var(--muted);
  }

  .title {
    font-weight: 600;
    font-size: 1.05rem;
    letter-spacing: -0.01em;
  }

  .message {
    margin: 0;
    line-height: 1.5;
    color: var(--muted);
    font-size: 0.9rem;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    gap: var(--s2);
    padding: 0 var(--s5) var(--s5) var(--s5);
  }

  .modal-footer .ui-btn {
    flex: 1;
  }

  @media (max-width: 640px) {
    .modal {
      padding: var(--s4);
      align-items: flex-end;
    }

    .panel {
      width: 100%;
    }

    :global(:root[data-fancy-effects="true"]) .panel {
      animation: slideUpMobile 0.25s var(--ease-out);
    }

    @keyframes slideUpMobile {
      from {
        opacity: 0;
        transform: translateY(100%);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .modal-content {
      padding: var(--s5) 20px 20px 20px;
    }

    .modal-footer {
      padding: 0 20px var(--s5) 20px;
    }
  }
</style>

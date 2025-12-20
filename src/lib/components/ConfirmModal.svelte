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
    <button type="button" class="backdrop" aria-label="Close dialog" onclick={handleCancel}></button>
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      tabindex="-1"
      onpointerdown={(event) => { if (event.target === event.currentTarget) handleCancel() }}
      onkeydown={(event) => { if (event.key === 'Escape') handleCancel() }}
    >
      <div class="panel" class:danger={props.danger}>
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
          <button type="button" class="btn btn-secondary" onclick={handleCancel}>
            {props.cancelText || 'Cancel'}
          </button>
          <button type="button" class={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`} onclick={handleConfirm}>
            {props.confirmText || 'Confirm'}
          </button>
        </footer>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    animation: fadeIn 0.15s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(8px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    border: 0;
    padding: 0;
    cursor: pointer;
  }

  .modal {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    pointer-events: none;
  }

  .panel {
    width: min(calc(100vw - 48px), 360px);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 16px;
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.03),
      0 4px 8px rgba(0, 0, 0, 0.04),
      0 16px 32px rgba(0, 0, 0, 0.08),
      0 32px 64px rgba(0, 0, 0, 0.12);
    color: var(--text);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    pointer-events: auto;
    animation: slideUp 0.2s ease-out;
  }

  .modal-content {
    padding: 24px 24px 20px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 16px;
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
    background: rgba(220, 80, 80, 0.12);
    color: #dc5050;
  }

  .text-content {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
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
    gap: 10px;
    padding: 0 24px 24px 24px;
  }

  .btn {
    flex: 1;
    border: none;
    border-radius: 10px;
    padding: 12px 18px;
    font: inherit;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-secondary {
    background: color-mix(in srgb, var(--text) 8%, transparent);
    color: var(--text);
  }

  .btn-secondary:hover {
    background: color-mix(in srgb, var(--text) 12%, transparent);
  }

  .btn-primary {
    background: var(--accent);
    color: white;
  }

  .btn-primary:hover {
    background: color-mix(in srgb, var(--accent) 85%, black 15%);
    transform: translateY(-1px);
  }

  .btn-primary:active {
    transform: translateY(0);
  }

  .btn-danger {
    background: #dc5050;
    color: white;
  }

  .btn-danger:hover {
    background: #c44040;
    transform: translateY(-1px);
  }

  .btn-danger:active {
    transform: translateY(0);
  }

  @media (max-width: 640px) {
    .modal {
      padding: 16px;
      align-items: flex-end;
    }

    .panel {
      width: 100%;
      border-radius: 20px 20px 12px 12px;
      animation: slideUpMobile 0.25s ease-out;
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
      padding: 24px 20px 20px 20px;
    }

    .modal-footer {
      padding: 0 20px 24px 20px;
    }
  }
</style>

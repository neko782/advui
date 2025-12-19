<script lang="ts">
  import { IconClose } from '../icons'

  interface Props {
    open?: boolean
    title?: string
    message?: string
    confirmText?: string
    cancelText?: string
    danger?: boolean
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
</script>

{#if props.open}
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
    <div class="panel">
      <header class="modal-head">
        <div id="modal-title" class="title">{props.title || 'Confirm'}</div>
        <button class="icon-btn" onclick={handleCancel} aria-label="Close">
          <IconClose style="font-size: 20px;" />
        </button>
      </header>
      <div class="modal-body">
        <p class="message">{props.message || 'Are you sure?'}</p>
      </div>
      <footer class="modal-footer">
        <button type="button" class="btn btn-secondary" onclick={handleCancel}>
          {props.cancelText || 'Cancel'}
        </button>
        <button type="button" class={`btn btn-primary ${props.danger ? 'btn-danger' : ''}`} onclick={handleConfirm}>
          {props.confirmText || 'Confirm'}
        </button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 1000;
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
    z-index: 1001;
  }

  .panel {
    width: min(calc(100vw - 48px), 480px);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 18px;
    box-shadow: 0 20px 40px rgba(0,0,0,0.2);
    color: var(--text);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
    border-bottom: 1px solid var(--border);
  }

  .title {
    font-weight: 600;
    font-size: 1.1rem;
  }

  .modal-body {
    padding: 24px;
    flex: 1;
  }

  .message {
    margin: 0;
    line-height: 1.5;
    color: var(--text);
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 24px;
    border-top: 1px solid var(--border);
  }

  .icon-btn {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    line-height: 1;
    color: var(--text);
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .icon-btn:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .btn {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 20px;
    font: inherit;
    font-size: 0.95rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-secondary {
    background: transparent;
    color: var(--text);
  }

  .btn-secondary:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .btn-primary {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .btn-primary:hover {
    background: color-mix(in srgb, var(--accent) 90%, black 10%);
    border-color: color-mix(in srgb, var(--accent) 90%, black 10%);
  }

  .btn-danger {
    background: #d64545;
    border-color: #d64545;
  }

  .btn-danger:hover {
    background: #b83838;
    border-color: #b83838;
  }

  @media (max-width: 640px) {
    .modal {
      padding: 12px;
    }

    .panel {
      width: 100%;
    }

    .modal-head,
    .modal-body,
    .modal-footer {
      padding: 16px;
    }
  }
</style>

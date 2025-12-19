<script lang="ts">
  import { tick } from 'svelte'

  interface Props {
    open?: boolean
    value?: string
    title?: string
    label?: string
    placeholder?: string
    confirmText?: string
    cancelText?: string
    onConfirm?: (value: string) => void
    onCancel?: () => void
  }

  const props: Props = $props()

  let inputEl = $state<HTMLInputElement | null>(null)
  let localValue = $state('')

  $effect(() => {
    if (props.open && props.value) {
      localValue = props.value
      tick().then(() => {
        inputEl?.focus()
        inputEl?.select?.()
      })
    }
  })

  function handleConfirm() {
    props.onConfirm?.(localValue)
  }

  function handleCancel() {
    props.onCancel?.()
  }

  function handleKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleConfirm()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      handleCancel()
    }
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
      <div class="panel">
        <header class="modal-head">
          <div id="modal-title" class="title">{props.title || 'Edit'}</div>
          <button class="close-btn" onclick={handleCancel} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </header>
        <div class="modal-body">
          <label class="field">
            <span class="label">{props.label || 'Value'}</span>
            <input
              bind:this={inputEl}
              type="text"
              class="input"
              placeholder={props.placeholder || ''}
              value={localValue}
              oninput={(e) => localValue = e.currentTarget.value}
              onkeydown={handleKeydown}
              aria-label={props.label || 'Value'}
            />
          </label>
        </div>
        <footer class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick={handleCancel}>
            {props.cancelText || 'Cancel'}
          </button>
          <button type="button" class="btn btn-primary" onclick={handleConfirm}>
            {props.confirmText || 'Save'}
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
    width: min(calc(100vw - 48px), 400px);
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

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 20px 0 20px;
  }

  .title {
    font-weight: 600;
    font-size: 1.05rem;
    letter-spacing: -0.01em;
  }

  .close-btn {
    border: none;
    border-radius: 8px;
    background: transparent;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    color: var(--muted);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .close-btn:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
    color: var(--text);
  }

  .modal-body {
    padding: 20px;
    flex: 1;
  }

  .field {
    display: grid;
    gap: 8px;
  }

  .label {
    font-size: 0.85rem;
    color: var(--muted);
    font-weight: 500;
  }

  .input {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 14px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 0.95rem;
    transition: all 0.15s ease;
  }

  .input:hover {
    border-color: color-mix(in srgb, var(--border) 80%, var(--text) 20%);
  }

  .input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    padding: 16px 20px 20px 20px;
  }

  .btn {
    border: none;
    border-radius: 10px;
    padding: 10px 18px;
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

    .modal-head {
      padding: 20px 20px 0 20px;
    }

    .modal-body {
      padding: 20px;
    }

    .modal-footer {
      padding: 16px 20px 24px 20px;
    }
  }
</style>

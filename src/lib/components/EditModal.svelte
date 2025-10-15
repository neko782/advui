<script>
  import { tick } from 'svelte'
  import { IconClose } from '../icons.js'

  const props = $props()

  let inputEl = $state(null)
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
        <button class="icon-btn" onclick={handleCancel} aria-label="Close">
          <IconClose style="font-size: 20px;" />
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

  .field {
    display: grid;
    gap: 8px;
  }

  .label {
    font-size: 0.9rem;
    color: var(--muted);
    font-weight: 500;
  }

  .input {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 1rem;
  }

  .input:focus {
    outline: 2px solid var(--accent);
    outline-offset: 0;
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

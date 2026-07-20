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

  let wasOpen = false
  $effect(() => {
    if (props.open && !wasOpen) {
      localValue = props.value ?? ''
      tick().then(() => {
        inputEl?.focus()
        inputEl?.select?.()
      })
    }
    wasOpen = !!props.open
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
    <button type="button" class="ui-backdrop" aria-label="Close dialog" onclick={handleCancel}></button>
    <div
      class="ui-modal modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      tabindex="-1"
      onpointerdown={(event) => { if (event.target === event.currentTarget) handleCancel() }}
      onkeydown={(event) => { if (event.key === 'Escape') handleCancel() }}
    >
      <div class="ui-panel panel">
        <header class="modal-head">
          <div id="modal-title" class="ui-modal-title">{props.title || 'Edit'}</div>
          <button class="ui-icon-btn" onclick={handleCancel} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </header>
        <div class="modal-body">
          <label class="ui-field">
            <span class="ui-field-label">{props.label || 'Value'}</span>
            <input
              bind:this={inputEl}
              type="text"
              class="ui-input"
              placeholder={props.placeholder || ''}
              value={localValue}
              oninput={(e) => localValue = e.currentTarget.value}
              onkeydown={handleKeydown}
              aria-label={props.label || 'Value'}
            />
          </label>
        </div>
        <footer class="modal-footer">
          <button type="button" class="ui-btn ui-btn-secondary" onclick={handleCancel}>
            {props.cancelText || 'Cancel'}
          </button>
          <button type="button" class="ui-btn ui-btn-primary" onclick={handleConfirm}>
            {props.confirmText || 'Save'}
          </button>
        </footer>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Overlay stacking, panel size and internal layout are local;
     chrome, field and buttons come from shared ui.css */
  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
  }
  .modal {
    pointer-events: none;
  }
  .panel {
    width: min(calc(100vw - 48px), 400px);
    pointer-events: auto;
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s3);
    padding: 20px var(--s5) 0 var(--s5);
  }

  .modal-body {
    padding: var(--s4) var(--s5);
    flex: 1;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--s2);
    padding: 0 var(--s5) 20px var(--s5);
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

    .modal-head {
      padding: 20px 20px 0 20px;
    }

    .modal-body {
      padding: var(--s4) 20px;
    }

    .modal-footer {
      padding: 0 20px 20px 20px;
    }
  }
</style>

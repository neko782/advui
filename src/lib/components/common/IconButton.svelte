<script lang="ts">
  import Icon from '../../Icon.svelte'

  interface Props {
    title?: string
    ariaLabel?: string
    disabled?: boolean
    onclick?: () => void
    name?: string
    size?: number
  }

  const props: Props = $props()
</script>

<button class="icon-btn" title={props.title || ''} aria-label={props.ariaLabel || props.title} disabled={props.disabled} onclick={props.onclick}>
  <Icon name={props.name || ''} size={props.size ?? 22} />
</button>

<style>
  .icon-btn {
    min-width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    color: var(--text);
    line-height: 1;
    transition: background-color .15s ease, border-color .15s ease, color .15s ease, transform .1s ease;
  }
  .icon-btn:hover:not(:disabled) {
    background: var(--panel);
    border-color: var(--accent);
    color: var(--accent);
  }
  .icon-btn:active:not(:disabled) {
    transform: scale(0.95);
  }
  .icon-btn:disabled {
    opacity: .5;
    cursor: not-allowed;
  }
  .icon-btn :global(.icon) { font-size: 22px; }
</style>

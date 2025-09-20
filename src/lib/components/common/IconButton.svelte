<script>
  import Icon from '../../Icon.svelte'
  const props = $props()
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
    background: transparent;
    color: var(--text);
    line-height: 1;
  }
  .icon-btn :global(.icon) { font-size: 22px; }
</style>

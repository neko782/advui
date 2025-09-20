<script>
  import SendMenu from '../common/SendMenu.svelte'
  const props = $props()
  let root

  // Close when clicking outside or pressing Escape
  $effect(() => {
    function onDocClick(e) {
      try { if (props.open && root && !root.contains(e.target)) props.onClose?.() } catch {}
    }
    function onKeydown(e) { if (e.key === 'Escape' && props.open) props.onClose?.() }
    window.addEventListener('click', onDocClick, true)
    window.addEventListener('keydown', onKeydown)
    return () => {
      window.removeEventListener('click', onDocClick, true)
      window.removeEventListener('keydown', onKeydown)
    }
  })
</script>

<div class={`chat-settings-group ${props.open ? 'open' : ''}`} bind:this={root}>
  <button class="icon-btn" aria-label="Chat settings" onclick={() => (props.onToggle?.())}>
    <span class="material-symbols-rounded icon">tune</span>
  </button>
  <div class="send-menu chat-settings-menu" role="menu" aria-label="Chat settings">
    <div class="menu-section">
      <div class="menu-label">Model</div>
      <input
        type="text"
        placeholder="gpt-4o-mini"
        value={props.model}
        oninput={(e) => props.onInputModel?.(e.currentTarget.value)}
        list="model-suggestions"
        aria-label="Model"
      />
      {#if props.modelIds?.length}
        <datalist id="model-suggestions">
          {#each props.modelIds as mid}
            <option value={mid}>{mid}</option>
          {/each}
        </datalist>
      {/if}
    </div>
  </div>
</div>

<style>
  .icon-btn { border: 1px solid var(--border); border-radius: 10px; background: transparent; min-width: 44px; height: 44px; display: grid; place-items: center; line-height: 1; }
  .icon { font-size: 22px; }
  .chat-settings-menu { min-width: 260px; gap: 12px; padding: 12px; }
  .menu-section { display: grid; gap: 6px; }
  .menu-label { font-size: .9rem; color: var(--muted); }
  input {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    box-sizing: border-box;
  }
  .chat-settings-group { position: relative; display: grid; place-items: center; }
  .chat-settings-menu {
    position: absolute;
    top: auto;
    bottom: calc(100% + 10px);
    left: 8px;
    right: auto;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--float-shadow);
    opacity: 0;
    transform: translateY(6px);
    transition: opacity .12s ease, transform .12s ease;
    pointer-events: none;
    z-index: 20;
  }
  .chat-settings-group.open .chat-settings-menu { opacity: 1; pointer-events: auto; transform: translateY(0); }
  .chat-settings-group::before { content: ''; position: absolute; left: 0; bottom: 100%; width: 220px; height: 12px; }
</style>


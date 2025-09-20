<script>
  // Generic hover/focus popover menu container
  // Usage: wrap a trigger in this component and place menu content in the default slot named "menu".
  const props = $props()
</script>

<div class={`send-group ${props.className || ''}`} aria-haspopup="menu">
  <slot />
  <div class={`send-menu ${props.side || 'top'}`} role="menu">
    <slot name="menu" />
  </div>
  <!-- Hover bridge created via CSS ::before on .send-group -->
</div>

<style>
  .send-group { position: relative; display: grid; place-items: center; z-index: 0; }
  .send-group:hover,
  .send-group:focus-within { z-index: 20; }
  .send-group::before {
    content: '';
    position: absolute;
    right: 0;
    bottom: 100%;
    width: 220px;
    height: 12px;
  }
  .send-menu {
    position: absolute;
    right: 0;
    display: grid;
    gap: 6px;
    padding: 8px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--float-shadow);
    opacity: 0;
    transform: translateY(6px);
    transition: opacity .12s ease, transform .12s ease;
    pointer-events: none;
    min-width: 160px;
    z-index: 10;
  }
  .send-group:hover .send-menu,
  .send-group:focus-within .send-menu { opacity: 1; transform: translateY(0); pointer-events: auto; }

  .send-menu.top { bottom: calc(100% + 10px); }
  .send-menu.bottom { top: calc(100% + 10px); }

  .menu-item {
    width: 100%;
    text-align: left;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    padding: 8px 10px;
    font: inherit;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .menu-item:disabled { opacity: .6; cursor: not-allowed; }
</style>

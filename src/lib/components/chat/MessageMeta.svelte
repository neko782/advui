<script>
  import Icon from '../../Icon.svelte'
  const props = $props()
</script>

<div class={`meta ${props.role}`}>
  <div class="send-group" aria-haspopup="menu" title="Change role">
    <button class="role-badge" aria-label={`Role: ${props.label || props.role}`} disabled={props.locked}>
      {props.label || props.role}
    </button>
    <div class="send-menu" role="menu" aria-label="Change role">
      <button role="menuitem" class="menu-item" onclick={() => props.onSetRole?.('user')} aria-label="Set role user" disabled={props.locked}>
        <Icon name="person" size={18} />
        User
      </button>
      <button role="menuitem" class="menu-item" onclick={() => props.onSetRole?.('assistant')} aria-label="Set role assistant" disabled={props.locked}>
        <Icon name="smart_toy" size={18} />
        Assistant
      </button>
      <button role="menuitem" class="menu-item" onclick={() => props.onSetRole?.('system')} aria-label="Set role system" disabled={props.locked}>
        <Icon name="tune" size={18} />
        System
      </button>
    </div>
  </div>
</div>

<style>
  .meta { font-size: .8rem; color: var(--muted); padding: 0 2px; margin-bottom: 6px; }
  .meta.user { justify-self: end; }
  .meta.assistant { justify-self: start; }
  .meta.system { justify-self: center; text-align: center; }
  .role-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--muted); line-height: 1.2; font: inherit; cursor: default; transition: color .12s ease, border-color .12s ease, background-color .12s ease; }
  .role-badge:hover, .role-badge:focus-visible { color: var(--text); border-color: color-mix(in srgb, var(--border), #ffffff 16%); }
  .send-group { position: relative; display: grid; place-items: center; z-index: 0; }
  .send-group:hover, .send-group:focus-within { z-index: 20; }
  .send-group::before { content: ''; position: absolute; width: 180px; height: 12px; top: 100%; }
  .send-menu { position: absolute; top: calc(100% + 8px); display: grid; gap: 6px; padding: 8px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--float-shadow); opacity: 0; transform: translateY(-6px); transition: opacity .12s ease, transform .12s ease; pointer-events: none; min-width: 160px; z-index: 1000; }
  .send-group:hover .send-menu, .send-group:focus-within .send-menu { opacity: 1; transform: translateY(0); pointer-events: auto; }
  /* Side-aware anchoring for role menu */
  .meta.assistant .send-group .send-menu { left: 0; right: auto; }
  .meta.user .send-group .send-menu { right: 0; left: auto; }
  .meta.system .send-group .send-menu { left: 50%; right: auto; transform: translate(-50%, -6px); }
  .meta.system .send-group:hover .send-menu, .meta.system .send-group:focus-within .send-menu { transform: translate(-50%, 0); }
  /* Hover bridge alignment to match side */
  .meta.assistant .send-group::before { left: 0; right: auto; }
  .meta.user .send-group::before { right: 0; left: auto; }
  .meta.system .send-group::before { left: 50%; right: auto; transform: translateX(-50%); }
  .menu-item { width: 100%; text-align: left; background: transparent; border: 1px solid var(--border); border-radius: 8px; color: var(--text); padding: 8px 10px; font: inherit; display: flex; align-items: center; gap: 8px; }
  .menu-item:disabled { opacity: .6; cursor: not-allowed; }
  .role-badge:disabled { opacity: .6; cursor: not-allowed; }
</style>

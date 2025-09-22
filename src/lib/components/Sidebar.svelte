<script>
  import Icon from '../Icon.svelte'
  const props = $props()

  // (cleaned) no local utilities currently needed
</script>

<aside class="sidebar {props.open ? '' : 'collapsed'}">
  <div class="sidebar-inner">
    <!-- Compact header with only the collapse toggle -->
    <div class="side-header">
      <button class="icon-btn" title="Toggle sidebar" aria-label="Toggle sidebar" aria-expanded={props.open ? 'true' : 'false'} onclick={() => props.onToggle?.()}>
        <Icon name="menu" size={20} />
      </button>
      {#if props.open}
        <div class="brand">AI Chat</div>
      {/if}
    </div>

    <!-- Body is always present so collapsed mode can show actions -->
    <div class="side-body">
      <!-- Primary nav actions -->
      <nav class="top-nav" aria-label="Primary">
        <button class="nav-item" onclick={() => props.onNewChat?.()} title="New chat" aria-label="New chat">
          <Icon name="edit_square" size={20} />
          <span class="label">New chat</span>
        </button>
      </nav>

      {#if props.open}
        <!-- Chat list as simple ghost-text buttons -->
        <div class="section-label">Chats</div>
        <nav class="chat-list" aria-label="Chats">
          {#each (props.chats || []) as c (c.id)}
            <button
              class="chat-link {props.selectedId === c.id ? 'active' : ''}"
              title={c.title || 'Chat'}
              onclick={() => props.onSelect?.(c.id)}
            >
              <span class="chat-title">{c.title || 'New Chat'}</span>
            </button>
          {/each}
        </nav>
      {/if}

      <!-- Footer actions pinned at the bottom -->
      <div class="side-footer">
        <button class="nav-item" onclick={() => props.onOpenSettings?.()} title="Settings" aria-label="Settings">
          <Icon name="settings" size={20} />
          <span class="label">Settings</span>
        </button>
      </div>
    </div>
  </div>
  {#if props.open}
    <div class="side-fade"></div>
  {/if}
</aside>

<style>
  .sidebar {
    --bg: color-mix(in oklab, canvas, #f3f4f6 10%);
    --panel: color-mix(in srgb, #ffffff 92%, #e6e6e6);
    --border: color-mix(in srgb, #c8c8c8 60%, #0000);
    --text: color-mix(in srgb, #1b1f24 92%, #0000);
    --muted: #6b7280;
    /* Subtle hover surface derived from background + text for good contrast in light/dark */
    --hover-bg: color-mix(in oklab, var(--bg), var(--text) 8%);
    background: var(--bg);
    border-right: 1px solid var(--border);
    /* Overlay the chat area instead of shifting it */
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 280px;
    height: 100%;
    z-index: 10;
  }
  .sidebar.collapsed { width: 52px; }
  @media (prefers-color-scheme: dark) {
    .sidebar {
      --bg: #0f0f10;
      --panel: #141414;
      --border: #2a2a2a;
      --text: #e6e6e6;
      --muted: #a3a3a3;
    }
  }
  .sidebar-inner { height: 100%; display: grid; grid-template-rows: auto 1fr; }
  .side-body { display: flex; flex-direction: column; min-height: 0; }
  .side-header { display: flex; align-items: center; gap: 8px; padding: 8px; }
  .brand { font-weight: 600; padding: 6px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); }
  .icon-btn { min-width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); color: var(--text); }
  .sidebar.collapsed .brand { display: none; }
  .sidebar.collapsed .chat-list { display: none; }
  .top-nav { display: grid; gap: 6px; padding: 6px 8px 2px; }
  /* Left padding set to 8px for precise alignment */
  .nav-item { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 8px 10px 8px 8px; border: 0; border-radius: 8px; background: transparent; color: var(--text); }
  .nav-item:hover { background: var(--panel); }
  .nav-item .label { white-space: nowrap; }
  .sidebar.collapsed .nav-item .label { display: none; }
  /* Collapsed nav items: icon-only ghost buttons (no border/background) */
  .sidebar.collapsed .nav-item {
    display: grid;
    place-items: center;
    padding: 0;
    min-width: 36px;
    height: 36px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--text);
  }
  .sidebar.collapsed .nav-item:hover,
  .sidebar.collapsed .nav-item:active,
  .sidebar.collapsed .nav-item:focus-visible {
    background: var(--hover-bg);
  }

  /* Give the collapse (menu) button a hover, matching ghost hover tone */
  .side-header .icon-btn:hover,
  .side-header .icon-btn:active,
  .side-header .icon-btn:focus-visible {
    background: var(--hover-bg);
  }

  /* Align label with chat buttons and add spacing from New chat */
  .section-label {
    font-size: .85rem;
    color: var(--muted);
    /* Left padding matches chat button left edge: chat-list(6px) + chat-link(10px) */
    padding: 8px 12px 0 16px;
    margin-top: 10px;
    margin-bottom: 8px; /* space between label and chat list */
  }
  .chat-list { display: grid; gap: 2px; padding: 0 6px 10px; overflow: auto; align-content: start; flex: 1; min-height: 0; }
  .chat-link { text-align: left; display: block; width: 100%; padding: 6px 10px; border: 0; background: transparent; color: var(--muted); border-radius: 8px; font: inherit; }
  .chat-link:hover { background: var(--panel); color: var(--text); }
  .chat-link.active { color: var(--text); }
  .chat-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .side-footer { padding: 8px; border-top: 1px solid var(--border); margin-top: auto; }
  /* Remove horizontal separator in collapsed mode */
  .sidebar.collapsed .side-footer { border-top: 0; }
  .side-fade { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(180deg, transparent, transparent 40%, rgba(0,0,0,0.04) 100%); mix-blend-mode: multiply; opacity: .35; }
</style>

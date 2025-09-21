<script>
  import Icon from '../Icon.svelte'
  const props = $props()

  function fmtTime(ts) {
    try {
      const d = new Date(ts)
      return d.toLocaleString()
    } catch { return '' }
  }
</script>

<aside class="sidebar">
  <div class="sidebar-inner">
    <div class="side-header">
      <div class="title">Chats</div>
      <button class="icon-btn" title="Hide" aria-label="Hide chats" onclick={() => props.onClose?.()}>
        <Icon name="close" size={20} />
      </button>
      <button class="icon-btn" title="New chat" aria-label="New chat" onclick={() => props.onNewChat?.()}>
        <Icon name="add" size={20} />
      </button>
    </div>
    <nav class="chat-list" aria-label="Chats">
      {#each (props.chats || []) as c (c.id)}
        <button
          class="chat-item {props.selectedId === c.id ? 'active' : ''}"
          title={c.title || 'Chat'}
          onclick={() => props.onSelect?.(c.id)}
        >
          <div class="chat-title">{c.title || 'New Chat'}</div>
          {#if c.updatedAt}
            <div class="chat-meta">{fmtTime(c.updatedAt)}</div>
          {/if}
        </button>
      {/each}
    </nav>
  </div>
  <div class="side-fade"></div>
</aside>

<style>
  .sidebar {
    --bg: color-mix(in oklab, canvas, #f3f4f6 10%);
    --panel: color-mix(in srgb, #ffffff 92%, #e6e6e6);
    --border: color-mix(in srgb, #c8c8c8 60%, #0000);
    --text: color-mix(in srgb, #1b1f24 92%, #0000);
    --muted: #6b7280;
    background: var(--bg);
    border-right: 1px solid var(--border);
    /* Overlay the chat area instead of shifting it */
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 320px;
    height: 100%;
    z-index: 10;
  }
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
  .side-header { display: flex; align-items: center; justify-content: space-between; padding: 10px; gap: 8px; }
  .title { font-weight: 600; padding: 6px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); }
  .icon-btn { min-width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); color: var(--text); }
  .chat-list {
    display: grid;
    gap: 6px;
    /* Add top padding so selected ring isn't clipped at the top */
    padding: 8px 8px 10px;
    overflow: auto;
    /* Prevent auto-rows from stretching to fill the column; enable scroll instead */
    align-content: start;
  }
  .chat-item {
    text-align: left;
    display: grid;
    gap: 2px;
    /* Slightly bigger touch target */
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--text);
    font: inherit;
    /* Even, fixed item size so the list scrolls instead of stretching */
    height: 64px;
    align-content: center;
  }
  /* Draw selection ring inside to avoid clipping and layout shifts */
  .chat-item.active { box-shadow: inset 0 0 0 2px #3584e4; border-color: #3584e4; }
  .chat-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chat-meta { font-size: 12px; color: var(--muted); }
  .side-fade { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(180deg, transparent, transparent 40%, rgba(0,0,0,0.04) 100%); mix-blend-mode: multiply; opacity: .35; }
</style>

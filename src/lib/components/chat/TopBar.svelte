<script>
  const props = $props()
</script>

<header class="topbar">
  <div class="topbar-inner">
    <div class="titlebox">AI Chat</div>
  </div>
</header>

<style>
  .topbar {
    position: sticky;
    top: 0; left: 0; right: 0;
    z-index: 5;
    background: transparent;
  }
  .topbar-inner {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
    padding: 10px 0;
    max-width: var(--page-max);
    margin-inline: auto;
    padding-inline: 0;
  }
  .titlebox {
    font-weight: 600;
    letter-spacing: 0.2px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg);
    flex: 1;
    min-height: 44px;
    display: flex;
    align-items: center;
  }
</style>

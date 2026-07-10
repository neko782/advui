<script lang="ts">
  import { onMount } from 'svelte'
  import { IconAdd, IconVisibility, IconVisibilityOff, IconAutorenew, IconDelete, IconDragHandle } from '../../icons'
  import type { SettingsDraft } from './settingsDraft.svelte'

  interface Props {
    draft: SettingsDraft
  }

  const props: Props = $props()
  const draft = $derived(props.draft)
  const local = $derived(props.draft.local)

  const connectionsForRender = () => draft.connections
  const activeConnection = $derived(draft.activeConnection)
  const activeConnectionId = $derived(draft.activeConnectionId)
  const activeRefreshMsg = $derived(draft.activeRefreshMsg)
  const activeConnectionRefreshing = $derived(draft.activeConnectionRefreshing)

  const selectConnection = (id) => draft.selectConnection(id)
  const addConnection = () => draft.addConnection()
  const removeConnection = (id) => draft.removeConnection(id)
  const updateActiveConnection = (patch) => draft.updateActiveConnection(patch)
  const invalidateActiveConnectionModelCache = () => draft.invalidateActiveConnectionModelCache()
  const refreshModelsNow = (targetId?, options?) => draft.refreshModelsNow(targetId, options)

  let revealKey = $state(false)
  let connectionFormReady = $state(false)

  onMount(() => {
    // Lazy load model cache when the connections tab is first shown
    if (!draft.modelCacheLoaded) {
      requestAnimationFrame(() => draft.loadModelCaches())
    }
    // Defer rendering connection form to avoid Firefox password manager blocking
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        connectionFormReady = true
      })
    })
  })

  // Drag and drop state
  let draggedConnectionId = $state<string | null>(null)
  let dragOverConnectionId = $state<string | null>(null)

  // Touch drag state for mobile
  let touchDragId = $state<string | null>(null)
  let touchListRef = $state<HTMLElement | null>(null)

  function handleConnectionDragStart(e: DragEvent, id: string) {
    draggedConnectionId = id
    e.dataTransfer!.effectAllowed = 'move'
    e.dataTransfer!.setData('text/plain', id)
  }

  function handleConnectionDragOver(e: DragEvent, id: string) {
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'
    if (!draggedConnectionId || draggedConnectionId === id) return
    dragOverConnectionId = id
  }

  function handleConnectionDrop(e: DragEvent) {
    e.preventDefault()
    if (draggedConnectionId && dragOverConnectionId && draggedConnectionId !== dragOverConnectionId) {
      draft.reorderConnections(draggedConnectionId, dragOverConnectionId)
    }
    draggedConnectionId = null
    dragOverConnectionId = null
  }

  function handleConnectionDragEnd() {
    draggedConnectionId = null
    dragOverConnectionId = null
  }

  // Touch handlers for mobile drag and drop
  function handleConnectionTouchStart(e: TouchEvent, id: string) {
    touchDragId = id
    draggedConnectionId = id
    const listEl = (e.currentTarget as HTMLElement).closest('.item-list')
    if (listEl) touchListRef = listEl as HTMLElement
  }

  function handleConnectionTouchMove(e: TouchEvent) {
    if (!touchDragId || !touchListRef) return
    e.preventDefault()
    const touchY = e.touches[0].clientY

    // Find which item the touch is over
    const items = touchListRef.querySelectorAll('.list-item')
    for (const item of items) {
      const id = item.getAttribute('data-id')
      if (id && id !== touchDragId) {
        const rect = item.getBoundingClientRect()
        if (touchY >= rect.top && touchY <= rect.bottom) {
          dragOverConnectionId = id
          return
        }
      }
    }
  }

  function handleConnectionTouchEnd() {
    if (touchDragId && dragOverConnectionId) {
      draft.reorderConnections(touchDragId, dragOverConnectionId)
    }
    touchDragId = null
    touchListRef = null
    draggedConnectionId = null
    dragOverConnectionId = null
  }
</script>

            <section class="group">
              <div class="group-head">
                <div class="group-title">Connections</div>
                <button type="button" class="icon-btn add-btn" title="Add connection" aria-label="Add connection" onclick={addConnection}>
                  <IconAdd style="font-size: 20px;" />
                </button>
              </div>
              <p class="hint section-hint">Manage your API connections. Drag to reorder.</p>
              <div class="item-list reorder-list">
                {#each connectionsForRender() as connection (connection.id)}
                  {@const isDragging = draggedConnectionId === connection.id}
                  {@const isDragOver = dragOverConnectionId === connection.id && draggedConnectionId !== connection.id}
                  <div
                    class="list-item {connection.id === activeConnectionId ? 'active' : ''} {isDragging ? 'dragging' : ''} {isDragOver ? 'drag-over' : ''}"
                    data-id={connection.id}
                    draggable="true"
                    ondragstart={(e) => handleConnectionDragStart(e, connection.id)}
                    ondragover={(e) => handleConnectionDragOver(e, connection.id)}
                    ondrop={handleConnectionDrop}
                    ondragend={handleConnectionDragEnd}
                    role="listitem"
                  >
                    <div
                      class="drag-handle"
                      aria-label="Drag to reorder"
                      ontouchstart={(e) => handleConnectionTouchStart(e, connection.id)}
                      ontouchmove={handleConnectionTouchMove}
                      ontouchend={handleConnectionTouchEnd}
                      ontouchcancel={resetTouchState}
                    >
                      <IconDragHandle style="font-size: 20px;" />
                    </div>
                    <button
                      type="button"
                      class="item-content"
                      onclick={() => selectConnection(connection.id)}
                    >
                      <span class="item-name">{connection?.name || connection?.id || 'Connection'}</span>
                      <span class="item-meta">{connection?.apiBaseUrl || 'Default endpoint'}</span>
                    </button>
                    {#if (local?.connections?.length || 0) > 1}
                      <button
                        type="button"
                        class="item-delete"
                        onclick={() => removeConnection(connection.id)}
                        title="Delete connection"
                        aria-label="Delete connection"
                      >
                        <IconDelete style="font-size: 18px;" />
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>
              {#if activeConnection && connectionFormReady}
                <div class="form-section">
                  <div class="form-section-title">Edit: {activeConnection.name || 'Connection'}</div>
                  <label class="field">
                    <span>Name</span>
                    <input
                      type="text"
                      placeholder="Connection name"
                      value={activeConnection.name || ''}
                      oninput={(event) => updateActiveConnection({ name: event.currentTarget.value })}
                      aria-label="Connection name"
                      autocomplete="off"
                      data-1p-ignore
                      data-lpignore="true"
                    />
                  </label>
                  <label class="field">
                    <span>API Key</span>
                    <div class="row">
                      <input
                        type="text"
                        placeholder="sk-..."
                        value={activeConnection.apiKey || ''}
                        autocomplete="off"
                        oninput={(event) => updateActiveConnection({ apiKey: event.currentTarget.value })}
                        onchange={() => invalidateActiveConnectionModelCache()}
                        aria-label="API key"
                        data-1p-ignore
                        data-lpignore="true"
                        data-form-type="other"
                        style={revealKey ? '' : '-webkit-text-security: disc; font-family: text-security-disc;'}
                        inputmode="text"
                      />
                      <button class="icon-btn" title={revealKey ? 'Hide key' : 'Show key'} onclick={() => (revealKey = !revealKey)} aria-label={revealKey ? 'Hide key' : 'Show key'}>
                        {#if revealKey}
                          <IconVisibilityOff style="font-size: 20px;" />
                        {:else}
                          <IconVisibility style="font-size: 20px;" />
                        {/if}
                      </button>
                      <button class="icon-btn" title="Test connection & fetch models" onclick={() => refreshModelsNow(activeConnection.id)} aria-label="Refresh models" disabled={activeConnectionRefreshing}>
                        <IconAutorenew style="font-size: 20px;" />
                      </button>
                    </div>
                  </label>
                  <p class="hint">Your key is stored locally in this browser.</p>
                  <label class="field">
                    <span>API base URL</span>
                    <input
                      type="text"
                      placeholder={DEFAULT_API_BASE_URL}
                      value={activeConnection.apiBaseUrl || ''}
                      autocomplete="off"
                      inputmode="url"
                      oninput={(event) => updateActiveConnection({ apiBaseUrl: event.currentTarget.value })}
                      onchange={() => invalidateActiveConnectionModelCache()}
                      aria-label="API base URL"
                      data-1p-ignore
                      data-lpignore="true"
                    />
                  </label>
                  <p class="hint">Leave blank to use the default endpoint for the selected API.</p>
                  <label class="field">
                    <span>API</span>
                    <select
                      value={activeConnection.apiMode || 'responses'}
                      onchange={(event) => updateActiveConnection({ apiMode: event.currentTarget.value })}
                      aria-label="API mode"
                    >
                      <option value="responses">Responses API</option>
                      <option value="chat_completions">Chat Completions API</option>
                      <option value="gemini">Gemini API</option>
                    </select>
                  </label>
                  {#if activeRefreshMsg}
                    <p class="hint status-msg" aria-live="polite">{activeRefreshMsg}</p>
                  {/if}
                </div>
              {/if}
            </section>

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    z-index: 1000;
    border: 0;
    padding: 0;
  }
  :global(:root[data-fancy-effects="true"]) .backdrop {
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    animation: backdrop-fade-in 0.2s ease-out;
  }
  @keyframes backdrop-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .modal {
    position: fixed; inset: 0;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    z-index: 1001;
  }
  .panel {
    width: min(calc(100vw - 48px), 1080px);
    height: min(calc(100vh - 48px), 900px);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 20px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    color: var(--text);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  :global(:root[data-fancy-effects="true"]) .panel {
    box-shadow:
      0 0 0 1px rgba(0,0,0,0.03),
      0 4px 12px rgba(0,0,0,0.08),
      0 16px 48px rgba(0,0,0,0.12),
      0 24px 64px rgba(0,0,0,0.08);
    animation: panel-slide-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }
  :global(:root[data-theme='dark']) .panel {
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }
  :global(:root[data-theme='dark'][data-fancy-effects="true"]) .panel {
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.05),
      0 4px 12px rgba(0,0,0,0.3),
      0 16px 48px rgba(0,0,0,0.4),
      0 24px 64px rgba(0,0,0,0.3);
  }
  @keyframes panel-slide-in {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(8px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }
  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 28px;
    border-bottom: 1px solid var(--border);
    background: linear-gradient(180deg, var(--panel), color-mix(in srgb, var(--panel) 95%, var(--bg) 5%));
  }
  .title {
    font-weight: 700;
    font-size: 1.15rem;
    letter-spacing: -0.01em;
  }
  .tab-bar {
    display: flex;
    gap: 6px;
    padding: 12px 24px;
    border-bottom: 1px solid var(--border);
    overflow: hidden;
    background: color-mix(in srgb, var(--panel) 98%, var(--bg) 2%);
  }
  .tab {
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-weight: 500;
    padding: 10px 18px;
    position: relative;
    white-space: nowrap;
    cursor: pointer;
    border-radius: 10px;
    transition: color 0.15s ease, background 0.15s ease;
  }
  .tab:hover:not(.active) {
    color: var(--text);
    background: color-mix(in srgb, var(--border) 40%, transparent);
  }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .tab.active {
    color: var(--text);
    background: color-mix(in srgb, var(--border) 60%, transparent);
  }
  .modal-body { flex: 1; overflow: hidden; }
  .modal-scroller {
    height: 100%;
    overflow-y: auto;
    padding: 28px;
    display: grid;
    gap: 20px;
    align-content: start;
  }
  .icon-btn {
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--panel);
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    line-height: 1;
    color: var(--text);
    transition: all 0.15s ease;
  }
  .icon-btn:hover:not(:disabled) {
    background: var(--bg);
    border-color: color-mix(in srgb, var(--border) 70%, var(--accent) 30%);
    transform: translateY(-1px);
  }
  .icon-btn:active:not(:disabled) {
    transform: translateY(0);
  }
  .icon-btn:disabled { opacity: .5; cursor: not-allowed; }
  .tool-network-settings {
    display: grid;
    gap: 10px;
    padding: 10px 12px;
    margin-left: 12px;
    border-left: 2px solid var(--border);
  }
  .mcp-settings {
    gap: 8px;
  }
  .mcp-server-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    align-items: center;
  }
  .mcp-remove-btn {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--panel);
    color: #d64545;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
  }
  .mcp-remove-btn:hover {
    background: color-mix(in srgb, #d64545 8%, var(--panel));
    border-color: color-mix(in srgb, #d64545 35%, var(--border));
  }
  .mcp-remove-btn:active {
    transform: scale(0.96);
  }
  .mcp-add-btn {
    width: fit-content;
  }
  .field-hint {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .field { display: grid; gap: 6px; }
  .field > span {
    font-size: .875rem;
    font-weight: 500;
    color: var(--muted);
  }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  input[type="text"],
  input[type="number"],
  select,
  textarea {
    flex: 1;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 11px 14px;
    background: var(--panel);
    color: var(--text);
    font: inherit;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  input[type="text"]:focus,
  input[type="number"]:focus,
  select:focus,
  textarea:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent);
  }
  input[type="text"]:hover:not(:focus),
  input[type="number"]:hover:not(:focus),
  select:hover:not(:focus),
  textarea:hover:not(:focus) {
    border-color: color-mix(in srgb, var(--border) 70%, var(--text) 30%);
  }
  textarea {
    min-height: 96px;
    line-height: 1.5;
    resize: vertical;
  }
  .hint {
    color: var(--muted);
    font-size: .85rem;
    margin-top: 2px;
    line-height: 1.4;
  }
  /* API key action buttons size */
  .row .icon-btn { height: 42px; width: 42px; }
  .group {
    display: grid;
    gap: 12px;
    padding: 20px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    transition: border-color 0.15s ease;
  }
  .group:hover {
    border-color: color-mix(in srgb, var(--border) 80%, var(--text) 20%);
  }
  .group-title {
    font-weight: 600;
    font-size: 1rem;
    letter-spacing: -0.01em;
    color: var(--text);
  }
  .group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 4px;
  }
  .group-head .icon-btn { flex-shrink: 0; }
  .presets .group-head .icon-btn { width: 32px; height: 32px; border-radius: 8px; }
  .preset-group-divider {
    height: 1px;
    background: var(--border);
    margin: 4px 0 0;
  }
  .preset-group-header {
    font-size: .75rem;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.6px;
    margin: 0;
    width: 100%;
    border: none;
    background: transparent;
    padding: 4px 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    user-select: none;
    transition: color 0.15s ease;
  }
  .preset-group-header:hover { color: var(--text); }
  .chevron {
    transition: transform .2s ease;
    flex-shrink: 0;
    opacity: 0.7;
  }
  .preset-group-header:hover .chevron {
    opacity: 1;
  }
  .chevron.expanded {
    transform: rotate(180deg);
  }
  .developer-group {
    background: color-mix(in srgb, var(--panel) 95%, var(--muted) 5%);
    border-style: dashed;
  }
  .legal-group {
    background: color-mix(in srgb, var(--panel) 96%, var(--accent) 4%);
  }
  .legal-link {
    color: var(--accent);
    font-size: 0.9rem;
    text-decoration: underline;
    text-underline-offset: 2px;
    word-break: break-all;
  }
  .legal-link:hover,
  .legal-link:focus-visible {
    color: color-mix(in srgb, var(--accent) 80%, var(--text) 20%);
  }
  /* Item list for connections and presets */
  .section-hint {
    margin: 0 0 8px;
    opacity: 0.9;
  }
  .item-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 20px;
  }
  .list-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px;
    border-radius: 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .list-item:hover {
    border-color: color-mix(in srgb, var(--border) 60%, var(--accent) 40%);
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  }
  .list-item.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, var(--bg) 94%);
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--accent) 12%, transparent),
      0 2px 8px rgba(0,0,0,0.06);
  }
  .list-item.dragging {
    opacity: 0.5;
    border-style: dashed;
    border-color: var(--accent);
    transform: scale(0.98);
    z-index: 10;
    background: color-mix(in srgb, var(--accent) 8%, var(--bg) 92%);
  }
  /* Reorder list with smooth transitions */
  .reorder-list .list-item {
    transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1), opacity 0.15s ease, border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
  }
  .reorder-list .list-item.dragging {
    transition: opacity 0.15s ease, border-color 0.15s ease;
  }
  /* Remove old drag-over highlight - items now shift visually */
  .list-item.drag-over {
    /* Items shift position instead of just highlighting */
  }
  .drag-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 44px;
    color: var(--muted);
    cursor: grab;
    border: none;
    background: transparent;
    border-radius: 8px;
    flex-shrink: 0;
    transition: color 0.15s ease, background 0.15s ease;
    opacity: 0.7;
    touch-action: none;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }
  .list-item:hover .drag-handle {
    opacity: 1;
  }
  .drag-handle:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--border) 40%, transparent);
  }
  .drag-handle:active {
    cursor: grabbing;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  /* Mobile: always show drag handle clearly */
  @media (pointer: coarse) {
    .drag-handle {
      opacity: 1;
      width: 44px;
      height: 48px;
    }
  }
  .item-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    padding: 8px 10px;
    text-align: left;
    border: none;
    background: transparent;
    border-radius: 8px;
    min-width: 0;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .item-content:hover {
    background: color-mix(in srgb, var(--border) 25%, transparent);
  }
  .item-name {
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .item-meta {
    font-size: 0.8rem;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .item-delete {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    color: var(--muted);
    border: none;
    background: transparent;
    border-radius: 8px;
    flex-shrink: 0;
    cursor: pointer;
    transition: all 0.15s ease;
    opacity: 0.6;
  }
  .list-item:hover .item-delete {
    opacity: 1;
  }
  .item-delete:hover {
    color: #e53935;
    background: rgba(229, 57, 53, 0.12);
  }
  :global(:root[data-theme='dark']) .item-delete:hover {
    background: rgba(229, 57, 53, 0.18);
  }

  /* Form section styling */
  .form-section {
    display: grid;
    gap: 10px;
    padding: 20px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: inset 0 1px 2px rgba(0,0,0,0.02);
  }
  .form-section-title {
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--text);
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
  .status-msg {
    padding: 10px 14px;
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--accent) 15%, transparent);
    font-size: 0.9rem;
  }

  /* Add button styling */
  .add-btn {
    background: color-mix(in srgb, var(--accent) 10%, var(--panel) 90%);
    border-color: color-mix(in srgb, var(--accent) 25%, transparent);
    color: var(--accent);
  }
  .add-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 18%, var(--panel) 82%);
    border-color: color-mix(in srgb, var(--accent) 50%, transparent);
    transform: translateY(-1px);
  }
  
  /* Legacy styles kept for backward compatibility */
  .preset-strip { display: flex; flex-wrap: wrap; gap: 6px; }
  .preset-pill { border: 1px solid var(--border); border-radius: 999px; padding: 4px 10px; background: var(--bg); color: var(--text); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-size: .85rem; transition: background-color .15s ease, color .15s ease, border-color .15s ease; }
  .preset-pill:hover { border-color: color-mix(in srgb, var(--border) 55%, var(--accent) 45%); }
  .preset-pill.active { background: var(--accent); border-color: transparent; color: #fff; box-shadow: 0 2px 5px rgba(0,0,0,0.14); }
  .preset-pill-name { pointer-events: none; }
  .preset-delete { display: inline-flex; align-items: center; gap: 6px; border: 1px solid rgba(214,69,69,0.4); border-radius: 8px; padding: 4px 8px; background: transparent; color: #d64545; cursor: pointer; width: fit-content; font-size: .85rem; }
  .preset-delete:hover { background: rgba(214,69,69,0.06); }
  .preset-delete:focus-visible { outline: 2px solid rgba(214,69,69,0.6); outline-offset: 2px; }
  .connection-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  /* Toggle switch */
  .switch {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    user-select: none;
  }
  .switch > input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
  .switch-ui {
    width: 46px;
    height: 26px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--border) 80%, var(--muted) 20%);
    position: relative;
    transition: background-color .2s ease, box-shadow .2s ease;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
  }
  .switch-ui::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2), 0 2px 6px rgba(0,0,0,0.1);
    transition: transform .2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .switch:hover .switch-ui {
    background: color-mix(in srgb, var(--border) 60%, var(--muted) 40%);
  }
  :global(:root[data-theme='dark']) .switch-ui {
    background: #2a2a2a;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.3);
  }
  :global(:root[data-theme='dark']) .switch-ui::after { background: #e6e6e6; }
  .switch > input:checked + .switch-ui {
    background: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
  }
  .switch > input:checked + .switch-ui::after { transform: translateX(20px); }
  .switch-label {
    font-size: .95rem;
    font-weight: 500;
    color: var(--text);
  }
  .data-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .data-action-btn {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .data-action-btn:hover:not(:disabled) {
    background: var(--panel);
    border-color: color-mix(in srgb, var(--border) 60%, var(--accent) 40%);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  }
  .data-action-btn:active:not(:disabled) {
    transform: translateY(0);
  }
  .data-action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  @media (max-width: 640px) {
    .modal { padding: 0; }
    .panel {
      width: 100%;
      height: 100%;
      border-radius: 0;
      border: none;
    }
    .modal-head { padding: 16px 20px; }
    .tab-bar { padding: 10px 16px; gap: 4px; }
    .tab { padding: 8px 14px; font-size: 0.9rem; }
    .modal-scroller { padding: 20px; gap: 16px; }
    .group { padding: 16px; border-radius: 12px; }
    .data-actions { flex-direction: column; }
    .data-action-btn { width: 100%; justify-content: center; }
  }

  /* Smooth scrollbar styling */
  .modal-scroller::-webkit-scrollbar {
    width: 8px;
  }
  .modal-scroller::-webkit-scrollbar-track {
    background: transparent;
  }
  .modal-scroller::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 4px;
  }
  .modal-scroller::-webkit-scrollbar-thumb:hover {
    background: var(--muted);
  }

  /* Reset button */
  .reset-btn {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    color: var(--muted);
    font: inherit;
    font-size: 0.8rem;
    font-weight: 500;
    padding: 6px 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .reset-btn:hover {
    color: var(--text);
    border-color: color-mix(in srgb, var(--border) 60%, var(--text) 30%);
    background: var(--bg);
  }

  /* Action item in message buttons list */
  .action-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    flex-wrap: wrap;
  }
  .action-item-label {
    flex: 1;
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--text);
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 8px 4px;
  }
  .action-item.disabled-action .action-item-label {
    color: var(--muted);
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--muted) 50%, transparent);
  }
  .action-item.disabled-action {
    opacity: 0.7;
    background: color-mix(in srgb, var(--bg) 90%, var(--muted) 10%);
  }
  .message-role-checks {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-left: auto;
  }
  .role-check {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.8rem;
    color: var(--muted);
    user-select: none;
  }
  .role-check input {
    width: 14px;
    height: 14px;
    margin: 0;
    accent-color: var(--accent);
  }
  .action-toggle {
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    flex-shrink: 0;
    user-select: none;
  }
  .action-toggle > input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
    pointer-events: none;
  }
  .action-toggle .switch-ui {
    width: 40px;
    height: 22px;
  }
  .action-toggle .switch-ui::after {
    width: 16px;
    height: 16px;
  }
  .action-toggle > input:checked + .switch-ui {
    background: var(--accent) !important;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
  }
  .action-toggle > input:checked + .switch-ui::after {
    transform: translateX(18px);
  }
  .action-toggle:hover > input:not(:checked) + .switch-ui {
    background: color-mix(in srgb, var(--border) 60%, var(--muted) 40%);
  }
  :global(:root[data-theme='dark']) .action-toggle > input:not(:checked) + .switch-ui {
    background: #2a2a2a;
  }

  /* Tools grid */
  .tools-grid {
    display: grid;
    gap: 8px;
  }
  .tool-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 16px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    user-select: none;
  }
  .tool-card:hover {
    border-color: color-mix(in srgb, var(--border) 60%, var(--accent) 40%);
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  }
  .tool-card-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--accent) 10%, var(--panel) 90%);
    color: var(--accent);
    flex-shrink: 0;
    transition: background 0.15s ease;
  }
  .tool-card:hover .tool-card-icon {
    background: color-mix(in srgb, var(--accent) 16%, var(--panel) 84%);
  }
  .tool-card-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .tool-card-name {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
  }
  .tool-card-desc {
    font-size: 0.8rem;
    color: var(--muted);
    line-height: 1.3;
  }
  .tool-card-toggle {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }
  .tool-card-toggle > input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
    pointer-events: none;
  }
  .tool-card-toggle .switch-ui {
    width: 46px;
    height: 26px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--border) 80%, var(--muted) 20%);
    position: relative;
    transition: background-color .2s ease, box-shadow .2s ease;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
  }
  .tool-card-toggle .switch-ui::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2), 0 2px 6px rgba(0,0,0,0.1);
    transition: transform .2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .tool-card:hover .tool-card-toggle > input:not(:checked) + .switch-ui {
    background: color-mix(in srgb, var(--border) 60%, var(--muted) 40%);
  }
  :global(:root[data-theme='dark']) .tool-card-toggle > input:not(:checked) + .switch-ui {
    background: #2a2a2a;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.3);
  }
  :global(:root[data-theme='dark']) .tool-card-toggle .switch-ui::after {
    background: #e6e6e6;
  }
  .tool-card-toggle > input:checked + .switch-ui {
    background: var(--accent) !important;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
  }
  .tool-card-toggle > input:checked + .switch-ui::after {
    transform: translateX(20px);
  }
  .tool-card:has(.tool-card-toggle > input:checked) {
    border-color: color-mix(in srgb, var(--accent) 30%, var(--border) 70%);
    background: color-mix(in srgb, var(--accent) 4%, var(--bg) 96%);
  }
</style>

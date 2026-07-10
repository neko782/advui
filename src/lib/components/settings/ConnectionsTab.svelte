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
  @keyframes backdrop-fade-in {
    from { opacity: 0;
    }
    to { opacity: 1;
    }
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
  .icon-btn:disabled { opacity: .5; cursor: not-allowed;
  }
  .field { display: grid; gap: 6px;
  }
  .field > span {
    font-size: .875rem;
    font-weight: 500;
    color: var(--muted);
  }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
  }
  input[type="text"], select {
    flex: 1;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 11px 14px;
    background: var(--panel);
    color: var(--text);
    font: inherit;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  input[type="text"]:focus, select:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent);
  }
  input[type="text"]:hover:not(:focus), select:hover:not(:focus) {
    border-color: color-mix(in srgb, var(--border) 70%, var(--text) 30%);
  }
  .hint {
    color: var(--muted);
    font-size: .85rem;
    margin-top: 2px;
    line-height: 1.4;
  }
  /* API key action buttons size */
  .row .icon-btn { height: 42px; width: 42px;
  }
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
  .group-head .icon-btn { flex-shrink: 0;
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
  /* Toggle switch */
  @media (max-width: 640px) {
    .group { padding: 16px; border-radius: 12px;
    }
  }
  /* Smooth scrollbar styling */
  /* Reset button */
  /* Action item in message buttons list */
  /* Tools grid */
</style>

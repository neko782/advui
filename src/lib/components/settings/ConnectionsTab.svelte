<script lang="ts">
  import { onMount } from 'svelte'
  import { IconAdd, IconVisibility, IconVisibilityOff, IconAutorenew, IconDelete, IconDragHandle } from '../../icons'
  import { DEFAULT_API_BASE_URL } from './settingsDraft.svelte'
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
    const listEl = (e.currentTarget as HTMLElement).closest('.ui-item-list')
    if (listEl) touchListRef = listEl as HTMLElement
  }

  function handleConnectionTouchMove(e: TouchEvent) {
    if (!touchDragId || !touchListRef) return
    e.preventDefault()
    const touchY = e.touches[0].clientY

    // Find which item the touch is over
    const items = touchListRef.querySelectorAll('.ui-list-item')
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

  function resetTouchState() {
    touchDragId = null
    touchListRef = null
    draggedConnectionId = null
    dragOverConnectionId = null
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

            <section class="ui-group">
              <div class="ui-group-head">
                <div class="ui-group-title">Connections</div>
                <button type="button" class="ui-icon-btn accent" title="Add connection" aria-label="Add connection" onclick={addConnection}>
                  <IconAdd style="font-size: 20px;" />
                </button>
              </div>
              <p class="ui-hint">Manage your API connections. Drag to reorder.</p>
              <div class="ui-item-list ui-reorder-list">
                {#each connectionsForRender() as connection (connection.id)}
                  {@const isDragging = draggedConnectionId === connection.id}
                  {@const isDragOver = dragOverConnectionId === connection.id && draggedConnectionId !== connection.id}
                  <div
                    class="ui-list-item {connection.id === activeConnectionId ? 'active' : ''} {isDragging ? 'dragging' : ''} {isDragOver ? 'drag-over' : ''}"
                    data-id={connection.id}
                    draggable="true"
                    ondragstart={(e) => handleConnectionDragStart(e, connection.id)}
                    ondragover={(e) => handleConnectionDragOver(e, connection.id)}
                    ondrop={handleConnectionDrop}
                    ondragend={handleConnectionDragEnd}
                    role="listitem"
                  >
                    <div
                      class="ui-drag-handle"
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
                      class="ui-item-content"
                      onclick={() => selectConnection(connection.id)}
                    >
                      <span class="ui-item-name">{connection?.name || connection?.id || 'Connection'}</span>
                      <span class="ui-item-meta">{connection?.apiBaseUrl || 'Default endpoint'}</span>
                    </button>
                    {#if (local?.connections?.length || 0) > 1}
                      <button
                        type="button"
                        class="ui-item-delete"
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
                <div class="ui-form-section">
                  <div class="ui-form-section-title">Edit: {activeConnection.name || 'Connection'}</div>
                  <label class="ui-field">
                    <span>Name</span>
                    <input
                      class="ui-input"
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
                  <label class="ui-field">
                    <span>API Key</span>
                    <div class="ui-row">
                      <input
                        class="ui-input"
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
                      <button class="ui-icon-btn" title={revealKey ? 'Hide key' : 'Show key'} onclick={() => (revealKey = !revealKey)} aria-label={revealKey ? 'Hide key' : 'Show key'}>
                        {#if revealKey}
                          <IconVisibilityOff style="font-size: 20px;" />
                        {:else}
                          <IconVisibility style="font-size: 20px;" />
                        {/if}
                      </button>
                      <button class="ui-icon-btn" title="Test connection & fetch models" onclick={() => refreshModelsNow(activeConnection.id)} aria-label="Refresh models" disabled={activeConnectionRefreshing}>
                        <IconAutorenew style="font-size: 20px;" />
                      </button>
                    </div>
                  </label>
                  <p class="ui-hint">Your key is stored locally in this browser.</p>
                  <label class="ui-field">
                    <span>API base URL</span>
                    <input
                      class="ui-input"
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
                  <p class="ui-hint">Leave blank to use the default endpoint for the selected API.</p>
                  <label class="ui-field">
                    <span>API</span>
                    <select
                      class="ui-select"
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
                    <p class="ui-status-msg" aria-live="polite">{activeRefreshMsg}</p>
                  {/if}
                </div>
              {/if}
            </section>

<style>
  /* All chrome, form controls, list items and icon buttons use the
     shared primitives from ui.css — nothing tab-specific remains. */
</style>

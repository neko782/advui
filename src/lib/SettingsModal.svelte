<script>
  import { loadSettings, saveSettings } from './settingsStore.js'
  import { setModelsCache, loadModelsCache, loadAllModelCaches } from './modelsStore.js'
  import { listModelsWithKey } from './openaiClient.js'
  import Icon from './Icon.svelte'

  const props = $props()

  let local = $state(loadSettings())
  let modelCacheByConnection = $state(loadAllModelCaches())
  let revealKey = $state(false)
  let refreshingConnectionId = $state('')
  let refreshMessages = $state({})
  let activePresetId = $state('')
  let activeConnectionId = $state('')
  const TABS = [
    { id: 'connection', label: 'Connections' },
    { id: 'presets', label: 'Presets' },
    { id: 'developer', label: 'Developer' },
  ]
  let activeTab = $state('connection')

  const REASONING_OPTIONS = ['none', 'minimal', 'low', 'medium', 'high']
  const TEXT_VERBOSITY_OPTIONS = ['low', 'medium', 'high']
  const REASONING_SUMMARY_OPTIONS = ['auto', 'concise', 'detailed']

  function parseMaxTokens(value) {
    if (value === '' || value == null) return null
    const num = Number(value)
    if (!Number.isFinite(num)) return null
    const rounded = Math.max(1, Math.floor(num))
    return Number.isFinite(rounded) ? rounded : null
  }

  function parseTopP(value) {
    if (value === '' || value == null) return null
    const num = Number(value)
    if (!Number.isFinite(num)) return null
    return Math.min(1, Math.max(0, num))
  }

  function parseTemperature(value) {
    if (value === '' || value == null) return null
    const num = Number(value)
    if (!Number.isFinite(num)) return null
    return Math.min(2, Math.max(0, num))
  }

  function parseReasoning(value) {
    return REASONING_OPTIONS.includes(value) ? value : 'none'
  }

  function parseVerbosity(value) {
    return TEXT_VERBOSITY_OPTIONS.includes(value) ? value : 'medium'
  }

  function parseReasoningSummary(value) {
    return REASONING_SUMMARY_OPTIONS.includes(value) ? value : 'auto'
  }

  function genPresetId() {
    return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  }

  const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1'

  function genConnectionId() {
    return `connection_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  }

  function syncActiveConnection() {
    let list = Array.isArray(local?.connections) ? local.connections : []
    if (!list.length) {
      const conn = {
        id: genConnectionId(),
        name: 'Connection 1',
        apiKey: '',
        apiBaseUrl: DEFAULT_API_BASE_URL,
        apiMode: 'responses',
      }
      local.connections = [conn]
      list = local.connections
    }
    const hasActive = list.some(c => c?.id === activeConnectionId)
    const fallback = list.find(c => c?.id === local?.selectedConnectionId)
      || list[0]
      || null
    const nextId = hasActive ? activeConnectionId : (fallback?.id || '')
    if (nextId !== activeConnectionId) activeConnectionId = nextId
    if (nextId && local.selectedConnectionId !== nextId) {
      local.selectedConnectionId = nextId
    }
    const active = list.find(c => c?.id === nextId) || fallback || null
    const mode = typeof active?.apiMode === 'string' && active.apiMode ? active.apiMode : 'responses'
    local.apiMode = mode
  }

  function syncActivePreset() {
    const list = Array.isArray(local?.presets) ? local.presets : []
    if (!list.length) {
      local.presets = [{
        id: genPresetId(),
        name: 'Preset 1',
        model: 'gpt-5',
        streaming: true,
        maxOutputTokens: null,
        topP: null,
        temperature: null,
        reasoningEffort: 'none',
        textVerbosity: 'medium',
        reasoningSummary: 'auto',
        connectionId: local?.selectedConnectionId || activeConnectionId || (local?.connections?.[0]?.id || ''),
      }]
    }
    const updatedList = Array.isArray(local?.presets) ? local.presets : []
    const hasActive = updatedList.some(p => p?.id === activePresetId)
    const fallback = updatedList.find(p => p?.id === local?.selectedPresetId)
      || updatedList[0]
      || null
    const nextId = hasActive ? activePresetId : (fallback?.id || '')
    if (nextId !== activePresetId) activePresetId = nextId
    if (nextId && local.selectedPresetId !== nextId) {
      local.selectedPresetId = nextId
    }
  }

  const activePreset = $derived((() => {
    const list = Array.isArray(local?.presets) ? local.presets : []
    const found = list.find(p => p?.id === activePresetId)
    return found || list[0] || null
  })())

  const activeConnection = $derived((() => {
    const list = Array.isArray(local?.connections) ? local.connections : []
    const found = list.find(c => c?.id === activeConnectionId)
    const fallback = list.find(c => c?.id === local?.selectedConnectionId)
    return found || fallback || list[0] || null
  })())

  const activeConnectionModels = $derived((() => {
    const entry = modelCacheByConnection?.[activeConnectionId]
    return Array.isArray(entry?.ids) ? entry.ids : []
  })())

  const activeRefreshMsg = $derived((refreshMessages?.[activeConnectionId]) || '')
  const activeConnectionRefreshing = $derived(refreshingConnectionId === activeConnectionId)

  const activePresetModels = $derived((() => {
    const connectionId = activePreset?.connectionId
    if (!connectionId) return []
    const entry = modelCacheByConnection?.[connectionId]
    return Array.isArray(entry?.ids) ? entry.ids : []
  })())

  function persistSettings() {
    syncActiveConnection()
    syncActivePreset()
    saveSettings(local)
    try { props.onSaved?.() } catch {}
  }

  function selectPreset(id) {
    if (!id) return
    activePresetId = id
    local.selectedPresetId = id
    persistSettings()
  }

  function addPreset() {
    const list = Array.isArray(local?.presets) ? local.presets.slice() : []
    const base = activePreset || list[list.length - 1] || { model: 'gpt-5', streaming: true }
    const count = list.length + 1
    let name = `Preset ${count}`
    const names = new Set(list.map(p => p?.name).filter(Boolean))
    while (names.has(name)) {
      name = `Preset ${Math.floor(Math.random() * 90) + 10}`
    }
    const preset = {
      id: genPresetId(),
      name,
      model: base?.model || 'gpt-5',
      streaming: typeof base?.streaming === 'boolean' ? base.streaming : true,
      maxOutputTokens: base?.maxOutputTokens ?? null,
      topP: base?.topP ?? null,
      temperature: base?.temperature ?? null,
      reasoningEffort: base?.reasoningEffort || 'none',
      textVerbosity: base?.textVerbosity || 'medium',
      reasoningSummary: base?.reasoningSummary || 'auto',
      connectionId: base?.connectionId || local?.selectedConnectionId || activeConnectionId || (local?.connections?.[0]?.id || ''),
    }
    local.presets = [...list, preset]
    activePresetId = preset.id
    local.selectedPresetId = preset.id
    persistSettings()
  }

  function updateActivePreset(patch) {
    const list = Array.isArray(local?.presets) ? local.presets : []
    const idx = list.findIndex(p => p?.id === activePresetId)
    if (idx < 0) return
    const next = [...list]
    next[idx] = { ...next[idx], ...patch }
    local.presets = next
    persistSettings()
  }

  function removePreset(id) {
    const list = Array.isArray(local?.presets) ? local.presets : []
    if (list.length <= 1) return
    const next = list.filter(p => p?.id !== id)
    if (!next.length) return
    local.presets = next
    const fallback = next.find(p => p?.id === local.selectedPresetId) || next[0]
    activePresetId = fallback?.id || ''
    local.selectedPresetId = fallback?.id || ''
    persistSettings()
  }

  function selectConnection(id) {
    if (!id) return
    activeConnectionId = id
    local.selectedConnectionId = id
    const list = Array.isArray(local?.connections) ? local.connections : []
    const found = list.find(c => c?.id === id)
    const nextMode = typeof found?.apiMode === 'string' && found.apiMode ? found.apiMode : 'responses'
    local.apiMode = nextMode
    persistSettings()
  }

  function addConnection() {
    const list = Array.isArray(local?.connections) ? local.connections.slice() : []
    const count = list.length + 1
    let name = `Connection ${count}`
    const names = new Set(list.map(c => c?.name).filter(Boolean))
    while (names.has(name)) {
      name = `Connection ${Math.floor(Math.random() * 90) + 10}`
    }
    const id = genConnectionId()
    const connection = {
      id,
      name,
      apiKey: '',
      apiBaseUrl: DEFAULT_API_BASE_URL,
      apiMode: 'responses',
    }
    local.connections = [...list, connection]
    modelCacheByConnection = { ...modelCacheByConnection, [id]: { ids: [], fetchedAt: 0 } }
    activeConnectionId = id
    persistSettings()
  }

  function updateActiveConnection(patch) {
    const list = Array.isArray(local?.connections) ? local.connections : []
    const idx = list.findIndex(c => c?.id === activeConnectionId)
    if (idx < 0) return
    const next = [...list]
    const current = next[idx] || {}
    const updated = { ...current, ...patch }
    next[idx] = updated
    local.connections = next
    const shouldClearModels = ['apiKey', 'apiBaseUrl'].some((key) => Object.prototype.hasOwnProperty.call(patch || {}, key))
    if (shouldClearModels) {
      setModelsCache(current.id, [])
      const cache = { ...modelCacheByConnection, [current.id]: { ids: [], fetchedAt: 0 } }
      modelCacheByConnection = cache
    }
    persistSettings()
  }

  function removeConnection(id) {
    const list = Array.isArray(local?.connections) ? local.connections : []
    if (list.length <= 1) return
    const next = list.filter(c => c?.id !== id)
    if (!next.length) return
    local.connections = next
    if (local.selectedConnectionId === id) {
      local.selectedConnectionId = next[0]?.id || ''
    }
    if (activeConnectionId === id) {
      activeConnectionId = next.find(c => c?.id === local.selectedConnectionId)?.id || next[0]?.id || ''
    }
    const fallbackId = local.selectedConnectionId || activeConnectionId || next[0]?.id || ''
    if (Array.isArray(local?.presets)) {
      local.presets = local.presets.map(p => (p?.connectionId === id ? { ...p, connectionId: fallbackId } : p))
    }
    const cache = { ...modelCacheByConnection }
    delete cache[id]
    modelCacheByConnection = cache
    const msgs = { ...refreshMessages }
    delete msgs[id]
    refreshMessages = msgs
    if (refreshingConnectionId === id) refreshingConnectionId = ''
    persistSettings()
  }

  async function close() {
    // Reset local state to the persisted settings the next time we open
    local = loadSettings()
    modelCacheByConnection = loadAllModelCaches()
    activePresetId = local?.selectedPresetId || local?.presets?.[0]?.id || ''
    activeConnectionId = local?.selectedConnectionId || local?.connections?.[0]?.id || ''
    activeTab = 'connection'
    revealKey = false
    refreshingConnectionId = ''
    refreshMessages = {}
    props.onClose?.()
  }

  function setTab(id) {
    if (TABS.some(tab => tab.id === id)) {
      activeTab = id
    }
  }
  async function refreshModelsNow(targetId = activeConnectionId, { quiet = false } = {}) {
    const list = Array.isArray(local?.connections) ? local.connections : []
    const connection = list.find(c => c?.id === targetId)
    if (!connection) {
      if (!quiet) {
        refreshMessages = { ...refreshMessages, [targetId]: 'Select or add a connection first.' }
      }
      return
    }
    if (!connection.apiKey) {
      if (!quiet) {
        refreshMessages = { ...refreshMessages, [targetId]: 'Enter an API key first.' }
      }
      return
    }
    refreshingConnectionId = targetId
    if (!quiet) {
      refreshMessages = { ...refreshMessages, [targetId]: 'Connecting…' }
    }
    try {
      const ids = await listModelsWithKey(connection.apiKey, connection.apiBaseUrl)
      setModelsCache(targetId, ids)
      modelCacheByConnection = { ...modelCacheByConnection, [targetId]: { ids, fetchedAt: Date.now() } }
      refreshMessages = { ...refreshMessages, [targetId]: `Connected ✓ Fetched ${ids.length} models.` }
    } catch (err) {
      const msg = err?.message || 'Failed to refresh models.'
      refreshMessages = { ...refreshMessages, [targetId]: `Error: ${msg}` }
    } finally {
      if (refreshingConnectionId === targetId) refreshingConnectionId = ''
    }
  }

  $effect(() => {
    syncActiveConnection()
    syncActivePreset()
  })
</script>

{#if props.open}
  <button type="button" class="backdrop" aria-label="Close settings overlay" onclick={close}></button>
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-label="Settings"
    tabindex="-1"
    onpointerdown={(event) => { if (event.target === event.currentTarget) close() }}
    onkeydown={(event) => { if (event.key === 'Escape' && event.target === event.currentTarget) close() }}
  >
    <div class="panel">
      <header class="modal-head">
        <div class="title">Settings</div>
        <button class="icon-btn" onclick={close} aria-label="Close">
          <Icon name="close" size={20} />
        </button>
      </header>
      <div class="tab-bar" role="tablist" aria-label="Settings sections">
        {#each TABS as tab}
          <button
            id={`settings-tab-${tab.id}`}
            type="button"
            role="tab"
            class={`tab ${tab.id === activeTab ? 'active' : ''}`}
            aria-selected={tab.id === activeTab}
            tabindex={tab.id === activeTab ? 0 : -1}
            onclick={() => setTab(tab.id)}
          >
            {tab.label}
          </button>
        {/each}
      </div>
      <div
        class="modal-body"
        role="tabpanel"
        aria-labelledby={`settings-tab-${activeTab}`}
      >
        <div class="modal-scroller">
          {#if activeTab === 'connection'}
            <section class="group">
              <div class="group-head">
                <div class="group-title">Connections</div>
                <button type="button" class="icon-btn" title="Add connection" aria-label="Add connection" onclick={addConnection}>
                  <Icon name="add" size={20} />
                </button>
              </div>
              <div class="preset-strip connection-strip">
                {#each (local?.connections || []) as connection (connection.id)}
                  <button
                    type="button"
                    class={`preset-pill ${connection.id === activeConnectionId ? 'active' : ''}`}
                    onclick={() => selectConnection(connection.id)}
                  >
                    <span class="preset-pill-name">{connection?.name || connection?.id || 'Connection'}</span>
                  </button>
                {/each}
              </div>
              {#if activeConnection}
                <label class="field">
                  <span>Name</span>
                  <input
                    type="text"
                    placeholder="Connection name"
                    value={activeConnection.name || ''}
                    oninput={(event) => updateActiveConnection({ name: event.currentTarget.value })}
                    aria-label="Connection name"
                  />
                </label>
                <label class="field">
                  <span>API Key</span>
                  <div class="row">
                    <input
                      type={revealKey ? 'text' : 'password'}
                      placeholder="sk-..."
                      value={activeConnection.apiKey || ''}
                      autocomplete="off"
                      oninput={(event) => updateActiveConnection({ apiKey: event.currentTarget.value })}
                      onblur={() => { if ((activeConnection.apiKey || '').trim()) refreshModelsNow(activeConnection.id) }}
                      aria-label="API key"
                    />
                    <button class="icon-btn" title={revealKey ? 'Hide key' : 'Show key'} onclick={() => (revealKey = !revealKey)} aria-label={revealKey ? 'Hide key' : 'Show key'}>
                      <Icon name={revealKey ? 'visibility_off' : 'visibility'} size={20} />
                    </button>
                    <button class="icon-btn" title="Refresh models" onclick={() => refreshModelsNow(activeConnection.id)} aria-label="Refresh models" disabled={activeConnectionRefreshing}>
                      <Icon name="autorenew" size={20} />
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
                    aria-label="API base URL"
                  />
                </label>
                <p class="hint">Leave blank to use the default OpenAI endpoint.</p>
                <label class="field">
                  <span>API</span>
                  <select
                    value={activeConnection.apiMode || 'responses'}
                    onchange={(event) => updateActiveConnection({ apiMode: event.currentTarget.value })}
                    aria-label="API mode"
                  >
                    <option value="responses">Responses API</option>
                    <option value="chat_completions">Chat Completions API</option>
                  </select>
                </label>
                {#if (local?.connections?.length || 0) > 1}
                  <div class="connection-actions">
                    <button
                      type="button"
                      class="preset-delete"
                      onclick={() => removeConnection(activeConnection.id)}
                      title="Delete connection"
                      aria-label="Delete connection"
                    >
                      <Icon name="delete" size={18} />
                      <span>Delete connection</span>
                    </button>
                  </div>
                {/if}
                {#if activeRefreshMsg}
                  <p class="hint" aria-live="polite">{activeRefreshMsg}</p>
                {/if}
              {/if}
            </section>
          {:else if activeTab === 'presets'}
            <section class="group presets">
              <div class="group-head">
                <div class="group-title">Presets</div>
                <button type="button" class="icon-btn" title="Add preset" aria-label="Add preset" onclick={addPreset}>
                  <Icon name="add" size={20} />
                </button>
              </div>
              <div class="preset-strip">
                {#each (local.presets || []) as preset (preset.id)}
                  <button
                    type="button"
                    class={`preset-pill ${preset.id === activePresetId ? 'active' : ''}`}
                    onclick={() => selectPreset(preset.id)}
                  >
                    <span class="preset-pill-name">{preset.name || 'Untitled'}</span>
                  </button>
                {/each}
              </div>
              {#if activePreset}
                <label class="field">
                  <span>Name</span>
                  <input
                    type="text"
                    placeholder="Preset name"
                    value={activePreset.name || ''}
                    oninput={(event) => updateActivePreset({ name: event.currentTarget.value })}
                    aria-label="Preset name"
                  />
                </label>
                <label class="field">
                  <span>Model</span>
                  <input
                    type="text"
                    placeholder="gpt-5"
                    value={activePreset.model || ''}
                    oninput={(event) => updateActivePreset({ model: event.currentTarget.value })}
                    list="preset-model-suggestions"
                    aria-label="Model"
                  />
                  {#if activePresetModels?.length}
                    <datalist id="preset-model-suggestions">
                      {#each activePresetModels as mid}
                        <option value={mid}>{mid}</option>
                      {/each}
                    </datalist>
                  {/if}
                </label>
                <label class="switch" title="Stream">
                  <input
                    type="checkbox"
                    checked={!!activePreset.streaming}
                    onchange={(event) => updateActivePreset({ streaming: !!event.currentTarget.checked })}
                    aria-label="Stream"
                  />
                  <span class="switch-ui" aria-hidden="true"></span>
                  <span class="switch-label">Stream</span>
                </label>
                <label class="field">
                  <span>Max output tokens</span>
                  <input
                    type="number"
                    min="1"
                    step="1024"
                    placeholder="Auto"
                    value={activePreset.maxOutputTokens ?? ''}
                    oninput={(event) => updateActivePreset({ maxOutputTokens: parseMaxTokens(event.currentTarget.value) })}
                    aria-label="Max output tokens"
                  />
                </label>
                <label class="field">
                  <span>Top P</span>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.1"
                    placeholder="Default"
                    value={activePreset.topP ?? ''}
                    oninput={(event) => updateActivePreset({ topP: parseTopP(event.currentTarget.value) })}
                    aria-label="top_p"
                  />
                </label>
                <label class="field">
                  <span>Temperature</span>
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    placeholder="Default"
                    value={activePreset.temperature ?? ''}
                    oninput={(event) => updateActivePreset({ temperature: parseTemperature(event.currentTarget.value) })}
                    aria-label="Temperature"
                  />
                </label>
                <label class="field">
                  <span>Reasoning effort</span>
                  <select
                    value={activePreset.reasoningEffort || 'none'}
                    onchange={(event) => updateActivePreset({ reasoningEffort: parseReasoning(event.currentTarget.value) })}
                    aria-label="Reasoning effort"
                  >
                    <option value="none">none</option>
                    <option value="minimal">minimal</option>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                </label>
                <label class="field">
                  <span>Reasoning summary</span>
                  <select
                    value={activePreset.reasoningSummary || 'auto'}
                    onchange={(event) => updateActivePreset({ reasoningSummary: parseReasoningSummary(event.currentTarget.value) })}
                    aria-label="Reasoning summary"
                  >
                    <option value="auto">auto</option>
                    <option value="concise">concise</option>
                    <option value="detailed">detailed</option>
                  </select>
                </label>
                <label class="field">
                  <span>Text verbosity</span>
                  <select
                    value={activePreset.textVerbosity || 'medium'}
                    onchange={(event) => updateActivePreset({ textVerbosity: parseVerbosity(event.currentTarget.value) })}
                    aria-label="Text verbosity"
                  >
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                </label>
                <label class="field">
                  <span>Connection</span>
                  <select
                    value={activePreset.connectionId || ''}
                    onchange={(event) => updateActivePreset({ connectionId: event.currentTarget.value })}
                    aria-label="Preset connection"
                  >
                    {#each (local?.connections || []) as connection (connection.id)}
                      <option value={connection.id}>{connection?.name || connection?.id || 'Connection'}</option>
                    {/each}
                  </select>
                </label>
                {#if (local?.presets?.length || 0) > 1}
                  <button
                    type="button"
                    class="preset-delete"
                    onclick={() => activePreset?.id && removePreset(activePreset.id)}
                    title="Delete preset"
                    aria-label="Delete preset"
                  >
                    <Icon name="delete" size={18} />
                    <span>Delete preset</span>
                  </button>
                {/if}
              {/if}
            </section>
          {:else if activeTab === 'developer'}
            <section class="group">
              <div class="group-title">Developer</div>
              <label class="switch" title="Debug Mode">
                <input
                  type="checkbox"
                  bind:checked={local.debug}
                  onchange={() => persistSettings()}
                  aria-label="Debug Mode"
                />
                <span class="switch-ui" aria-hidden="true"></span>
                <span class="switch-label">Debug Mode</span>
              </label>
            </section>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 1000;
    border: 0;
    padding: 0;
  }
  .modal {
    position: fixed; inset: 0;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    z-index: 1001; /* Above app bars */
  }
  .panel {
    width: min(calc(100vw - 48px), 1080px);
    height: min(calc(100vh - 48px), 900px);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 18px;
    box-shadow: var(--float-shadow);
    color: var(--text);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .modal-head { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid var(--border); }
  .title { font-weight: 600; font-size: 1.1rem; }
  .tab-bar { display: flex; gap: 12px; padding: 0 24px; border-bottom: 1px solid var(--border); overflow-x: auto; }
  .tab-bar::-webkit-scrollbar { display: none; }
  .tab {
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    padding: 14px 4px;
    position: relative;
    white-space: nowrap;
    cursor: pointer;
  }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .tab.active { color: var(--text); font-weight: 600; }
  .tab.active::after {
    content: '';
    position: absolute;
    left: 0; right: 0; bottom: 6px;
    height: 2px;
    border-radius: 999px;
    background: var(--accent);
  }
  .modal-body { flex: 1; overflow: hidden; }
  .modal-scroller { height: 100%; overflow-y: auto; padding: 24px; display: grid; gap: 24px; align-content: start; }
  .icon-btn { border: 1px solid var(--border); border-radius: 8px; background: transparent; width: 32px; height: 32px; display: grid; place-items: center; line-height: 1; color: var(--text); }
  .icon-btn:disabled { opacity: .6; cursor: not-allowed; }
  .field { display: grid; gap: 6px; }
  .field > span { font-size: .9rem; color: var(--muted); }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  input[type="text"], input[type="password"], input[type="number"], select { flex: 1; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; background: var(--bg); color: var(--text); font: inherit; }
  .hint { color: var(--muted); font-size: .9rem; margin-top: 4px; }
  /* API key action buttons size */
  .row .icon-btn { height: 38px; width: 38px; }
  .group { display: grid; gap: 8px; }
  .group-title { font-weight: 600; }
  .group-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .group-head .icon-btn { flex-shrink: 0; }
  .presets .group-head .icon-btn { width: 28px; height: 28px; border-radius: 6px; }
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
  .switch { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; }
  .switch > input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
  .switch-ui { width: 42px; height: 24px; border-radius: 999px; background: var(--border); position: relative; transition: background-color .15s ease; box-shadow: inset 0 0 0 1px var(--border); }
  .switch-ui::after { content: ''; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.15); transition: transform .15s ease, background-color .15s ease; }
  @media (prefers-color-scheme: dark) {
    .switch-ui { background: #2a2a2a; box-shadow: inset 0 0 0 1px #2f2f2f; }
    .switch-ui::after { background: #e6e6e6; }
  }
  .switch > input:checked + .switch-ui { background: color-mix(in srgb, var(--accent), #0000 70%); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent), #0000 60%); }
  .switch > input:checked + .switch-ui::after { transform: translateX(18px); }
  .switch-label { font-size: .95rem; }
  @media (max-width: 640px) {
    .modal { padding: 12px; }
    .panel { width: 100%; height: 100%; }
    .modal-head { padding: 16px; }
    .tab-bar { padding: 0 16px; }
    .modal-scroller { padding: 16px; }
  }
</style>

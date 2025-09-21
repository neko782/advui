<script>
  import { loadSettings, saveSettings } from './settingsStore.js'
  import { setModelsCache, loadModelsCache } from './modelsStore.js'
  import { listModelsWithKey } from './openaiClient.js'
  import Icon from './Icon.svelte'

  const props = $props()

  let local = $state(loadSettings())
  let modelIds = $state(loadModelsCache().ids || [])
  let revealKey = $state(false)
  let refreshing = $state(false)
  let refreshMsg = $state('')

  function close() {
    // Revert any unsaved changes back to the last saved settings
    local = loadSettings()
    revealKey = false
    refreshMsg = ''
    props.onClose?.()
  }
  function save() {
    saveSettings(local)
    close()
  }
  function clearKey() {
    local.apiKey = ''
  }

  async function refreshModelsNow() {
    refreshMsg = ''
    if (!local.apiKey) {
      refreshMsg = 'Enter an API key first.'
      return
    }
    refreshing = true
    try {
      const ids = await listModelsWithKey(local.apiKey)
      setModelsCache(ids)
      modelIds = ids
      refreshMsg = `Connected ✓ Fetched ${ids.length} models.`
    } catch (err) {
      const msg = err?.message || 'Failed to refresh models.'
      refreshMsg = `Error: ${msg}`
    } finally {
      refreshing = false
    }
  }
</script>

{#if props.open}
  <button type="button" class="backdrop" aria-label="Close settings overlay" onclick={close}></button>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Settings" onclick={(e) => { if (e.target === e.currentTarget) close() }}>
    <div class="panel">
      <header class="modal-head">
        <div class="title">Settings</div>
        <button class="icon-btn" onclick={close} aria-label="Close">
          <Icon name="close" size={20} />
        </button>
      </header>
      <div class="modal-body">
        <label class="field">
          <span>OpenAI API Key</span>
          <div class="row">
            <input
              type={revealKey ? 'text' : 'password'}
              placeholder="sk-..."
              bind:value={local.apiKey}
              autocomplete="off"
            />
            <button class="icon-btn" title={revealKey ? 'Hide key' : 'Show key'} onclick={() => (revealKey = !revealKey)} aria-label={revealKey ? 'Hide key' : 'Show key'}>
              <Icon name={revealKey ? 'visibility_off' : 'visibility'} size={20} />
            </button>
            <button class="icon-btn" title="Clear key" onclick={clearKey} aria-label="Clear key">
              <Icon name="backspace" size={20} />
            </button>
            <button class="icon-btn" title="Refresh models" onclick={refreshModelsNow} aria-label="Refresh models" disabled={refreshing}>
              <Icon name="autorenew" size={20} />
            </button>
          </div>
        </label>

        <p class="hint">Your key is stored locally in this browser.</p>
        {#if refreshMsg}
          <p class="hint" aria-live="polite">{refreshMsg}</p>
        {/if}

        <hr class="section" />

        <div class="group">
          <div class="group-title">Default Chat</div>
          <label class="field">
            <span>Default model</span>
            <input
              type="text"
              placeholder="gpt-4o-mini"
              bind:value={local.defaultChat.model}
              list="global-model-suggestions"
              aria-label="Default model"
            />
            {#if modelIds?.length}
              <datalist id="global-model-suggestions">
                {#each modelIds as mid}
                  <option value={mid}>{mid}</option>
                {/each}
              </datalist>
            {/if}
          </label>
          <p class="hint">These settings apply to every new chat.</p>
        </div>
      </div>
      <footer class="modal-foot">
        <button class="icon-btn" title="Cancel" aria-label="Cancel" onclick={close}>
          <Icon name="close" size={20} />
        </button>
        <button class="icon-btn primary" title="Save" aria-label="Save" onclick={save}>
          <Icon name="check" size={20} />
        </button>
      </footer>
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
    display: grid; place-items: center;
    padding: 16px;
    z-index: 1001; /* Above app bars */
  }
  .panel {
    max-width: 560px; width: 100%;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--float-shadow);
    color: var(--text);
    overflow: hidden; /* unify rounded corners across sections */
  }
  .modal-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; }
  .title { font-weight: 600; }
  .modal-body { padding: 8px 14px 4px; display: grid; gap: 12px; }
  .modal-foot { padding: 12px 14px; display: flex; justify-content: flex-end; gap: 8px; }
  .icon-btn { border: 1px solid var(--border); border-radius: 8px; background: transparent; width: 32px; height: 32px; display: grid; place-items: center; line-height: 1; color: var(--text); }
  .icon-btn.primary { background: var(--accent); color: #fff; border-color: transparent; }
  .icon-btn:disabled { opacity: .6; cursor: not-allowed; }
  .btn { border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; background: var(--bg); color: var(--text); }
  .btn.primary { background: var(--accent); color: white; border-color: transparent; }
  .field { display: grid; gap: 6px; }
  .field > span { font-size: .9rem; color: var(--muted); }
  .row { display: flex; gap: 8px; }
  input { flex: 1; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; background: var(--bg); color: var(--text); }
  .hint { color: var(--muted); font-size: .9rem; margin-top: 4px; }
  /* API key action buttons size */
  .row .icon-btn { height: 38px; width: 38px; }
  .section { border: 0; border-top: 1px solid var(--border); margin: 8px 0; }
  .group { display: grid; gap: 8px; }
  .group-title { font-weight: 600; }
</style>

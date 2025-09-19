<script>
  import { loadSettings, saveSettings } from './settingsStore.js'
  import Icon from './Icon.svelte'

  const props = $props()

  let local = $state(loadSettings())
  let revealKey = $state(false)

  function close() {
    props.onClose?.()
  }
  function save() {
    saveSettings(local)
    close()
  }
  function clearKey() {
    local.apiKey = ''
  }
</script>

{#if props.open}
  <div class="backdrop" onclick={close}></div>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Settings">
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
            <button class="btn" onclick={() => (revealKey = !revealKey)} aria-label="Toggle visibility">
              {revealKey ? 'Hide' : 'Show'}
            </button>
            <button class="btn" onclick={clearKey} aria-label="Clear key">Clear</button>
          </div>
        </label>

        <label class="field">
          <span>Model</span>
          <input type="text" placeholder="gpt-4o-mini" bind:value={local.model} />
        </label>

        <p class="hint">Your key is stored locally in this browser.</p>
      </div>
      <footer class="modal-foot">
        <button class="btn" onclick={close}>Cancel</button>
        <button class="btn primary" onclick={save}>Save</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 1000;
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
  .icon-btn { border: 1px solid var(--border); border-radius: 8px; background: transparent; width: 32px; height: 32px; display: grid; place-items: center; line-height: 1; }
  .btn { border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; background: var(--bg); color: var(--text); }
  .btn.primary { background: var(--accent); color: white; border-color: transparent; }
  .field { display: grid; gap: 6px; }
  .field > span { font-size: .9rem; color: var(--muted); }
  .row { display: flex; gap: 8px; }
  input { flex: 1; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; background: var(--bg); color: var(--text); }
  .hint { color: var(--muted); font-size: .9rem; margin-top: 4px; }
</style>

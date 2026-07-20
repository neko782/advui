<script lang="ts">
  import { IconClose } from './icons'
  import GeneralTab from './components/settings/GeneralTab.svelte'
  import ConnectionsTab from './components/settings/ConnectionsTab.svelte'
  import PresetsTab from './components/settings/PresetsTab.svelte'
  import FeaturesTab from './components/settings/FeaturesTab.svelte'
  import { SettingsDraft } from './components/settings/settingsDraft.svelte'

  interface Props {
    open?: boolean
    onClose?: () => void
    onSaved?: () => void
  }

  const props: Props = $props()

  const draft = new SettingsDraft(() => { try { props.onSaved?.() } catch {} })

  const TABS = [
    { id: 'general', label: 'General' },
    { id: 'features', label: 'Features' },
    { id: 'connection', label: 'Connections' },
    { id: 'presets', label: 'Presets' },
  ]
  let activeTab = $state<'general' | 'connection' | 'presets' | 'features'>('general')

  function setTab(id) {
    if (TABS.some(tab => tab.id === id)) {
      activeTab = id
    }
  }

  function close() {
    // Reset draft state to the persisted settings the next time we open
    draft.reset()
    activeTab = 'general'
    props.onClose?.()
  }

  // Defer sync to avoid blocking during initialization
  $effect(() => {
    queueMicrotask(() => {
      draft.syncActiveConnection()
      draft.syncActivePreset()
    })
  })
</script>

<svelte:window onkeydown={(e) => { if (props.open && e.key === 'Escape') close() }} />

{#if props.open}
  <button type="button" class="ui-backdrop" aria-label="Close settings overlay" onclick={close}></button>
  <div
    class="ui-modal"
    role="dialog"
    aria-modal="true"
    aria-label="Settings"
    tabindex="-1"
    onpointerdown={(event) => { if (event.target === event.currentTarget) close() }}
  >
    <div class="ui-panel ui-panel-full panel">
      <header class="ui-modal-head">
        <div class="ui-modal-title">Settings</div>
        <button class="ui-icon-btn" onclick={close} aria-label="Close">
          <IconClose style="font-size: 20px;" />
        </button>
      </header>
      <div class="ui-tab-bar" role="tablist" aria-label="Settings sections">
        <div class="ui-segmented">
          {#each TABS as tab}
            <button
              id={`settings-tab-${tab.id}`}
              type="button"
              role="tab"
              class={`ui-segment ${tab.id === activeTab ? 'active' : ''}`}
              aria-selected={tab.id === activeTab}
              tabindex={tab.id === activeTab ? 0 : -1}
              onclick={() => setTab(tab.id)}
            >
              {tab.label}
            </button>
          {/each}
        </div>
      </div>
      <div
        class="ui-modal-body"
        role="tabpanel"
        aria-labelledby={`settings-tab-${activeTab}`}
      >
        <div class="ui-modal-scroller">
          {#if activeTab === 'general'}
            <GeneralTab draft={draft} />
          {:else if activeTab === 'connection'}
            <ConnectionsTab draft={draft} />
          {:else if activeTab === 'presets'}
            <PresetsTab draft={draft} />
          {:else if activeTab === 'features'}
            <FeaturesTab draft={draft} />
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Chrome, controls and cards come from shared ui.css — only the
     desktop panel size is local. Mobile fullscreen is .ui-panel-full. */
  @media (min-width: 641px) {
    .panel {
      width: min(calc(100vw - 48px), 1080px);
      height: min(calc(100vh - 48px), 900px);
    }
  }
</style>

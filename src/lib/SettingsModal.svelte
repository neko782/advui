<script lang="ts">
  import { untrack } from 'svelte'
  import { IconClose } from './icons'
  import GeneralTab from './components/settings/GeneralTab.svelte'
  import ConnectionsTab from './components/settings/ConnectionsTab.svelte'
  import PresetsTab from './components/settings/PresetsTab.svelte'
  import FeaturesTab from './components/settings/FeaturesTab.svelte'
  import { SettingsDraft } from './components/settings/settingsDraft.svelte'
  import FieldEditor from './components/FieldEditor.svelte'
  import { rememberScroll } from './utils/rememberScroll'

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
  let hasOpened = $state(false)
  let visitedTabs = $state(new Set(['general']))

  function setTab(id: string) {
    if (TABS.some(tab => tab.id === id)) {
      activeTab = id as typeof activeTab
      visitedTabs = new Set([...visitedTabs, id])
    }
  }

  function close() {
    draft.flush()
    props.onClose?.()
  }

  let wasOpen = false
  $effect(() => {
    if (props.open && !wasOpen) untrack(() => {
      hasOpened = true
      const presetId = draft.activePresetId
      const connectionId = draft.activeConnectionId
      draft.reset()
      if (draft.presets.some(p => p.id === presetId)) draft.activePresetId = presetId
      if (draft.connections.some(c => c.id === connectionId)) draft.activeConnectionId = connectionId
      draft.loadModelCaches()
    })
    if (!props.open && wasOpen) untrack(() => draft.flush())
    wasOpen = !!props.open
  })

  // Defer sync to avoid blocking during initialization
  $effect(() => {
    queueMicrotask(() => {
      draft.syncActiveConnection()
      draft.syncActivePreset()
    })
  })
</script>

<svelte:window onkeydown={(e) => { if (props.open && e.key === 'Escape') close() }} />

{#if hasOpened}
  <div class="settings-session" class:session-hidden={!props.open} inert={!props.open}>
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
        <FieldEditor active={!!props.open}>
        {#each TABS as section (section.id)}
        {#if visitedTabs.has(section.id)}
        <div class="ui-modal-scroller" style:display={activeTab === section.id ? undefined : 'none'}
          inert={activeTab !== section.id} use:rememberScroll={{ active: !!props.open && activeTab === section.id }}>
          {#if section.id === 'general'}
            <GeneralTab draft={draft} />
          {:else if section.id === 'connection'}
            <ConnectionsTab draft={draft} />
          {:else if section.id === 'presets'}
            <PresetsTab draft={draft} active={!!props.open && activeTab === 'presets'} />
          {:else if section.id === 'features'}
            <FeaturesTab draft={draft} />
          {/if}
        </div>
        {/if}
        {/each}
        </FieldEditor>
      </div>
    </div>
  </div>
  </div>
{/if}

<style>
  .session-hidden { display: none; }
  /* Chrome, controls and cards come from shared ui.css — only the
     desktop panel size is local. Mobile fullscreen is .ui-panel-full. */
  @media (min-width: 641px) {
    .panel {
      width: min(calc(100vw - 48px), 1080px);
      height: min(calc(100vh - 48px), 900px);
    }
  }
</style>

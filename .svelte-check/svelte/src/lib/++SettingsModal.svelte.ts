///<reference types="svelte" />
;
import { untrack } from 'svelte'
import { IconClose } from './icons'
import GeneralTab from './components/settings/GeneralTab.svelte'
import ConnectionsTab from './components/settings/ConnectionsTab.svelte'
import PresetsTab from './components/settings/PresetsTab.svelte'
import FeaturesTab from './components/settings/FeaturesTab.svelte'
import { SettingsDraft } from './components/settings/settingsDraft.svelte';
;

  interface Props {
    open?: boolean
    onClose?: () => void
    onSaved?: () => void
  };function $$render() {

  
  
  
  
  
  
  


  const props: Props = $props()

  const draft = new SettingsDraft(() => { try { props.onSaved?.() } catch {} })

  const TABS = [
    { id: 'general', label: 'General' },
    { id: 'features', label: 'Features' },
    { id: 'connection', label: 'Connections' },
    { id: 'presets', label: 'Presets' },
  ]
  let activeTab = $state<'general' | 'connection' | 'presets' | 'features'>('general')

  function setTab(id: string) {
    if (TABS.some(tab => tab.id === id)) {
      activeTab = id as typeof activeTab
    }
  }

  function close() {
    // Reset draft state to the persisted settings the next time we open
    draft.reset()
    activeTab = 'general'
    props.onClose?.()
  }

  let wasOpen = false
  $effect(() => {
    if (props.open && !wasOpen) untrack(() => draft.reset())
    wasOpen = !!props.open
  })

  // Defer sync to avoid blocking during initialization
  $effect(() => {
    queueMicrotask(() => {
      draft.syncActiveConnection()
      draft.syncActivePreset()
    })
  })
;
async () => {

 { svelteHTML.createElement("svelte:window", {  "onkeydown":(e) => { if (props.open && e.key === 'Escape') close() },});}

if(props.open){
   { svelteHTML.createElement("button", {       "type":`button`,"class":`ui-backdrop`,"aria-label":`Close settings overlay`,"onclick":close,}); }
   { svelteHTML.createElement("div", {             "class":`ui-modal`,"role":`dialog`,"aria-modal":`true`,"aria-label":`Settings`,"tabindex":-1,"onpointerdown":(event) => { if (event.target === event.currentTarget) close() },});
     { svelteHTML.createElement("div", { "class":`ui-panel ui-panel-full panel`,});
       { svelteHTML.createElement("header", { "class":`ui-modal-head`,});
         { svelteHTML.createElement("div", { "class":`ui-modal-title`,});  }
         { svelteHTML.createElement("button", {     "class":`ui-icon-btn`,"onclick":close,"aria-label":`Close`,});
           { const $$_esolCnocI4C = __sveltets_2_ensureComponent(IconClose); new $$_esolCnocI4C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
         }
       }
       { svelteHTML.createElement("div", {     "class":`ui-tab-bar`,"role":`tablist`,"aria-label":`Settings sections`,});
         { svelteHTML.createElement("div", { "class":`ui-segmented`,});
            for(let tab of __sveltets_2_ensureArray(TABS)){
             { svelteHTML.createElement("button", {               "id":`settings-tab-${tab.id}`,"type":`button`,"role":`tab`,"class":`ui-segment ${tab.id === activeTab ? 'active' : ''}`,"aria-selected":tab.id === activeTab,"tabindex":tab.id === activeTab ? 0 : -1,"onclick":() => setTab(tab.id),});
              tab.label;
             }
          }
         }
       }
       { svelteHTML.createElement("div", {       "class":`ui-modal-body`,"role":`tabpanel`,"aria-labelledby":`settings-tab-${activeTab}`,});
         { svelteHTML.createElement("div", { "class":`ui-modal-scroller`,});
          if(activeTab === 'general'){
             { const $$_baTlareneG4C = __sveltets_2_ensureComponent(GeneralTab); new $$_baTlareneG4C({ target: __sveltets_2_any(), props: {  "draft":draft,}});}
          } else if (activeTab === 'connection'){
             { const $$_baTsnoitcennoC4C = __sveltets_2_ensureComponent(ConnectionsTab); new $$_baTsnoitcennoC4C({ target: __sveltets_2_any(), props: {  "draft":draft,}});}
          } else if (activeTab === 'presets'){
             { const $$_baTsteserP4C = __sveltets_2_ensureComponent(PresetsTab); new $$_baTsteserP4C({ target: __sveltets_2_any(), props: {  "draft":draft,}});}
          } else if (activeTab === 'features'){
             { const $$_baTserutaeF4C = __sveltets_2_ensureComponent(FeaturesTab); new $$_baTserutaeF4C({ target: __sveltets_2_any(), props: {  "draft":draft,}});}
          }
         }
       }
     }
   }
}


};
return { props: {} as any as Props, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const SettingsModal__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type SettingsModal__SvelteComponent_ = ReturnType<typeof SettingsModal__SvelteComponent_>;
/*Ωignore_endΩ*/export default SettingsModal__SvelteComponent_;
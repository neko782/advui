///<reference types="svelte" />
;
import { onMount } from 'svelte'
import { IconAdd, IconVisibility, IconVisibilityOff, IconAutorenew, IconDelete, IconDragHandle } from '../../icons'
import { DEFAULT_API_BASE_URL } from './settingsDraft.svelte'
import type { SettingsDraft } from './settingsDraft.svelte'
import type { ApiMode } from '../../types';
;

  interface Props {
    draft: SettingsDraft
  };function $$render() {

  
  
  
  
  


  const props: Props = $props()
  const draft = $derived(props.draft)
  const local = $derived(props.draft.local)

  const connectionsForRender = () => draft.connections
  const activeConnection = $derived(draft.activeConnection)
  const activeConnectionId = $derived(draft.activeConnectionId)
  const activeRefreshMsg = $derived(draft.activeRefreshMsg)
  const activeConnectionRefreshing = $derived(draft.activeConnectionRefreshing)

  const selectConnection = (id: string) => draft.selectConnection(id)
  const addConnection = () => draft.addConnection()
  const removeConnection = (id: string) => draft.removeConnection(id)
  const updateActiveConnection = (patch: Parameters<SettingsDraft['updateActiveConnection']>[0]) => draft.updateActiveConnection(patch)
  const invalidateActiveConnectionModelCache = () => draft.invalidateActiveConnectionModelCache()
  const refreshModelsNow = (...args: Parameters<SettingsDraft['refreshModelsNow']>) => draft.refreshModelsNow(...args)

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
    const touchY = e.touches[0]?.clientY ?? 0

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
;
async () => {

             { svelteHTML.createElement("section", { "class":`ui-group`,});
               { svelteHTML.createElement("div", { "class":`ui-group-head`,});
                 { svelteHTML.createElement("div", { "class":`ui-group-title`,});  }
                 { svelteHTML.createElement("button", {         "type":`button`,"class":`ui-icon-btn accent`,"title":`Add connection`,"aria-label":`Add connection`,"onclick":addConnection,});
                   { const $$_ddAnocI3C = __sveltets_2_ensureComponent(IconAdd); new $$_ddAnocI3C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
                 }
               }
               { svelteHTML.createElement("p", { "class":`ui-hint`,});       }
               { svelteHTML.createElement("div", { "class":`ui-item-list ui-reorder-list`,});
                   for(let connection of __sveltets_2_ensureArray(connectionsForRender())){connection.id;
                  const isDragging = draggedConnectionId === connection.id;
                  const isDragOver = dragOverConnectionId === connection.id && draggedConnectionId !== connection.id;
                   { svelteHTML.createElement("div", {                 "class":`ui-list-item ${connection.id === activeConnectionId ? 'active' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`,...__sveltets_2_empty({"data-id":connection.id}),"draggable":`true`,"ondragstart":(e) => handleConnectionDragStart(e, connection.id),"ondragover":(e) => handleConnectionDragOver(e, connection.id),"ondrop":handleConnectionDrop,"ondragend":handleConnectionDragEnd,"role":`listitem`,});
                     { svelteHTML.createElement("div", {             "class":`ui-drag-handle`,"aria-label":`Drag to reorder`,"ontouchstart":(e) => handleConnectionTouchStart(e, connection.id),"ontouchmove":handleConnectionTouchMove,"ontouchend":handleConnectionTouchEnd,"ontouchcancel":resetTouchState,});
                       { const $$_eldnaHgarDnocI4C = __sveltets_2_ensureComponent(IconDragHandle); new $$_eldnaHgarDnocI4C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
                     }
                     { svelteHTML.createElement("button", {       "type":`button`,"class":`ui-item-content`,"onclick":() => selectConnection(connection.id),});
                       { svelteHTML.createElement("span", { "class":`ui-item-name`,});connection?.name || connection?.id || 'Connection'; }
                       { svelteHTML.createElement("span", { "class":`ui-item-meta`,});connection?.apiBaseUrl || 'Default endpoint'; }
                     }
                    if((local?.connections?.length || 0) > 1){
                       { svelteHTML.createElement("button", {           "type":`button`,"class":`ui-item-delete`,"onclick":() => removeConnection(connection.id),"title":`Delete connection`,"aria-label":`Delete connection`,});
                         { const $$_eteleDnocI4C = __sveltets_2_ensureComponent(IconDelete); new $$_eteleDnocI4C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
                       }
                    }
                   }
                }
               }
              if(activeConnection && connectionFormReady){
                 { svelteHTML.createElement("div", { "class":`ui-form-section`,});
                   { svelteHTML.createElement("div", { "class":`ui-form-section-title`,}); activeConnection.name || 'Connection'; }
                   { svelteHTML.createElement("label", { "class":`ui-field`,});
                     { svelteHTML.createElement("span", {});  }
                     { svelteHTML.createElement("input", {                  "class":`ui-input`,"type":`text`,"placeholder":`Connection name`,"value":activeConnection.name || '',"oninput":(event) => updateActiveConnection({ name: event.currentTarget.value }),"aria-label":`Connection name`,"autocomplete":`off`,...__sveltets_2_empty({"data-1p-ignore":true}),...__sveltets_2_empty({"data-lpignore":`true`}),});}
                   }
                   { svelteHTML.createElement("label", { "class":`ui-field`,});
                     { svelteHTML.createElement("span", {});  }
                     { svelteHTML.createElement("div", { "class":`ui-row`,});
                       { svelteHTML.createElement("input", {                          "class":`ui-input`,"type":`text`,"placeholder":`sk-...`,"value":activeConnection.apiKey || '',"autocomplete":`off`,"oninput":(event) => updateActiveConnection({ apiKey: event.currentTarget.value }),"onchange":() => invalidateActiveConnectionModelCache(),"aria-label":`API key`,...__sveltets_2_empty({"data-1p-ignore":true}),...__sveltets_2_empty({"data-lpignore":`true`}),...__sveltets_2_empty({"data-form-type":`other`}),"style":revealKey ? '' : '-webkit-text-security: disc; font-family: text-security-disc;',"inputmode":`text`,});}
                       { svelteHTML.createElement("button", {       "class":`ui-icon-btn`,"title":revealKey ? 'Hide key' : 'Show key',"onclick":() => (revealKey = !revealKey),"aria-label":revealKey ? 'Hide key' : 'Show key',});
                        if(revealKey){
                           { const $$_ffOytilibisiVnocI5C = __sveltets_2_ensureComponent(IconVisibilityOff); new $$_ffOytilibisiVnocI5C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
                        }else{
                           { const $$_ytilibisiVnocI5C = __sveltets_2_ensureComponent(IconVisibility); new $$_ytilibisiVnocI5C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
                        }
                       }
                       { svelteHTML.createElement("button", {         "class":`ui-icon-btn`,"title":`Test connection & fetch models`,"onclick":() => refreshModelsNow(activeConnection.id),"aria-label":`Refresh models`,"disabled":activeConnectionRefreshing,});
                         { const $$_wenerotuAnocI5C = __sveltets_2_ensureComponent(IconAutorenew); new $$_wenerotuAnocI5C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
                       }
                     }
                   }
                   { svelteHTML.createElement("p", { "class":`ui-hint`,});        }
                   { svelteHTML.createElement("label", { "class":`ui-field`,});
                     { svelteHTML.createElement("span", {});   }
                     { svelteHTML.createElement("input", {                      "class":`ui-input`,"type":`text`,"placeholder":DEFAULT_API_BASE_URL,"value":activeConnection.apiBaseUrl || '',"autocomplete":`off`,"inputmode":`url`,"oninput":(event) => updateActiveConnection({ apiBaseUrl: event.currentTarget.value }),"onchange":() => invalidateActiveConnectionModelCache(),"aria-label":`API base URL`,...__sveltets_2_empty({"data-1p-ignore":true}),...__sveltets_2_empty({"data-lpignore":`true`}),});}
                   }
                   { svelteHTML.createElement("p", { "class":`ui-hint`,});           }
                   { svelteHTML.createElement("label", { "class":`ui-field`,});
                     { svelteHTML.createElement("span", {});  }
                     { svelteHTML.createElement("select", {         "class":`ui-select`,"value":activeConnection.apiMode || 'responses',"onchange":(event) => updateActiveConnection({ apiMode: event.currentTarget.value as ApiMode }),"aria-label":`API mode`,});
                       { svelteHTML.createElement("option", { "value":`responses`,});  }
                       { svelteHTML.createElement("option", { "value":`chat_completions`,});   }
                       { svelteHTML.createElement("option", { "value":`gemini`,});  }
                     }
                   }
                  if(activeConnection.apiMode !== 'gemini'){
                     { svelteHTML.createElement("label", { "class":`ui-switch`,});
                       { svelteHTML.createElement("input", {      "type":`checkbox`,"checked":!!activeConnection.openRouterEnabled,"onchange":(event) => updateActiveConnection({ openRouterEnabled: event.currentTarget.checked }),});}
                       { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                       { svelteHTML.createElement("span", { "class":`ui-switch-label`,});   }
                     }
                     { svelteHTML.createElement("p", { "class":`ui-hint`,});          }
                  }
                  if(activeRefreshMsg){
                     { svelteHTML.createElement("p", {   "class":`ui-status-msg`,"aria-live":`polite`,});activeRefreshMsg; }
                  }
                 }
              }
             }


};
return { props: {} as any as Props, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const ConnectionsTab__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type ConnectionsTab__SvelteComponent_ = ReturnType<typeof ConnectionsTab__SvelteComponent_>;
/*Ωignore_endΩ*/export default ConnectionsTab__SvelteComponent_;
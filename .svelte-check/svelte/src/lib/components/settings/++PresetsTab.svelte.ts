///<reference types="svelte" />
;
import OpenRouterProviderInput from '../OpenRouterProviderInput.svelte'
import { onMount } from 'svelte'
import { IconAdd, IconDelete, IconDragHandle } from '../../icons'
import { DEFAULT_MODEL, DEFAULT_SYSTEM_PROMPT } from '../../utils/presetHelpers'
import {
    parseTopP,
    parseTemperature,
    parseReasoning,
    parseVerbosity,
    parseReasoningSummary,
    parseThinkingBudget,
  } from './settingsDraft.svelte'
import type { SettingsDraft } from './settingsDraft.svelte';
;

  interface Props {
    draft: SettingsDraft
  };function $$render() {

  
  
  
  
  
  


  const props: Props = $props()
  const draft = $derived(props.draft)
  const local = $derived(props.draft.local)

  const presetsForRender = () => draft.presets
  const activePreset = $derived(draft.activePreset)
  const presetConnection = $derived((local?.connections || []).find(c => c.id === activePreset?.connectionId))
  const activePresetId = $derived(draft.activePresetId)
  const activePresetModels = $derived(draft.activePresetModels)
  const activePresetSupportsResponsesApiFeatures = $derived(draft.activePresetSupportsResponsesApiFeatures)

  const selectPreset = (id: string) => draft.selectPreset(id)
  const addPreset = () => draft.addPreset()
  const removePreset = (id: string) => draft.removePreset(id)
  const updateActivePreset = (patch: Parameters<SettingsDraft['updateActivePreset']>[0]) => draft.updateActivePreset(patch)

  // Default preset for new chat-mode chats (skips the preset menu)
  const isDefaultForNewChats = $derived(
    !!activePreset?.id && local?.defaultNewChatPresetId === activePreset.id
  )
  function toggleDefaultForNewChats(checked: boolean) {
    if (!activePreset?.id) return
    local.defaultNewChatPresetId = checked ? activePreset.id : ''
    draft.persist()
  }
  function toggleTavernOnly(checked: boolean) {
    updateActivePreset({ tavernOnly: checked })
    // A tavern-only preset can't be the chat-mode default
    if (checked && local?.defaultNewChatPresetId === activePreset?.id) {
      local.defaultNewChatPresetId = ''
      draft.persist()
    }
  }

  onMount(() => {
    // Model suggestions come from the shared cache; hydrate it lazily
    if (!draft.modelCacheLoaded) {
      requestAnimationFrame(() => draft.loadModelCaches())
    }
  })

  let expandedPresetGroups = $state<{ general: boolean, sampling: boolean, reasoning: boolean }>({ general: false, sampling: false, reasoning: false })

  function togglePresetGroup(group: keyof typeof expandedPresetGroups) {
    expandedPresetGroups = { ...expandedPresetGroups, [group]: !expandedPresetGroups[group] }
  }

  // Drag and drop state
  let draggedPresetId = $state<string | null>(null)
  let dragOverPresetId = $state<string | null>(null)

  // Touch drag state for mobile
  let touchDragId = $state<string | null>(null)
  let touchListRef = $state<HTMLElement | null>(null)

  function handlePresetDragStart(e: DragEvent, id: string) {
    draggedPresetId = id
    e.dataTransfer!.effectAllowed = 'move'
    e.dataTransfer!.setData('text/plain', id)
  }

  function handlePresetDragOver(e: DragEvent, id: string) {
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'
    if (!draggedPresetId || draggedPresetId === id) return
    dragOverPresetId = id
  }

  function handlePresetDrop(e: DragEvent) {
    e.preventDefault()
    if (draggedPresetId && dragOverPresetId && draggedPresetId !== dragOverPresetId) {
      draft.reorderPresets(draggedPresetId, dragOverPresetId)
    }
    draggedPresetId = null
    dragOverPresetId = null
  }

  function handlePresetDragEnd() {
    draggedPresetId = null
    dragOverPresetId = null
  }

  function handlePresetTouchStart(e: TouchEvent, id: string) {
    touchDragId = id
    draggedPresetId = id
    const listEl = (e.currentTarget as HTMLElement).closest('.ui-item-list')
    if (listEl) touchListRef = listEl as HTMLElement
  }

  function handlePresetTouchMove(e: TouchEvent) {
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
          dragOverPresetId = id
          return
        }
      }
    }
  }

  function resetTouchState() {
    touchDragId = null
    touchListRef = null
    draggedPresetId = null
    dragOverPresetId = null
  }

  function handlePresetTouchEnd() {
    if (touchDragId && dragOverPresetId) {
      draft.reorderPresets(touchDragId, dragOverPresetId)
    }
    touchDragId = null
    touchListRef = null
    draggedPresetId = null
    dragOverPresetId = null
  }
;
async () => {

             { svelteHTML.createElement("section", { "class":`ui-group presets`,});
               { svelteHTML.createElement("div", { "class":`ui-group-head`,});
                 { svelteHTML.createElement("div", { "class":`ui-group-title`,});  }
                 { svelteHTML.createElement("button", {         "type":`button`,"class":`ui-icon-btn accent`,"title":`Add preset`,"aria-label":`Add preset`,"onclick":addPreset,});
                   { const $$_ddAnocI3C = __sveltets_2_ensureComponent(IconAdd); new $$_ddAnocI3C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
                 }
               }
               { svelteHTML.createElement("p", { "class":`ui-hint`,});          }
               { svelteHTML.createElement("div", { "class":`ui-item-list ui-reorder-list`,});
                   for(let preset of __sveltets_2_ensureArray(presetsForRender())){preset.id;
                  const presetConnection = (local?.connections || []).find(c => c.id === preset.connectionId);
                  const isDragging = draggedPresetId === preset.id;
                  const isDragOver = dragOverPresetId === preset.id && draggedPresetId !== preset.id;
                   { svelteHTML.createElement("div", {                 "class":`ui-list-item ${preset.id === activePresetId ? 'active' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`,...__sveltets_2_empty({"data-id":preset.id}),"draggable":`true`,"ondragstart":(e) => handlePresetDragStart(e, preset.id ?? ''),"ondragover":(e) => handlePresetDragOver(e, preset.id ?? ''),"ondrop":handlePresetDrop,"ondragend":handlePresetDragEnd,"role":`listitem`,});
                     { svelteHTML.createElement("div", {             "class":`ui-drag-handle`,"aria-label":`Drag to reorder`,"ontouchstart":(e) => handlePresetTouchStart(e, preset.id ?? ''),"ontouchmove":handlePresetTouchMove,"ontouchend":handlePresetTouchEnd,"ontouchcancel":resetTouchState,});
                       { const $$_eldnaHgarDnocI4C = __sveltets_2_ensureComponent(IconDragHandle); new $$_eldnaHgarDnocI4C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
                     }
                     { svelteHTML.createElement("button", {       "type":`button`,"class":`ui-item-content`,"onclick":() => selectPreset(preset.id ?? ''),});
                       { svelteHTML.createElement("span", { "class":`ui-item-name`,});
                        preset.name || 'Untitled';
                        if(local?.defaultNewChatPresetId && preset.id === local.defaultNewChatPresetId){
                           { svelteHTML.createElement("span", { "class":`ui-item-badge`,});  }
                        }
                        if(preset.tavernOnly){
                           { svelteHTML.createElement("span", { "class":`ui-item-badge neutral`,});  }
                        }
                       }
                       { svelteHTML.createElement("span", { "class":`ui-item-meta`,});preset.model || 'No model';  presetConnection?.name || 'No connection'; }
                     }
                    if((local?.presets?.length || 0) > 1){
                       { svelteHTML.createElement("button", {           "type":`button`,"class":`ui-item-delete`,"onclick":() => removePreset(preset.id ?? ''),"title":`Delete preset`,"aria-label":`Delete preset`,});
                         { const $$_eteleDnocI4C = __sveltets_2_ensureComponent(IconDelete); new $$_eteleDnocI4C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
                       }
                    }
                   }
                }
               }
              if(activePreset){
                 { svelteHTML.createElement("div", { "class":`ui-form-section`,});
                   { svelteHTML.createElement("div", { "class":`ui-form-section-title`,}); activePreset.name || 'Preset'; }
                   { svelteHTML.createElement("label", { "class":`ui-field`,});
                     { svelteHTML.createElement("span", {});  }
                     { svelteHTML.createElement("input", {             "class":`ui-input`,"type":`text`,"placeholder":`Preset name`,"value":activePreset.name || '',"oninput":(event) => updateActivePreset({ name: event.currentTarget.value }),"aria-label":`Preset name`,});}
                   }
                   { svelteHTML.createElement("label", {   "class":`ui-switch`,"title":`Only offer this preset in tavern mode`,});
                     { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":!!activePreset.tavernOnly,"onchange":(event) => toggleTavernOnly(!!event.currentTarget.checked),"aria-label":`Tavern only`,});}
                     { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                     { svelteHTML.createElement("span", { "class":`ui-switch-label`,});  }
                   }
                   { svelteHTML.createElement("p", { "class":`ui-hint`,});               }
                  if(!activePreset.tavernOnly){
                     { svelteHTML.createElement("label", {   "class":`ui-switch`,"title":`Use this preset for new chats without asking`,});
                       { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":isDefaultForNewChats,"onchange":(event) => toggleDefaultForNewChats(!!event.currentTarget.checked),"aria-label":`Default for new chats`,});}
                       { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                       { svelteHTML.createElement("span", { "class":`ui-switch-label`,});    }
                     }
                     { svelteHTML.createElement("p", { "class":`ui-hint`,});             }
                  }
                   { svelteHTML.createElement("label", { "class":`ui-field`,});
                     { svelteHTML.createElement("span", {});  }
                     { svelteHTML.createElement("textarea", {             "class":`ui-textarea`,"rows":3,"placeholder":DEFAULT_SYSTEM_PROMPT,"value":typeof activePreset.systemPrompt === 'string' ? activePreset.systemPrompt : '',"oninput":(event) => updateActivePreset({ systemPrompt: event.currentTarget.value }),"aria-label":`System prompt`,}); }
                   }
                   { svelteHTML.createElement("label", { "class":`ui-field`,});
                     { svelteHTML.createElement("span", {});  }
                     { svelteHTML.createElement("input", {               "class":`ui-input`,"type":`text`,"placeholder":DEFAULT_MODEL,"value":activePreset.model || '',"oninput":(event) => updateActivePreset({ model: event.currentTarget.value }),"list":`preset-model-suggestions`,"aria-label":`Model`,});}
                    if(activePresetModels?.length){
                       { svelteHTML.createElement("datalist", { "id":`preset-model-suggestions`,});
                          for(let mid of __sveltets_2_ensureArray(activePresetModels)){
                           { svelteHTML.createElement("option", { "value":mid,});mid; }
                        }
                       }
                    }
                   }

                 { svelteHTML.createElement("div", { "class":`preset-group-divider`,}); }
                 { svelteHTML.createElement("button", {   "class":`preset-group-header`,"onclick":() => togglePresetGroup('general'),});
                   { svelteHTML.createElement("span", {});  }
                   { svelteHTML.createElement("svg", {             "class":`chevron ${expandedPresetGroups.general ? 'expanded' : ''}`,"width":`16`,"height":`16`,"viewBox":`0 0 24 24`,"fill":`none`,"stroke":`currentColor`,"stroke-width":`2`,});
                     { svelteHTML.createElement("polyline", { "points":`6 9 12 15 18 9`,}); }
                   }
                 }

                if(expandedPresetGroups.general){
                   { svelteHTML.createElement("label", {   "class":`ui-switch`,"title":`Stream`,});
                     { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":!!activePreset.streaming,"onchange":(event) => updateActivePreset({ streaming: !!event.currentTarget.checked }),"aria-label":`Stream`,});}
                     { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                     { svelteHTML.createElement("span", { "class":`ui-switch-label`,});  }
                   }
                  if(activePresetSupportsResponsesApiFeatures){
                     { svelteHTML.createElement("label", {   "class":`ui-switch`,"title":`Web search (Responses API only)`,});
                       { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":!!activePreset.webSearchEnabled,"onchange":(event) => updateActivePreset({ webSearchEnabled: !!event.currentTarget.checked }),"aria-label":`Web search`,});}
                       { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                       { svelteHTML.createElement("span", { "class":`ui-switch-label`,});  }
                     }
                     { svelteHTML.createElement("label", {   "class":`ui-switch`,"title":`Code interpreter (Responses API only)`,});
                       { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":!!activePreset.codeInterpreterEnabled,"onchange":(event) => updateActivePreset({ codeInterpreterEnabled: !!event.currentTarget.checked }),"aria-label":`Code interpreter`,});}
                       { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                       { svelteHTML.createElement("span", { "class":`ui-switch-label`,});  }
                     }
                    if(activePreset.codeInterpreterEnabled){
                       { svelteHTML.createElement("div", { "class":`tool-network-settings`,});
                         { svelteHTML.createElement("label", {   "class":`ui-switch`,"title":`Allow network access for code interpreter`,});
                           { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":!!activePreset.codeInterpreterNetworkEnabled,"onchange":(event) => updateActivePreset({ codeInterpreterNetworkEnabled: !!event.currentTarget.checked }),"aria-label":`Code interpreter network access`,});}
                           { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                           { svelteHTML.createElement("span", { "class":`ui-switch-label`,});  }
                         }
                        if(activePreset.codeInterpreterNetworkEnabled){
                           { svelteHTML.createElement("label", { "class":`ui-field`,});
                             { svelteHTML.createElement("span", {});  }
                             { svelteHTML.createElement("input", {             "class":`ui-input`,"type":`text`,"placeholder":`e.g. api.github.com, pypi.org`,"value":activePreset.codeInterpreterAllowedDomains || '',"oninput":(event) => updateActivePreset({ codeInterpreterAllowedDomains: event.currentTarget.value || undefined }),"aria-label":`Code interpreter allowed domains`,});}
                           }
                        }
                       }
                    }
                     { svelteHTML.createElement("label", {   "class":`ui-switch`,"title":`Shell (Responses API only)`,});
                       { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":!!activePreset.shellEnabled,"onchange":(event) => updateActivePreset({ shellEnabled: !!event.currentTarget.checked }),"aria-label":`Shell`,});}
                       { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                       { svelteHTML.createElement("span", { "class":`ui-switch-label`,});  }
                     }
                    if(activePreset.shellEnabled){
                       { svelteHTML.createElement("div", { "class":`tool-network-settings`,});
                         { svelteHTML.createElement("label", {   "class":`ui-switch`,"title":`Allow network access for shell`,});
                           { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":!!activePreset.shellNetworkEnabled,"onchange":(event) => updateActivePreset({ shellNetworkEnabled: !!event.currentTarget.checked }),"aria-label":`Shell network access`,});}
                           { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                           { svelteHTML.createElement("span", { "class":`ui-switch-label`,});  }
                         }
                        if(activePreset.shellNetworkEnabled){
                           { svelteHTML.createElement("label", { "class":`ui-field`,});
                             { svelteHTML.createElement("span", {});  }
                             { svelteHTML.createElement("input", {             "class":`ui-input`,"type":`text`,"placeholder":`e.g. api.github.com, registry.npmjs.org`,"value":activePreset.shellAllowedDomains || '',"oninput":(event) => updateActivePreset({ shellAllowedDomains: event.currentTarget.value || undefined }),"aria-label":`Shell allowed domains`,});}
                           }
                        }
                       }
                    }
                     { svelteHTML.createElement("label", {   "class":`ui-switch`,"title":`Image generation (Responses API only)`,});
                       { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":!!activePreset.imageGenerationEnabled,"onchange":(event) => updateActivePreset({ imageGenerationEnabled: !!event.currentTarget.checked }),"aria-label":`Image generation`,});}
                       { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                       { svelteHTML.createElement("span", { "class":`ui-switch-label`,});  }
                     }
                    if(activePreset.imageGenerationEnabled){
                       { svelteHTML.createElement("label", { "class":`ui-field`,});
                         { svelteHTML.createElement("span", {});   }
                         { svelteHTML.createElement("input", {             "class":`ui-input`,"type":`text`,"placeholder":`gpt-image-1`,"value":activePreset.imageGenerationModel || '',"oninput":(event) => updateActivePreset({ imageGenerationModel: event.currentTarget.value }),"aria-label":`Image generation model`,});}
                       }
                    }
                     { svelteHTML.createElement("label", {   "class":`ui-switch`,"title":`MCP (Responses API only)`,});
                       { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":!!activePreset.mcpEnabled,"onchange":(event) => updateActivePreset({ mcpEnabled: !!event.currentTarget.checked }),"aria-label":`MCP`,});}
                       { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                       { svelteHTML.createElement("span", { "class":`ui-switch-label`,});  }
                     }
                    if(activePreset.mcpEnabled){
                       { svelteHTML.createElement("div", { "class":`tool-network-settings mcp-settings`,});
                        if(activePreset.mcpServers?.length){
                              for(let server of __sveltets_2_ensureArray(activePreset.mcpServers)){let index = 1;index;
                             { svelteHTML.createElement("div", { "class":`mcp-server-row`,});
                               { svelteHTML.createElement("input", {             "class":`ui-input`,"type":`text`,"placeholder":`https://example.com/mcp`,"value":server?.url || '',"oninput":(event) => updateActivePreset({
                                  mcpServers: (activePreset.mcpServers || []).map((entry, entryIndex) => (
                                    entryIndex === index
                                      ? { ...entry, url: event.currentTarget.value }
                                      : entry
                                  )),
                                }),"aria-label":`MCP server URL ${index + 1}`,});}
                               { svelteHTML.createElement("button", {           "type":`button`,"class":`ui-icon-btn ui-icon-btn-sm danger`,"onclick":() => updateActivePreset({
                                  mcpServers: (activePreset.mcpServers || []).filter((_, entryIndex) => entryIndex !== index),
                                }),"aria-label":`Remove MCP server ${index + 1}`,"title":`Remove MCP server`,});
                                 { const $$_eteleDnocI5C = __sveltets_2_ensureComponent(IconDelete); new $$_eteleDnocI5C({ target: __sveltets_2_any(), props: {  "style":`font-size: 14px;`,}});}
                               }
                             }
                          }
                        }else{
                           { svelteHTML.createElement("div", { "class":`ui-hint`,});   }
                        }
                         { svelteHTML.createElement("button", {       "type":`button`,"class":`ui-btn ui-btn-outline ui-btn-sm mcp-add-btn`,"onclick":() => updateActivePreset({
                            mcpServers: [...(activePreset.mcpServers || []), { label: '', url: '' }],
                          }),});
                            
                         }
                       }
                    }
                  }
                   { svelteHTML.createElement("label", { "class":`ui-field`,});
                     { svelteHTML.createElement("span", {});  }
                     { svelteHTML.createElement("select", {         "class":`ui-select`,"value":activePreset.textVerbosity || 'medium',"onchange":(event) => updateActivePreset({ textVerbosity: parseVerbosity(event.currentTarget.value) }),"aria-label":`Text verbosity`,});
                       { svelteHTML.createElement("option", { "value":`none`,});  }
                       { svelteHTML.createElement("option", { "value":`low`,});  }
                       { svelteHTML.createElement("option", { "value":`medium`,});  }
                       { svelteHTML.createElement("option", { "value":`high`,});  }
                     }
                   }
                   { svelteHTML.createElement("label", { "class":`ui-field`,});
                     { svelteHTML.createElement("span", {});  }
                     { svelteHTML.createElement("select", {         "class":`ui-select`,"value":activePreset.connectionId || '',"onchange":(event) => updateActivePreset({ connectionId: event.currentTarget.value }),"aria-label":`Connection`,});
                         for(let connection of __sveltets_2_ensureArray(local?.connections || [])){connection.id;
                         { svelteHTML.createElement("option", { "value":connection.id,});connection?.name || connection?.id || 'Connection'; }
                      }
                     }
                   }
                  if(presetConnection?.openRouterEnabled && presetConnection.apiMode !== 'gemini'){
                     { svelteHTML.createElement("div", { "class":`ui-field`,});
                       { const $$_tupnIredivorPretuoRnepO3C = __sveltets_2_ensureComponent(OpenRouterProviderInput); new $$_tupnIredivorPretuoRnepO3C({ target: __sveltets_2_any(), props: {    "value":activePreset.openRouterProvider,"onInput":(value) => updateActivePreset({ openRouterProvider: value }),}});}
                     }
                  }
                }

                 { svelteHTML.createElement("div", { "class":`preset-group-divider`,}); }
                 { svelteHTML.createElement("button", {   "class":`preset-group-header`,"onclick":() => togglePresetGroup('sampling'),});
                   { svelteHTML.createElement("span", {});  }
                   { svelteHTML.createElement("svg", {             "class":`chevron ${expandedPresetGroups.sampling ? 'expanded' : ''}`,"width":`16`,"height":`16`,"viewBox":`0 0 24 24`,"fill":`none`,"stroke":`currentColor`,"stroke-width":`2`,});
                     { svelteHTML.createElement("polyline", { "points":`6 9 12 15 18 9`,}); }
                   }
                 }

                if(expandedPresetGroups.sampling){
                   { svelteHTML.createElement("label", { "class":`ui-field`,});
                     { svelteHTML.createElement("span", {});  }
                     { svelteHTML.createElement("input", {                   "class":`ui-input`,"type":`number`,"min":`0`,"max":`1`,"step":`0.1`,"placeholder":`Default`,"value":activePreset.topP ?? '',"oninput":(event) => updateActivePreset({ topP: parseTopP(event.currentTarget.value) }),"aria-label":`top_p`,});}
                   }
                   { svelteHTML.createElement("label", { "class":`ui-field`,});
                     { svelteHTML.createElement("span", {});  }
                     { svelteHTML.createElement("input", {                   "class":`ui-input`,"type":`number`,"min":`0`,"max":`2`,"step":`0.1`,"placeholder":`Default`,"value":activePreset.temperature ?? '',"oninput":(event) => updateActivePreset({ temperature: parseTemperature(event.currentTarget.value) }),"aria-label":`Temperature`,});}
                   }
                }

                 { svelteHTML.createElement("div", { "class":`preset-group-divider`,}); }
                 { svelteHTML.createElement("button", {   "class":`preset-group-header`,"onclick":() => togglePresetGroup('reasoning'),});
                   { svelteHTML.createElement("span", {});  }
                   { svelteHTML.createElement("svg", {             "class":`chevron ${expandedPresetGroups.reasoning ? 'expanded' : ''}`,"width":`16`,"height":`16`,"viewBox":`0 0 24 24`,"fill":`none`,"stroke":`currentColor`,"stroke-width":`2`,});
                     { svelteHTML.createElement("polyline", { "points":`6 9 12 15 18 9`,}); }
                   }
                 }

                if(expandedPresetGroups.reasoning){
                   { svelteHTML.createElement("label", { "class":`ui-field`,});
                     { svelteHTML.createElement("span", {});  }
                     { svelteHTML.createElement("select", {         "class":`ui-select`,"value":activePreset.reasoningEffort || 'default',"onchange":(event) => updateActivePreset({ reasoningEffort: parseReasoning(event.currentTarget.value) }),"aria-label":`Reasoning effort`,});
                       { svelteHTML.createElement("option", { "value":`default`,});  }
                       { svelteHTML.createElement("option", { "value":`none`,});  }
                       { svelteHTML.createElement("option", { "value":`minimal`,});  }
                       { svelteHTML.createElement("option", { "value":`low`,});  }
                       { svelteHTML.createElement("option", { "value":`medium`,});  }
                       { svelteHTML.createElement("option", { "value":`high`,});  }
                       { svelteHTML.createElement("option", { "value":`xhigh`,});  }
                     }
                   }
                   { svelteHTML.createElement("label", { "class":`ui-field`,});
                     { svelteHTML.createElement("span", {});  }
                     { svelteHTML.createElement("select", {         "class":`ui-select`,"value":activePreset.reasoningSummary || 'auto',"onchange":(event) => updateActivePreset({ reasoningSummary: parseReasoningSummary(event.currentTarget.value) }),"aria-label":`Reasoning summary`,});
                       { svelteHTML.createElement("option", { "value":`none`,});  }
                       { svelteHTML.createElement("option", { "value":`auto`,});  }
                       { svelteHTML.createElement("option", { "value":`concise`,});  }
                       { svelteHTML.createElement("option", { "value":`detailed`,});  }
                     }
                   }
                  if(local.showThinkingSettings){
                     { svelteHTML.createElement("label", {   "class":`ui-switch`,"title":`Enable Anthropic thinking`,});
                       { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":!!activePreset.thinkingEnabled,"onchange":(event) => updateActivePreset({ thinkingEnabled: !!event.currentTarget.checked }),"aria-label":`Enable Anthropic thinking`,});}
                       { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                       { svelteHTML.createElement("span", { "class":`ui-switch-label`,});  }
                     }
                     { svelteHTML.createElement("label", { "class":`ui-field`,});
                       { svelteHTML.createElement("span", {});   }
                       { svelteHTML.createElement("input", {                   "class":`ui-input`,"type":`number`,"min":`1`,"step":`100`,"placeholder":`Budget tokens`,"value":activePreset.thinkingBudgetTokens ?? '',"oninput":(event) => updateActivePreset({ thinkingBudgetTokens: parseThinkingBudget(event.currentTarget.value) }),"aria-label":`Thinking budget tokens`,"disabled":!activePreset.thinkingEnabled,});}
                     }
                  }
                }
                 }
              }
             }


};
return { props: {} as any as Props, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const PresetsTab__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type PresetsTab__SvelteComponent_ = ReturnType<typeof PresetsTab__SvelteComponent_>;
/*Ωignore_endΩ*/export default PresetsTab__SvelteComponent_;
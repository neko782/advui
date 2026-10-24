///<reference types="svelte" />
;
  let datalistUid = 0
;;

import OpenRouterProviderInput from '../OpenRouterProviderInput.svelte'
import { IconTune, IconLayers } from '../../icons'
import { DEFAULT_MODEL } from '../../utils/presetHelpers'
import type { Preset, ReasoningEffort, TextVerbosity, ReasoningSummary, ConnectionOption, McpServerConfig } from '../../types';
;

  interface Props {
    open?: boolean
    disabled?: boolean
    model?: string
    streaming?: boolean
    maxOutputTokens?: number | null
    topP?: number | null
    temperature?: number | null
    reasoningEffort?: ReasoningEffort
    reasoningSummary?: ReasoningSummary
    textVerbosity?: TextVerbosity
    openRouterProvider?: string
    onInputOpenRouterProvider?: (val: string) => void
    thinkingEnabled?: boolean
    thinkingBudgetTokens?: number | null
    webSearchEnabled?: boolean
    codeInterpreterEnabled?: boolean
    codeInterpreterNetworkEnabled?: boolean
    codeInterpreterAllowedDomains?: string
    shellEnabled?: boolean
    shellNetworkEnabled?: boolean
    shellAllowedDomains?: string
    imageGenerationEnabled?: boolean
    imageGenerationModel?: string
    mcpEnabled?: boolean
    mcpServers?: McpServerConfig[]
    modelIds?: string[]
    connections?: ConnectionOption[]
    connectionId?: string | null
    showThinkingControls?: boolean
    presets?: Preset[]
    onToggle?: () => void
    onClose?: () => void
    onChangeConnection?: (val: string) => void
    onInputModel?: (val: string) => void
    onInputStreaming?: (val: boolean) => void
    onInputMaxOutputTokens?: (val: string) => void
    onInputTopP?: (val: string) => void
    onInputTemperature?: (val: string) => void
    onInputReasoningEffort?: (val: string) => void
    onInputReasoningSummary?: (val: string) => void
    onInputTextVerbosity?: (val: string) => void
    onInputThinkingEnabled?: (val: boolean) => void
    onInputThinkingBudgetTokens?: (val: string) => void
    onInputWebSearchEnabled?: (val: boolean) => void
    onInputCodeInterpreterEnabled?: (val: boolean) => void
    onInputCodeInterpreterNetworkEnabled?: (val: boolean) => void
    onInputCodeInterpreterAllowedDomains?: (val: string) => void
    onInputShellEnabled?: (val: boolean) => void
    onInputShellNetworkEnabled?: (val: boolean) => void
    onInputShellAllowedDomains?: (val: string) => void
    onInputImageGenerationEnabled?: (val: boolean) => void
    onInputImageGenerationModel?: (val: string) => void
    onInputMcpEnabled?: (val: boolean) => void
    onChangeMcpServers?: (servers: McpServerConfig[]) => void
    onSelectPreset?: (preset: Preset) => void
  };function $$render() {

  
  
  
  


  const props: Props = $props()
  const modelDatalistId = `model-suggestions-${++datalistUid}`
  let root: HTMLDivElement | undefined
  let activeTab = $state<'general' | 'sampling' | 'reasoning'>('general')
  let presetMenuOpen = $state(false)
  let presetMenuEl = $state<HTMLDivElement | null>(null)
  let presetButtonEl = $state<HTMLButtonElement | null>(null)
  let presetMenuPosition = $state({ bottom: 0, left: 0 })

  // Per-tool floating popup
  let activeToolPopup = $state<string | null>(null)
  let toolPopupEl = $state<HTMLDivElement | null>(null)
  let toolPopupPosition = $state({ bottom: 0, left: 0 })
  const toolPopupBtnEls: Record<string, HTMLButtonElement | null> = {}

  const supportsResponsesApiFeatures = $derived((() => {
    const conns = props.connections || []
    const currentConn = conns.find(c => c.id === props.connectionId) || conns[0]
    return currentConn?.apiMode === 'responses'
  })())

  const supportsOpenRouter = $derived((() => {
    const conns = props.connections || []
    const conn = conns.find(c => c.id === props.connectionId) || conns[0]
    return conn?.openRouterEnabled === true && conn.apiMode !== 'gemini'
  })())

  function updateMcpServers(transform: (servers: McpServerConfig[]) => McpServerConfig[]) {
    if (props.disabled) return
    const current = Array.isArray(props.mcpServers)
      ? props.mcpServers.map((server) => ({ label: server?.label || '', url: server?.url || '' }))
      : []
    props.onChangeMcpServers?.(transform(current))
  }

  function addMcpServer() {
    updateMcpServers((servers) => [...servers, { label: '', url: '' }])
  }

  function removeMcpServer(index: number) {
    updateMcpServers((servers) => servers.filter((_, i) => i !== index))
  }

  function updateMcpServerUrl(index: number, value: string) {
    updateMcpServers((servers) => servers.map((server, i) => (
      i === index ? { ...server, url: value } : server
    )))
  }

  function togglePresetMenu() {
    if (!presetMenuOpen && presetButtonEl) {
      const rect = presetButtonEl.getBoundingClientRect()
      const menuWidth = 220
      const padding = 8
      let leftPos = rect.left
      if (leftPos + menuWidth > window.innerWidth - padding) {
        leftPos = rect.right - menuWidth
        if (leftPos < padding) leftPos = window.innerWidth - menuWidth - padding
      }
      presetMenuPosition = { bottom: window.innerHeight - rect.top + 4, left: Math.max(padding, leftPos) }
    }
    presetMenuOpen = !presetMenuOpen
  }

  function closePresetMenu() { presetMenuOpen = false }

  function selectPreset(preset: Preset) {
    closePresetMenu()
    props.onSelectPreset?.(preset)
  }

  function toggleToolPopup(tool: string, btn?: HTMLButtonElement | null) {
    if (activeToolPopup === tool) { activeToolPopup = null; return }
    const el = btn || toolPopupBtnEls[tool]
    if (el) {
      const rect = el.getBoundingClientRect()
      const popupWidth = 280
      const padding = 8
      let leftPos = rect.left
      if (leftPos + popupWidth > window.innerWidth - padding) {
        leftPos = rect.right - popupWidth
        if (leftPos < padding) leftPos = window.innerWidth - popupWidth - padding
      }
      toolPopupPosition = { bottom: window.innerHeight - rect.top + 4, left: Math.max(padding, leftPos) }
    }
    activeToolPopup = tool
  }

  $effect(() => {
    // Only listen while something is actually open; avoids document-level
    // listeners for every mounted (but closed) instance.
    if (!props.open && !presetMenuOpen && !activeToolPopup) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Element
      try {
        const isInPresetMenu = presetMenuEl && presetMenuEl.contains(target)
        const isPresetWrapper = target.closest('.preset-toggle-wrapper')
        const isInToolPopup = toolPopupEl && toolPopupEl.contains(target)
        const isToolBtn = target.closest('.tool-settings-btn')

        if (props.open && root && !root.contains(target) && !isInPresetMenu && !isPresetWrapper && !isInToolPopup && !isToolBtn) {
          props.onClose?.()
        }
        if (presetMenuOpen && !isInPresetMenu && !isPresetWrapper) closePresetMenu()
        if (activeToolPopup && !isInToolPopup && !isToolBtn) activeToolPopup = null
      } catch {}
    }
    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (activeToolPopup) { activeToolPopup = null }
        else if (presetMenuOpen) closePresetMenu()
        else if (props.open) props.onClose?.()
      }
    }
    window.addEventListener('click', onDocClick, true)
    window.addEventListener('keydown', onKeydown)
    return () => { window.removeEventListener('click', onDocClick, true); window.removeEventListener('keydown', onKeydown) }
  })

  $effect(() => { if (!props.open) activeToolPopup = null })
;
async () => {



 { const $$_div0 = svelteHTML.createElement("div", {  "class":`chat-settings-group ${props.open ? 'open' : ''}`,});root = $$_div0;
   { svelteHTML.createElement("button", {       "class":`icon-btn`,"aria-label":`Chat settings`,"disabled":props.disabled,"onclick":() => (!props.disabled && props.onToggle?.()),});
     { const $$_enuTnocI2C = __sveltets_2_ensureComponent(IconTune); new $$_enuTnocI2C({ target: __sveltets_2_any(), props: {  "style":`font-size: 22px;`,}});}
   }
   { svelteHTML.createElement("div", {     "class":`send-menu chat-settings-menu`,"role":`menu`,"aria-label":`Chat settings`,});
    
     { svelteHTML.createElement("div", { "class":`tab-content`,});
      if(activeTab === 'general'){
         { svelteHTML.createElement("div", { "class":`menu-section`,});
           { svelteHTML.createElement("label", {   "class":`ui-switch`,"title":`Stream`,});
             { svelteHTML.createElement("input", {          "type":`checkbox`,"checked":!!props.streaming,"disabled":props.disabled,"onchange":(e) => (!props.disabled && props.onInputStreaming?.(e.currentTarget.checked)),"aria-label":`Stream`,});}
             { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
             { svelteHTML.createElement("span", { "class":`ui-switch-label`,});  }
           }
         }
        if(supportsResponsesApiFeatures){
           { svelteHTML.createElement("div", { "class":`menu-section`,});
             { svelteHTML.createElement("label", { "class":`ui-switch`,});
               { svelteHTML.createElement("input", {          "type":`checkbox`,"checked":!!props.webSearchEnabled,"disabled":props.disabled,"onchange":(e) => (!props.disabled && props.onInputWebSearchEnabled?.(e.currentTarget.checked)),"aria-label":`Web search`,});}
               { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
               { svelteHTML.createElement("span", { "class":`ui-switch-label`,});  }
             }
           }
           { svelteHTML.createElement("div", { "class":`menu-section`,});
             { svelteHTML.createElement("div", { "class":`tool-header-row`,});
               { svelteHTML.createElement("label", { "class":`ui-switch`,});
                 { svelteHTML.createElement("input", {          "type":`checkbox`,"checked":!!props.codeInterpreterEnabled,"disabled":props.disabled,"onchange":(e) => (!props.disabled && props.onInputCodeInterpreterEnabled?.(e.currentTarget.checked)),"aria-label":`Code interpreter`,});}
                 { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                 { svelteHTML.createElement("span", { "class":`ui-switch-label`,});  }
               }
              if(props.codeInterpreterEnabled){
                 { const $$_button5 = svelteHTML.createElement("button", {            "type":`button`,"class":`tool-settings-btn`,"onclick":() => toggleToolPopup('codeInterpreter', toolPopupBtnEls['codeInterpreter']),"disabled":props.disabled,"title":`Network settings`,"aria-label":`Network settings`,});toolPopupBtnEls['codeInterpreter'] = $$_button5;
                   { svelteHTML.createElement("svg", {           "width":`16`,"height":`16`,"viewBox":`0 0 24 24`,"fill":`none`,"stroke":`currentColor`,"stroke-width":`2`,});
                     { svelteHTML.createElement("polyline", { "points":activeToolPopup === 'codeInterpreter' ? "18 15 12 9 6 15" : "6 9 12 15 18 9",}); }
                   }
                 }
              }
             }
           }
           { svelteHTML.createElement("div", { "class":`menu-section`,});
             { svelteHTML.createElement("div", { "class":`tool-header-row`,});
               { svelteHTML.createElement("label", { "class":`ui-switch`,});
                 { svelteHTML.createElement("input", {          "type":`checkbox`,"checked":!!props.shellEnabled,"disabled":props.disabled,"onchange":(e) => (!props.disabled && props.onInputShellEnabled?.(e.currentTarget.checked)),"aria-label":`Shell`,});}
                 { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                 { svelteHTML.createElement("span", { "class":`ui-switch-label`,});  }
               }
              if(props.shellEnabled){
                 { const $$_button5 = svelteHTML.createElement("button", {            "type":`button`,"class":`tool-settings-btn`,"onclick":() => toggleToolPopup('shell', toolPopupBtnEls['shell']),"disabled":props.disabled,"title":`Network settings`,"aria-label":`Network settings`,});toolPopupBtnEls['shell'] = $$_button5;
                   { svelteHTML.createElement("svg", {           "width":`16`,"height":`16`,"viewBox":`0 0 24 24`,"fill":`none`,"stroke":`currentColor`,"stroke-width":`2`,});
                     { svelteHTML.createElement("polyline", { "points":activeToolPopup === 'shell' ? "18 15 12 9 6 15" : "6 9 12 15 18 9",}); }
                   }
                 }
              }
             }
           }
           { svelteHTML.createElement("div", { "class":`menu-section`,});
             { svelteHTML.createElement("div", { "class":`tool-header-row`,});
               { svelteHTML.createElement("label", { "class":`ui-switch`,});
                 { svelteHTML.createElement("input", {          "type":`checkbox`,"checked":!!props.imageGenerationEnabled,"disabled":props.disabled,"onchange":(e) => (!props.disabled && props.onInputImageGenerationEnabled?.(e.currentTarget.checked)),"aria-label":`Image generation`,});}
                 { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                 { svelteHTML.createElement("span", { "class":`ui-switch-label`,});  }
               }
              if(props.imageGenerationEnabled){
                 { const $$_button5 = svelteHTML.createElement("button", {            "type":`button`,"class":`tool-settings-btn`,"onclick":() => toggleToolPopup('imageGeneration', toolPopupBtnEls['imageGeneration']),"disabled":props.disabled,"title":`Model settings`,"aria-label":`Model settings`,});toolPopupBtnEls['imageGeneration'] = $$_button5;
                   { svelteHTML.createElement("svg", {           "width":`16`,"height":`16`,"viewBox":`0 0 24 24`,"fill":`none`,"stroke":`currentColor`,"stroke-width":`2`,});
                     { svelteHTML.createElement("polyline", { "points":activeToolPopup === 'imageGeneration' ? "18 15 12 9 6 15" : "6 9 12 15 18 9",}); }
                   }
                 }
              }
             }
           }
           { svelteHTML.createElement("div", { "class":`menu-section`,});
             { svelteHTML.createElement("div", { "class":`tool-header-row`,});
               { svelteHTML.createElement("label", { "class":`ui-switch`,});
                 { svelteHTML.createElement("input", {          "type":`checkbox`,"checked":!!props.mcpEnabled,"disabled":props.disabled,"onchange":(e) => (!props.disabled && props.onInputMcpEnabled?.(e.currentTarget.checked)),"aria-label":`MCP`,});}
                 { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                 { svelteHTML.createElement("span", { "class":`ui-switch-label`,});  }
               }
              if(props.mcpEnabled){
                 { const $$_button5 = svelteHTML.createElement("button", {            "type":`button`,"class":`tool-settings-btn`,"onclick":() => toggleToolPopup('mcp', toolPopupBtnEls['mcp']),"disabled":props.disabled,"title":`Server settings`,"aria-label":`Server settings`,});toolPopupBtnEls['mcp'] = $$_button5;
                   { svelteHTML.createElement("svg", {           "width":`16`,"height":`16`,"viewBox":`0 0 24 24`,"fill":`none`,"stroke":`currentColor`,"stroke-width":`2`,});
                     { svelteHTML.createElement("polyline", { "points":activeToolPopup === 'mcp' ? "18 15 12 9 6 15" : "6 9 12 15 18 9",}); }
                   }
                 }
              }
             }
           }
        }
         { svelteHTML.createElement("div", { "class":`menu-section`,});
           { svelteHTML.createElement("div", { "class":`menu-label`,});  }
           { svelteHTML.createElement("select", {       "value":props.textVerbosity || 'medium',"disabled":props.disabled,"onchange":(e) => (!props.disabled && props.onInputTextVerbosity?.(e.currentTarget.value)),"aria-label":`Text verbosity`,});
             { svelteHTML.createElement("option", { "value":`none`,});  } { svelteHTML.createElement("option", { "value":`low`,});  }
             { svelteHTML.createElement("option", { "value":`medium`,});  } { svelteHTML.createElement("option", { "value":`high`,});  }
           }
         }
         { svelteHTML.createElement("div", { "class":`menu-section`,});
           { svelteHTML.createElement("div", { "class":`menu-label`,});  }
           { svelteHTML.createElement("select", {       "value":props.connectionId || '',"disabled":props.disabled,"onchange":(e) => (!props.disabled && props.onChangeConnection?.(e.currentTarget.value)),"aria-label":`Connection`,});
               for(let conn of __sveltets_2_ensureArray(props.connections || [])){conn?.id || conn?.name;
               { svelteHTML.createElement("option", { "value":conn?.id || '',});conn?.name || conn?.id || 'Connection'; }
            }
           }
         }
        if(supportsOpenRouter){
           { svelteHTML.createElement("div", { "class":`menu-section`,});
             { const $$_tupnIredivorPretuoRnepO4C = __sveltets_2_ensureComponent(OpenRouterProviderInput); new $$_tupnIredivorPretuoRnepO4C({ target: __sveltets_2_any(), props: {        "value":props.openRouterProvider,"disabled":props.disabled,"active":!!props.open,"onInput":props.onInputOpenRouterProvider,}});}
           }
        }
      } else if (activeTab === 'sampling'){
         { svelteHTML.createElement("div", { "class":`menu-section`,});
           { svelteHTML.createElement("div", { "class":`menu-label`,});  }
           { svelteHTML.createElement("input", {                  "type":`number`,"min":`0`,"max":`1`,"step":`0.1`,"placeholder":`Default`,"value":props.topP ?? '',"disabled":props.disabled,"oninput":(e) => (!props.disabled && props.onInputTopP?.(e.currentTarget.value)),"aria-label":`top_p`,});}
         }
         { svelteHTML.createElement("div", { "class":`menu-section`,});
           { svelteHTML.createElement("div", { "class":`menu-label`,});  }
           { svelteHTML.createElement("input", {                  "type":`number`,"min":`0`,"max":`2`,"step":`0.1`,"placeholder":`Default`,"value":props.temperature ?? '',"disabled":props.disabled,"oninput":(e) => (!props.disabled && props.onInputTemperature?.(e.currentTarget.value)),"aria-label":`Temperature`,});}
         }
      } else if (activeTab === 'reasoning'){
         { svelteHTML.createElement("div", { "class":`menu-section`,});
           { svelteHTML.createElement("div", { "class":`menu-label`,});  }
           { svelteHTML.createElement("select", {       "value":props.reasoningEffort || 'default',"disabled":props.disabled,"onchange":(e) => (!props.disabled && props.onInputReasoningEffort?.(e.currentTarget.value)),"aria-label":`Reasoning effort`,});
             { svelteHTML.createElement("option", { "value":`default`,});  } { svelteHTML.createElement("option", { "value":`none`,});  } { svelteHTML.createElement("option", { "value":`minimal`,});  } { svelteHTML.createElement("option", { "value":`low`,});  }
             { svelteHTML.createElement("option", { "value":`medium`,});  } { svelteHTML.createElement("option", { "value":`high`,});  } { svelteHTML.createElement("option", { "value":`xhigh`,});  }
           }
         }
         { svelteHTML.createElement("div", { "class":`menu-section`,});
           { svelteHTML.createElement("div", { "class":`menu-label`,});  }
           { svelteHTML.createElement("select", {       "value":props.reasoningSummary || 'auto',"disabled":props.disabled,"onchange":(e) => (!props.disabled && props.onInputReasoningSummary?.(e.currentTarget.value)),"aria-label":`Reasoning summary`,});
             { svelteHTML.createElement("option", { "value":`none`,});  } { svelteHTML.createElement("option", { "value":`auto`,});  }
             { svelteHTML.createElement("option", { "value":`concise`,});  } { svelteHTML.createElement("option", { "value":`detailed`,});  }
           }
         }
        if(props.showThinkingControls){
           { svelteHTML.createElement("div", { "class":`menu-section`,});
             { svelteHTML.createElement("label", {   "class":`ui-switch`,"title":`Enable Anthropic thinking`,});
               { svelteHTML.createElement("input", {          "type":`checkbox`,"checked":!!props.thinkingEnabled,"disabled":props.disabled,"onchange":(e) => (!props.disabled && props.onInputThinkingEnabled?.(e.currentTarget.checked)),"aria-label":`Enable Anthropic thinking`,});}
               { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
               { svelteHTML.createElement("span", { "class":`ui-switch-label`,});  }
             }
             { svelteHTML.createElement("input", {                "type":`number`,"min":`1`,"step":`100`,"placeholder":`Budget tokens`,"value":props.thinkingBudgetTokens ?? '',"disabled":props.disabled || !props.thinkingEnabled,"oninput":(e) => (!props.disabled && props.onInputThinkingBudgetTokens?.(e.currentTarget.value)),"aria-label":`Thinking budget tokens`,});}
           }
        }
      }
     }
    
     { svelteHTML.createElement("div", {   "class":`settings-tabs`,"role":`tablist`,});
       { svelteHTML.createElement("button", {       "class":`settings-tab ${activeTab === 'general' ? 'active' : ''}`,"role":`tab`,"aria-selected":activeTab === 'general',"onclick":() => activeTab = 'general',});  }
       { svelteHTML.createElement("button", {       "class":`settings-tab ${activeTab === 'sampling' ? 'active' : ''}`,"role":`tab`,"aria-selected":activeTab === 'sampling',"onclick":() => activeTab = 'sampling',});  }
       { svelteHTML.createElement("button", {       "class":`settings-tab ${activeTab === 'reasoning' ? 'active' : ''}`,"role":`tab`,"aria-selected":activeTab === 'reasoning',"onclick":() => activeTab = 'reasoning',});  }
     }
    
     { svelteHTML.createElement("div", { "class":`menu-section`,});
       { svelteHTML.createElement("div", { "class":`menu-label`,});  }
       { svelteHTML.createElement("div", { "class":`model-input-wrapper`,});
         { svelteHTML.createElement("input", {              "type":`text`,"placeholder":DEFAULT_MODEL,"value":props.model,"disabled":props.disabled,"oninput":(e) => (!props.disabled && props.onInputModel?.(e.currentTarget.value)),"list":modelDatalistId,"aria-label":`Model`,});}
        if(Array.isArray(props.presets) && props.presets.length > 0){
           { svelteHTML.createElement("div", { "class":`preset-toggle-wrapper`,});
             { const $$_button5 = svelteHTML.createElement("button", {            "type":`button`,"class":`preset-toggle-btn`,"onclick":togglePresetMenu,"disabled":props.disabled,"aria-label":`Switch preset`,"title":`Switch preset`,});presetButtonEl = $$_button5;
               { const $$_sreyaLnocI6C = __sveltets_2_ensureComponent(IconLayers); new $$_sreyaLnocI6C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
             }
           }
        }
       }
      if(props.modelIds?.length){
         { svelteHTML.createElement("datalist", { "id":modelDatalistId,});
            for(let mid of __sveltets_2_ensureArray(props.modelIds)){ { svelteHTML.createElement("option", { "value":mid,});mid; }}
         }
      }
     }
   }
 }

if(presetMenuOpen){
   { const $$_div0 = svelteHTML.createElement("div", {      "class":`preset-menu`,"aria-label":`Choose preset`,"style":`bottom: ${presetMenuPosition.bottom}px; left: ${presetMenuPosition.left}px;`,});presetMenuEl = $$_div0;
       for(let preset of __sveltets_2_ensureArray(props.presets || [])){preset.id || preset.name;
       { svelteHTML.createElement("button", {     "type":`button`,"class":`preset-menu-item`,"onclick":() => selectPreset(preset),});
         { svelteHTML.createElement("span", { "class":`preset-menu-name`,});preset?.name || 'Preset'; }
         { svelteHTML.createElement("span", { "class":`preset-menu-model`,});preset?.model || ''; }
       }
    }
   }
}

if(activeToolPopup){
   { const $$_div0 = svelteHTML.createElement("div", {    "class":`tool-popup`,"style":`bottom: ${toolPopupPosition.bottom}px; left: ${toolPopupPosition.left}px;`,});toolPopupEl = $$_div0;
    if(activeToolPopup === 'codeInterpreter'){
       { svelteHTML.createElement("div", { "class":`tool-popup-content`,});
         { svelteHTML.createElement("label", { "class":`ui-switch`,});
           { svelteHTML.createElement("input", {          "type":`checkbox`,"checked":!!props.codeInterpreterNetworkEnabled,"disabled":props.disabled,"onchange":(e) => (!props.disabled && props.onInputCodeInterpreterNetworkEnabled?.(e.currentTarget.checked)),"aria-label":`Allow network`,});}
           { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
           { svelteHTML.createElement("span", { "class":`ui-switch-label`,});  }
         }
        if(props.codeInterpreterNetworkEnabled){
           { svelteHTML.createElement("input", {              "type":`text`,"placeholder":`Allowed domains (comma-separated)`,"value":props.codeInterpreterAllowedDomains || '',"disabled":props.disabled,"oninput":(e) => (!props.disabled && props.onInputCodeInterpreterAllowedDomains?.(e.currentTarget.value)),"aria-label":`Allowed domains`,"class":`tool-popup-input`,});}
           { svelteHTML.createElement("div", { "class":`tool-popup-hint`,});    }
        }
       }
    } else if (activeToolPopup === 'shell'){
       { svelteHTML.createElement("div", { "class":`tool-popup-content`,});
         { svelteHTML.createElement("label", { "class":`ui-switch`,});
           { svelteHTML.createElement("input", {          "type":`checkbox`,"checked":!!props.shellNetworkEnabled,"disabled":props.disabled,"onchange":(e) => (!props.disabled && props.onInputShellNetworkEnabled?.(e.currentTarget.checked)),"aria-label":`Allow network`,});}
           { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
           { svelteHTML.createElement("span", { "class":`ui-switch-label`,});  }
         }
        if(props.shellNetworkEnabled){
           { svelteHTML.createElement("input", {              "type":`text`,"placeholder":`Allowed domains (comma-separated)`,"value":props.shellAllowedDomains || '',"disabled":props.disabled,"oninput":(e) => (!props.disabled && props.onInputShellAllowedDomains?.(e.currentTarget.value)),"aria-label":`Allowed domains`,"class":`tool-popup-input`,});}
           { svelteHTML.createElement("div", { "class":`tool-popup-hint`,});    }
        }
       }
    } else if (activeToolPopup === 'imageGeneration'){
       { svelteHTML.createElement("div", { "class":`tool-popup-content`,});
         { svelteHTML.createElement("input", {              "type":`text`,"placeholder":`gpt-image-1`,"value":props.imageGenerationModel || '',"disabled":props.disabled,"oninput":(e) => (!props.disabled && props.onInputImageGenerationModel?.(e.currentTarget.value)),"aria-label":`Image generation model`,"class":`tool-popup-input`,});}
       }
    } else if (activeToolPopup === 'mcp'){
       { svelteHTML.createElement("div", { "class":`tool-popup-content mcp-popup`,});
        if(props.mcpServers?.length){
              for(let server of __sveltets_2_ensureArray(props.mcpServers)){let index = 1;index;
             { svelteHTML.createElement("div", { "class":`mcp-server-row`,});
               { svelteHTML.createElement("input", {              "type":`text`,"placeholder":`https://example.com/mcp`,"value":server?.url || '',"disabled":props.disabled,"oninput":(e) => updateMcpServerUrl(index, e.currentTarget.value),"aria-label":`MCP server URL ${index + 1}`,"class":`tool-popup-input`,});}
               { svelteHTML.createElement("button", {           "type":`button`,"class":`mcp-remove-btn`,"onclick":() => removeMcpServer(index),"disabled":props.disabled,"aria-label":`Remove server ${index + 1}`,"title":`Remove`,});
                 { svelteHTML.createElement("svg", {             "width":`14`,"height":`14`,"viewBox":`0 0 24 24`,"fill":`none`,"stroke":`currentColor`,"stroke-width":`2`,"stroke-linecap":`round`,});
                   { svelteHTML.createElement("line", {       "x1":`18`,"y1":`6`,"x2":`6`,"y2":`18`,}); } { svelteHTML.createElement("line", {       "x1":`6`,"y1":`6`,"x2":`18`,"y2":`18`,}); }
                 }
               }
             }
          }
        }else{
           { svelteHTML.createElement("div", { "class":`tool-popup-hint`,});   }
        }
         { svelteHTML.createElement("button", {       "type":`button`,"class":`mcp-add-btn`,"onclick":addMcpServer,"disabled":props.disabled,});   }
       }
    }
   }
}


};
return { props: {} as any as Props, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const ChatSettingsPopover__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type ChatSettingsPopover__SvelteComponent_ = ReturnType<typeof ChatSettingsPopover__SvelteComponent_>;
/*Ωignore_endΩ*/export default ChatSettingsPopover__SvelteComponent_;
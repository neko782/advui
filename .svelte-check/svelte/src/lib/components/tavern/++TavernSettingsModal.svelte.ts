///<reference types="svelte" />
;
import { IconClose, IconAdd, IconDelete, IconDownload, IconUpload, IconArrowUpward, IconArrowDownward, IconContentCopy, IconChevronRight } from '../../icons'
import {
    generatePromptPresetId,
    generatePromptBlockId,
    generatePersonaId,
    makeDefaultPromptPreset,
    exportPromptPreset,
    importPromptPreset,
  } from '../../tavern/promptPresets'
import type { Preset } from '../../types'
import type { PromptPreset, PromptBlock, PromptBlockMarker, Persona } from '../../types/tavern';
;

  type AvatarShape = 'circle' | 'rounded' | 'card';;

  interface Props {
    open?: boolean
    /** Connection presets (selection only; edited in the main Settings). */
    connectionPresets?: Preset[]
    tavernSelectedPresetId?: string
    tavernPerChatPresets?: boolean
    promptPresets?: PromptPreset[]
    selectedPromptPresetId?: string
    personas?: Persona[]
    selectedPersonaId?: string
    avatarShape?: AvatarShape
    onSave?: (data: {
      tavernSelectedPresetId: string
      tavernPerChatPresets: boolean
      promptPresets: PromptPreset[]
      selectedPromptPresetId: string
      personas: Persona[]
      selectedPersonaId: string
      tavernAvatarShape: AvatarShape
    }) => void
    onClose?: () => void
  };function $$render() {

  
  
  
  



  const props: Props = $props()

  const TABS = [
    { id: 'general', label: 'General' },
    { id: 'prompts', label: 'Prompts' },
    { id: 'personas', label: 'Personas' },
  ] as const

  let tab = $state<'general' | 'prompts' | 'personas'>('general')
  let presets = $state<PromptPreset[]>([])
  let selectedId = $state('')
  let personas = $state<Persona[]>([])
  let selectedPersonaId = $state('')
  let connectionPresetId = $state('')
  let perChatPresets = $state(false)
  let avatarShape = $state<AvatarShape>('circle')
  let expandedBlockId = $state<string | null>(null)
  let errorText = $state('')
  let wasOpen = $state(false)
  let importInput = $state<HTMLInputElement | null>(null)

  $effect(() => {
    if (props.open && !wasOpen) {
      tab = 'general'
      presets = JSON.parse(JSON.stringify(props.promptPresets || []))
      if (!presets.length) presets = [makeDefaultPromptPreset()]
      selectedId = presets.some(p => p.id === props.selectedPromptPresetId)
        ? props.selectedPromptPresetId!
        : presets[0]!.id
      personas = JSON.parse(JSON.stringify(props.personas || []))
      if (!personas.length) personas = [{ id: 'persona-default', name: 'User', description: '' }]
      selectedPersonaId = personas.some(p => p.id === props.selectedPersonaId)
        ? props.selectedPersonaId!
        : personas[0]!.id!
      connectionPresetId = props.tavernSelectedPresetId || (props.connectionPresets?.[0]?.id ?? '') || ''
      perChatPresets = !!props.tavernPerChatPresets
      avatarShape = props.avatarShape === 'rounded' || props.avatarShape === 'card' ? props.avatarShape : 'circle'
      expandedBlockId = null
      errorText = ''
    }
    wasOpen = !!props.open
  })

  // Live save (same behavior as the main Settings modal): persist every change
  // immediately, no Save/Cancel buttons.
  let persistInitialized = $state(false)
  let lastPersistSig = $state('')
  $effect(() => {
    const sig = JSON.stringify({
      presets, selectedId, personas, selectedPersonaId,
      connectionPresetId, perChatPresets, avatarShape,
    })
    if (!props.open) {
      persistInitialized = false
      lastPersistSig = ''
      return
    }
    if (!persistInitialized) {
      persistInitialized = true
      lastPersistSig = sig
      return
    }
    if (sig === lastPersistSig) return
    lastPersistSig = sig
    props.onSave?.({
      tavernSelectedPresetId: connectionPresetId,
      tavernPerChatPresets: perChatPresets,
      promptPresets: JSON.parse(JSON.stringify(presets)),
      selectedPromptPresetId: selectedId,
      personas: JSON.parse(JSON.stringify(personas)),
      selectedPersonaId,
      tavernAvatarShape: avatarShape,
    })
  })

  const current = $derived(presets.find(p => p.id === selectedId) || presets[0] || null)

  const MARKER_LABELS: Record<PromptBlockMarker, string> = {
    chatHistory: 'Chat History',
    charDescription: 'Character Description',
    persona: 'Persona',
  }

  const MARKER_HINTS: Record<PromptBlockMarker, string> = {
    chatHistory: 'Chat messages go here. Blocks below become post-history instructions.',
    charDescription: "Filled with the character's description, personality, scenario and example dialogue.",
    persona: 'Filled with your active persona description.',
  }

  // ----- prompt preset helpers -----

  function updateCurrent(mutate: (preset: PromptPreset) => PromptPreset) {
    if (!current) return
    presets = presets.map(p => (p.id === current.id ? mutate(p) : p))
  }

  function updateBlock(blockId: string, patch: Partial<PromptBlock>) {
    updateCurrent(preset => ({
      ...preset,
      blocks: preset.blocks.map(b => (b.id === blockId ? { ...b, ...patch } : b)),
    }))
  }

  function moveBlock(blockId: string, delta: number) {
    updateCurrent(preset => {
      const index = preset.blocks.findIndex(b => b.id === blockId)
      const target = index + delta
      if (index < 0 || target < 0 || target >= preset.blocks.length) return preset
      const blocks = preset.blocks.slice()
      const [moved] = blocks.splice(index, 1)
      if (moved) blocks.splice(target, 0, moved)
      return { ...preset, blocks }
    })
  }

  function removeBlock(blockId: string) {
    if (expandedBlockId === blockId) expandedBlockId = null
    updateCurrent(preset => ({
      ...preset,
      blocks: preset.blocks.filter(b => b.id !== blockId),
    }))
  }

  function addBlock() {
    const id = generatePromptBlockId()
    updateCurrent(preset => ({
      ...preset,
      blocks: [...preset.blocks, { id, name: 'New block', role: 'system', content: '', enabled: true }],
    }))
    expandedBlockId = id
  }

  function addMarker(marker: PromptBlockMarker) {
    updateCurrent(preset => ({
      ...preset,
      blocks: [...preset.blocks, {
        id: generatePromptBlockId(),
        name: MARKER_LABELS[marker],
        role: 'system',
        content: '',
        enabled: true,
        marker,
      }],
    }))
  }

  function toggleExpand(block: PromptBlock) {
    expandedBlockId = expandedBlockId === block.id ? null : block.id
  }

  const missingMarkers = $derived.by(() => {
    const existing = new Set((current?.blocks || []).map(b => b.marker).filter(Boolean))
    return (Object.keys(MARKER_LABELS) as PromptBlockMarker[]).filter(m => !existing.has(m))
  })

  function addPreset() {
    const preset: PromptPreset = { ...makeDefaultPromptPreset(), id: generatePromptPresetId(), name: `Prompt ${presets.length + 1}` }
    presets = [...presets, preset]
    selectedId = preset.id
  }

  function duplicatePreset() {
    if (!current) return
    const copy: PromptPreset = JSON.parse(JSON.stringify(current))
    copy.id = generatePromptPresetId()
    copy.name = `${current.name} (copy)`
    copy.blocks = copy.blocks.map(b => ({ ...b, id: generatePromptBlockId() }))
    presets = [...presets, copy]
    selectedId = copy.id
  }

  function deletePreset() {
    if (!current || presets.length <= 1) return
    const id = current.id
    presets = presets.filter(p => p.id !== id)
    selectedId = presets[0]?.id || ''
  }

  function handleExport() {
    if (!current) return
    const blob = new Blob([exportPromptPreset(current)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(current.name || 'prompt-preset').replace(/[^\w\- ]+/g, '').trim() || 'prompt-preset'}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  async function handleImportFile(event: Event) {
    const target = event.target as HTMLInputElement
    const file = target.files?.[0]
    target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const preset = importPromptPreset(text)
      presets = [...presets, preset]
      selectedId = preset.id
      errorText = ''
    } catch (err) {
      errorText = err instanceof Error ? err.message : 'Failed to import prompt preset.'
    }
  }

  // ----- persona helpers -----

  function addPersona() {
    const persona: Persona = { id: generatePersonaId(), name: `Persona ${personas.length + 1}`, description: '' }
    personas = [...personas, persona]
    selectedPersonaId = persona.id!
  }

  function updatePersona(id: string, patch: Partial<Persona>) {
    personas = personas.map(p => (p.id === id ? { ...p, ...patch } : p))
  }

  function deletePersona(id: string) {
    if (personas.length <= 1) return
    personas = personas.filter(p => p.id !== id)
    if (selectedPersonaId === id) selectedPersonaId = personas[0]?.id || ''
  }

;
async () => {

 { svelteHTML.createElement("svelte:window", {  "onkeydown":(e) => { if (props.open && e.key === 'Escape') props.onClose?.() },});}

if(props.open){
   { svelteHTML.createElement("button", {       "type":`button`,"class":`ui-backdrop`,"aria-label":`Close tavern settings overlay`,"onclick":() => props.onClose?.(),}); }
   { svelteHTML.createElement("div", {             "class":`ui-modal`,"role":`dialog`,"aria-modal":`true`,"aria-label":`Tavern settings`,"tabindex":-1,"onpointerdown":(event) => { if (event.target === event.currentTarget) props.onClose?.() },});
     { svelteHTML.createElement("div", { "class":`ui-panel ui-panel-full panel`,});
       { svelteHTML.createElement("header", { "class":`ui-modal-head`,});
         { svelteHTML.createElement("div", { "class":`ui-modal-title`,});  }
         { svelteHTML.createElement("button", {     "class":`ui-icon-btn`,"onclick":() => props.onClose?.(),"aria-label":`Close`,});
           { const $$_esolCnocI4C = __sveltets_2_ensureComponent(IconClose); new $$_esolCnocI4C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
         }
       }
       { svelteHTML.createElement("div", {     "class":`ui-tab-bar`,"role":`tablist`,"aria-label":`Tavern settings sections`,});
         { svelteHTML.createElement("div", { "class":`ui-segmented`,});
           for(let t of __sveltets_2_ensureArray(TABS)){t.id;
           { svelteHTML.createElement("button", {           "type":`button`,"role":`tab`,"class":`ui-segment ${t.id === tab ? 'active' : ''}`,"aria-selected":t.id === tab,"onclick":() => (tab = t.id),});
            t.label;
           }
        }
         }
       }
       { svelteHTML.createElement("div", {   "class":`ui-modal-body`,"role":`tabpanel`,});
         { svelteHTML.createElement("div", { "class":`ui-modal-scroller`,});
          if(tab === 'general'){
             { svelteHTML.createElement("div", { "class":`ui-group`,});
               { svelteHTML.createElement("div", { "class":`ui-group-title`,});  }
               { svelteHTML.createElement("div", { "class":`ui-field`,});
                 { svelteHTML.createElement("span", { "class":`ui-field-label`,});perChatPresets ? 'Preset for new tavern chats' : 'Preset for all tavern chats'; }
                 { svelteHTML.createElement("select", {       "class":`ui-select`,"value":connectionPresetId,"onchange":(e) => (connectionPresetId = e.currentTarget.value),"aria-label":`Tavern preset`,});
                     for(let preset of __sveltets_2_ensureArray(props.connectionPresets || [])){preset.id;
                     { svelteHTML.createElement("option", { "value":preset.id,});preset.name || 'Preset';preset.model ? ` — ${preset.model}` : ''; }
                  }
                 }
               }
               { svelteHTML.createElement("label", { "class":`ui-switch`,});
                 { svelteHTML.createElement("input", {        "type":`checkbox`,"checked":perChatPresets,"onchange":(e) => (perChatPresets = e.currentTarget.checked),"style":`display: none;`,});}
                 { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,...__sveltets_2_empty({"data-on":perChatPresets}),}); }
                 { svelteHTML.createElement("span", { "class":`ui-switch-label`,});     }
               }
              if(perChatPresets){
                 { svelteHTML.createElement("div", { "class":`ui-hint`,});                            }
              }else{
                 { svelteHTML.createElement("div", { "class":`ui-hint`,});                           }
              }
             }

             { svelteHTML.createElement("div", { "class":`ui-group`,});
               { svelteHTML.createElement("div", { "class":`ui-group-title`,});  }
               { svelteHTML.createElement("div", { "class":`ui-field`,});
                 { svelteHTML.createElement("span", { "class":`ui-field-label`,});   }
                 { svelteHTML.createElement("div", {     "class":`shape-switch`,"role":`radiogroup`,"aria-label":`Avatar shape`,});
                   { svelteHTML.createElement("button", {         "type":`button`,"class":`shape-option ${avatarShape === 'circle' ? 'active' : ''}`,"role":`radio`,"aria-checked":avatarShape === 'circle',"onclick":() => (avatarShape = 'circle'),});
                     { svelteHTML.createElement("span", { "class":`shape-preview circle`,}); } 
                   }
                   { svelteHTML.createElement("button", {         "type":`button`,"class":`shape-option ${avatarShape === 'rounded' ? 'active' : ''}`,"role":`radio`,"aria-checked":avatarShape === 'rounded',"onclick":() => (avatarShape = 'rounded'),});
                     { svelteHTML.createElement("span", { "class":`shape-preview rounded`,}); } 
                   }
                   { svelteHTML.createElement("button", {         "type":`button`,"class":`shape-option ${avatarShape === 'card' ? 'active' : ''}`,"role":`radio`,"aria-checked":avatarShape === 'card',"onclick":() => (avatarShape = 'card'),});
                     { svelteHTML.createElement("span", { "class":`shape-preview card`,}); }  
                   }
                 }
                 { svelteHTML.createElement("div", { "class":`ui-hint`,});         }
               }
             }
          } else if (tab === 'prompts'){
             { svelteHTML.createElement("div", { "class":`ui-group`,});
               { svelteHTML.createElement("div", { "class":`ui-group-head`,});
                 { svelteHTML.createElement("div", { "class":`ui-group-title`,});  }
                 { svelteHTML.createElement("div", { "class":`ui-row`,});
                   { svelteHTML.createElement("button", {       "type":`button`,"class":`ui-icon-btn ui-icon-btn-sm`,"title":`New preset`,"onclick":addPreset,}); { const $$_ddAnocI8C = __sveltets_2_ensureComponent(IconAdd); new $$_ddAnocI8C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});} }
                   { svelteHTML.createElement("button", {       "type":`button`,"class":`ui-icon-btn ui-icon-btn-sm`,"title":`Duplicate preset`,"onclick":duplicatePreset,}); { const $$_ypoCtnetnoCnocI8C = __sveltets_2_ensureComponent(IconContentCopy); new $$_ypoCtnetnoCnocI8C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});} }
                   { svelteHTML.createElement("button", {       "type":`button`,"class":`ui-icon-btn ui-icon-btn-sm`,"title":`Import (shareable JSON)`,"onclick":() => importInput?.click(),}); { const $$_daolpUnocI8C = __sveltets_2_ensureComponent(IconUpload); new $$_daolpUnocI8C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});} }
                   { svelteHTML.createElement("button", {       "type":`button`,"class":`ui-icon-btn ui-icon-btn-sm`,"title":`Export (shareable JSON)`,"onclick":handleExport,}); { const $$_daolnwoDnocI8C = __sveltets_2_ensureComponent(IconDownload); new $$_daolnwoDnocI8C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});} }
                   { svelteHTML.createElement("button", {         "type":`button`,"class":`ui-icon-btn ui-icon-btn-sm danger`,"title":`Delete preset`,"disabled":presets.length <= 1,"onclick":deletePreset,}); { const $$_eteleDnocI8C = __sveltets_2_ensureComponent(IconDelete); new $$_eteleDnocI8C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});} }
                   { const $$_input7 = svelteHTML.createElement("input", {         "type":`file`,"accept":`.json,application/json`,"onchange":handleImportFile,"style":`display: none;`,});importInput = $$_input7;}
                 }
               }
               { svelteHTML.createElement("div", { "class":`ui-row`,});
                 { svelteHTML.createElement("select", {       "class":`ui-select`,"value":selectedId,"onchange":(e) => (selectedId = e.currentTarget.value),"aria-label":`Prompt preset`,});
                     for(let preset of __sveltets_2_ensureArray(presets)){preset.id;
                     { svelteHTML.createElement("option", { "value":preset.id,});preset.name; }
                  }
                 }
               }
              if(current){
                 { svelteHTML.createElement("div", { "class":`ui-field`,});
                   { svelteHTML.createElement("span", { "class":`ui-field-label`,});  }
                   { svelteHTML.createElement("input", {        "class":`ui-input`,"value":current.name,"oninput":(e) => updateCurrent(p => ({ ...p, name: e.currentTarget.value })),"aria-label":`Preset name`,});}
                 }
              }
               { svelteHTML.createElement("div", { "class":`ui-hint`,});          }
             }

            if(current){
               { svelteHTML.createElement("div", { "class":`ui-group`,});
                 { svelteHTML.createElement("div", { "class":`ui-group-title`,});   }
                 { svelteHTML.createElement("div", { "class":`blocks`,});
                      for(let block of __sveltets_2_ensureArray(current.blocks)){let index = 1;block.id;
                     { svelteHTML.createElement("div", { "class":`block ${block.enabled ? '' : 'disabled'} ${block.marker ? 'marker' : ''} ${expandedBlockId === block.id ? 'open' : ''}`,});
                       { svelteHTML.createElement("div", { "class":`block-head`,});
                         { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":block.enabled,"onchange":(e) => updateBlock(block.id, { enabled: e.currentTarget.checked }),"aria-label":`Enable block`,});}
                         { svelteHTML.createElement("button", {       "type":`button`,"class":`block-title`,"onclick":() => toggleExpand(block),"aria-expanded":expandedBlockId === block.id,});
                           { const $$_thgiRnorvehCnocI9C = __sveltets_2_ensureComponent(IconChevronRight); new $$_thgiRnorvehCnocI9C({ target: __sveltets_2_any(), props: {  "style":`font-size: 16px;`,}});}
                           { svelteHTML.createElement("span", { "class":`block-name`,});block.marker ? MARKER_LABELS[block.marker] : (block.name || 'Block'); }
                          if(block.marker){
                             { svelteHTML.createElement("span", { "class":`ui-item-badge neutral`,});  }
                          }else{
                             { svelteHTML.createElement("span", { "class":`ui-item-badge`,});block.role; }
                          }
                         }
                         { svelteHTML.createElement("div", { "class":`block-actions`,});
                           { svelteHTML.createElement("button", {         "type":`button`,"class":`ui-icon-btn ui-icon-btn-sm`,"title":`Move up`,"disabled":index === 0,"onclick":() => moveBlock(block.id, -1),}); { const $$_drawpUworrAnocI10C = __sveltets_2_ensureComponent(IconArrowUpward); new $$_drawpUworrAnocI10C({ target: __sveltets_2_any(), props: {  "style":`font-size: 15px;`,}});} }
                           { svelteHTML.createElement("button", {         "type":`button`,"class":`ui-icon-btn ui-icon-btn-sm`,"title":`Move down`,"disabled":index === current.blocks.length - 1,"onclick":() => moveBlock(block.id, 1),}); { const $$_drawnwoDworrAnocI10C = __sveltets_2_ensureComponent(IconArrowDownward); new $$_drawnwoDworrAnocI10C({ target: __sveltets_2_any(), props: {  "style":`font-size: 15px;`,}});} }
                           { svelteHTML.createElement("button", {       "type":`button`,"class":`ui-icon-btn ui-icon-btn-sm danger`,"title":`Delete block`,"onclick":() => removeBlock(block.id),}); { const $$_eteleDnocI10C = __sveltets_2_ensureComponent(IconDelete); new $$_eteleDnocI10C({ target: __sveltets_2_any(), props: {  "style":`font-size: 15px;`,}});} }
                         }
                       }
                      if(expandedBlockId === block.id){
                         { svelteHTML.createElement("div", { "class":`block-body`,});
                          if(block.marker){
                             { svelteHTML.createElement("div", { "class":`ui-hint`,});MARKER_HINTS[block.marker]; }
                          }else{
                             { svelteHTML.createElement("div", { "class":`ui-row`,});
                               { svelteHTML.createElement("input", {          "class":`ui-input`,"value":block.name,"oninput":(e) => updateBlock(block.id, { name: e.currentTarget.value }),"aria-label":`Block name`,"placeholder":`Block name`,});}
                               { svelteHTML.createElement("select", {       "class":`ui-select`,"value":block.role,"onchange":(e) => updateBlock(block.id, { role: e.currentTarget.value as PromptBlock['role'] }),"aria-label":`Block role`,});
                                 { svelteHTML.createElement("option", { "value":`system`,});  }
                                 { svelteHTML.createElement("option", { "value":`user`,});  }
                                 { svelteHTML.createElement("option", { "value":`assistant`,});  }
                               }
                             }
                             { svelteHTML.createElement("textarea", {         "class":`ui-textarea`,"value":block.content,"oninput":(e) => updateBlock(block.id, { content: e.currentTarget.value }),"placeholder":'Prompt text... supports {{char}}, {{user}}, {{persona}}, {{description}}',}); }
                          }
                         }
                      }
                     }
                  }
                 }
                 { svelteHTML.createElement("div", { "class":`ui-row`,});
                   { svelteHTML.createElement("button", {     "type":`button`,"class":`ui-btn ui-btn-accent`,"onclick":addBlock,}); { const $$_ddAnocI7C = __sveltets_2_ensureComponent(IconAdd); new $$_ddAnocI7C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}  }
                     for(let marker of __sveltets_2_ensureArray(missingMarkers)){marker;
                     { svelteHTML.createElement("button", {     "type":`button`,"class":`ui-btn ui-btn-accent`,"onclick":() => addMarker(marker),}); { const $$_ddAnocI7C = __sveltets_2_ensureComponent(IconAdd); new $$_ddAnocI7C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});} MARKER_LABELS[marker]; }
                  }
                 }
               }
            }
          }else{
             { svelteHTML.createElement("div", { "class":`ui-group`,});
               { svelteHTML.createElement("div", { "class":`ui-group-head`,});
                 { svelteHTML.createElement("div", { "class":`ui-group-title`,});  }
                 { svelteHTML.createElement("button", {     "type":`button`,"class":`ui-btn ui-btn-accent`,"onclick":addPersona,}); { const $$_ddAnocI7C = __sveltets_2_ensureComponent(IconAdd); new $$_ddAnocI7C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}  }
               }
               { svelteHTML.createElement("div", { "class":`ui-hint`,});    '{{user}}';       }
               { svelteHTML.createElement("div", { "class":`personas`,});
                   for(let persona of __sveltets_2_ensureArray(personas)){persona.id;
                   { svelteHTML.createElement("div", { "class":`persona ${selectedPersonaId === persona.id ? 'active' : ''}`,});
                     { svelteHTML.createElement("div", { "class":`persona-head`,});
                       { svelteHTML.createElement("input", {          "class":`ui-input`,"value":persona.name,"oninput":(e) => updatePersona(persona.id!, { name: e.currentTarget.value }),"aria-label":`Persona name`,"placeholder":`Name`,});}
                       { svelteHTML.createElement("label", {   "class":`active-toggle`,"title":`Use this persona as ${'{{user}}'}`,});
                         { svelteHTML.createElement("input", {         "type":`radio`,"name":`active-persona`,"checked":selectedPersonaId === persona.id,"onchange":() => (selectedPersonaId = persona.id!),});}
                         { svelteHTML.createElement("span", {});  }
                       }
                       { svelteHTML.createElement("button", {         "type":`button`,"class":`ui-icon-btn ui-icon-btn-sm danger`,"title":`Delete persona`,"disabled":personas.length <= 1,"onclick":() => deletePersona(persona.id!),}); { const $$_eteleDnocI9C = __sveltets_2_ensureComponent(IconDelete); new $$_eteleDnocI9C({ target: __sveltets_2_any(), props: {  "style":`font-size: 15px;`,}});} }
                     }
                     { svelteHTML.createElement("textarea", {         "class":`ui-textarea`,"value":persona.description,"oninput":(e) => updatePersona(persona.id!, { description: e.currentTarget.value }),"placeholder":'Who {{user}} is... (injected via the Persona block)',}); }
                   }
                }
               }
             }
          }

          if(errorText){
             { svelteHTML.createElement("div", { "class":`ui-error-text`,});errorText; }
          }
         }
       }
     }
   }
}


};
return { props: {} as any as Props, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const TavernSettingsModal__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type TavernSettingsModal__SvelteComponent_ = ReturnType<typeof TavernSettingsModal__SvelteComponent_>;
/*Ωignore_endΩ*/export default TavernSettingsModal__SvelteComponent_;
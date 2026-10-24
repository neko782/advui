///<reference types="svelte" />
;
import { IconClose, IconAdd, IconDelete, IconDownload, IconPerson, IconCollapseContent } from '../../icons'
import ConfirmModal from '../ConfirmModal.svelte'
import { exportCharacterCard } from '../../tavern/characterCard'
import type { Character } from '../../types/tavern';
;

  interface Props {
    open?: boolean
    character?: Character | null
    canDelete?: boolean
    onSave?: (character: Character) => void
    onDelete?: (id: string) => Promise<void> | void
    onCancel?: () => void
  };;

  type SectionId = 'description' | 'greetings' | 'behavior' | 'overrides' | 'meta';function $$render() {

  
  
  
  


  const props: Props = $props()


  let draft = $state<Character | null>(null)
  let tagsText = $state('')
  let avatarInput = $state<HTMLInputElement | null>(null)
  let errorText = $state('')
  let lastLoadedKey = $state('')
  let activeSection = $state<SectionId>('description')
  let deleteConfirmOpen = $state(false)
  let modalEl = $state<HTMLDivElement | null>(null)
  let scrollerEl = $state<HTMLDivElement | null>(null)
  let tabsEl = $state<HTMLElement | null>(null)

  // Re-seed the draft whenever the modal opens for a (possibly different) character
  $effect(() => {
    if (!props.open) {
      lastLoadedKey = ''
      deleteConfirmOpen = false
      return
    }
    const source = props.character
    const key = source ? source.id : 'new'
    if (lastLoadedKey === key) return
    lastLoadedKey = key
    errorText = ''
    deleteConfirmOpen = false
    activeSection = 'description'
    draft = source
      ? { ...source, alternateGreetings: [...(source.alternateGreetings || [])], tags: [...(source.tags || [])] }
      : null
    tagsText = source ? (source.tags || []).join(', ') : ''
  })

  function selectSection(id: SectionId, event: MouseEvent) {
    const changed = activeSection !== id
    activeSection = id
    // Center the tapped bubble by scrolling ONLY the tab strip horizontally,
    // so the tap never drags the vertical scroll position around.
    const btn = event.currentTarget as HTMLElement | null
    if (btn && tabsEl) {
      const left = btn.offsetLeft - (tabsEl.clientWidth - btn.offsetWidth) / 2
      tabsEl.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
    }
    // Section content swapped underneath: reset to the top so the view never
    // lands on a random mid-scroll position of the new content.
    if (changed && scrollerEl) scrollerEl.scrollTo({ top: 0 })
  }

  // Keep the modal pinned to the *visual* viewport so the on-screen keyboard
  // resizes the panel instead of letting the browser scroll the page.
  $effect(() => {
    if (!props.open) return
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      if (!modalEl) return
      modalEl.style.setProperty('--vv-height', `${Math.round(vv.height)}px`)
      modalEl.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`)
      // The inner scroller owns all scrolling; keep the page itself pinned.
      if (window.scrollY !== 0) window.scrollTo(0, 0)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      if (modalEl) {
        modalEl.style.removeProperty('--vv-height')
        modalEl.style.removeProperty('--vv-top')
      }
    }
  })

  // On mobile a focused textarea takes over the whole modal body (CSS
  // :focus-within), so no scrolling ever happens while typing. This state
  // just drives the floating "collapse" button.
  let fieldExpanded = $state(false)

  function handleFocusIn(event: FocusEvent) {
    if (event.target instanceof HTMLTextAreaElement) fieldExpanded = true
  }

  function handleFocusOut(event: FocusEvent) {
    if (!(event.relatedTarget instanceof HTMLTextAreaElement)) fieldExpanded = false
  }

  function collapseField() {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
    fieldExpanded = false
  }

  function updateField<K extends keyof Character>(key: K, value: Character[K]) {
    if (!draft) return
    draft = { ...draft, [key]: value }
  }

  function addGreeting() {
    if (!draft) return
    draft = { ...draft, alternateGreetings: [...draft.alternateGreetings, ''] }
  }

  function updateGreeting(index: number, value: string) {
    if (!draft) return
    const next = draft.alternateGreetings.slice()
    next[index] = value
    draft = { ...draft, alternateGreetings: next }
  }

  function removeGreeting(index: number) {
    if (!draft) return
    draft = { ...draft, alternateGreetings: draft.alternateGreetings.filter((_, i) => i !== index) }
  }

  function handleAvatarChange(event: Event) {
    const target = event.target as HTMLInputElement
    const file = target.files?.[0]
    target.value = ''
    if (!file || !draft) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') updateField('avatar', reader.result)
    }
    reader.readAsDataURL(file)
  }

  function applyTags(base: Character): Character {
    return {
      ...base,
      tags: tagsText.split(',').map(t => t.trim()).filter(Boolean),
    }
  }

  function handleExport() {
    if (!draft) return
    try {
      const { blob, filename } = exportCharacterCard(applyTags(draft))
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (err) {
      errorText = err instanceof Error ? err.message : 'Failed to export card.'
    }
  }

  function handleSave() {
    if (!draft) return
    if (!draft.name.trim()) {
      errorText = 'Name is required.'
      return
    }
    props.onSave?.(applyTags({ ...draft, name: draft.name.trim() }))
  }

  async function handleDelete() {
    if (!draft || !props.canDelete) return
    deleteConfirmOpen = false
    await props.onDelete?.(draft.id)
  }

  const sections: Array<{ id: SectionId; label: string }> = [
    { id: 'description', label: 'Description' },
    { id: 'greetings', label: 'Greetings' },
    { id: 'behavior', label: 'Personality & Scenario' },
    { id: 'overrides', label: 'Prompt overrides' },
    { id: 'meta', label: 'Creator & tags' },
  ]
;
async () => {

 { svelteHTML.createElement("svelte:window", {  "onkeydown":(e) => { if (props.open && !deleteConfirmOpen && e.key === 'Escape') props.onCancel?.() },});}

if(props.open && draft){
   { svelteHTML.createElement("button", {       "type":`button`,"class":`ui-backdrop`,"aria-label":`Close character editor overlay`,"onclick":() => props.onCancel?.(),}); }
   { const $$_div0 = svelteHTML.createElement("div", {              "class":`ui-modal modal`,"role":`dialog`,"aria-modal":`true`,"aria-labelledby":`char-editor-title`,"tabindex":-1,"onpointerdown":(event) => { if (event.target === event.currentTarget) props.onCancel?.() },});modalEl = $$_div0;
     { svelteHTML.createElement("div", { "class":`ui-panel ui-panel-full panel`,});
       { svelteHTML.createElement("header", { "class":`ui-modal-head`,});
         { svelteHTML.createElement("div", {   "id":`char-editor-title`,"class":`ui-modal-title`,});  }
         { svelteHTML.createElement("button", {       "type":`button`,"class":`ui-icon-btn`,"aria-label":`Close`,"onclick":() => props.onCancel?.(),});
           { const $$_esolCnocI4C = __sveltets_2_ensureComponent(IconClose); new $$_esolCnocI4C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
         }
       }

       { svelteHTML.createElement("div", { "class":`ui-modal-body modal-body`,});
         { const $$_div3 = svelteHTML.createElement("div", {      "class":`ui-modal-scroller modal-scroller`,"onfocusin":handleFocusIn,"onfocusout":handleFocusOut,});scrollerEl = $$_div3;
          
           { svelteHTML.createElement("div", { "class":`identity`,});
             { svelteHTML.createElement("button", {         "type":`button`,"class":`avatar-wrap`,"title":`Change avatar`,"aria-label":`Change avatar`,"onclick":() => avatarInput?.click(),});
              if(draft.avatar){
                 { svelteHTML.createElement("img", {      "class":`avatar`,"src":draft.avatar,"alt":draft.name || 'Avatar',});}
              }else{
                 { svelteHTML.createElement("div", { "class":`avatar placeholder`,}); { const $$_nosrePnocI7C = __sveltets_2_ensureComponent(IconPerson); new $$_nosrePnocI7C({ target: __sveltets_2_any(), props: {  "style":`font-size: 32px;`,}});} }
              }
               { svelteHTML.createElement("span", { "class":`avatar-hint`,});  }
             }
             { const $$_input5 = svelteHTML.createElement("input", {         "type":`file`,"accept":`image/png,image/jpeg,image/webp`,"onchange":handleAvatarChange,"style":`display: none;`,});avatarInput = $$_input5;}
             { svelteHTML.createElement("div", { "class":`identity-fields`,});
               { svelteHTML.createElement("input", {          "class":`ui-input name-input`,"value":draft.name,"oninput":(e) => updateField('name', e.currentTarget.value),"placeholder":`Name`,"aria-label":`Name`,});}
               { svelteHTML.createElement("input", {          "class":`ui-input`,"value":draft.nickname,"oninput":(e) => updateField('nickname', e.currentTarget.value),"placeholder":'Nickname — replaces {{char}} (optional)',"aria-label":`Nickname`,});}
             }
           }

          
           { const $$_div4 = svelteHTML.createElement("div", {      "class":`section-tabs`,"role":`tablist`,"aria-label":`Character sections`,});tabsEl = $$_div4;
               for(let section of __sveltets_2_ensureArray(sections)){section.id;
               { svelteHTML.createElement("button", {           "type":`button`,"class":`tab-bubble ${activeSection === section.id ? 'active' : ''}`,"role":`tab`,"aria-selected":activeSection === section.id,"onclick":(e) => selectSection(section.id, e),});section.label; }
            }
           }

           { svelteHTML.createElement("div", {   "class":`section-body`,"role":`tabpanel`,});
            if(activeSection === 'description'){
               { svelteHTML.createElement("label", { "class":`ui-field`,});
                 { svelteHTML.createElement("span", { "class":`ui-field-label`,});  }
                 { svelteHTML.createElement("textarea", {         "class":`ui-textarea tall`,"value":draft.description,"oninput":(e) => updateField('description', e.currentTarget.value),"placeholder":'Who {{char}} is...',"aria-label":`Description`,}); }
               }
            } else if (activeSection === 'greetings'){
               { svelteHTML.createElement("label", { "class":`ui-field`,});
                 { svelteHTML.createElement("span", { "class":`ui-field-label`,});  }
                 { svelteHTML.createElement("textarea", {     "class":`ui-textarea`,"value":draft.firstMes,"oninput":(e) => updateField('firstMes', e.currentTarget.value),}); }
               }
                  for(let greeting of __sveltets_2_ensureArray(draft.alternateGreetings)){let index = 1;index;
                 { svelteHTML.createElement("div", { "class":`greeting-row`,});
                   { svelteHTML.createElement("textarea", {       "class":`ui-textarea`,"value":greeting,"oninput":(e) => updateGreeting(index, e.currentTarget.value),"placeholder":`Alternate greeting ${index + 1}`,}); }
                   { svelteHTML.createElement("button", {       "type":`button`,"class":`ui-icon-btn ui-icon-btn-sm danger`,"aria-label":`Remove greeting`,"onclick":() => removeGreeting(index),});
                     { const $$_eteleDnocI7C = __sveltets_2_ensureComponent(IconDelete); new $$_eteleDnocI7C({ target: __sveltets_2_any(), props: {  "style":`font-size: 16px;`,}});}
                   }
                 }
              }
               { svelteHTML.createElement("button", {     "type":`button`,"class":`ui-btn ui-btn-accent ui-btn-sm`,"onclick":addGreeting,});
                 { const $$_ddAnocI6C = __sveltets_2_ensureComponent(IconAdd); new $$_ddAnocI6C({ target: __sveltets_2_any(), props: {  "style":`font-size: 16px;`,}});}  
               }
            } else if (activeSection === 'behavior'){
               { svelteHTML.createElement("label", { "class":`ui-field`,});
                 { svelteHTML.createElement("span", { "class":`ui-field-label`,});  }
                 { svelteHTML.createElement("textarea", {     "class":`ui-textarea`,"value":draft.personality,"oninput":(e) => updateField('personality', e.currentTarget.value),}); }
               }
               { svelteHTML.createElement("label", { "class":`ui-field`,});
                 { svelteHTML.createElement("span", { "class":`ui-field-label`,});  }
                 { svelteHTML.createElement("textarea", {     "class":`ui-textarea`,"value":draft.scenario,"oninput":(e) => updateField('scenario', e.currentTarget.value),}); }
               }
               { svelteHTML.createElement("label", { "class":`ui-field`,});
                 { svelteHTML.createElement("span", { "class":`ui-field-label`,});  }
                 { svelteHTML.createElement("textarea", {     "class":`ui-textarea`,"value":draft.mesExample,"oninput":(e) => updateField('mesExample', e.currentTarget.value),}); }
               }
            } else if (activeSection === 'overrides'){
               { svelteHTML.createElement("label", { "class":`ui-field`,});
                 { svelteHTML.createElement("span", { "class":`ui-field-label`,});       '{{original}}';  }
                 { svelteHTML.createElement("textarea", {     "class":`ui-textarea`,"value":draft.systemPrompt,"oninput":(e) => updateField('systemPrompt', e.currentTarget.value),}); }
               }
               { svelteHTML.createElement("label", { "class":`ui-field`,});
                 { svelteHTML.createElement("span", { "class":`ui-field-label`,});   '{{original}}';  }
                 { svelteHTML.createElement("textarea", {     "class":`ui-textarea`,"value":draft.postHistoryInstructions,"oninput":(e) => updateField('postHistoryInstructions', e.currentTarget.value),}); }
               }
            }else{
               { svelteHTML.createElement("div", { "class":`grid-2`,});
                 { svelteHTML.createElement("label", { "class":`ui-field`,});
                   { svelteHTML.createElement("span", { "class":`ui-field-label`,});  }
                   { svelteHTML.createElement("input", {      "class":`ui-input`,"value":draft.creator,"oninput":(e) => updateField('creator', e.currentTarget.value),});}
                 }
                 { svelteHTML.createElement("label", { "class":`ui-field`,});
                   { svelteHTML.createElement("span", { "class":`ui-field-label`,});  }
                   { svelteHTML.createElement("input", {      "class":`ui-input`,"value":draft.characterVersion,"oninput":(e) => updateField('characterVersion', e.currentTarget.value),});}
                 }
               }
               { svelteHTML.createElement("label", { "class":`ui-field`,});
                 { svelteHTML.createElement("span", { "class":`ui-field-label`,});   }
                 { svelteHTML.createElement("input", {      "class":`ui-input`,"value":tagsText,"oninput":(e) => (tagsText = e.currentTarget.value),});}
               }
               { svelteHTML.createElement("label", { "class":`ui-field`,});
                 { svelteHTML.createElement("span", { "class":`ui-field-label`,});       }
                 { svelteHTML.createElement("textarea", {     "class":`ui-textarea`,"value":draft.creatorNotes,"oninput":(e) => updateField('creatorNotes', e.currentTarget.value),}); }
               }
            }
           }

          if(errorText){
             { svelteHTML.createElement("div", { "class":`ui-error-text`,});errorText; }
          }
         }
        if(fieldExpanded){
           { svelteHTML.createElement("button", {         "type":`button`,"class":`collapse-btn`,"onpointerdown":(e) => e.preventDefault(),"onclick":collapseField,});
             { const $$_tnetnoCespalloCnocI4C = __sveltets_2_ensureComponent(IconCollapseContent); new $$_tnetnoCespalloCnocI4C({ target: __sveltets_2_any(), props: {  "style":`font-size: 16px;`,}});} 
           }
        }
       }

       { svelteHTML.createElement("footer", { "class":`modal-foot`,});
         { svelteHTML.createElement("button", {         "type":`button`,"class":`ui-icon-btn`,"onclick":handleExport,"title":`Export card (PNG/JSON)`,"aria-label":`Export card`,});
           { const $$_daolnwoDnocI4C = __sveltets_2_ensureComponent(IconDownload); new $$_daolnwoDnocI4C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
         }
        if(props.canDelete){
           { svelteHTML.createElement("button", {         "type":`button`,"class":`ui-icon-btn danger`,"onclick":() => (deleteConfirmOpen = true),"title":`Delete character`,"aria-label":`Delete character`,});
             { const $$_eteleDnocI4C = __sveltets_2_ensureComponent(IconDelete); new $$_eteleDnocI4C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
           }
        }
         { svelteHTML.createElement("div", { "class":`foot-spacer`,}); }
         { svelteHTML.createElement("button", {     "type":`button`,"class":`ui-btn ui-btn-outline`,"onclick":() => props.onCancel?.(),});  }
         { svelteHTML.createElement("button", {     "type":`button`,"class":`ui-btn ui-btn-primary`,"onclick":handleSave,});  }
       }
     }
   }
}

 { const $$_ladoMmrifnoC0C = __sveltets_2_ensureComponent(ConfirmModal); new $$_ladoMmrifnoC0C({ target: __sveltets_2_any(), props: {                 "open":deleteConfirmOpen,"title":`Delete Character`,"message":`Delete this character and all of their chats? This action cannot be undone.`,"confirmText":`Delete`,"cancelText":`Cancel`,"danger":true,"onConfirm":handleDelete,"onCancel":() => (deleteConfirmOpen = false),}});}


};
return { props: {} as any as Props, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const CharacterEditorModal__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type CharacterEditorModal__SvelteComponent_ = ReturnType<typeof CharacterEditorModal__SvelteComponent_>;
/*Ωignore_endΩ*/export default CharacterEditorModal__SvelteComponent_;
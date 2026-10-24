///<reference types="svelte" />
;
import { IconSend, IconCallSplit, IconPublishedWithChanges, IconClose, IconChevronLeft, IconChevronRight, IconAutorenew, IconContentCopy, IconDelete, IconEdit, IconArrowDownward, IconArrowUpward, IconDangerous } from '../../icons'
import type { Message, MessageActionButton, EditorActionButton } from '../../types';
;

  interface Props {
    message: Message
    index?: number
    total?: number
    visibleCount?: number
    locked?: boolean
    debug?: boolean
    isEditing?: boolean
    isInsertedMessage?: boolean
    branchesLength?: number
    branchIndex?: number
    hasFollowingAssistant?: boolean
    nextAssistantId?: number
    nextAssistantTyping?: boolean
    messageActions?: MessageActionButton[]
    editorActions?: EditorActionButton[]
    onApplyEditSend?: () => void
    onApplyEditBranch?: () => void
    onApplyEditReplace?: () => void
    onCancelEdit?: () => void
    onDeleteInserted?: () => void
    onChangeVariant?: (delta: number) => void
    onRefreshAssistant?: (id: number) => void
    onRefreshAfterUserIndex?: (index: number) => void
    onCopy?: (text: string) => void
    onDelete?: (id: number) => void
    onEdit?: (id: number) => void
    onMoveDown?: (id: number) => void
    onMoveUp?: (id: number) => void
    onFork?: (id: number) => void
    onDebugFuckBranch?: (id: number) => void
    onDebugMessageDeath?: (id: number) => void
  };function $$render() {

  
  


  const props: Props = $props()
  const branchCount = $derived(props.branchesLength ?? 0)
  const branchIndex = $derived(props.branchIndex ?? 0)
  // Ensure message reference stays reactive with Svelte 5 runes
  const m = $derived(props.message)

  // Build a set of enabled action IDs and their order from settings
  const enabledActions = $derived((() => {
    const actions = props.messageActions
    if (!Array.isArray(actions) || actions.length === 0) return null
    const enabled = new Set<string>()
    for (const a of actions) {
      if (a.enabled) enabled.add(a.id)
    }
    return enabled
  })())

  // Order from settings (action id -> position)
  const actionOrder = $derived((() => {
    const actions = props.messageActions
    if (!Array.isArray(actions) || actions.length === 0) return null
    const order = new Map<string, number>()
    actions.forEach((a, i) => order.set(a.id, i))
    return order
  })())

  function isEnabled(id: string): boolean {
    if (enabledActions !== null && !enabledActions.has(id)) return false
    const role = m.role
    if (role !== 'user' && role !== 'assistant' && role !== 'system') return false
    const action = props.messageActions?.find(a => a.id === id)
    if (!action?.roles) return true
    return action.roles[role] !== false
  }

  // Build ordered actions list, respecting enabled state and custom order
  const orderedActions = $derived((() => {
    const items: { id: string; render: string }[] = []
    if (isEnabled('regenerate')) {
      if (m.role === 'assistant') {
        items.push({ id: 'regenerate', render: 'regenerate-assistant' })
      } else if (m.role === 'user' && props.hasFollowingAssistant) {
        items.push({ id: 'regenerate', render: 'regenerate-following' })
      } else if (m.role === 'user') {
        items.push({ id: 'regenerate', render: 'regenerate-after-user' })
      }
    }
    if (isEnabled('copy')) items.push({ id: 'copy', render: 'copy' })
    if (isEnabled('delete')) items.push({ id: 'delete', render: 'delete' })
    if (isEnabled('edit')) items.push({ id: 'edit', render: 'edit' })
    if (isEnabled('fork')) items.push({ id: 'fork', render: 'fork' })
    if (isEnabled('moveDown')) items.push({ id: 'moveDown', render: 'moveDown' })
    if (isEnabled('moveUp')) items.push({ id: 'moveUp', render: 'moveUp' })

    if (actionOrder) {
      items.sort((a, b) => (actionOrder.get(a.id) ?? 99) - (actionOrder.get(b.id) ?? 99))
    }
    return items
  })())
;
async () => {

 { svelteHTML.createElement("div", { "class":`actions ${m.role}`,});
  if(props.isEditing){
    if(!props.editorActions || props.editorActions.find(a => a.id === 'editSend')?.enabled !== false){
       { svelteHTML.createElement("button", {         "class":`action-btn`,"onclick":props.onApplyEditSend,"aria-label":`Send (branch + reply)`,"title":`Send (branch + reply)`,"disabled":props.locked,});
         { const $$_dneSnocI2C = __sveltets_2_ensureComponent(IconSend); new $$_dneSnocI2C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
       }
    }
    if(!props.editorActions || props.editorActions.find(a => a.id === 'editBranch')?.enabled !== false){
       { svelteHTML.createElement("button", {         "class":`action-btn`,"onclick":props.onApplyEditBranch,"aria-label":`Branch (no reply)`,"title":`Branch (no reply)`,"disabled":props.locked,});
         { const $$_tilpSllaCnocI2C = __sveltets_2_ensureComponent(IconCallSplit); new $$_tilpSllaCnocI2C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
       }
    }
    if(!props.editorActions || props.editorActions.find(a => a.id === 'editReplace')?.enabled !== false){
       { svelteHTML.createElement("button", {         "class":`action-btn`,"onclick":props.onApplyEditReplace,"aria-label":`Replace in current branch`,"title":`Replace in current branch`,"disabled":props.locked,});
         { const $$_segnahChtiWdehsilbuPnocI2C = __sveltets_2_ensureComponent(IconPublishedWithChanges); new $$_segnahChtiWdehsilbuPnocI2C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
       }
    }
    if(props.isInsertedMessage){
       { svelteHTML.createElement("button", {         "class":`action-btn`,"onclick":props.onDeleteInserted,"aria-label":`Delete message`,"title":`Delete`,"disabled":props.locked,});
         { const $$_eteleDnocI2C = __sveltets_2_ensureComponent(IconDelete); new $$_eteleDnocI2C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
       }
    }else{
       { svelteHTML.createElement("button", {         "class":`action-btn`,"onclick":props.onCancelEdit,"aria-label":`Cancel edit`,"title":`Cancel`,"disabled":props.locked,});
         { const $$_esolCnocI2C = __sveltets_2_ensureComponent(IconClose); new $$_esolCnocI2C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
       }
    }
  }else{
    if(branchCount > 1){
       { svelteHTML.createElement("span", { "class":`variants`,});
         { svelteHTML.createElement("button", {         "class":`action-btn`,"onclick":() => props.onChangeVariant?.(-1),"aria-label":`Previous branch`,"title":`Previous`,"disabled":props.locked || m.typing || branchIndex <= 0,});
           { const $$_tfeLnorvehCnocI3C = __sveltets_2_ensureComponent(IconChevronLeft); new $$_tfeLnorvehCnocI3C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
         }
         { svelteHTML.createElement("span", {   "class":`variant-counter`,"aria-live":`polite`,});branchIndex + 1; branchCount; }
         { svelteHTML.createElement("button", {         "class":`action-btn`,"onclick":() => props.onChangeVariant?.(1),"aria-label":`Next branch`,"title":`Next`,"disabled":props.locked || m.typing || branchIndex >= (branchCount - 1),});
           { const $$_thgiRnorvehCnocI3C = __sveltets_2_ensureComponent(IconChevronRight); new $$_thgiRnorvehCnocI3C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
         }
       }
    }

       for(let action of __sveltets_2_ensureArray(orderedActions)){action.id;
      if(action.render === 'regenerate-assistant'){
         { svelteHTML.createElement("button", {         "class":`action-btn`,"onclick":() => props.onRefreshAssistant?.(m.id),"aria-label":`Regenerate response`,"title":`Regenerate`,"disabled":props.locked || m.typing,});
           { const $$_wenerotuAnocI2C = __sveltets_2_ensureComponent(IconAutorenew); new $$_wenerotuAnocI2C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
         }
      } else if (action.render === 'regenerate-following'){
         { svelteHTML.createElement("button", {         "class":`action-btn`,"onclick":() => { if (props.nextAssistantId != null) props.onRefreshAssistant?.(props.nextAssistantId) },"aria-label":`Regenerate following response`,"title":`Regenerate following response`,"disabled":props.locked || props.nextAssistantTyping,});
           { const $$_wenerotuAnocI2C = __sveltets_2_ensureComponent(IconAutorenew); new $$_wenerotuAnocI2C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
         }
      } else if (action.render === 'regenerate-after-user'){
         { svelteHTML.createElement("button", {         "class":`action-btn`,"onclick":() => { if (props.index != null) props.onRefreshAfterUserIndex?.(props.index) },"aria-label":`Generate following response`,"title":`Generate following response`,"disabled":props.locked,});
           { const $$_wenerotuAnocI2C = __sveltets_2_ensureComponent(IconAutorenew); new $$_wenerotuAnocI2C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
         }
      } else if (action.render === 'copy'){
         { svelteHTML.createElement("button", {         "class":`action-btn`,"onclick":() => props.onCopy?.(m.content),"aria-label":`Copy message`,"title":`Copy`,"disabled":m.typing,});
           { const $$_ypoCtnetnoCnocI2C = __sveltets_2_ensureComponent(IconContentCopy); new $$_ypoCtnetnoCnocI2C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
         }
      } else if (action.render === 'delete'){
         { svelteHTML.createElement("button", {         "class":`action-btn`,"onclick":() => props.onDelete?.(m.id),"aria-label":`Delete message`,"title":`Delete`,"disabled":props.locked || m.typing,});
           { const $$_eteleDnocI2C = __sveltets_2_ensureComponent(IconDelete); new $$_eteleDnocI2C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
         }
      } else if (action.render === 'edit'){
         { svelteHTML.createElement("button", {         "class":`action-btn`,"onclick":() => props.onEdit?.(m.id),"aria-label":`Edit message`,"title":`Edit`,"disabled":props.locked || m.typing,});
           { const $$_tidEnocI2C = __sveltets_2_ensureComponent(IconEdit); new $$_tidEnocI2C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
         }
      } else if (action.render === 'fork'){
         { svelteHTML.createElement("button", {         "class":`action-btn`,"onclick":() => props.onFork?.(m.id),"aria-label":`Fork message`,"title":`Fork`,"disabled":props.locked || m.typing,});
           { const $$_tilpSllaCnocI2C = __sveltets_2_ensureComponent(IconCallSplit); new $$_tilpSllaCnocI2C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
         }
      } else if (action.render === 'moveDown'){
         { svelteHTML.createElement("button", {         "class":`action-btn`,"onclick":() => props.onMoveDown?.(m.id),"aria-label":`Move down`,"title":`Down`,"disabled":props.locked || m.typing || props.index === ((props.visibleCount || props.total || 1) - 1),});
           { const $$_drawnwoDworrAnocI2C = __sveltets_2_ensureComponent(IconArrowDownward); new $$_drawnwoDworrAnocI2C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
         }
      } else if (action.render === 'moveUp'){
         { svelteHTML.createElement("button", {         "class":`action-btn`,"onclick":() => props.onMoveUp?.(m.id),"aria-label":`Move up`,"title":`Up`,"disabled":props.locked || m.typing || props.index === 0,});
           { const $$_drawpUworrAnocI2C = __sveltets_2_ensureComponent(IconArrowUpward); new $$_drawpUworrAnocI2C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
         }
      }
    }

    if(props.debug){
       { svelteHTML.createElement("button", {         "class":`action-btn debug`,"onclick":() => props.onDebugFuckBranch?.(m.id),"aria-label":`Fuck up branching`,"title":`Fuck up branching`,"disabled":props.locked || m.typing,});
         { const $$_suoregnaDnocI2C = __sveltets_2_ensureComponent(IconDangerous); new $$_suoregnaDnocI2C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
       }
       { svelteHTML.createElement("button", {         "class":`action-btn debug`,"onclick":() => props.onDebugMessageDeath?.(m.id),"aria-label":`Message death (simulate bug)`,"title":`Message death (simulate bug)`,"disabled":props.locked || m.typing,});
         { const $$_eteleDnocI2C = __sveltets_2_ensureComponent(IconDelete); new $$_eteleDnocI2C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
       }
    }
  }
 }


};
return { props: {} as any as Props, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const MessageActions__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type MessageActions__SvelteComponent_ = ReturnType<typeof MessageActions__SvelteComponent_>;
/*Ωignore_endΩ*/export default MessageActions__SvelteComponent_;
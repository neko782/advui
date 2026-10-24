///<reference types="svelte" />
;
import { formatRole } from '../../utils/format'
import MessageMeta from './MessageMeta.svelte'
import MessageBubble from './MessageBubble.svelte'
import MessageActions from './MessageActions.svelte'
import { IconPerson } from '../../icons'
import type { VisibleMessage, MessageRole, MessageActionButton, EditorActionButton } from '../../types'
import type { Character } from '../../types/tavern';
;

  interface Props {
    vm: VisibleMessage
    /** Tavern: character bound to this chat (adds avatar + name to assistant messages). */
    character?: Character | null
    /** Tavern: active persona name (labels user messages). */
    personaName?: string
    /** Tavern: avatar shape ('circle' default, or 'rounded' square). */
    avatarShape?: 'circle' | 'rounded' | 'card'
    imageCache?: Record<string, { data: string; mimeType?: string; name?: string }>
    total?: number
    visibleCount?: number
    locked?: boolean
    debug?: boolean
    editingId?: number | null
    editingText?: string
    isInsertedMessage?: boolean
    hasFollowingAssistant?: boolean
    nextAssistantId?: number
    nextAssistantTyping?: boolean
    parentId?: number | null
    branchIndex?: number
    branchesLength?: number
    allowInlineHtml?: boolean
    renderLatex?: boolean
    messageActions?: MessageActionButton[]
    editorActions?: EditorActionButton[]
    disableRoleSwitching?: boolean
    onSetRole?: (id: number, role: MessageRole) => void
    onEditInput?: (text: string) => void
    onEditKeydown?: (e: KeyboardEvent) => void
    onApplyEditSend?: () => void
    onApplyEditBranch?: () => void
    onApplyEditReplace?: () => void
    onCancelEdit?: () => void
    onChangeVariant?: (id: number, delta: number) => void
    onRefreshAssistant?: (id: number) => void
    onRefreshAfterUserIndex?: (index: number) => void
    onCopy?: (text: string) => void
    onDelete?: (id: number) => void
    onEdit?: (id: number) => void
    onMoveDown?: (id: number) => void
    onMoveUp?: (id: number) => void
    onFork?: (id: number) => void
    onDeleteInserted?: () => void
    onDebugFuckBranch?: (id: number) => void
    onDebugMessageDeath?: (id: number) => void
  };function $$render() {

  
  
  
  
  
  
  


  const props: Props = $props()
  // Keep these derived from props so they update when parent data changes
  const vm = $derived(props.vm)
  const m = $derived(vm.m)
  const isEditing = $derived(props.editingId === m.id)
  const branchesLength = $derived(Number(props.branchesLength) || 0)
  const branchIndex = $derived(Number(props.branchIndex) || 0)
  // Tavern: assistant messages show the character avatar + name,
  // user messages are labeled with the active persona name.
  const showCharacter = $derived(!!props.character && m.role === 'assistant')
  const roleLabel = $derived.by(() => {
    if (showCharacter) return props.character!.nickname || props.character!.name || formatRole(m.role)
    if (props.character && m.role === 'user' && props.personaName) return props.personaName
    return formatRole(m.role)
  })
  // Move should target the clicked message, not its parent
  function doMoveUp() { props.onMoveUp?.(m.id) }
  function doMoveDown() { props.onMoveDown?.(m.id) }

  const avatarShapeClass = $derived(
    props.avatarShape === 'rounded' ? 'rounded' : props.avatarShape === 'card' ? 'card' : ''
  )
;
async () => {

 { svelteHTML.createElement("div", { "class":`row ${m.role}`,});
   { svelteHTML.createElement("div", { "class":`stack ${m.role} ${isEditing ? 'editing' : ''}`,});
    if(showCharacter){
       { svelteHTML.createElement("div", { "class":`char-header`,});
        if(props.character!.avatar){
           { svelteHTML.createElement("img", {        "class":`char-avatar ${avatarShapeClass}`,"src":props.character!.avatar,"alt":props.character!.name,"loading":`lazy`,});}
        }else{
           { svelteHTML.createElement("div", { "class":`char-avatar placeholder ${avatarShapeClass}`,}); { const $$_nosrePnocI4C = __sveltets_2_ensureComponent(IconPerson); new $$_nosrePnocI4C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});} }
        }
         { const $$_ateMegasseM3C = __sveltets_2_ensureComponent(MessageMeta); new $$_ateMegasseM3C({ target: __sveltets_2_any(), props: {              "role":m.role,"label":roleLabel,"locked":props.locked,"debug":props.debug,"messageId":m.id,"disabled":props.disableRoleSwitching,"onSetRole":(r) => props.onSetRole?.(m.id, r),}});}
       }
    }else{
       { const $$_ateMegasseM2C = __sveltets_2_ensureComponent(MessageMeta); new $$_ateMegasseM2C({ target: __sveltets_2_any(), props: {              "role":m.role,"label":roleLabel,"locked":props.locked,"debug":props.debug,"messageId":m.id,"disabled":props.disableRoleSwitching,"onSetRole":(r) => props.onSetRole?.(m.id, r),}});}
    }
     { const $$_elbbuBegasseM2C = __sveltets_2_ensureComponent(MessageBubble); new $$_elbbuBegasseM2C({ target: __sveltets_2_any(), props: {                 "message":m,"imageCache":props.imageCache,"isEditing":isEditing,"editingText":props.editingText,"allowInlineHtml":props.allowInlineHtml,"renderLatex":props.renderLatex,"onEditInput":(t) => props.onEditInput?.(t),"onEditKeydown":props.onEditKeydown,}});}
    
     { const $$_snoitcAegasseM2C = __sveltets_2_ensureComponent(MessageActions); new $$_snoitcAegasseM2C({ target: __sveltets_2_any(), props: {                                                               "message":m,"index":vm.i,"total":props.total,"visibleCount":props.visibleCount,"locked":props.locked,"debug":props.debug,"isEditing":isEditing,"branchesLength":branchesLength,"branchIndex":branchIndex,"hasFollowingAssistant":props.hasFollowingAssistant,"nextAssistantId":props.nextAssistantId,"nextAssistantTyping":props.nextAssistantTyping,"messageActions":props.messageActions,"editorActions":props.editorActions,"isInsertedMessage":props.isInsertedMessage && isEditing,"onApplyEditSend":props.onApplyEditSend,"onApplyEditBranch":props.onApplyEditBranch,"onApplyEditReplace":props.onApplyEditReplace,"onCancelEdit":props.onCancelEdit,"onDeleteInserted":props.onDeleteInserted,"onChangeVariant":(d) => props.onChangeVariant?.(m.id, d),"onRefreshAssistant":props.onRefreshAssistant,"onRefreshAfterUserIndex":props.onRefreshAfterUserIndex,"onCopy":props.onCopy,"onDelete":props.onDelete,"onEdit":props.onEdit,"onMoveDown":doMoveDown,"onMoveUp":doMoveUp,"onFork":props.onFork,"onDebugFuckBranch":props.onDebugFuckBranch,"onDebugMessageDeath":props.onDebugMessageDeath,}});}
   }
 }


};
return { props: {} as any as Props, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const MessageItem__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type MessageItem__SvelteComponent_ = ReturnType<typeof MessageItem__SvelteComponent_>;
/*Ωignore_endΩ*/export default MessageItem__SvelteComponent_;
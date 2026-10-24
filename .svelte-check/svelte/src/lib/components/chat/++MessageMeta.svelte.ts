///<reference types="svelte" />
;
import { IconPerson, IconSmartToy, IconTune } from '../../icons'
import type { MessageRole } from '../../types';
;

  interface Props {
    role: MessageRole
    label?: string
    locked?: boolean
    disabled?: boolean
    debug?: boolean
    messageId?: number
    onSetRole?: (role: MessageRole) => void
  };function $$render() {

  
  


  const props: Props = $props()
  let open = $state(false)
  let groupEl = $state<HTMLDivElement | null>(null)
  let triggerEl = $state<HTMLButtonElement | null>(null)
  const menuId = `role-menu-${props.messageId ?? 'unknown'}`

  function toggleMenu() {
    if (props.locked || props.disabled) return
    open = !open
  }

  function closeMenu() {
    open = false
  }

  function handleSelect(role: MessageRole) {
    props.onSetRole?.(role)
    closeMenu()
    triggerEl?.focus()
  }

  function handleMenuKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
      triggerEl?.focus()
    }
  }

  function handleFocusOut(event: FocusEvent) {
    if (!open) return
    if (groupEl && !groupEl.contains(event.relatedTarget as Node | null)) {
      closeMenu()
    }
  }

  $effect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!groupEl?.contains(event.target as Node | null)) {
        closeMenu()
      }
    }

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu()
        triggerEl?.focus()
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeydown)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeydown)
    }
  })

  $effect(() => {
    if ((props.locked || props.disabled) && open) {
      closeMenu()
    }
  })
;
async () => {

 { svelteHTML.createElement("div", {   "class":`meta ${props.role}`,...__sveltets_2_empty({"data-open":open}),});
   { const $$_div1 = svelteHTML.createElement("div", {              "class":`send-group`,"aria-haspopup":`menu`,"title":`Change role`,...__sveltets_2_empty({"data-open":open}),...__sveltets_2_empty({"data-side":`bottom`}),"onfocusout":handleFocusOut,});groupEl = $$_div1;
     { const $$_button2 = svelteHTML.createElement("button", {                "class":`role-badge`,"aria-label":`Role: ${props.label || props.role}`,"aria-expanded":open,"aria-controls":menuId,"disabled":props.locked || props.disabled,"type":`button`,"onclick":toggleMenu,});triggerEl = $$_button2;
      props.label || props.role;
     }
     { svelteHTML.createElement("div", {                 "class":`send-menu`,"role":`menu`,"aria-label":`Change role`,"id":menuId,"aria-hidden":!open,"hidden":!open,...__sveltets_2_empty({"data-open":open}),"onkeydown":handleMenuKeydown,});
       { svelteHTML.createElement("button", {         "role":`menuitem`,"class":`menu-item`,"onclick":() => handleSelect('user'),"aria-label":`Set role user`,"disabled":props.locked,});
         { const $$_nosrePnocI4C = __sveltets_2_ensureComponent(IconPerson); new $$_nosrePnocI4C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
        
       }
       { svelteHTML.createElement("button", {         "role":`menuitem`,"class":`menu-item`,"onclick":() => handleSelect('assistant'),"aria-label":`Set role assistant`,"disabled":props.locked,});
         { const $$_yoTtramSnocI4C = __sveltets_2_ensureComponent(IconSmartToy); new $$_yoTtramSnocI4C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
        
       }
       { svelteHTML.createElement("button", {         "role":`menuitem`,"class":`menu-item`,"onclick":() => handleSelect('system'),"aria-label":`Set role system`,"disabled":props.locked,});
         { const $$_enuTnocI4C = __sveltets_2_ensureComponent(IconTune); new $$_enuTnocI4C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
        
       }
     }
   }
  if(props.debug){
     { svelteHTML.createElement("span", {   "class":`id-tag`,"title":`ID: ${props.messageId}`,}); props.messageId; }
  }
 }


};
return { props: {} as any as Props, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const MessageMeta__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type MessageMeta__SvelteComponent_ = ReturnType<typeof MessageMeta__SvelteComponent_>;
/*Ωignore_endΩ*/export default MessageMeta__SvelteComponent_;
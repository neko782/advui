///<reference types="svelte" />
;
import { tick } from 'svelte';
;

  interface Props {
    open?: boolean
    value?: string
    title?: string
    label?: string
    placeholder?: string
    confirmText?: string
    cancelText?: string
    onConfirm?: (value: string) => void
    onCancel?: () => void
  };function $$render() {

  


  const props: Props = $props()

  let inputEl = $state<HTMLInputElement | null>(null)
  let localValue = $state('')

  let wasOpen = false
  $effect(() => {
    if (props.open && !wasOpen) {
      localValue = props.value ?? ''
      tick().then(() => {
        inputEl?.focus()
        inputEl?.select?.()
      })
    }
    wasOpen = !!props.open
  })

  function handleConfirm() {
    props.onConfirm?.(localValue)
  }

  function handleCancel() {
    props.onCancel?.()
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleConfirm()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      handleCancel()
    }
  }
;
async () => {

if(props.open){
   { svelteHTML.createElement("div", {   "class":`modal-overlay`,"role":`presentation`,});
     { svelteHTML.createElement("button", {       "type":`button`,"class":`ui-backdrop`,"aria-label":`Close dialog`,"onclick":handleCancel,}); }
     { svelteHTML.createElement("div", {               "class":`ui-modal modal`,"role":`dialog`,"aria-modal":`true`,"aria-labelledby":`modal-title`,"tabindex":-1,"onpointerdown":(event) => { if (event.target === event.currentTarget) handleCancel() },"onkeydown":(event) => { if (event.key === 'Escape') handleCancel() },});
       { svelteHTML.createElement("div", { "class":`ui-panel panel`,});
         { svelteHTML.createElement("header", { "class":`modal-head`,});
           { svelteHTML.createElement("div", {   "id":`modal-title`,"class":`ui-modal-title`,});props.title || 'Edit'; }
           { svelteHTML.createElement("button", {     "class":`ui-icon-btn`,"onclick":handleCancel,"aria-label":`Close`,});
             { svelteHTML.createElement("svg", {       "width":`16`,"height":`16`,"viewBox":`0 0 16 16`,"fill":`none`,});
                { svelteHTML.createElement("path", {       "d":`M12 4L4 12M4 4l8 8`,"stroke":`currentColor`,"stroke-width":`2`,"stroke-linecap":`round`,});}
             }
           }
         }
         { svelteHTML.createElement("div", { "class":`modal-body`,});
           { svelteHTML.createElement("label", { "class":`ui-field`,});
             { svelteHTML.createElement("span", { "class":`ui-field-label`,});props.label || 'Value'; }
             { const $$_input5 = svelteHTML.createElement("input", {                "type":`text`,"class":`ui-input`,"placeholder":props.placeholder || '',"value":localValue,"oninput":(e) => localValue = e.currentTarget.value,"onkeydown":handleKeydown,"aria-label":props.label || 'Value',});inputEl = $$_input5;}
           }
         }
         { svelteHTML.createElement("footer", { "class":`modal-footer`,});
           { svelteHTML.createElement("button", {     "type":`button`,"class":`ui-btn ui-btn-secondary`,"onclick":handleCancel,});
            props.cancelText || 'Cancel';
           }
           { svelteHTML.createElement("button", {     "type":`button`,"class":`ui-btn ui-btn-primary`,"onclick":handleConfirm,});
            props.confirmText || 'Save';
           }
         }
       }
     }
   }
}


};
return { props: {} as any as Props, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const EditModal__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type EditModal__SvelteComponent_ = ReturnType<typeof EditModal__SvelteComponent_>;
/*Ωignore_endΩ*/export default EditModal__SvelteComponent_;
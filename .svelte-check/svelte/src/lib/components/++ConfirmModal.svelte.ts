///<reference types="svelte" />
;;
  interface Props {
    open?: boolean
    title?: string
    message?: string
    confirmText?: string
    cancelText?: string
    danger?: boolean
    checkbox?: boolean
    checkboxLabel?: string
    checkboxChecked?: boolean
    onCheckboxChange?: (checked: boolean) => void
    onConfirm?: () => void
    onCancel?: () => void
  };function $$render() {



  const props: Props = $props()

  let dialogEl = $state<HTMLDivElement | null>(null)

  // Move focus into the dialog when it opens so the Escape keydown handler works.
  $effect(() => {
    if (props.open && dialogEl) {
      dialogEl.focus()
    }
  })

  async function handleConfirm() {
    try {
      await props.onConfirm?.()
    } catch (err) {
      console.error('ConfirmModal onConfirm error:', err)
    }
  }

  function handleCancel() {
    props.onCancel?.()
  }

  function handleCheckbox(e: Event) {
    const target = e.target as HTMLInputElement
    props.onCheckboxChange?.(target.checked)
  }
;
async () => {

if(props.open){
   { svelteHTML.createElement("div", {   "class":`modal-overlay`,"role":`presentation`,});
     { svelteHTML.createElement("button", {       "type":`button`,"class":`ui-backdrop`,"aria-label":`Close dialog`,"onclick":handleCancel,}); }
     { const $$_div1 = svelteHTML.createElement("div", {              "class":`ui-modal modal`,"role":`dialog`,"aria-modal":`true`,"aria-labelledby":`modal-title`,"tabindex":-1,"onkeydown":(event) => { if (event.key === 'Escape') handleCancel() },});dialogEl = $$_div1;
       { svelteHTML.createElement("div", {  "class":`ui-panel panel`,});props.danger;
         { svelteHTML.createElement("div", { "class":`modal-content`,});
          if(props.danger){
             { svelteHTML.createElement("div", { "class":`icon-wrapper danger`,});
               { svelteHTML.createElement("svg", {       "width":`24`,"height":`24`,"viewBox":`0 0 24 24`,"fill":`none`,});
                  { svelteHTML.createElement("path", {         "d":`M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z`,"stroke":`currentColor`,"stroke-width":`2`,"stroke-linecap":`round`,"stroke-linejoin":`round`,});}
               }
             }
          }
           { svelteHTML.createElement("div", { "class":`text-content`,});
             { svelteHTML.createElement("div", {   "id":`modal-title`,"class":`title`,});props.title || 'Confirm'; }
             { svelteHTML.createElement("p", { "class":`message`,});props.message || 'Are you sure?'; }
           }
          if(props.checkbox){
             { svelteHTML.createElement("label", { "class":`checkbox-row`,});
               { svelteHTML.createElement("input", {      "type":`checkbox`,"checked":props.checkboxChecked,"onchange":handleCheckbox,});}
               { svelteHTML.createElement("span", { "class":`checkbox-label`,});props.checkboxLabel || "Don't ask again"; }
             }
          }
         }
         { svelteHTML.createElement("footer", { "class":`modal-footer`,});
           { svelteHTML.createElement("button", {     "type":`button`,"class":`ui-btn ui-btn-secondary`,"onclick":handleCancel,});
            props.cancelText || 'Cancel';
           }
           { svelteHTML.createElement("button", {     "type":`button`,"class":`ui-btn ${props.danger ? 'ui-btn-danger' : 'ui-btn-primary'}`,"onclick":handleConfirm,});
            props.confirmText || 'Confirm';
           }
         }
       }
     }
   }
}


};
return { props: {} as any as Props, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const ConfirmModal__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type ConfirmModal__SvelteComponent_ = ReturnType<typeof ConfirmModal__SvelteComponent_>;
/*Ωignore_endΩ*/export default ConfirmModal__SvelteComponent_;
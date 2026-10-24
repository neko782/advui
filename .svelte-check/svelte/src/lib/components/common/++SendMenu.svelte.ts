///<reference types="svelte" />
;// Generic hover/focus popover menu container
// Usage: wrap a trigger in this component and place menu content in the default slot named "menu".

import type { Snippet } from 'svelte';
;

  interface Props {
    className?: string
    side?: 'top' | 'bottom' | 'left' | 'right'
    children?: Snippet
    menu?: Snippet
  };function $$render() {

  
  
  


  const props: Props = $props()

/*Ωignore_startΩ*/;const __sveltets_createSlot = __sveltets_2_createCreateSlot();/*Ωignore_endΩ*/;
async () => {

 { svelteHTML.createElement("div", {     "class":`send-group ${props.className || ''}`,"aria-haspopup":`menu`,...__sveltets_2_empty({"data-side":props.side || 'top'}),});
   { __sveltets_createSlot("default", {});}
   { svelteHTML.createElement("div", {   "class":`send-menu ${props.side || 'top'}`,"role":`menu`,});
     { __sveltets_createSlot("menu", {  });}
   }
  
 }


};
return { props: {} as any as Props, exports: {}, bindings: __sveltets_$$bindings(''), slots: {'default': {}, 'menu': {}}, events: {} }}
const SendMenu__SvelteComponent_ = __sveltets_2_isomorphic_component_slots(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type SendMenu__SvelteComponent_ = InstanceType<typeof SendMenu__SvelteComponent_>;
/*Ωignore_endΩ*/export default SendMenu__SvelteComponent_;
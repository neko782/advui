///<reference types="svelte" />
;
import Icon from '../../Icon.svelte';
;

  interface Props {
    title?: string
    ariaLabel?: string
    disabled?: boolean
    onclick?: () => void
    name?: string
    size?: number
  };function $$render() {

  


  const props: Props = $props()
;
async () => {

 { svelteHTML.createElement("button", {         "class":`icon-btn`,"title":props.title || '',"aria-label":props.ariaLabel || props.title,"disabled":props.disabled,"onclick":props.onclick,});
   { const $$_nocI1C = __sveltets_2_ensureComponent(Icon); new $$_nocI1C({ target: __sveltets_2_any(), props: {    "name":props.name || '',"size":props.size ?? 22,}});}
 }


};
return { props: {} as any as Props, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const IconButton__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type IconButton__SvelteComponent_ = ReturnType<typeof IconButton__SvelteComponent_>;
/*Ωignore_endΩ*/export default IconButton__SvelteComponent_;
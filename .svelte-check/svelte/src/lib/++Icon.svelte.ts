///<reference types="svelte" />
;;
  interface Props {
    name?: string
    size?: number
    weight?: number
    filled?: boolean
    grade?: number
    opticalSize?: number
  };function $$render() {



  let { name = '', size = 22, weight = 400, filled = false, grade = 0, opticalSize = 24 }: Props = $props()
;
async () => {

  { svelteHTML.createElement("span", {      "class":`icon material-symbols-rounded`,"style":`font-size: ${size}px; font-variation-settings: 'FILL' ${filled ? 1 : 0}, 'wght' ${weight}, 'GRAD' ${grade}, 'opsz' ${opticalSize};`,"aria-hidden":`true`,});
  name;
 }



};
return { props: {} as any as Props, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Icon__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Icon__SvelteComponent_ = ReturnType<typeof Icon__SvelteComponent_>;
/*Ωignore_endΩ*/export default Icon__SvelteComponent_;
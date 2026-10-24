///<reference types="svelte" />
;
import Composer from '../Composer.svelte'
import type { Image } from '../../../types';
function $$render() {

  
  /*Ωignore_startΩ*/;type $$ComponentProps = { initialInput?: string, locked?: boolean, onFilesSelected?: Function };/*Ωignore_endΩ*/
  let { initialInput = '', locked = false, onFilesSelected = (_files: File[]) => {} }: $$ComponentProps = $props()
  let input = $state(initialInput)
  let sent = $state('')
  let attachedImages = $state<Image[]>([])
;
async () => {

 { const $$_resopmoC0C = __sveltets_2_ensureComponent(Composer); new $$_resopmoC0C({ target: __sveltets_2_any(), props: {          input,locked,attachedImages,"onInput":(value) => { input = value },"onFilesSelected":(files) => {
    onFilesSelected(files)
    attachedImages = files.map((file, index) => ({ id: `${index}`, name: file.name, mimeType: file.type, data: 'aGk=' }))
  },"onSend":() => { sent = input; input = ''; attachedImages = [] },}});}
 { svelteHTML.createElement("output", { ...__sveltets_2_empty({"data-testid":`draft`}),});input; }
 { svelteHTML.createElement("output", { ...__sveltets_2_empty({"data-testid":`sent`}),});sent; }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const ComposerHarness__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type ComposerHarness__SvelteComponent_ = ReturnType<typeof ComposerHarness__SvelteComponent_>;
/*Ωignore_endΩ*/export default ComposerHarness__SvelteComponent_;
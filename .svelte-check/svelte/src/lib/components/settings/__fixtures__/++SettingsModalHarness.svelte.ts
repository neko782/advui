///<reference types="svelte" />
;
import SettingsModal from '../../../SettingsModal.svelte';
function $$render() {

  
  let open = $state(false)
   function show() { open = true }
;
async () => {
 { const $$_ladoMsgnitteS0C = __sveltets_2_ensureComponent(SettingsModal); new $$_ladoMsgnitteS0C({ target: __sveltets_2_any(), props: {   open,"onClose":() => { open = false },}});}
};
return { props: {} as Record<string, never>, exports: {} as any as { show: typeof show }, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const SettingsModalHarness__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type SettingsModalHarness__SvelteComponent_ = ReturnType<typeof SettingsModalHarness__SvelteComponent_>;
/*Ωignore_endΩ*/export default SettingsModalHarness__SvelteComponent_;
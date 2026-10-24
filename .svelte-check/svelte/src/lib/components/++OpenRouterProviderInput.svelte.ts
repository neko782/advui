///<reference types="svelte" />
;
;type $$ComponentProps =  {
    value?: string
    disabled?: boolean
    active?: boolean
    onInput?: (value: string) => void
  };function $$render() {

  let { value = '', disabled = false, active = true, onInput }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props()
  const uid = $props.id()

  let providerOptions = $state<Array<{ slug: string; name: string }>>([])
  $effect(() => {
    if (!active || providerOptions.length) return
    const controller = new AbortController()
    fetch('https://openrouter.ai/api/v1/providers', { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('Could not load providers')
        return response.json()
      })
      .then(result => {
        if (controller.signal.aborted || !Array.isArray(result?.data)) return
        providerOptions = (result.data as Array<{ slug: string; name: string }>)
          .filter(provider => typeof provider?.slug === 'string' && typeof provider?.name === 'string')
          .sort((a, b) => a.name.localeCompare(b.name))
      })
      .catch(() => {}) // Manual provider entry remains available offline.
    return () => controller.abort()
  })

;
async () => {

 { svelteHTML.createElement("label", {});
   { svelteHTML.createElement("span", {});  }
   { svelteHTML.createElement("input", {          "type":`text`,"placeholder":`Automatic`,"list":`${uid}-providers`,value,disabled,"oninput":(event) => { if (!disabled) onInput?.(event.currentTarget.value) },});}
 }
 { svelteHTML.createElement("datalist", { "id":`${uid}-providers`,});
     for(let provider of __sveltets_2_ensureArray(providerOptions)){provider.slug;
     { svelteHTML.createElement("option", { "value":provider.slug,});provider.name; }
  }
 }
 { svelteHTML.createElement("p", {});            }


};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const OpenRouterProviderInput__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type OpenRouterProviderInput__SvelteComponent_ = ReturnType<typeof OpenRouterProviderInput__SvelteComponent_>;
/*Ωignore_endΩ*/export default OpenRouterProviderInput__SvelteComponent_;
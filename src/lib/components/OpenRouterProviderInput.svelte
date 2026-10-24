<script lang="ts">
  import FloatingPopover from './FloatingPopover.svelte'
  import { IconTune } from '../icons'
  let { value = '', disabled = false, active = true, onInput }: {
    value?: string
    disabled?: boolean
    active?: boolean
    onInput?: (value: string) => void
  } = $props()
  const uid = $props.id()
  let expanded = $state(false)
  let button = $state<HTMLButtonElement>()
  let root: HTMLDivElement

  $effect(() => { if (!active || disabled) expanded = false })
  $effect(() => {
    if (!expanded) return
    const outside = (event: PointerEvent) => { if (!root.contains(event.target as Node)) expanded = false }
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && root.contains(event.target as Node)) {
        expanded = false
        event.stopImmediatePropagation()
        button?.focus()
      }
    }
    window.addEventListener('pointerdown', outside, true)
    root.addEventListener('keydown', onKeydown)
    return () => { window.removeEventListener('pointerdown', outside, true); root.removeEventListener('keydown', onKeydown) }
  })

  let providerOptions = $state<Array<{ slug: string; name: string }>>([])
  $effect(() => {
    if (!active || !expanded || providerOptions.length) return
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

</script>

<div bind:this={root}>
  <button type="button" class="provider-toggle" bind:this={button} {disabled}
    aria-label="OpenRouter provider" title="OpenRouter provider" aria-expanded={expanded}
    class:selected={!!value} onclick={() => { expanded = !expanded }}><IconTune style="font-size: 18px;" /></button>
  <FloatingPopover open={expanded && active} anchor={button} maxWidth={320} maxHeight={260} className="provider-popup">
  <div class="provider-content">
<label>
  <span>OpenRouter provider</span>
  <input type="text" placeholder="Automatic" list={`${uid}-providers`} {value} {disabled}
    oninput={(event) => { if (!disabled) onInput?.(event.currentTarget.value) }} />
</label>
<datalist id={`${uid}-providers`}>
  {#each providerOptions as provider (provider.slug)}
    <option value={provider.slug}>{provider.name}</option>
  {/each}
</datalist>
<p>Choose a provider or enter its slug. Leave blank for automatic routing.</p>
  </div>
  </FloatingPopover>
</div>

<style>
  label { display: grid; gap: 6px; }
  .provider-toggle { display: grid; place-items: center; width: 40px; height: 44px; padding: 0; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--muted); cursor: pointer; }
  .provider-toggle:hover, .provider-toggle.selected { color: var(--accent); border-color: var(--accent); }
  .provider-content { display: grid; gap: 10px; padding: 14px; overflow-y: auto; }
  span { font-size: .9rem; color: var(--muted); font-weight: 500; }
  input { width: 100%; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; background: var(--bg); color: var(--text); font: inherit; box-sizing: border-box; }
  input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent); }
  p { margin: 0; font-size: .75rem; color: var(--muted); }
</style>

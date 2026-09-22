<script lang="ts">
  let { value = '', disabled = false, active = true, onInput }: {
    value?: string
    disabled?: boolean
    active?: boolean
    onInput?: (value: string) => void
  } = $props()
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
        providerOptions = result.data
          .filter(provider => typeof provider?.slug === 'string' && typeof provider?.name === 'string')
          .sort((a, b) => a.name.localeCompare(b.name))
      })
      .catch(() => {}) // Manual provider entry remains available offline.
    return () => controller.abort()
  })

</script>

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

<style>
  label { display: grid; gap: 6px; }
  span { font-size: .9rem; color: var(--muted); font-weight: 500; }
  input { width: 100%; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; background: var(--bg); color: var(--text); font: inherit; box-sizing: border-box; }
  input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent); }
  p { margin: 0; font-size: .75rem; color: var(--muted); }
</style>

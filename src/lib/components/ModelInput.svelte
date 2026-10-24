<script lang="ts">
  import { tick } from 'svelte'
  import { DEFAULT_MODEL } from '../utils/presetHelpers'

  let { value = '', models = [], disabled = false, active = true, suggestionsAbove = false, onInput }: {
    value?: string
    models?: string[]
    disabled?: boolean
    active?: boolean
    suggestionsAbove?: boolean
    onInput?: (value: string) => void
  } = $props()

  const uid = $props.id()
  let draft = $state('')
  let focused = $state(false)
  let expanded = $state(false)
  let query = $state('')
  let highlighted = $state(-1)
  let root: HTMLDivElement
  let input: HTMLInputElement
  let list = $state<HTMLDivElement>()
  let viewportHeight = $state(176)

  const options = $derived([...new Set(models)])
  const matches = $derived.by(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return options.filter(model => terms.every(term => model.toLowerCase().includes(term)))
  })
  const visible = $derived(matches.slice(0, 100))
  const showSuggestions = $derived(active && !disabled && expanded && options.length > 0)

  // Shared preset normalization must never rewrite an active text selection.
  $effect(() => { if (!focused) draft = value })
  $effect(() => {
    if (!active || disabled) {
      expanded = false
      focused = false
      if (document.activeElement === input) input.blur()
    }
  })

  $effect(() => {
    if (!showSuggestions) return
    const viewport = window.visualViewport
    let frame = 0
    let disposed = false
    const update = () => {
      viewportHeight = Math.max(0, Math.min(176, (viewport?.height ?? window.innerHeight) - 112))
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(async () => {
        // A modal's scroller can be shorter than the visual viewport because
        // its header and tabs also need room. Fit the field and list together.
        for (let parent = root.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent)
          if (!/auto|scroll/.test(style.overflowY) || !parent.clientHeight) continue
          const available = parent.clientHeight - parseFloat(style.paddingTop || '0') - parseFloat(style.paddingBottom || '0')
          const controlHeight = input.getBoundingClientRect().height
          viewportHeight = Math.max(0, Math.min(viewportHeight, available - controlHeight - 6))
          break
        }
        await tick()
        // Suggestions occupy layout space. Scroll the containing settings
        // panel just enough to reveal them, including after keyboard resize.
        if (!disposed) root.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      })
    }
    update()
    viewport?.addEventListener('resize', update)
    window.addEventListener('resize', update)
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      viewport?.removeEventListener('resize', update)
      window.removeEventListener('resize', update)
    }
  })

  function openSuggestions() {
    if (disabled || !active) return
    query = ''
    highlighted = -1
    expanded = true
  }

  function choose(model: string) {
    draft = model
    onInput?.(model)
    expanded = false
    highlighted = -1
    input.focus({ preventScroll: true })
  }

  async function onKeydown(event: KeyboardEvent) {
    if (event.isComposing) return
    if (event.key === 'Escape' && showSuggestions) {
      event.preventDefault()
      event.stopPropagation()
      expanded = false
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && options.length) {
      event.preventDefault()
      if (!showSuggestions) openSuggestions()
      if (!visible.length) return
      highlighted = event.key === 'ArrowDown'
        ? (highlighted + 1) % visible.length
        : (highlighted <= 0 ? visible.length - 1 : highlighted - 1)
      await tick()
      // Scroll only the results, without moving the input or the page.
      const option = list?.children[highlighted] as HTMLElement | undefined
      if (option && list) {
        if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop
        else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
          list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight
        }
      }
    } else if (event.key === 'Enter' && showSuggestions && highlighted >= 0) {
      event.preventDefault()
      event.stopPropagation()
      const model = visible[highlighted]
      if (model) choose(model)
    } else if (event.key === 'Tab') {
      expanded = false
    }
  }
</script>

<div class="model-input" class:above={suggestionsAbove} bind:this={root}
  onfocusout={(event) => {
    if (!root.contains(event.relatedTarget as Node | null)) expanded = false
  }}>
  <div class="model-control">
    <input bind:this={input} type="text" class="ui-input" bind:value={draft} {disabled}
      placeholder={DEFAULT_MODEL} aria-label="Model" role="combobox"
      aria-autocomplete="list" aria-expanded={showSuggestions}
      aria-controls={showSuggestions ? `${uid}-models` : undefined}
      aria-activedescendant={showSuggestions && highlighted >= 0 ? `${uid}-model-${highlighted}` : undefined}
      autocomplete="off" autocapitalize="off" spellcheck={false}
      onfocus={() => { focused = true; openSuggestions() }}
      onblur={() => { focused = false }}
      oninput={(event) => {
        if (disabled) return
        query = event.currentTarget.value
        highlighted = -1
        expanded = true
        if (list) list.scrollTop = 0
        onInput?.(query)
      }}
      onkeydown={onKeydown} />
    {#if options.length}
      <button type="button" class="suggestions-toggle" {disabled}
        aria-label={showSuggestions ? 'Hide model suggestions' : 'Show model suggestions'}
        aria-expanded={showSuggestions} aria-controls={showSuggestions ? `${uid}-models` : undefined}
        onpointerdown={(event) => event.preventDefault()}
        onclick={() => {
          if (showSuggestions) expanded = false
          else { input.focus({ preventScroll: true }); openSuggestions() }
        }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d={showSuggestions ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
        </svg>
      </button>
    {/if}
  </div>
  {#if showSuggestions}
    <div class="suggestions" style={`--model-viewport-height: ${viewportHeight}px`}>
      <div class="model-options" id={`${uid}-models`} role="listbox" aria-label="Model suggestions" bind:this={list}>
        {#each visible as model, index (model)}
          <button type="button" role="option" id={`${uid}-model-${index}`} tabindex="-1"
            aria-selected={highlighted === index} class:highlighted={highlighted === index}
            class:current={model === draft}
            onpointerdown={(event) => event.preventDefault()} onclick={() => choose(model)}>{model}</button>
        {/each}
      </div>
      {#if !matches.length}
        <div class="model-hint" role="status">No matches. You can enter any model ID.</div>
      {:else if matches.length > visible.length}
        <div class="model-hint catalog-count">Showing {visible.length} of {matches.length}. Type to narrow.</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .model-input { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .model-control { display: flex; align-items: stretch; min-width: 0; }
  input { flex: 1; min-width: 0; width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; background: var(--bg); color: var(--text); font: inherit; font-size: max(16px, 1rem); }
  input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 15%, transparent); }
  input:has(+ button) { border-top-right-radius: 0; border-bottom-right-radius: 0; }
  .suggestions-toggle { flex: 0 0 40px; display: grid; place-items: center; border: 1px solid var(--border); border-left: 0; border-radius: 0 8px 8px 0; background: var(--bg); color: var(--muted); cursor: pointer; }
  .suggestions-toggle:hover { color: var(--accent); background: var(--panel); }
  .suggestions-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .suggestions-toggle:disabled { opacity: .5; cursor: not-allowed; }
  .suggestions { display: flex; flex-direction: column; container-type: size; height: min(var(--model-suggestions-height, 176px), var(--model-viewport-height)); min-height: 0; overflow: hidden; box-sizing: border-box; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); }
  .above .suggestions { order: -1; }
  .model-options { position: relative; flex: 1; overflow-y: auto; overflow-x: hidden; min-height: 0; overscroll-behavior: contain; scrollbar-width: thin; touch-action: pan-y; }
  .model-options:empty { display: none; }
  .model-options button { display: block; width: 100%; min-height: 44px; padding: 10px 12px; box-sizing: border-box; border: 0; border-radius: 0; background: transparent; color: var(--text); font: inherit; font-size: .9rem; text-align: left; overflow-wrap: anywhere; cursor: pointer; }
  .model-options button + button { border-top: 1px solid var(--border); }
  .model-options button:hover, .model-options button.highlighted { background: color-mix(in srgb, var(--accent) 12%, var(--bg)); }
  .model-options button.current { color: var(--accent); }
  .model-hint { flex-shrink: 0; padding: 10px 12px; color: var(--muted); font-size: .8rem; overflow-wrap: anywhere; }
  @container (max-height: 128px) { .catalog-count { display: none; } }
</style>

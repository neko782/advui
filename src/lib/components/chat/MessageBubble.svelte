<script>
  import { placeCaretAtEnd } from '../../utils/dom.js'
  import { renderMarkdown } from '../../utils/markdown.js'
  const props = $props()
  let el = $state(null)
  let reasoningOpen = $state(false)
  let lastReasoningId = $state(null)
  const reasoningSummary = $derived(() => (typeof props.message?.reasoningSummary === 'string' ? props.message.reasoningSummary : ''))
  const showReasoning = $derived(() => {
    const msg = props.message
    if (!msg || msg.role !== 'assistant') return false
    if (msg.reasoningSummaryLoading) return true
    return reasoningSummary.trim().length > 0
  })

  // When entering edit mode, seed text and move caret
  $effect(() => {
    if (props.isEditing && el) {
      try {
        el.textContent = props.editingText || ''
        el.focus()
        placeCaretAtEnd(el)
      } catch {}
    }
  })

  $effect(() => {
    const mid = props.message?.id ?? null
    if (mid !== lastReasoningId) {
      reasoningOpen = false
      lastReasoningId = mid
    }
  })

  function onPaste(e) {
    try {
      const text = e.clipboardData?.getData('text/plain')
      if (text != null) {
        e.preventDefault()
        document.execCommand('insertText', false, text)
      }
    } catch {}
  }
</script>

{#if props.isEditing}
  <div
    class={`bubble ${props.message.role} editing`}
    contenteditable="true"
    role="textbox"
    tabindex="0"
    aria-multiline="true"
    oninput={(e) => props.onEditInput?.(e.currentTarget.innerText)}
    onkeydown={props.onEditKeydown}
    onpaste={onPaste}
    bind:this={el}
  ></div>
{:else}
  {#if props.message.typing}
    <div class={`bubble ${props.message.role}`} data-typing={true}>
      {#if props.message.content && props.message.content !== 'typing'}
        {@html renderMarkdown(props.message.content)}
      {:else}
        <span class="dots"><i></i><i></i><i></i></span>
      {/if}
    </div>
  {:else if props.message.content}
    <div class={`bubble ${props.message.role}`}>
      {@html renderMarkdown(props.message.content)}
    </div>
    {#if showReasoning}
      <div class={`reasoning ${props.message.role}`}>
        <button
          type="button"
          class="reasoning-toggle"
          aria-expanded={reasoningOpen}
          onclick={() => (reasoningOpen = !reasoningOpen)}
        >
          <span class="reasoning-label">Reasoning</span>
          {#if props.message.reasoningSummaryLoading}
            <span class="reasoning-status">loading…</span>
          {:else if reasoningSummary.trim().length}
            <span class="reasoning-status">{reasoningOpen ? 'hide' : 'show'}</span>
          {:else}
            <span class="reasoning-status">not available</span>
          {/if}
          <span class={`chevron ${reasoningOpen ? 'open' : ''}`} aria-hidden="true"></span>
        </button>
        {#if reasoningOpen}
          <div class="reasoning-body">
            {#if props.message.reasoningSummaryLoading}
              <p class="reasoning-placeholder">Model is still summarizing…</p>
            {:else if reasoningSummary.trim().length}
              {@html renderMarkdown(reasoningSummary)}
            {:else}
              <p class="reasoning-placeholder">No reasoning summary was provided.</p>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  {/if}
{/if}

<style>
  .bubble { display: block; max-width: 100%; padding: 10px var(--bubble-pad-x); border-radius: 14px; border: none; white-space: normal; overflow-wrap: anywhere; word-break: break-word; line-height: 1.4; font-size: 0.98rem; box-shadow: 0 1px 0 rgba(0,0,0,0.04); }
  .bubble.editing { white-space: pre-wrap; }
  /* Markdown content inside bubbles rendered via {@html} */
  .bubble :global(h1), .bubble :global(h2), .bubble :global(h3), .bubble :global(h4), .bubble :global(h5), .bubble :global(h6) { margin: 0.2em 0 0.4em; line-height: 1.25; }
  .bubble :global(h1) { font-size: 1.35rem; }
  .bubble :global(h2) { font-size: 1.25rem; }
  .bubble :global(h3) { font-size: 1.15rem; }
  .bubble :global(p) { margin: 0.2em 0; }
  .bubble :global(p + p) { margin-top: 0.8em; }
  .bubble :global(ul), .bubble :global(ol) { margin: 0; padding-left: 2em; list-style-position: inside; }
  .bubble :global(ul) { list-style: disc; }
  .bubble :global(ol) { list-style: decimal; }
  .bubble :global(li) { margin: 0.2em 0; }
  .bubble :global(ul > li:first-child), .bubble :global(ol > li:first-child) { margin-top: 0; }
  .bubble :global(ul > li:last-child), .bubble :global(ol > li:last-child) { margin-bottom: 0; }
  .bubble :global(a) { color: var(--accent); text-decoration: underline; }
  .bubble :global(code) { background: color-mix(in srgb, var(--panel), #ffffff 8%); padding: 0 3px; border-radius: 4px; }
  .bubble :global(pre) { background: color-mix(in srgb, var(--panel), #ffffff 6%); padding: 10px; border-radius: 10px; overflow: auto; }
  .bubble :global(pre code) { background: transparent; padding: 0; }
  .bubble :global(p:first-child), .bubble :global(ul:first-child), .bubble :global(ol:first-child), .bubble :global(pre:first-child), .bubble :global(h1:first-child), .bubble :global(h2:first-child), .bubble :global(h3:first-child), .bubble :global(h4:first-child), .bubble :global(h5:first-child), .bubble :global(h6:first-child) { margin-top: 0; }
  .bubble :global(p:last-child), .bubble :global(ul:last-child), .bubble :global(ol:last-child), .bubble :global(pre:last-child), .bubble :global(h1:last-child), .bubble :global(h2:last-child), .bubble :global(h3:last-child), .bubble :global(h4:last-child), .bubble :global(h5:last-child), .bubble :global(h6:last-child) { margin-bottom: 0; }
  .bubble.assistant { background: transparent; justify-self: start; }
  .bubble.user { background: var(--user); color: var(--text); justify-self: end; }
  .bubble.system { justify-self: center; background: transparent; color: var(--muted); border: 1px dashed var(--border); }
  .dots { display: inline-flex; gap: 6px; align-items: center; }
  .dots i { width: 6px; height: 6px; display: inline-block; background: currentColor; opacity: 0.5; border-radius: 999px; animation: pop 1.2s infinite ease-in-out; }
  .dots i:nth-child(2) { animation-delay: .15s; }
  .dots i:nth-child(3) { animation-delay: .30s; }
  @keyframes pop { 0%, 80%, 100% { transform: translateY(0); opacity: .45 } 40% { transform: translateY(-3px); opacity: .9 } }
  .reasoning { display: grid; gap: 6px; margin-top: 4px; }
  .reasoning.assistant { justify-self: start; }
  .reasoning.user { justify-self: end; }
  .reasoning-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
    color: var(--muted);
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .reasoning-toggle:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; }
  .reasoning-label { font-weight: 600; }
  .reasoning-status { font-size: 0.8rem; text-transform: lowercase; }
  .chevron { width: 10px; height: 10px; position: relative; }
  .chevron::before {
    content: '';
    border: 4px solid transparent;
    border-top-color: currentColor;
    display: block;
    transform-origin: center;
    transition: transform .2s ease;
  }
  .chevron.open::before { transform: rotate(180deg); }
  .reasoning-body {
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px;
    font-size: 0.9rem;
    color: var(--text);
    background: color-mix(in srgb, var(--panel), #ffffff 4%);
  }
  .reasoning-body :global(p:first-child) { margin-top: 0; }
  .reasoning-body :global(p:last-child) { margin-bottom: 0; }
  .reasoning-placeholder { margin: 0; font-style: italic; color: var(--muted); }
</style>

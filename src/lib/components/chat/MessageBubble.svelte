<script>
  import { placeCaretAtEnd } from '../../utils/dom.js'
  import { renderMarkdown } from '../../utils/markdown.js'
  const props = $props()
  let el = $state(null)

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
  <div class={`bubble ${props.message.role}`} data-typing={props.message.typing ? true : undefined}>
    {#if props.message.typing}
      <span class="dots"><i></i><i></i><i></i></span>
    {:else}
      {@html renderMarkdown(props.message.content)}
    {/if}
  </div>
{/if}

<style>
  .bubble { display: block; max-width: 100%; padding: 10px var(--bubble-pad-x); border-radius: 14px; border: none; white-space: normal; overflow-wrap: anywhere; word-break: break-word; line-height: 1.4; font-size: 0.98rem; box-shadow: 0 1px 0 rgba(0,0,0,0.04); }
  .bubble.editing { white-space: pre-wrap; }
  .bubble.assistant { background: transparent; justify-self: start; }
  .bubble.user { background: var(--user); color: var(--text); justify-self: end; }
  .bubble.system { justify-self: center; background: transparent; color: var(--muted); border: 1px dashed var(--border); }
  .dots { display: inline-flex; gap: 6px; align-items: center; }
  .dots i { width: 6px; height: 6px; display: inline-block; background: currentColor; opacity: 0.5; border-radius: 999px; animation: pop 1.2s infinite ease-in-out; }
  .dots i:nth-child(2) { animation-delay: .15s; }
  .dots i:nth-child(3) { animation-delay: .30s; }
  @keyframes pop { 0%, 80%, 100% { transform: translateY(0); opacity: .45 } 40% { transform: translateY(-3px); opacity: .9 } }
</style>

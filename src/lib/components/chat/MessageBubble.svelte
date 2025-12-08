<script lang="ts">
  import { autoGrow } from '../../utils/dom'
  import { renderMarkdown } from '../../utils/markdown'
  import type { Message, Image } from '../../types'

  interface Props {
    message: Message
    isEditing?: boolean
    editingText?: string
    onEditInput?: (text: string) => void
    onEditKeydown?: (e: KeyboardEvent) => void
  }

  const props: Props = $props()
  let el = $state<HTMLTextAreaElement | null>(null)
  let reasoningOpen = $state(false)
  let lastReasoningId = $state<number | null>(null)
  let autoOpened = $state(false)
  let reasoningSummaryText = $state('')
  let showReasoning = $state(false)
  let lastSyncedEditingId = $state<number | null>(null)
  const EDIT_GROW_OPTS = { maxHeight: Number.POSITIVE_INFINITY, minHeight: 32 }

  function handleBubbleClick(e: MouseEvent) {
    const target = e.target as HTMLElement
    if (target.classList.contains('code-copy-btn')) {
      const wrapper = target.closest('.code-block-wrapper')
      const codeEl = wrapper?.querySelector('pre code')
      if (codeEl) {
        const code = codeEl.textContent || ''
        navigator.clipboard.writeText(code).then(() => {
          target.textContent = 'Copied!'
          setTimeout(() => { target.textContent = 'Copy' }, 1500)
        }).catch(() => {
          target.textContent = 'Failed'
          setTimeout(() => { target.textContent = 'Copy' }, 1500)
        })
      }
    }
  }

function isImageAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object') return false
  const mime = typeof attachment.mimeType === 'string' ? attachment.mimeType : ''
  if (mime.startsWith('image/')) return true
  if (!mime && typeof attachment.name === 'string') {
    return /\.(png|jpe?g|gif|webp)$/i.test(attachment.name)
  }
  return false
}

function isPdfAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object') return false
  const mime = (attachment.mimeType || '').toLowerCase()
  if (mime === 'application/pdf') return true
  if (!mime && typeof attachment.name === 'string') {
    return attachment.name.toLowerCase().endsWith('.pdf')
  }
  return false
}

function attachmentDisplayName(attachment) {
  if (!attachment || typeof attachment !== 'object') return 'attachment'
  if (typeof attachment.name === 'string' && attachment.name.trim()) return attachment.name.trim()
  if (typeof attachment.id === 'string' && attachment.id.trim()) return attachment.id.trim()
  return 'attachment'
}

function attachmentDataUrl(attachment) {
  if (!attachment || typeof attachment !== 'object') return ''
  const data = typeof attachment.data === 'string' && attachment.data ? attachment.data : ''
  if (!data) return ''
  const mime = typeof attachment.mimeType === 'string' && attachment.mimeType
    ? attachment.mimeType
    : (isPdfAttachment(attachment)
      ? 'application/pdf'
      : (isImageAttachment(attachment) ? 'image/png' : 'application/octet-stream'))
  return `data:${mime};base64,${data}`
}

function attachmentMimeLabel(attachment) {
  if (isPdfAttachment(attachment)) return 'PDF'
  const mime = typeof attachment?.mimeType === 'string' ? attachment.mimeType : ''
  if (!mime) return 'FILE'
  const parts = mime.split('/')
  if (parts.length === 2 && parts[1]) return parts[1].toUpperCase()
  return mime.toUpperCase()
}

  function extractReasoningSummary(msg) {
    const raw = msg?.reasoningSummary
    if (typeof raw === 'string') return raw
    if (Array.isArray(raw)) {
      try {
        return raw
          .map((part) => {
            if (typeof part === 'string') return part
            if (part && typeof part === 'object' && typeof part.text === 'string') return part.text
            return ''
          })
          .filter(Boolean)
          .join('\n\n\n')
          .replace(/\n{4,}/g, '\n\n\n')
      } catch {}
    }
    return ''
  }

  // When entering edit mode, seed text and move caret
  // Only sync when we start editing this specific message, not on every keystroke
  $effect(() => {
    if (!el || !props.isEditing) {
      lastSyncedEditingId = null
      return
    }

    const currentMessageId = props.message?.id

    // Only sync when we first start editing this message
    if (currentMessageId !== lastSyncedEditingId) {
      lastSyncedEditingId = currentMessageId
      try {
        const next = props.editingText ?? ''
        el.value = next
        // Defer all DOM operations to ensure the element is fully ready
        queueMicrotask(() => {
          if (!el) return
          autoGrow(el, EDIT_GROW_OPTS)
          el.focus()
          const len = (el.value ?? '').length
          if (typeof el.setSelectionRange === 'function') {
            el.setSelectionRange(len, len)
          }
        })
      } catch {}
    }
  })

  $effect(() => {
    if (!props.isEditing || !el) return
    void props.editingText
    queueMicrotask(() => autoGrow(el, EDIT_GROW_OPTS))
  })

  $effect(() => {
    const mid = props.message?.id ?? null
    if (mid !== lastReasoningId) {
      reasoningOpen = false
      autoOpened = false
      lastReasoningId = mid
    }
  })

  $effect(() => {
    const msg = props.message
    if (!msg) {
      reasoningSummaryText = ''
      showReasoning = false
      return
    }
    const text = extractReasoningSummary(msg)
    reasoningSummaryText = text
    const available = (msg.role === 'assistant') && text.trim().length > 0
    showReasoning = available
    if (!available) {
      reasoningOpen = false
      autoOpened = false
      return
    }
    if (!autoOpened) {
      reasoningOpen = true
      autoOpened = true
    }
  })

  function toggleReasoning() {
    reasoningOpen = !reasoningOpen
    autoOpened = true
  }

  function onPaste(e) {
    try {
      const text = e.clipboardData?.getData('text/plain')
      if (text != null) {
        e.preventDefault()
        const target = e.currentTarget
        if (target && typeof target.setRangeText === 'function') {
          const start = target.selectionStart ?? target.value.length
          const end = target.selectionEnd ?? target.value.length
          target.setRangeText(text, start, end, 'end')
          props.onEditInput?.(target.value)
          queueMicrotask(() => autoGrow(target, EDIT_GROW_OPTS))
        } else {
          document.execCommand('insertText', false, text)
        }
      }
    } catch {}
  }
</script>

{#if props.isEditing}
  <span class={`editor-container ${props.message.role}`}>
    <span class={`editor-sizer bubble ${props.message.role} editing`} aria-hidden="true">{props.editingText ?? ''}</span>
    <textarea
      class={`bubble ${props.message.role} editing editor-area`}
      rows="1"
      value={props.editingText ?? ''}
      oninput={(e) => {
        const target = e.currentTarget
        props.onEditInput?.(target.value)
        queueMicrotask(() => autoGrow(target, EDIT_GROW_OPTS))
      }}
      onkeydown={props.onEditKeydown}
      onpaste={onPaste}
      bind:this={el}
    ></textarea>
  </span>
{:else}
  {#if showReasoning}
    <div class={`reasoning ${props.message.role}`}>
      <button
        type="button"
        class="reasoning-toggle"
        aria-expanded={reasoningOpen}
        onclick={toggleReasoning}
      >
        <span class="reasoning-label">Reasoning</span>
        <span class={`chevron ${reasoningOpen ? 'open' : ''}`} aria-hidden="true"></span>
      </button>
      {#if reasoningOpen}
        <div class="reasoning-body">
          {@html renderMarkdown(reasoningSummaryText)}
        </div>
      {/if}
    </div>
  {/if}
  {#if props.message.typing}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
    <div class={`bubble ${props.message.role}`} data-typing={true} onclick={handleBubbleClick}>
      {#if props.message.content && props.message.content !== 'typing'}
          {@html renderMarkdown(props.message.content)}
      {:else}
        <span class="dots"><i></i><i></i><i></i></span>
      {/if}
    </div>
  {:else if props.message.content || (props.message.images && props.message.images.length > 0)}
    {#if props.message.images && props.message.images.length > 0}
      <div class={`message-images ${props.message.role}`}>
        {#each props.message.images as attachment (attachment.id)}
          {#if isImageAttachment(attachment)}
            {#if attachment?.data}
              <img
                src={attachmentDataUrl(attachment)}
                alt={attachmentDisplayName(attachment)}
                class="message-image"
              />
            {:else}
              <div class="message-file placeholder">
                <span class="file-label">{attachmentDisplayName(attachment)}</span>
              </div>
            {/if}
          {:else}
            {#if attachment?.data}
              <a
                class="message-file"
                href={attachmentDataUrl(attachment)}
                target="_blank"
                rel="noopener noreferrer"
                download={attachmentDisplayName(attachment)}
              >
                <span class="file-label">{attachmentDisplayName(attachment)}</span>
                <span class="file-meta">{attachmentMimeLabel(attachment)}</span>
              </a>
            {:else}
              <div class="message-file placeholder">
                <span class="file-label">{attachmentDisplayName(attachment)}</span>
              </div>
            {/if}
          {/if}
        {/each}
      </div>
    {/if}
    {#if props.message.content}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
      <div class={`bubble ${props.message.role}`} onclick={handleBubbleClick}>
        {@html renderMarkdown(props.message.content)}
      </div>
    {/if}
  {/if}
{/if}

<style>
  .bubble { display: block; max-width: 100%; padding: 10px var(--bubble-pad-x); border-radius: 14px; border: none; white-space: normal; overflow-wrap: anywhere; word-break: break-word; line-height: 1.4; font-size: 0.98rem; box-shadow: 0 1px 0 rgba(0,0,0,0.04); }
  .bubble.editing { white-space: pre-wrap; }
  .editor-container {
    display: inline-grid;
    grid-template-columns: auto;
    max-width: 100%;
    vertical-align: top;
  }
  .editor-container.assistant {
    justify-self: start;
  }
  .editor-container.user {
    justify-self: end;
  }
  .editor-container.system {
    justify-self: center;
  }
  .editor-sizer {
    grid-area: 1 / 1;
    display: block;
    visibility: hidden;
    white-space: pre-wrap;
    padding: 10px var(--bubble-pad-x);
    border: none;
    border-radius: 14px;
    overflow-wrap: anywhere;
    word-break: break-word;
    line-height: 1.4;
    font-size: inherit;
    font-family: inherit;
    pointer-events: none;
    min-width: 32px;
    min-height: 32px;
    width: 100%;
    max-width: 100%;
    overflow: hidden;
    box-sizing: border-box;
  }
  .bubble.editing.editor-area {
    grid-area: 1 / 1;
    width: 100%;
    max-width: 100%;
    resize: none;
    outline: none;
    overflow: hidden;
    font-family: inherit;
    font-size: inherit;
    box-sizing: border-box;
    min-height: 32px;
  }
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
  /* Table styles */
  .bubble :global(table) {
    display: block;
    width: max-content;
    overflow-x: auto;
    border-collapse: separate;
    border-spacing: 0;
    margin: 0.5em 0;
    font-size: 0.9rem;
  }
  .bubble :global(th), .bubble :global(td) {
    padding: 8px 12px;
    text-align: left;
    max-width: 300px;
    word-break: break-word;
    border: 1px solid var(--border);
    border-top: none;
    border-left: none;
  }
  .bubble :global(th) {
    font-weight: 600;
    background: color-mix(in srgb, var(--panel), #000000 6%);
  }
  .bubble :global(tr:nth-child(even)) {
    background: color-mix(in srgb, var(--panel), #000000 2%);
  }
  /* First column left border */
  .bubble :global(th:first-child), .bubble :global(td:first-child) {
    border-left: 1px solid var(--border);
  }
  /* First row top border */
  .bubble :global(thead tr:first-child th), .bubble :global(tbody:first-child tr:first-child td) {
    border-top: 1px solid var(--border);
  }
  /* Rounded corners */
  .bubble :global(thead tr:first-child th:first-child), .bubble :global(tbody:first-child tr:first-child td:first-child) {
    border-top-left-radius: 8px;
  }
  .bubble :global(thead tr:first-child th:last-child), .bubble :global(tbody:first-child tr:first-child td:last-child) {
    border-top-right-radius: 8px;
  }
  .bubble :global(tbody tr:last-child td:first-child) {
    border-bottom-left-radius: 8px;
  }
  .bubble :global(tbody tr:last-child td:last-child) {
    border-bottom-right-radius: 8px;
  }
  .bubble :global(table:first-child) { margin-top: 0; }
  .bubble :global(table:last-child) { margin-bottom: 0; }
  .bubble :global(code) { background: color-mix(in srgb, var(--panel), #ffffff 8%); padding: 0 3px; border-radius: 4px; }
  .bubble :global(.code-block-wrapper) {
    border-radius: 10px;
    overflow: hidden;
    background: color-mix(in srgb, var(--panel), #000000 4%);
    margin: 0.5em 0;
    border: 1px solid var(--border);
  }
  .bubble :global(.code-block-header) {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 12px;
    background: color-mix(in srgb, var(--border), transparent 50%);
    font-size: 0.75rem;
    border-bottom: 1px solid var(--border);
  }
  .bubble :global(.code-lang) {
    color: var(--muted);
    text-transform: lowercase;
    font-family: inherit;
  }
  .bubble :global(.code-copy-btn) {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--muted);
    padding: 2px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.7rem;
    transition: all 0.15s ease;
  }
  .bubble :global(.code-copy-btn:hover) {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .bubble :global(pre) { background: transparent; padding: 12px; margin: 0; border-radius: 0; overflow: auto; }
  .bubble :global(pre code) { background: transparent; padding: 0; }
  /* highlight.js theme - GitHub-inspired light/dark */
  .bubble :global(.hljs-comment), .bubble :global(.hljs-quote) { color: var(--muted); font-style: italic; }
  .bubble :global(.hljs-keyword), .bubble :global(.hljs-selector-tag), .bubble :global(.hljs-addition) { color: #d73a49; }
  .bubble :global(.hljs-string), .bubble :global(.hljs-meta .hljs-string), .bubble :global(.hljs-regexp), .bubble :global(.hljs-selector-attr), .bubble :global(.hljs-selector-pseudo) { color: #032f62; }
  .bubble :global(.hljs-number), .bubble :global(.hljs-literal), .bubble :global(.hljs-type), .bubble :global(.hljs-template-variable), .bubble :global(.hljs-variable), .bubble :global(.hljs-symbol), .bubble :global(.hljs-bullet), .bubble :global(.hljs-built_in) { color: #005cc5; }
  .bubble :global(.hljs-title), .bubble :global(.hljs-section), .bubble :global(.hljs-attribute), .bubble :global(.hljs-name) { color: #6f42c1; }
  .bubble :global(.hljs-function), .bubble :global(.hljs-title.function_) { color: #6f42c1; }
  .bubble :global(.hljs-params) { color: var(--text); }
  .bubble :global(.hljs-meta), .bubble :global(.hljs-tag) { color: #22863a; }
  .bubble :global(.hljs-attr) { color: #005cc5; }
  .bubble :global(.hljs-deletion) { color: #b31d28; }
  :global([data-theme='dark']) .bubble :global(.hljs-keyword), :global([data-theme='dark']) .bubble :global(.hljs-selector-tag), :global([data-theme='dark']) .bubble :global(.hljs-addition) { color: #ff7b72; }
  :global([data-theme='dark']) .bubble :global(.hljs-string), :global([data-theme='dark']) .bubble :global(.hljs-meta .hljs-string), :global([data-theme='dark']) .bubble :global(.hljs-regexp) { color: #a5d6ff; }
  :global([data-theme='dark']) .bubble :global(.hljs-number), :global([data-theme='dark']) .bubble :global(.hljs-literal), :global([data-theme='dark']) .bubble :global(.hljs-type), :global([data-theme='dark']) .bubble :global(.hljs-built_in) { color: #79c0ff; }
  :global([data-theme='dark']) .bubble :global(.hljs-title), :global([data-theme='dark']) .bubble :global(.hljs-section), :global([data-theme='dark']) .bubble :global(.hljs-attribute), :global([data-theme='dark']) .bubble :global(.hljs-name) { color: #d2a8ff; }
  :global([data-theme='dark']) .bubble :global(.hljs-meta), :global([data-theme='dark']) .bubble :global(.hljs-tag) { color: #7ee787; }
  :global([data-theme='dark']) .bubble :global(.hljs-attr) { color: #79c0ff; }
  :global([data-theme='dark']) .bubble :global(.hljs-deletion) { color: #ffa198; }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .bubble :global(.hljs-keyword), :global(:root:not([data-theme='light'])) .bubble :global(.hljs-selector-tag), :global(:root:not([data-theme='light'])) .bubble :global(.hljs-addition) { color: #ff7b72; }
    :global(:root:not([data-theme='light'])) .bubble :global(.hljs-string), :global(:root:not([data-theme='light'])) .bubble :global(.hljs-meta .hljs-string), :global(:root:not([data-theme='light'])) .bubble :global(.hljs-regexp) { color: #a5d6ff; }
    :global(:root:not([data-theme='light'])) .bubble :global(.hljs-number), :global(:root:not([data-theme='light'])) .bubble :global(.hljs-literal), :global(:root:not([data-theme='light'])) .bubble :global(.hljs-type), :global(:root:not([data-theme='light'])) .bubble :global(.hljs-built_in) { color: #79c0ff; }
    :global(:root:not([data-theme='light'])) .bubble :global(.hljs-title), :global(:root:not([data-theme='light'])) .bubble :global(.hljs-section), :global(:root:not([data-theme='light'])) .bubble :global(.hljs-attribute), :global(:root:not([data-theme='light'])) .bubble :global(.hljs-name) { color: #d2a8ff; }
    :global(:root:not([data-theme='light'])) .bubble :global(.hljs-meta), :global(:root:not([data-theme='light'])) .bubble :global(.hljs-tag) { color: #7ee787; }
    :global(:root:not([data-theme='light'])) .bubble :global(.hljs-attr) { color: #79c0ff; }
    :global(:root:not([data-theme='light'])) .bubble :global(.hljs-deletion) { color: #ffa198; }
  }
  .bubble :global(p:first-child), .bubble :global(ul:first-child), .bubble :global(ol:first-child), .bubble :global(pre:first-child), .bubble :global(h1:first-child), .bubble :global(h2:first-child), .bubble :global(h3:first-child), .bubble :global(h4:first-child), .bubble :global(h5:first-child), .bubble :global(h6:first-child), .bubble :global(.code-block-wrapper:first-child) { margin-top: 0; }
  .bubble :global(p:last-child), .bubble :global(ul:last-child), .bubble :global(ol:last-child), .bubble :global(pre:last-child), .bubble :global(h1:last-child), .bubble :global(h2:last-child), .bubble :global(h3:last-child), .bubble :global(h4:last-child), .bubble :global(h5:last-child), .bubble :global(h6:last-child), .bubble :global(.code-block-wrapper:last-child) { margin-bottom: 0; }
  .bubble.assistant {
    background: transparent;
    justify-self: start;
    padding-inline-start: 0;
    box-shadow: none;
  }
  .bubble.user { background: var(--user); color: var(--text); justify-self: end; }
  .bubble.system { justify-self: center; background: transparent; color: var(--muted); border: 1px dashed var(--border); }
  .dots { display: inline-flex; gap: 6px; align-items: center; }
  .dots i { width: 6px; height: 6px; display: inline-block; background: currentColor; opacity: 0.5; border-radius: 999px; animation: pop 1.2s infinite ease-in-out; will-change: transform, opacity; }
  .dots i:nth-child(2) { animation-delay: .15s; }
  .dots i:nth-child(3) { animation-delay: .30s; }
  @keyframes pop { 0%, 80%, 100% { transform: translateY(0); opacity: .45 } 40% { transform: translateY(-3px); opacity: .9 } }
  .reasoning { display: grid; gap: 6px; margin: 10px 0 6px; }
  .reasoning.assistant { justify-self: stretch; }
  .reasoning.user { justify-self: stretch; }
  .reasoning-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    gap: 6px;
    justify-self: start;
    font-size: 0.85rem;
    color: var(--muted);
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .reasoning-toggle:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; }
  .reasoning-label { font-weight: 600; }
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
  .reasoning-body :global(p) { margin: 0.4em 0; }
  .reasoning-body :global(p + p) { margin-top: 0.75em; }
  .reasoning-body :global(p:has(> strong) + p) { margin-top: 0.4em; }
  .reasoning-body :global(p:first-child) { margin-top: 0; }
  .reasoning-body :global(p:last-child) { margin-bottom: 0; }
  .message-images {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 6px;
  }
  .message-images.assistant {
    justify-content: flex-start;
  }
  .message-images.user {
    justify-content: flex-end;
  }
  .message-images.system {
    justify-content: center;
  }
  .message-image {
    max-width: 300px;
    max-height: 300px;
    border-radius: 10px;
    object-fit: contain;
    border: 1px solid var(--border);
  }
  .message-file {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-width: 120px;
    max-width: 200px;
    padding: 10px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--panel), transparent 20%);
    color: var(--text);
    text-decoration: none;
    gap: 6px;
    font-size: 0.85rem;
    line-height: 1.2;
    word-break: break-word;
  }
  .message-file:hover {
    border-color: var(--accent);
  }
  .message-file.placeholder {
    pointer-events: none;
    border-style: dashed;
    background: color-mix(in srgb, var(--panel), transparent 35%);
  }
  .message-file .file-label {
    font-weight: 600;
    text-align: center;
  }
  .message-file .file-meta {
    font-size: 0.7rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
</style>

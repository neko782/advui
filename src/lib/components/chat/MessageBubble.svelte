<script lang="ts">
  import { autoGrow } from '../../utils/dom'
  import {
    isImageAttachment,
    isVideoAttachment,
    isAudioAttachment,
    attachmentDisplayName,
    attachmentDataUrl,
    attachmentMimeLabel
  } from '../../attachments/mime'
  import type { Message } from '../../types'
  import MarkdownContent from './LazyMarkdownContent.svelte'
  import ActivityLog from './ActivityLog.svelte'
  import { activityOf } from '../../api/activity'
  import { steeredParts } from '../../api/steering'

  interface Props {
    message: Message
    imageCache?: Record<string, { data: string; mimeType?: string; name?: string }>
    isEditing?: boolean
    editingText?: string
    allowInlineHtml?: boolean
    renderLatex?: boolean
    onEditInput?: (text: string) => void
    onEditKeydown?: (e: KeyboardEvent) => void
  }

  const props: Props = $props()
  let el = $state<HTMLTextAreaElement | null>(null)
  let lastSyncedEditingId = $state<number | null>(null)
  const EDIT_GROW_OPTS = { maxHeight: Number.POSITIVE_INFINITY, minHeight: 32 }

// Attachment type detection & display lives in ../../attachments/mime.ts (shared).

type ImageCache = Props['imageCache']
type AttachmentLike = { id?: string; data?: string; mimeType?: string; name?: string; revisedPrompt?: string; [key: string]: unknown }

function resolveAttachment(attachment: string | AttachmentLike | null | undefined, imageCache: ImageCache): AttachmentLike | null {
  if (attachment == null) return null
  if (typeof attachment === 'string') {
    const id = attachment.trim()
    if (!id) return null
    const cached = imageCache?.[id]
    return cached?.data
      ? { id, data: cached.data, mimeType: cached.mimeType, name: cached.name }
      : { id }
  }
  if (typeof attachment !== 'object') return null
  if (typeof attachment.data === 'string' && attachment.data) return attachment
  const id = typeof attachment.id === 'string' && attachment.id.trim() ? attachment.id.trim() : null
  if (!id) return attachment
  const cached = imageCache?.[id]
  if (!cached?.data) return attachment
  return {
    ...attachment,
    data: cached.data,
    mimeType: attachment.mimeType || cached.mimeType,
    name: attachment.name ?? cached.name,
  }
}

const resolvedAttachments = $derived.by(() => {
  const attachments = Array.isArray(props.message?.images) ? props.message.images : []
  if (!attachments.length) return []
  return attachments.map((attachment) => resolveAttachment(attachment as AttachmentLike, props.imageCache)).filter((a): a is AttachmentLike => !!a)
})

function resolveGeneratedImage(image: AttachmentLike | null | undefined, imageCache: ImageCache): AttachmentLike | null {
  if (!image || typeof image !== 'object') return null
  if (typeof image.data === 'string' && image.data) return image
  const id = typeof image.id === 'string' && image.id.trim() ? image.id.trim() : null
  if (!id) return null
  const cached = imageCache?.[id]
  if (!cached?.data) return null
  return {
    ...image,
    data: cached.data,
    mimeType: image.mimeType || cached.mimeType || 'image/png',
    name: image.name ?? cached.name,
  }
}

const resolvedGeneratedImages = $derived.by(() => {
  const images = Array.isArray(props.message?.generatedImages) ? props.message.generatedImages : []
  if (!images.length) return []
  return images.map((image) => resolveGeneratedImage(image as AttachmentLike, props.imageCache)).filter((a): a is AttachmentLike => !!a)
})

  // Steering messages still queued show as user bubbles after the text
  // written so far (delivered ones are messages of their own). Older replies
  // kept delivered ones in their steps; they show where they reached the model.
  const steered = $derived.by(() => {
    if (props.message?.role !== 'assistant') return null
    const raw = typeof props.message.content === 'string' ? props.message.content : ''
    const content = props.message.typing && raw === 'typing' ? '' : raw
    return steeredParts(content, activityOf(props.message))
  })

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

  function onPaste(e: ClipboardEvent) {
    try {
      const text = e.clipboardData?.getData('text/plain')
      if (text != null) {
        e.preventDefault()
        const target = e.currentTarget as HTMLTextAreaElement | null
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
  {#if props.message.role === 'assistant'}
    <ActivityLog message={props.message} allowInlineHtml={props.allowInlineHtml} renderLatex={props.renderLatex} />
  {/if}
  {#if steered}
    {#each steered as part, i (part.key)}
      {#if part.kind === 'steer'}
        <div class="steer" class:pending={part.pending}>
          <div class="bubble user">
            <MarkdownContent content={part.text} allowInlineHtml={props.allowInlineHtml} renderLatex={props.renderLatex} />
          </div>
        </div>
      {:else}
        <div class="bubble assistant" data-typing={props.message.typing || undefined}>
          <MarkdownContent
            content={part.text}
            allowInlineHtml={props.allowInlineHtml}
            renderLatex={props.renderLatex}
            streaming={!!props.message.typing && i === steered.length - 1}
          />
        </div>
      {/if}
    {/each}
    {#if props.message.typing && steered[steered.length - 1]?.kind !== 'text'}
      <div class="bubble assistant" data-typing={true}><span class="dots"><i></i><i></i><i></i></span></div>
    {/if}
  {:else if props.message.typing}
    <div class={`bubble ${props.message.role}`} data-typing={true}>
      {#if props.message.content && props.message.content !== 'typing'}
        <MarkdownContent
          content={props.message.content}
          allowInlineHtml={props.allowInlineHtml}
          renderLatex={props.renderLatex}
          streaming={true}
        />
      {:else}
        <span class="dots"><i></i><i></i><i></i></span>
      {/if}
    </div>
  {:else if props.message.content || resolvedAttachments.length > 0 || (props.message.generatedImages && props.message.generatedImages.length > 0)}
    {#if resolvedAttachments.length > 0}
      <div class={`message-images ${props.message.role}`}>
        {#each resolvedAttachments as attachment (attachment.id)}
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
          {:else if isVideoAttachment(attachment)}
            {#if attachment?.data}
              <div class="message-video-container">
                <video
                  src={attachmentDataUrl(attachment)}
                  class="message-video"
                  controls
                  preload="metadata"
                >
                  <track kind="captions" />
                  Your browser does not support the video tag.
                </video>
                <div class="attachment-name">{attachmentDisplayName(attachment)}</div>
              </div>
            {:else}
              <div class="message-file placeholder">
                <span class="file-label">{attachmentDisplayName(attachment)}</span>
                <span class="file-meta">VIDEO</span>
              </div>
            {/if}
          {:else if isAudioAttachment(attachment)}
            {#if attachment?.data}
              <div class="message-audio-container">
                <audio
                  src={attachmentDataUrl(attachment)}
                  class="message-audio"
                  controls
                  preload="metadata"
                >
                  Your browser does not support the audio tag.
                </audio>
                <div class="attachment-name">{attachmentDisplayName(attachment)}</div>
              </div>
            {:else}
              <div class="message-file placeholder">
                <span class="file-label">{attachmentDisplayName(attachment)}</span>
                <span class="file-meta">AUDIO</span>
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
      <div class={`bubble ${props.message.role}`}>
        <MarkdownContent
          content={props.message.content}
          allowInlineHtml={props.allowInlineHtml}
          renderLatex={props.renderLatex}
        />
      </div>
    {/if}
    {#if resolvedGeneratedImages.length > 0}
      <div class={`generated-images ${props.message.role}`}>
        {#each resolvedGeneratedImages as genImg (genImg.id)}
          <div class="generated-image-container">
            <img
              src={`data:${genImg.mimeType || 'image/png'};base64,${genImg.data}`}
              alt={genImg.revisedPrompt || 'Generated image'}
              class="generated-image"
            />
            {#if genImg.revisedPrompt}
              <div class="generated-image-prompt" title={genImg.revisedPrompt}>
                {genImg.revisedPrompt}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
{/if}

<style>
  .bubble { display: block; max-width: 100%; min-width: 0; padding: 10px var(--bubble-pad-x); border-radius: 14px; border: none; white-space: normal; overflow-wrap: anywhere; word-break: break-word; line-height: 1.4; font-size: 0.98rem; box-shadow: 0 1px 0 rgba(0,0,0,0.04); overflow-x: auto; }
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
  .bubble :global(.katex-display) {
    max-width: 100%;
    margin: 0.5em 0;
    overflow-x: auto;
    overflow-y: hidden;
    padding-block: 0.15em;
  }
  /* Table styles */
  .bubble :global(.table-block-wrapper) {
    width: 100%;
    max-width: 100%;
    margin: 0.5em 0;
    border-radius: 0;
    background: color-mix(in srgb, var(--panel), #000000 4%);
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
  }
  .bubble :global(.table-block-wrapper table) {
    width: max-content;
    border-collapse: separate;
    border-spacing: 0;
    border-radius: 8px;
    overflow: hidden;
    margin: 0;
    font-size: 0.9rem;
  }
  .bubble :global(.table-block-wrapper th), .bubble :global(.table-block-wrapper td) {
    padding: 8px 12px;
    text-align: left;
    word-break: normal;
    overflow-wrap: anywhere;
    border: 1px solid var(--border);
    border-top: none;
    border-left: none;
  }
  .bubble :global(.table-block-wrapper th) {
    font-weight: 600;
    background: color-mix(in srgb, var(--panel), #000000 6%);
  }
  .bubble :global(.table-block-wrapper tr:nth-child(even)) {
    background: color-mix(in srgb, var(--panel), #000000 2%);
  }
  /* First column left border */
  .bubble :global(.table-block-wrapper th:first-child), .bubble :global(.table-block-wrapper td:first-child) {
    border-left: 1px solid var(--border);
  }
  /* First row top border */
  .bubble :global(.table-block-wrapper thead tr:first-child th), .bubble :global(.table-block-wrapper tbody:first-child tr:first-child td) {
    border-top: 1px solid var(--border);
  }
  /* Rounded corners */
  .bubble :global(.table-block-wrapper thead tr:first-child th:first-child), .bubble :global(.table-block-wrapper tbody:first-child tr:first-child td:first-child) {
    border-top-left-radius: 8px;
  }
  .bubble :global(.table-block-wrapper thead tr:first-child th:last-child), .bubble :global(.table-block-wrapper tbody:first-child tr:first-child td:last-child) {
    border-top-right-radius: 8px;
  }
  .bubble :global(.table-block-wrapper tbody tr:last-child td:first-child) {
    border-bottom-left-radius: 8px;
  }
  .bubble :global(.table-block-wrapper tbody tr:last-child td:last-child) {
    border-bottom-right-radius: 8px;
  }
  .bubble :global(.table-block-wrapper:first-child) { margin-top: 0; }
  .bubble :global(.table-block-wrapper:last-child) { margin-bottom: 0; }
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
  .bubble :global(p:first-child), .bubble :global(ul:first-child), .bubble :global(ol:first-child), .bubble :global(pre:first-child), .bubble :global(h1:first-child), .bubble :global(h2:first-child), .bubble :global(h3:first-child), .bubble :global(h4:first-child), .bubble :global(h5:first-child), .bubble :global(h6:first-child), .bubble :global(.code-block-wrapper:first-child), .bubble :global(.table-block-wrapper:first-child) { margin-top: 0; }
  .bubble :global(p:last-child), .bubble :global(ul:last-child), .bubble :global(ol:last-child), .bubble :global(pre:last-child), .bubble :global(h1:last-child), .bubble :global(h2:last-child), .bubble :global(h3:last-child), .bubble :global(h4:last-child), .bubble :global(h5:last-child), .bubble :global(h6:last-child), .bubble :global(.code-block-wrapper:last-child), .bubble :global(.table-block-wrapper:last-child) { margin-bottom: 0; }
  .bubble.assistant {
    background: transparent;
    justify-self: start;
    padding-inline-start: 0;
    box-shadow: none;
  }
  .bubble.user { background: var(--user); color: var(--text); justify-self: end; }
  /* A steering message lines up with the user's own messages: the row is
     their container (MessageItem), and the reply's stack starts at its left. */
  .steer { justify-self: start; display: flex; justify-content: flex-end; width: 100cqw; margin: 6px 0; }
  .steer > .bubble { max-width: min(720px, 92cqw); }
  .steer.pending { opacity: 0.6; }
  .bubble.system { justify-self: center; background: transparent; color: var(--muted); border: 1px dashed var(--border); }
  .dots { display: inline-flex; gap: 6px; align-items: center; }
  .dots i { width: 6px; height: 6px; display: inline-block; background: currentColor; opacity: 0.5; border-radius: 999px; animation: pop 1.2s infinite ease-in-out; will-change: transform, opacity; }
  .dots i:nth-child(2) { animation-delay: .15s; }
  .dots i:nth-child(3) { animation-delay: .30s; }
  @keyframes pop { 0%, 80%, 100% { transform: translateY(0); opacity: .45 } 40% { transform: translateY(-3px); opacity: .9 } }
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
  .message-video-container {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .message-video {
    max-width: 400px;
    max-height: 300px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: #000;
  }
  .message-audio-container {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .message-audio {
    max-width: 300px;
    border-radius: 24px;
  }
  .attachment-name {
    font-size: 0.75rem;
    color: var(--muted);
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  /* Generated images */
  .generated-images {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 8px;
  }
  .generated-images.assistant {
    justify-content: flex-start;
  }
  .generated-images.user {
    justify-content: flex-end;
  }
  .generated-images.system {
    justify-content: center;
  }
  .generated-image-container {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 512px;
  }
  .generated-image {
    max-width: 100%;
    max-height: 512px;
    border-radius: 12px;
    object-fit: contain;
    border: 1px solid var(--border);
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }
  .generated-image-prompt {
    font-size: 0.8rem;
    color: var(--muted);
    line-height: 1.3;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
</style>

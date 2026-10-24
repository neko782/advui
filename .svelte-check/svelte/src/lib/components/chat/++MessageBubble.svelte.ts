///<reference types="svelte" />
;
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
import MarkdownContent from './MarkdownContent.svelte';
;

  interface Props {
    message: Message
    imageCache?: Record<string, { data: string; mimeType?: string; name?: string }>
    isEditing?: boolean
    editingText?: string
    allowInlineHtml?: boolean
    renderLatex?: boolean
    onEditInput?: (text: string) => void
    onEditKeydown?: (e: KeyboardEvent) => void
  };;

// Attachment type detection & display lives in ../../attachments/mime.ts (shared).

type ImageCache = Props['imageCache'];;
type AttachmentLike = { id?: string; data?: string; mimeType?: string; name?: string; revisedPrompt?: string; [key: string]: unknown };function $$render() {

  
  
  
  


  const props: Props = $props()
  let el = $state<HTMLTextAreaElement | null>(null)
  let reasoningOpen = $state(false)
  let lastReasoningId = $state<number | null>(null)
  let autoOpened = $state(false)
  let reasoningSummaryText = $state('')
  let showReasoning = $state(false)
  let lastSyncedEditingId = $state<number | null>(null)
  const EDIT_GROW_OPTS = { maxHeight: Number.POSITIVE_INFINITY, minHeight: 32 }



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

  function extractReasoningSummary(msg: Message | null | undefined) {
    const raw: unknown = msg?.reasoningSummary
    if (typeof raw === 'string') return raw
    if (Array.isArray(raw)) {
      try {
        return raw
          .map((part: unknown) => {
            if (typeof part === 'string') return part
            const text = (part as { text?: unknown } | null)?.text
            if (typeof text === 'string') return text
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
;
async () => {

if(props.isEditing){
   { svelteHTML.createElement("span", { "class":`editor-container ${props.message.role}`,});
     { svelteHTML.createElement("span", {   "class":`editor-sizer bubble ${props.message.role} editing`,"aria-hidden":`true`,});props.editingText ?? ''; }
     { const $$_textarea1 = svelteHTML.createElement("textarea", {              "class":`bubble ${props.message.role} editing editor-area`,"rows":1,"value":props.editingText ?? '',"oninput":(e) => {
        const target = e.currentTarget
        props.onEditInput?.(target.value)
        queueMicrotask(() => autoGrow(target, EDIT_GROW_OPTS))
      },"onkeydown":props.onEditKeydown,"onpaste":onPaste,});el = $$_textarea1; }
   }
}else{
  if(showReasoning){
     { svelteHTML.createElement("div", { "class":`reasoning ${props.message.role}`,});
       { svelteHTML.createElement("button", {         "type":`button`,"class":`reasoning-toggle`,"aria-expanded":reasoningOpen,"onclick":toggleReasoning,});
         { svelteHTML.createElement("span", { "class":`reasoning-label`,});  }
         { svelteHTML.createElement("span", {   "class":`chevron ${reasoningOpen ? 'open' : ''}`,"aria-hidden":`true`,}); }
       }
      if(reasoningOpen){
         { svelteHTML.createElement("div", { "class":`reasoning-body`,});
           { const $$_tnetnoCnwodkraM2C = __sveltets_2_ensureComponent(MarkdownContent); new $$_tnetnoCnwodkraM2C({ target: __sveltets_2_any(), props: {         "content":reasoningSummaryText,"allowInlineHtml":props.allowInlineHtml,"renderLatex":props.renderLatex,"streaming":props.message.reasoningSummaryLoading,}});}
         }
      }
     }
  }
  if(props.message.typing){
     { svelteHTML.createElement("div", {   "class":`bubble ${props.message.role}`,...__sveltets_2_empty({"data-typing":true}),});
      if(props.message.content && props.message.content !== 'typing'){
         { const $$_tnetnoCnwodkraM1C = __sveltets_2_ensureComponent(MarkdownContent); new $$_tnetnoCnwodkraM1C({ target: __sveltets_2_any(), props: {         "content":props.message.content,"allowInlineHtml":props.allowInlineHtml,"renderLatex":props.renderLatex,"streaming":true,}});}
      }else{
         { svelteHTML.createElement("span", { "class":`dots`,}); { svelteHTML.createElement("i", {}); } { svelteHTML.createElement("i", {}); } { svelteHTML.createElement("i", {}); } }
      }
     }
  } else if (props.message.content || resolvedAttachments.length > 0 || (props.message.generatedImages && props.message.generatedImages.length > 0)){
    if(resolvedAttachments.length > 0){
       { svelteHTML.createElement("div", { "class":`message-images ${props.message.role}`,});
           for(let attachment of __sveltets_2_ensureArray(resolvedAttachments)){attachment.id;
          if(isImageAttachment(attachment)){
            if(attachment?.data){
               { svelteHTML.createElement("img", {       "src":attachmentDataUrl(attachment),"alt":attachmentDisplayName(attachment),"class":`message-image`,});}
            }else{
               { svelteHTML.createElement("div", { "class":`message-file placeholder`,});
                 { svelteHTML.createElement("span", { "class":`file-label`,});attachmentDisplayName(attachment); }
               }
            }
          } else if (isVideoAttachment(attachment)){
            if(attachment?.data){
               { svelteHTML.createElement("div", { "class":`message-video-container`,});
                 { svelteHTML.createElement("video", {        "src":attachmentDataUrl(attachment),"class":`message-video`,"controls":true,"preload":`metadata`,});
                   { svelteHTML.createElement("track", {  "kind":`captions`,});}
                         
                 }
                 { svelteHTML.createElement("div", { "class":`attachment-name`,});attachmentDisplayName(attachment); }
               }
            }else{
               { svelteHTML.createElement("div", { "class":`message-file placeholder`,});
                 { svelteHTML.createElement("span", { "class":`file-label`,});attachmentDisplayName(attachment); }
                 { svelteHTML.createElement("span", { "class":`file-meta`,});  }
               }
            }
          } else if (isAudioAttachment(attachment)){
            if(attachment?.data){
               { svelteHTML.createElement("div", { "class":`message-audio-container`,});
                 { svelteHTML.createElement("audio", {        "src":attachmentDataUrl(attachment),"class":`message-audio`,"controls":true,"preload":`metadata`,});
                         
                 }
                 { svelteHTML.createElement("div", { "class":`attachment-name`,});attachmentDisplayName(attachment); }
               }
            }else{
               { svelteHTML.createElement("div", { "class":`message-file placeholder`,});
                 { svelteHTML.createElement("span", { "class":`file-label`,});attachmentDisplayName(attachment); }
                 { svelteHTML.createElement("span", { "class":`file-meta`,});  }
               }
            }
          }else{
            if(attachment?.data){
               { svelteHTML.createElement("a", {           "class":`message-file`,"href":attachmentDataUrl(attachment),"target":`_blank`,"rel":`noopener noreferrer`,"download":attachmentDisplayName(attachment),});
                 { svelteHTML.createElement("span", { "class":`file-label`,});attachmentDisplayName(attachment); }
                 { svelteHTML.createElement("span", { "class":`file-meta`,});attachmentMimeLabel(attachment); }
               }
            }else{
               { svelteHTML.createElement("div", { "class":`message-file placeholder`,});
                 { svelteHTML.createElement("span", { "class":`file-label`,});attachmentDisplayName(attachment); }
               }
            }
          }
        }
       }
    }
    if(props.message.content){
       { svelteHTML.createElement("div", { "class":`bubble ${props.message.role}`,});
         { const $$_tnetnoCnwodkraM1C = __sveltets_2_ensureComponent(MarkdownContent); new $$_tnetnoCnwodkraM1C({ target: __sveltets_2_any(), props: {       "content":props.message.content,"allowInlineHtml":props.allowInlineHtml,"renderLatex":props.renderLatex,}});}
       }
    }
    if(resolvedGeneratedImages.length > 0){
       { svelteHTML.createElement("div", { "class":`generated-images ${props.message.role}`,});
           for(let genImg of __sveltets_2_ensureArray(resolvedGeneratedImages)){genImg.id;
           { svelteHTML.createElement("div", { "class":`generated-image-container`,});
             { svelteHTML.createElement("img", {       "src":`data:${genImg.mimeType || 'image/png'};base64,${genImg.data}`,"alt":genImg.revisedPrompt || 'Generated image',"class":`generated-image`,});}
            if(genImg.revisedPrompt){
               { svelteHTML.createElement("div", {   "class":`generated-image-prompt`,"title":genImg.revisedPrompt,});
                genImg.revisedPrompt;
               }
            }
           }
        }
       }
    }
  }
}


};
return { props: {} as any as Props, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const MessageBubble__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type MessageBubble__SvelteComponent_ = ReturnType<typeof MessageBubble__SvelteComponent_>;
/*Ωignore_endΩ*/export default MessageBubble__SvelteComponent_;
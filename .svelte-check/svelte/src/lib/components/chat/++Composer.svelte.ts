///<reference types="svelte" />
;
import { IconAdd, IconClose, IconStop, IconSend, IconEditSquare } from '../../icons'
import { autoGrow, placeCaretAtEnd } from '../../utils/dom'
import { readEditableText } from '../../utils/editableText'
import {
    isSupportedAttachment,
    isImageAttachment,
    isVideoAttachment,
    isAudioAttachment,
    attachmentTypeLabel,
    attachmentDisplayName
  } from '../../attachments/mime'
import ChatSettingsPopover from './ChatSettingsPopover.svelte'
import { onMount } from 'svelte'
import type { Image, Preset, ConnectionOption, Keybinds, ReasoningEffort, TextVerbosity, ReasoningSummary, MessageRole, McpServerConfig } from '../../types';
;

  interface Props {
    input?: string
    sending?: boolean
    locked?: boolean
    chatSettingsOpen?: boolean
    chatModel?: string
    chatStreaming?: boolean
    chatMaxOutputTokens?: number | null
    chatTopP?: number | null
    chatTemperature?: number | null
    chatReasoningEffort?: ReasoningEffort
    chatReasoningSummary?: ReasoningSummary
    chatTextVerbosity?: TextVerbosity
    chatOpenRouterProvider?: string
    chatThinkingEnabled?: boolean
    chatThinkingBudgetTokens?: number | null
    chatWebSearchEnabled?: boolean
    chatCodeInterpreterEnabled?: boolean
    chatCodeInterpreterNetworkEnabled?: boolean
    chatCodeInterpreterAllowedDomains?: string
    chatShellEnabled?: boolean
    chatShellNetworkEnabled?: boolean
    chatShellAllowedDomains?: string
    chatImageGenerationEnabled?: boolean
    chatImageGenerationModel?: string
    chatMcpEnabled?: boolean
    chatMcpServers?: McpServerConfig[]
    modelIds?: string[]
    connections?: ConnectionOption[]
    chatConnectionId?: string | null
    attachedImages?: Image[]
    keybinds?: Keybinds
    showThinkingControls?: boolean
    presets?: Preset[]
    onToggleChatSettings?: () => void
    onCloseChatSettings?: () => void
    onChangeConnection?: (val: string) => void
    onChangeModel?: (val: string) => void
    onChangeStreaming?: (val: boolean) => void
    onChangeMaxOutputTokens?: (val: string) => void
    onChangeTopP?: (val: string) => void
    onChangeTemperature?: (val: string) => void
    onChangeReasoningEffort?: (val: string) => void
    onChangeReasoningSummary?: (val: string) => void
    onChangeTextVerbosity?: (val: string) => void
    onChangeOpenRouterProvider?: (val: string) => void
    onChangeThinkingEnabled?: (val: boolean) => void
    onChangeThinkingBudgetTokens?: (val: string) => void
    onChangeWebSearchEnabled?: (val: boolean) => void
    onChangeCodeInterpreterEnabled?: (val: boolean) => void
    onChangeCodeInterpreterNetworkEnabled?: (val: boolean) => void
    onChangeCodeInterpreterAllowedDomains?: (val: string) => void
    onChangeShellEnabled?: (val: boolean) => void
    onChangeShellNetworkEnabled?: (val: boolean) => void
    onChangeShellAllowedDomains?: (val: string) => void
    onChangeImageGenerationEnabled?: (val: boolean) => void
    onChangeImageGenerationModel?: (val: string) => void
    onChangeMcpEnabled?: (val: boolean) => void
    onChangeMcpServers?: (servers: McpServerConfig[]) => void
    onSelectPreset?: (preset: Preset) => void
    onInput?: (val: string) => void
    disableSendRolePopup?: boolean
    showAddWithoutSend?: boolean
    onAdd?: (role: MessageRole) => void
    onStop?: () => void
    onSend?: (role: MessageRole) => void
    onFilesSelected?: (files: File[]) => void
    onRemoveImage?: (id: string) => void
  };function $$render() {

  
  
  
  
  
  
  


  const props: Props = $props()
  // Gecko on Android only advertises image clipboard/keyboard content to rich
  // editors. plaintext-only and textarea inputs don't enable that native path.
  const useRichInput = typeof navigator !== 'undefined'
    && /Android/i.test(navigator.userAgent) && /Firefox\//i.test(navigator.userAgent)
  let inputEl = $state<HTMLTextAreaElement | HTMLDivElement>()
  let isDragging = $state(false)
  // Auto-grow on mount
  $effect(() => { queueMicrotask(() => autoGrow(inputEl ?? null)) })
  // Also auto-grow whenever parent updates the input value (e.g., after send/add clears it)
  $effect(() => { void props.input; queueMicrotask(() => autoGrow(inputEl ?? null)) })

  $effect(() => {
    const value = props.input || ''
    if (useRichInput && inputEl && (readEditableText(inputEl) !== value || (!value && inputEl.hasChildNodes()))) {
      // Avoid replacing DOM during ordinary typing: that resets selection/IME.
      inputEl.textContent = value
      if (document.activeElement === inputEl) placeCaretAtEnd(inputEl)
    }
  })

  function handleEditorInput() {
    if (!inputEl) return
    props.onInput?.(readEditableText(inputEl))
    queueMicrotask(() => autoGrow(inputEl ?? null))
  }

  function insertEditorText(text: string) {
    if (!text || !inputEl) return
    // insertText preserves the browser's undo stack. Keep a DOM fallback for
    // environments that don't implement this editing command.
    if (!document.execCommand?.('insertText', false, text)) {
      const selection = window.getSelection()
      if (!selection) return
      if (!selection.rangeCount || !inputEl.contains(selection.getRangeAt(0).commonAncestorContainer)) {
        placeCaretAtEnd(inputEl)
      }
      if (!selection.rangeCount) return
      const range = selection.getRangeAt(0)
      range.deleteContents()
      const node = document.createTextNode(text)
      range.insertNode(node)
      range.setStartAfter(node)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }
    handleEditorInput()
  }

  function handleBeforeInput(e: InputEvent) {
    if (useRichInput && e.inputType.startsWith('format')) {
      e.preventDefault()
      return
    }
    handlePaste(e)
  }

  let isInputFocused = $state(false)
  let isMobileViewport = $state(false)
  const hideAuxControls = $derived(isInputFocused && isMobileViewport)

  onMount(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia('(max-width: 640px)')
    const update = () => { isMobileViewport = mql.matches }
    update()
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', update)
      return () => { mql.removeEventListener('change', update) }
    }
    if (typeof mql.addListener === 'function') {
      mql.addListener(update)
      return () => { mql.removeListener(update) }
    }
    return undefined
  })

  // Attachment type detection lives in ../../attachments/mime.ts (shared).
  const getAttachmentTypeLabel = attachmentTypeLabel
  const getAttachmentDisplayName = attachmentDisplayName

  function onKey(e: KeyboardEvent) {
    if (e.isComposing || isMobileViewport) return
    if (props.locked) return
    if (e.key !== 'Enter') return

    const keybinds = props.keybinds || { sendMessage: 'Enter', newLine: 'Shift+Enter' }

    // Determine which key combination was pressed
    let pressedKey = 'Enter'
    if (e.shiftKey) pressedKey = 'Shift+Enter'
    else if (e.ctrlKey || e.metaKey) pressedKey = 'Ctrl+Enter'
    else if (e.altKey) pressedKey = 'Alt+Enter'

    // Check if this key combination matches any action
    let action = null
    if (keybinds.sendMessage === pressedKey) action = 'send'
    else if (keybinds.newLine === pressedKey) action = 'newline'

    // Perform the action
    if (action === 'send') {
      e.preventDefault()
      props.onSend?.('user')
    } else if (action === 'newline') {
      // Let default behavior happen (insert newline)
    } else {
      // No action bound to this key combination, prevent default
      e.preventDefault()
    }
  }

  function handleFileSelect(e: Event & { currentTarget: HTMLInputElement }) {
    const files = e.currentTarget.files
    if (files && files.length > 0) {
      const accepted = Array.from(files).filter(isSupportedAttachment) as File[]
      if (accepted.length > 0) {
        props.onFilesSelected?.(accepted)
      }
    }
    e.currentTarget.value = ''
  }

  // Depth counter: dragleave fires when moving over child elements, so track
  // enter/leave pairs to avoid indicator flicker.
  let dragDepth = 0

  function handleDragEnter(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragDepth++
    if (!isDragging) isDragging = true
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0 && isDragging) isDragging = false
  }

  function handleDragEnd() {
    dragDepth = 0
    isDragging = false
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragDepth = 0
    isDragging = false

    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      const acceptedFiles = Array.from(files).filter(isSupportedAttachment) as File[]
      if (acceptedFiles.length > 0) {
        props.onFilesSelected?.(acceptedFiles)
      }
    }
  }

  let pasteHandled = false

  function handlePaste(e: ClipboardEvent | InputEvent) {
    const isPaste = e.type === 'paste'
    if (!isPaste && (e as InputEvent).inputType !== 'insertFromPaste') return
    if (props.locked && !useRichInput) return
    if (!isPaste && pasteHandled) {
      if (useRichInput) e.preventDefault()
      return
    }
    const clipboard = isPaste ? (e as ClipboardEvent).clipboardData : (e as InputEvent).dataTransfer
    if (!clipboard) return

    const pastedFiles: File[] = []
    const items = clipboard.items
    if (items && items.length > 0) {
      for (const item of Array.from(items)) {
        if (!item || item.kind !== 'file') continue
        const file = item.getAsFile?.()
        if (file && isSupportedAttachment(file)) {
          pastedFiles.push(file)
        }
      }
    }

    if (pastedFiles.length === 0 && clipboard.files?.length > 0) {
      for (const file of Array.from(clipboard.files)) {
        if (file && isSupportedAttachment(file)) {
          pastedFiles.push(file)
        }
      }
    }

    if (pastedFiles.length === 0 && !useRichInput) return

    const hasTextData = (() => {
      try {
        if (!clipboard.types) return false
        for (const type of Array.from(clipboard.types)) {
          if (type === 'text/plain' || type === 'text/html') {
            const data = clipboard.getData?.(type)
            if (typeof data === 'string' && data.trim()) return true
          }
        }
      } catch {}
      return false
    })()

    if (useRichInput) {
      // Images belong in the attachment tray; never insert clipboard HTML or
      // inline images into the message editor. Preserve accompanying plain text.
      e.preventDefault()
      const text = clipboard.getData('text/plain')
      insertEditorText(text)
    } else if (!hasTextData) {
      e.preventDefault()
    }

    if (isPaste) {
      // A single paste can also dispatch beforeinput with the same files.
      pasteHandled = true
      setTimeout(() => { pasteHandled = false }, 0)
    }
    if (pastedFiles.length && !props.locked) props.onFilesSelected?.(pastedFiles)
  }
;
async () => {

 { svelteHTML.createElement("footer", {            "class":`composer`,"ondragenter":handleDragEnter,"ondragover":handleDragOver,"ondragleave":handleDragLeave,"ondragend":handleDragEnd,"ondrop":handleDrop,});isDragging;
   { svelteHTML.createElement("div", {  "class":`composer-inner`,});hideAuxControls;
     { svelteHTML.createElement("div", { "class":`chat-settings-slot`,});
       { const $$_revopoPsgnitteStahC3C = __sveltets_2_ensureComponent(ChatSettingsPopover); new $$_revopoPsgnitteStahC3C({ target: __sveltets_2_any(), props: {                                                                                                             "open":props.chatSettingsOpen,"model":props.chatModel,"streaming":props.chatStreaming,"maxOutputTokens":props.chatMaxOutputTokens,"topP":props.chatTopP,"temperature":props.chatTemperature,"reasoningEffort":props.chatReasoningEffort,"reasoningSummary":props.chatReasoningSummary,"textVerbosity":props.chatTextVerbosity,"openRouterProvider":props.chatOpenRouterProvider,"onInputOpenRouterProvider":props.onChangeOpenRouterProvider,"thinkingEnabled":props.chatThinkingEnabled,"thinkingBudgetTokens":props.chatThinkingBudgetTokens,"webSearchEnabled":props.chatWebSearchEnabled,"codeInterpreterEnabled":props.chatCodeInterpreterEnabled,"codeInterpreterNetworkEnabled":props.chatCodeInterpreterNetworkEnabled,"codeInterpreterAllowedDomains":props.chatCodeInterpreterAllowedDomains,"shellEnabled":props.chatShellEnabled,"shellNetworkEnabled":props.chatShellNetworkEnabled,"shellAllowedDomains":props.chatShellAllowedDomains,"imageGenerationEnabled":props.chatImageGenerationEnabled,"imageGenerationModel":props.chatImageGenerationModel,"mcpEnabled":props.chatMcpEnabled,"mcpServers":props.chatMcpServers,"modelIds":props.modelIds,"connections":props.connections,"connectionId":props.chatConnectionId,"showThinkingControls":props.showThinkingControls,"presets":props.presets,"onToggle":props.onToggleChatSettings,"onClose":props.onCloseChatSettings,"onChangeConnection":props.onChangeConnection,"onInputModel":props.onChangeModel,"onInputStreaming":props.onChangeStreaming,"onInputMaxOutputTokens":props.onChangeMaxOutputTokens,"onInputTopP":props.onChangeTopP,"onInputTemperature":props.onChangeTemperature,"onInputReasoningEffort":props.onChangeReasoningEffort,"onInputReasoningSummary":props.onChangeReasoningSummary,"onInputTextVerbosity":props.onChangeTextVerbosity,"onInputThinkingEnabled":props.onChangeThinkingEnabled,"onInputThinkingBudgetTokens":props.onChangeThinkingBudgetTokens,"onInputWebSearchEnabled":props.onChangeWebSearchEnabled,"onInputCodeInterpreterEnabled":props.onChangeCodeInterpreterEnabled,"onInputCodeInterpreterNetworkEnabled":props.onChangeCodeInterpreterNetworkEnabled,"onInputCodeInterpreterAllowedDomains":props.onChangeCodeInterpreterAllowedDomains,"onInputShellEnabled":props.onChangeShellEnabled,"onInputShellNetworkEnabled":props.onChangeShellNetworkEnabled,"onInputShellAllowedDomains":props.onChangeShellAllowedDomains,"onInputImageGenerationEnabled":props.onChangeImageGenerationEnabled,"onInputImageGenerationModel":props.onChangeImageGenerationModel,"onInputMcpEnabled":props.onChangeMcpEnabled,"onChangeMcpServers":props.onChangeMcpServers,"onSelectPreset":props.onSelectPreset,}});}
     }

     { svelteHTML.createElement("label", {    "class":`icon-btn attachment-btn`,"title":`Attach files`,});props.locked;
       { const $$_ddAnocI3C = __sveltets_2_ensureComponent(IconAdd); new $$_ddAnocI3C({ target: __sveltets_2_any(), props: {  "style":`font-size: 22px;`,}});}
       { svelteHTML.createElement("input", {          "type":`file`,"multiple":true,"disabled":props.locked,"aria-label":`Attach files`,"onchange":handleFileSelect,});}
     }

     { svelteHTML.createElement("div", { "class":`input-wrapper`,});
      if(props.attachedImages && props.attachedImages.length > 0){
         { svelteHTML.createElement("div", { "class":`image-previews`,});
             for(let img of __sveltets_2_ensureArray(props.attachedImages)){img.id;
             { svelteHTML.createElement("div", { "class":`attachment-preview ${isImageAttachment(img) ? 'image' : isVideoAttachment(img) ? 'video' : isAudioAttachment(img) ? 'audio' : 'file'}`,});
              if(img?.data){
                if(isImageAttachment(img)){
                   { svelteHTML.createElement("img", {    "src":`data:${img.mimeType || 'image/png'};base64,${img.data}`,"alt":img.name || img.id || 'Attached image',});}
                } else if (isVideoAttachment(img)){
                  
                   { svelteHTML.createElement("video", {     "src":`data:${img.mimeType || 'video/mp4'};base64,${img.data}`,"class":`video-preview`,"preload":`metadata`,}); }
                   { svelteHTML.createElement("span", { "class":`file-chip-overlay`,});getAttachmentDisplayName(img); }
                } else if (isAudioAttachment(img)){
                   { svelteHTML.createElement("div", { "class":`file-chip audio-chip`,});
                     { svelteHTML.createElement("span", { "class":`file-chip-icon`,});  }
                     { svelteHTML.createElement("span", { "class":`file-chip-name`,});getAttachmentDisplayName(img); }
                   }
                }else{
                   { svelteHTML.createElement("a", {           "class":`file-chip`,"href":`data:${img.mimeType || 'application/octet-stream'};base64,${img.data}`,"target":`_blank`,"rel":`noopener noreferrer`,"download":getAttachmentDisplayName(img),});
                     { svelteHTML.createElement("span", { "class":`file-chip-icon`,});getAttachmentTypeLabel(img); }
                     { svelteHTML.createElement("span", { "class":`file-chip-name`,});getAttachmentDisplayName(img); }
                   }
                }
              }
               { svelteHTML.createElement("button", {     "class":`remove-image-btn`,"onclick":() => props.onRemoveImage?.(img.id),"aria-label":`Remove image`,});
                 { const $$_esolCnocI6C = __sveltets_2_ensureComponent(IconClose); new $$_esolCnocI6C({ target: __sveltets_2_any(), props: {  "style":`font-size: 16px;`,}});}
               }
             }
          }
         }
      }
      if(useRichInput){
         { const $$_div3 = svelteHTML.createElement("div", {                            "class":`composer-input rich-input`,"contenteditable":`true`,"role":`textbox`,"aria-label":`Type a message`,"aria-multiline":`true`,...__sveltets_2_empty({"data-placeholder":`Type a message…`}),"tabindex":0,"oninput":handleEditorInput,"onkeydown":onKey,"onpaste":handlePaste,"onbeforeinput":handleBeforeInput,"onfocus":() => { isInputFocused = true },"onblur":() => { isInputFocused = false },});inputEl = $$_div3; }
      }else{
         { const $$_textarea3 = svelteHTML.createElement("textarea", {                      "class":`composer-input`,"rows":1,"placeholder":`Type a message…`,"value":props.input,"oninput":(e) => { props.onInput?.(e.currentTarget.value); queueMicrotask(() => autoGrow(inputEl ?? null)) },"onkeydown":onKey,"onpaste":handlePaste,"onbeforeinput":handlePaste,"onfocus":() => { isInputFocused = true },"onblur":() => { isInputFocused = false },});inputEl = $$_textarea3; }
      }
     }

    
     { svelteHTML.createElement("div", {  "class":`send-area`,});hideAuxControls && props.showAddWithoutSend;
      if(props.sending){
         { svelteHTML.createElement("div", {   "class":`send-group`,"title":`Stop response`,});
           { svelteHTML.createElement("button", {       "class":`float-btn stop-btn`,"onclick":() => props.onStop?.(),"aria-label":`Stop response`,"disabled":!props.onStop,});
             { const $$_potSnocI5C = __sveltets_2_ensureComponent(IconStop); new $$_potSnocI5C({ target: __sveltets_2_any(), props: {  "style":`font-size: 22px;`,}});}
           }
         }
      }else{
        if(props.showAddWithoutSend){
           { svelteHTML.createElement("div", {       "class":`send-group add-group`,...__sveltets_2_empty({"data-side":`top`}),"aria-haspopup":`menu`,"title":`Add without sending`,});
             { svelteHTML.createElement("button", {       "class":`float-btn add-btn`,"onclick":() => props.onAdd?.('user'),"disabled":props.locked,"aria-label":`Add without sending`,});
               { const $$_erauqStidEnocI5C = __sveltets_2_ensureComponent(IconEditSquare); new $$_erauqStidEnocI5C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
             }
             { svelteHTML.createElement("div", {     "class":`send-menu`,"role":`menu`,"aria-label":`Add as`,});
               { svelteHTML.createElement("button", {         "role":`menuitem`,"class":`menu-item`,"onclick":() => props.onAdd?.('user'),"disabled":props.locked,"aria-label":`Add as user`,});
                 { const $$_erauqStidEnocI6C = __sveltets_2_ensureComponent(IconEditSquare); new $$_erauqStidEnocI6C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
                
               }
               { svelteHTML.createElement("button", {         "role":`menuitem`,"class":`menu-item`,"onclick":() => props.onAdd?.('assistant'),"disabled":props.locked,"aria-label":`Add as assistant`,});
                 { const $$_erauqStidEnocI6C = __sveltets_2_ensureComponent(IconEditSquare); new $$_erauqStidEnocI6C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
                
               }
               { svelteHTML.createElement("button", {         "role":`menuitem`,"class":`menu-item`,"onclick":() => props.onAdd?.('system'),"disabled":props.locked,"aria-label":`Add as system`,});
                 { const $$_erauqStidEnocI6C = __sveltets_2_ensureComponent(IconEditSquare); new $$_erauqStidEnocI6C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
                
               }
             }
           }
        }
         { svelteHTML.createElement("div", {       "class":`send-group`,...__sveltets_2_empty({"data-side":props.disableSendRolePopup ? undefined : 'top'}),"aria-haspopup":props.disableSendRolePopup ? undefined : 'menu',"title":props.disableSendRolePopup ? 'Send' : 'Send as',});
           { svelteHTML.createElement("button", {       "class":`float-btn`,"onclick":() => props.onSend?.('user'),"disabled":props.locked,"aria-label":`Send`,});
             { const $$_dneSnocI5C = __sveltets_2_ensureComponent(IconSend); new $$_dneSnocI5C({ target: __sveltets_2_any(), props: {  "style":`font-size: 22px;`,}});}
           }
          if(!props.disableSendRolePopup){
             { svelteHTML.createElement("div", {     "class":`send-menu`,"role":`menu`,"aria-label":`Send as`,});
               { svelteHTML.createElement("button", {         "role":`menuitem`,"class":`menu-item`,"onclick":() => props.onSend?.('user'),"disabled":props.locked,"aria-label":`Send as user`,});
                 { const $$_dneSnocI6C = __sveltets_2_ensureComponent(IconSend); new $$_dneSnocI6C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
                
               }
               { svelteHTML.createElement("button", {         "role":`menuitem`,"class":`menu-item`,"onclick":() => props.onSend?.('assistant'),"disabled":props.locked,"aria-label":`Send as assistant`,});
                 { const $$_dneSnocI6C = __sveltets_2_ensureComponent(IconSend); new $$_dneSnocI6C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
                
               }
               { svelteHTML.createElement("button", {         "role":`menuitem`,"class":`menu-item`,"onclick":() => props.onSend?.('system'),"disabled":props.locked,"aria-label":`Send as system`,});
                 { const $$_dneSnocI6C = __sveltets_2_ensureComponent(IconSend); new $$_dneSnocI6C({ target: __sveltets_2_any(), props: {  "style":`font-size: 18px;`,}});}
                
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
const Composer__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Composer__SvelteComponent_ = ReturnType<typeof Composer__SvelteComponent_>;
/*Ωignore_endΩ*/export default Composer__SvelteComponent_;
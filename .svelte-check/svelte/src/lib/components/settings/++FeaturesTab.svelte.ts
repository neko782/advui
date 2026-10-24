///<reference types="svelte" />
;
import { IconDragHandle, IconTravelExplore, IconCodeBlocks, IconTerminal, IconImagesmode, IconExtension } from '../../icons'
import { DEFAULT_MESSAGE_ACTIONS } from '../../constants/defaults.js'
import type { MessageActionRole } from '../../types'
import type { SettingsDraft } from './settingsDraft.svelte';
;

  interface Props {
    draft: SettingsDraft
  };function $$render() {

  
  
  
  


  const props: Props = $props()
  const draft = $derived(props.draft)
  const local = $derived(props.draft.local)
  const persistSettings = () => props.draft.persist()

  const MESSAGE_ACTION_ROLES: { id: MessageActionRole, label: string }[] = [
    { id: 'user', label: 'User' },
    { id: 'assistant', label: 'Assistant' },
    { id: 'system', label: 'System' },
  ]

  const messageActionsForRender = () => draft.messageActions
  const editorActionsForRender = () => draft.editorActions
  const defaultToolsForRender = () => draft.defaultTools

  const toggleMessageAction = (id: string) => draft.toggleMessageAction(id)
  const toggleMessageActionRole = (id: string, role: MessageActionRole) => draft.toggleMessageActionRole(id, role)
  const resetMessageActions = () => draft.resetMessageActions()
  const toggleEditorAction = (id: string) => draft.toggleEditorAction(id)
  const resetEditorActions = () => draft.resetEditorActions()
  const updateDefaultTool = (...args: Parameters<SettingsDraft['updateDefaultTool']>) => draft.updateDefaultTool(...args)

  // Message actions drag state
  let draggedActionId = $state<string | null>(null)
  let dragOverActionId = $state<string | null>(null)

  function handleActionDragStart(e: DragEvent, id: string) {
    draggedActionId = id
    e.dataTransfer!.effectAllowed = 'move'
    e.dataTransfer!.setData('text/plain', id)
  }

  function handleActionDragOver(e: DragEvent, id: string) {
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'
    if (!draggedActionId || draggedActionId === id) return
    dragOverActionId = id
  }

  function handleActionDrop(e: DragEvent) {
    e.preventDefault()
    if (draggedActionId && dragOverActionId && draggedActionId !== dragOverActionId) {
      draft.reorderMessageActions(draggedActionId, dragOverActionId)
    }
    draggedActionId = null
    dragOverActionId = null
  }

  function handleActionDragEnd() {
    draggedActionId = null
    dragOverActionId = null
  }

  // Touch drag for message actions
  let touchActionDragId = $state<string | null>(null)
  let touchActionListRef = $state<HTMLElement | null>(null)

  function handleActionTouchStart(e: TouchEvent, id: string) {
    touchActionDragId = id
    draggedActionId = id
    const listEl = (e.currentTarget as HTMLElement).closest('.ui-item-list')
    if (listEl) touchActionListRef = listEl as HTMLElement
  }

  function handleActionTouchMove(e: TouchEvent) {
    if (!touchActionDragId || !touchActionListRef) return
    e.preventDefault()
    const touchY = e.touches[0]?.clientY ?? 0
    const items = touchActionListRef.querySelectorAll('.ui-list-item')
    for (const item of items) {
      const id = item.getAttribute('data-id')
      if (id && id !== touchActionDragId) {
        const rect = item.getBoundingClientRect()
        if (touchY >= rect.top && touchY <= rect.bottom) {
          dragOverActionId = id
          return
        }
      }
    }
  }

  function handleActionTouchEnd() {
    if (touchActionDragId && dragOverActionId) {
      draft.reorderMessageActions(touchActionDragId, dragOverActionId)
    }
    touchActionDragId = null
    touchActionListRef = null
    draggedActionId = null
    dragOverActionId = null
  }
;
async () => {

             { svelteHTML.createElement("section", { "class":`ui-group`,});
               { svelteHTML.createElement("div", { "class":`ui-group-title`,});  }
               { svelteHTML.createElement("label", {   "class":`ui-switch`,"title":`Show thinking controls`,});
                 { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":!!local.showThinkingSettings,"onchange":(event) => {
                    local.showThinkingSettings = !!event.currentTarget.checked
                    persistSettings()
                  },"aria-label":`Show thinking controls`,});}
                 { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                 { svelteHTML.createElement("span", { "class":`ui-switch-label`,});   }
               }
               { svelteHTML.createElement("p", { "class":`ui-hint`,});         }
               { svelteHTML.createElement("label", {   "class":`ui-switch`,"title":`Fancy effects`,});
                 { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":!!local.fancyEffects,"onchange":(event) => {
                    local.fancyEffects = !!event.currentTarget.checked
                    persistSettings()
                  },"aria-label":`Fancy effects`,});}
                 { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                 { svelteHTML.createElement("span", { "class":`ui-switch-label`,});  }
               }
               { svelteHTML.createElement("p", { "class":`ui-hint`,});             }
               { svelteHTML.createElement("label", {   "class":`ui-switch`,"title":`Allow inline HTML`,});
                 { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":!!local.allowInlineHtml,"onchange":(event) => {
                    local.allowInlineHtml = !!event.currentTarget.checked
                    persistSettings()
                  },"aria-label":`Allow inline HTML`,});}
                 { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                 { svelteHTML.createElement("span", { "class":`ui-switch-label`,});   }
               }
               { svelteHTML.createElement("p", { "class":`ui-hint`,});           }
               { svelteHTML.createElement("label", {   "class":`ui-switch`,"title":`Render LaTeX math`,});
                 { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":local.renderLatex !== false,"onchange":(event) => {
                    local.renderLatex = !!event.currentTarget.checked
                    persistSettings()
                  },"aria-label":`Render LaTeX math`,});}
                 { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                 { svelteHTML.createElement("span", { "class":`ui-switch-label`,});   }
               }
               { svelteHTML.createElement("p", { "class":`ui-hint`,});            }
             }

             { svelteHTML.createElement("section", { "class":`ui-group`,});
               { svelteHTML.createElement("div", { "class":`ui-group-head`,});
                 { svelteHTML.createElement("div", { "class":`ui-group-title`,});  }
                 { svelteHTML.createElement("button", {           "type":`button`,"class":`ui-btn ui-btn-outline ui-btn-sm`,"onclick":resetMessageActions,"title":`Reset to defaults`,"aria-label":`Reset message buttons to defaults`,});  }
               }
               { svelteHTML.createElement("p", { "class":`ui-hint`,});              }
               { svelteHTML.createElement("div", { "class":`ui-item-list ui-reorder-list`,});
                   for(let action of __sveltets_2_ensureArray(messageActionsForRender())){action.id;
                  const isDragging = draggedActionId === action.id;
                  const isDragOver = dragOverActionId === action.id && draggedActionId !== action.id;
                   { svelteHTML.createElement("div", {                 "class":`ui-list-item action-item ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''} ${!action.enabled ? 'disabled-action' : ''}`,...__sveltets_2_empty({"data-id":action.id}),"draggable":`true`,"ondragstart":(e) => handleActionDragStart(e, action.id),"ondragover":(e) => handleActionDragOver(e, action.id),"ondrop":handleActionDrop,"ondragend":handleActionDragEnd,"role":`listitem`,});
                     { svelteHTML.createElement("div", {             "class":`ui-drag-handle`,"aria-label":`Drag to reorder`,"ontouchstart":(e) => handleActionTouchStart(e, action.id),"ontouchmove":handleActionTouchMove,"ontouchend":handleActionTouchEnd,"ontouchcancel":() => { touchActionDragId = null; touchActionListRef = null; draggedActionId = null; dragOverActionId = null },});
                       { const $$_eldnaHgarDnocI4C = __sveltets_2_ensureComponent(IconDragHandle); new $$_eldnaHgarDnocI4C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
                     }
                     { svelteHTML.createElement("span", { "class":`action-item-label`,});action.label; }
                     { svelteHTML.createElement("div", {   "class":`message-role-checks`,"aria-label":`${action.label} message roles`,});
                        for(let role of __sveltets_2_ensureArray(MESSAGE_ACTION_ROLES)){
                        const checked = action.roles?.[role.id] ?? DEFAULT_MESSAGE_ACTIONS.find(a => a.id === action.id)?.roles?.[role.id] ?? true;
                         { svelteHTML.createElement("label", {   "class":`role-check`,"title":`${action.label} on ${role.label.toLowerCase()} messages`,});
                           { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":checked,"onchange":() => toggleMessageActionRole(action.id, role.id),"aria-label":`${action.label} on ${role.label} messages`,});}
                           { svelteHTML.createElement("span", {});role.label; }
                         }
                      }
                     }
                     { svelteHTML.createElement("label", {   "class":`action-toggle`,"title":action.enabled ? 'Disable' : 'Enable',});
                       { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":action.enabled,"onchange":() => toggleMessageAction(action.id),"aria-label":`${action.enabled ? 'Disable' : 'Enable'} ${action.label}`,});}
                       { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                     }
                   }
                }
               }
             }

             { svelteHTML.createElement("section", { "class":`ui-group`,});
               { svelteHTML.createElement("div", { "class":`ui-group-head`,});
                 { svelteHTML.createElement("div", { "class":`ui-group-title`,});  }
                 { svelteHTML.createElement("button", {           "type":`button`,"class":`ui-btn ui-btn-outline ui-btn-sm`,"onclick":resetEditorActions,"title":`Reset to defaults`,"aria-label":`Reset editor buttons to defaults`,});  }
               }
               { svelteHTML.createElement("p", { "class":`ui-hint`,});         }
               { svelteHTML.createElement("div", { "class":`ui-item-list`,});
                   for(let action of __sveltets_2_ensureArray(editorActionsForRender())){action.id;
                   { svelteHTML.createElement("div", {     "class":`ui-list-item action-item ${!action.enabled ? 'disabled-action' : ''}`,...__sveltets_2_empty({"data-id":action.id}),});
                     { svelteHTML.createElement("span", { "class":`action-item-label`,});action.label; }
                     { svelteHTML.createElement("label", {   "class":`action-toggle`,"title":action.enabled ? 'Disable' : 'Enable',});
                       { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":action.enabled,"onchange":() => toggleEditorAction(action.id),"aria-label":`${action.enabled ? 'Disable' : 'Enable'} ${action.label}`,});}
                       { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                     }
                   }
                }
               }
             }

             { svelteHTML.createElement("section", { "class":`ui-group`,});
               { svelteHTML.createElement("div", { "class":`ui-group-title`,});   }
               { svelteHTML.createElement("label", {   "class":`ui-switch`,"title":`Disable role switching`,});
                 { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":!!local.disableRoleSwitching,"onchange":(event) => {
                    local.disableRoleSwitching = !!event.currentTarget.checked
                    persistSettings()
                  },"aria-label":`Disable role switching`,});}
                 { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                 { svelteHTML.createElement("span", { "class":`ui-switch-label`,});     }
               }
               { svelteHTML.createElement("p", { "class":`ui-hint`,});            }
               { svelteHTML.createElement("label", {   "class":`ui-switch`,"title":`Disable send role popup`,});
                 { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":!!local.disableSendRolePopup,"onchange":(event) => {
                    local.disableSendRolePopup = !!event.currentTarget.checked
                    persistSettings()
                  },"aria-label":`Disable send role popup`,});}
                 { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                 { svelteHTML.createElement("span", { "class":`ui-switch-label`,});    }
               }
               { svelteHTML.createElement("p", { "class":`ui-hint`,});               }
               { svelteHTML.createElement("label", {   "class":`ui-switch`,"title":`Show add without sending button`,});
                 { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":!!local.showAddWithoutSend,"onchange":(event) => {
                    local.showAddWithoutSend = !!event.currentTarget.checked
                    persistSettings()
                  },"aria-label":`Show add without sending button`,});}
                 { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                 { svelteHTML.createElement("span", { "class":`ui-switch-label`,});    }
               }
               { svelteHTML.createElement("p", { "class":`ui-hint`,});                  }
               { svelteHTML.createElement("label", {   "class":`ui-switch`,"title":`Show insert buttons between messages`,});
                 { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":local.showInsertButtons !== false,"onchange":(event) => {
                    local.showInsertButtons = !!event.currentTarget.checked
                    persistSettings()
                  },"aria-label":`Show insert buttons between messages`,});}
                 { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                 { svelteHTML.createElement("span", { "class":`ui-switch-label`,});    }
               }
               { svelteHTML.createElement("p", { "class":`ui-hint`,});        }
             }

             { svelteHTML.createElement("section", { "class":`ui-group`,});
               { svelteHTML.createElement("div", { "class":`ui-group-title`,});  }
               { svelteHTML.createElement("p", { "class":`ui-hint`,});             }
               { svelteHTML.createElement("div", { "class":`tools-grid`,});
                 { svelteHTML.createElement("label", {   "class":`tool-card`,"title":`Web search`,});
                   { svelteHTML.createElement("div", { "class":`tool-card-icon`,}); { const $$_erolpxElevarTnocI4C = __sveltets_2_ensureComponent(IconTravelExplore); new $$_erolpxElevarTnocI4C({ target: __sveltets_2_any(), props: {  "style":`font-size: 24px;`,}});} }
                   { svelteHTML.createElement("div", { "class":`tool-card-info`,});
                     { svelteHTML.createElement("span", { "class":`tool-card-name`,});  }
                     { svelteHTML.createElement("span", { "class":`tool-card-desc`,});      }
                   }
                   { svelteHTML.createElement("div", { "class":`tool-card-toggle`,});
                     { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":defaultToolsForRender().webSearch,"onchange":(event) => updateDefaultTool('webSearch', event.currentTarget.checked),"aria-label":`Web search default`,});}
                     { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                   }
                 }
                 { svelteHTML.createElement("label", {   "class":`tool-card`,"title":`Code interpreter`,});
                   { svelteHTML.createElement("div", { "class":`tool-card-icon`,}); { const $$_skcolBedoCnocI4C = __sveltets_2_ensureComponent(IconCodeBlocks); new $$_skcolBedoCnocI4C({ target: __sveltets_2_any(), props: {  "style":`font-size: 24px;`,}});} }
                   { svelteHTML.createElement("div", { "class":`tool-card-info`,});
                     { svelteHTML.createElement("span", { "class":`tool-card-name`,});  }
                     { svelteHTML.createElement("span", { "class":`tool-card-desc`,});       }
                   }
                   { svelteHTML.createElement("div", { "class":`tool-card-toggle`,});
                     { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":defaultToolsForRender().codeInterpreter,"onchange":(event) => updateDefaultTool('codeInterpreter', event.currentTarget.checked),"aria-label":`Code interpreter default`,});}
                     { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                   }
                 }
                 { svelteHTML.createElement("label", {   "class":`tool-card`,"title":`Shell`,});
                   { svelteHTML.createElement("div", { "class":`tool-card-icon`,}); { const $$_lanimreTnocI4C = __sveltets_2_ensureComponent(IconTerminal); new $$_lanimreTnocI4C({ target: __sveltets_2_any(), props: {  "style":`font-size: 24px;`,}});} }
                   { svelteHTML.createElement("div", { "class":`tool-card-info`,});
                     { svelteHTML.createElement("span", { "class":`tool-card-name`,});  }
                     { svelteHTML.createElement("span", { "class":`tool-card-desc`,});      }
                   }
                   { svelteHTML.createElement("div", { "class":`tool-card-toggle`,});
                     { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":defaultToolsForRender().shell,"onchange":(event) => updateDefaultTool('shell', event.currentTarget.checked),"aria-label":`Shell default`,});}
                     { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                   }
                 }
                 { svelteHTML.createElement("label", {   "class":`tool-card`,"title":`Image generation`,});
                   { svelteHTML.createElement("div", { "class":`tool-card-icon`,}); { const $$_edomsegamInocI4C = __sveltets_2_ensureComponent(IconImagesmode); new $$_edomsegamInocI4C({ target: __sveltets_2_any(), props: {  "style":`font-size: 24px;`,}});} }
                   { svelteHTML.createElement("div", { "class":`tool-card-info`,});
                     { svelteHTML.createElement("span", { "class":`tool-card-name`,});  }
                     { svelteHTML.createElement("span", { "class":`tool-card-desc`,});     }
                   }
                   { svelteHTML.createElement("div", { "class":`tool-card-toggle`,});
                     { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":defaultToolsForRender().imageGeneration,"onchange":(event) => updateDefaultTool('imageGeneration', event.currentTarget.checked),"aria-label":`Image generation default`,});}
                     { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                   }
                 }
                 { svelteHTML.createElement("label", {   "class":`tool-card`,"title":`MCP servers`,});
                   { svelteHTML.createElement("div", { "class":`tool-card-icon`,}); { const $$_noisnetxEnocI4C = __sveltets_2_ensureComponent(IconExtension); new $$_noisnetxEnocI4C({ target: __sveltets_2_any(), props: {  "style":`font-size: 24px;`,}});} }
                   { svelteHTML.createElement("div", { "class":`tool-card-info`,});
                     { svelteHTML.createElement("span", { "class":`tool-card-name`,});  }
                     { svelteHTML.createElement("span", { "class":`tool-card-desc`,});       }
                   }
                   { svelteHTML.createElement("div", { "class":`tool-card-toggle`,});
                     { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":defaultToolsForRender().mcp,"onchange":(event) => updateDefaultTool('mcp', event.currentTarget.checked),"aria-label":`MCP default`,});}
                     { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                   }
                 }
               }
             }


};
return { props: {} as any as Props, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const FeaturesTab__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type FeaturesTab__SvelteComponent_ = ReturnType<typeof FeaturesTab__SvelteComponent_>;
/*Ωignore_endΩ*/export default FeaturesTab__SvelteComponent_;
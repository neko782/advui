<script lang="ts">
  import { IconDragHandle } from '../../icons'
  import SettingToggle from '../SettingToggle.svelte'
  import { TOOLS } from '../ToolsPicker.svelte'
  import type { MessageActionRole } from '../../types'
  import type { SettingsDraft } from './settingsDraft.svelte'

  interface Props {
    draft: SettingsDraft
  }

  const props: Props = $props()
  const draft = $derived(props.draft)
  const local = $derived(props.draft.local)

  /** Apply a change to the draft settings and save it. */
  function update(change: (settings: SettingsDraft['local']) => void) {
    change(local)
    props.draft.persist()
  }

  const MESSAGE_ACTION_ROLES: { id: MessageActionRole, label: string }[] = [
    { id: 'user', label: 'User' },
    { id: 'assistant', label: 'Assistant' },
    { id: 'system', label: 'System' },
  ]

  const messageActionsForRender = () => draft.messageActions
  const editorActionsForRender = () => draft.editorActions

  const toggleMessageActionRole = (id: string, role: MessageActionRole) => draft.toggleMessageActionRole(id, role)
  const resetMessageActions = () => draft.resetMessageActions()
  const toggleEditorAction = (id: string) => draft.toggleEditorAction(id)
  const resetEditorActions = () => draft.resetEditorActions()

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
</script>

            <section class="ui-group">
              <div class="ui-group-title">Display</div>
              <div class="ui-setting-list">
                <SettingToggle
                  label="Fancy effects"
                  hint="Blur, shadows and animations. Turn off for better performance on slower devices."
                  checked={!!local.fancyEffects}
                  onChange={(on) => update(s => { s.fancyEffects = on })}
                />
                <SettingToggle
                  label="Inline HTML"
                  ariaLabel="Allow inline HTML"
                  hint="Render HTML tags in markdown messages. Off by default for security."
                  checked={!!local.allowInlineHtml}
                  onChange={(on) => update(s => { s.allowInlineHtml = on })}
                />
                <SettingToggle
                  label="LaTeX math"
                  ariaLabel="Render LaTeX math"
                  hint="Render math wrapped in $, $$, \(...\), or \[...\] delimiters using KaTeX."
                  checked={local.renderLatex === true}
                  onChange={(on) => update(s => { s.renderLatex = on })}
                />
              </div>
            </section>

            <section class="ui-group">
              <div class="ui-group-title">Conversation editing</div>
              <div class="ui-setting-list">
                <SettingToggle
                  label="Change message roles"
                  hint="Click the role badge on an existing message to switch its role."
                  checked={!local.disableRoleSwitching}
                  onChange={(on) => update(s => { s.disableRoleSwitching = !on })}
                />
                <SettingToggle
                  label="Send as another role"
                  hint="Role menu on the send button. When off, messages always send as user."
                  checked={!local.disableSendRolePopup}
                  onChange={(on) => update(s => { s.disableSendRolePopup = !on })}
                />
                <SettingToggle
                  label="Add without sending"
                  hint="A button next to send that adds your message to the chat without requesting a reply."
                  checked={!!local.showAddWithoutSend}
                  onChange={(on) => update(s => { s.showAddWithoutSend = on })}
                />
                <SettingToggle
                  label="Insert between messages"
                  hint="Inline insert controls between existing messages."
                  checked={local.showInsertButtons !== false}
                  onChange={(on) => update(s => { s.showInsertButtons = on })}
                />
              </div>
            </section>

            <section class="ui-group">
              <div class="ui-group-title">Tools</div>
              <p class="ui-hint">A tool that is off here is hidden from every chat and preset and never sent, whatever they have saved. Each chat only offers the tools its connection's API supports; browser tools work with every API.</p>
              <div class="ui-setting-list">
                {#each TOOLS as tool (tool.id)}
                  <SettingToggle
                    label={tool.label}
                    hint={tool.desc}
                    checked={!draft.disabledTools[tool.id]}
                    onChange={(on) => draft.setToolDisabled(tool.id, !on)}
                  />
                {/each}
              </div>
            </section>

            <section class="ui-group">
              <div class="ui-group-title">Generation</div>
              <div class="ui-setting-list">
                <SettingToggle
                  label="Deprecated parameters"
                  hint="Bring back temperature, top P, Anthropic thinking and retired reasoning levels in chat settings and presets. Current models often ignore or reject them."
                  checked={!!local.showLegacyParams}
                  onChange={(on) => update(s => { s.showLegacyParams = on })}
                />
              </div>
            </section>

            <section class="ui-group">
              <div class="ui-group-head">
                <div class="ui-group-title">Message buttons</div>
                <button
                  type="button"
                  class="ui-btn ui-btn-outline ui-btn-sm"
                  onclick={resetMessageActions}
                  title="Reset to defaults"
                  aria-label="Reset message buttons to defaults"
                >Reset</button>
              </div>
              <p class="ui-hint">Pick the messages each button appears on — a button with nothing selected is hidden. Drag to change order.</p>
              <div class="ui-item-list ui-reorder-list">
                {#each messageActionsForRender() as action (action.id)}
                  {@const isDragging = draggedActionId === action.id}
                  {@const isDragOver = dragOverActionId === action.id && draggedActionId !== action.id}
                  <div
                    class="ui-list-item action-item {isDragging ? 'dragging' : ''} {isDragOver ? 'drag-over' : ''} {!action.enabled ? 'disabled-action' : ''}"
                    data-id={action.id}
                    draggable="true"
                    ondragstart={(e) => handleActionDragStart(e, action.id)}
                    ondragover={(e) => handleActionDragOver(e, action.id)}
                    ondrop={handleActionDrop}
                    ondragend={handleActionDragEnd}
                    role="listitem"
                  >
                    <div
                      class="ui-drag-handle"
                      aria-label="Drag to reorder"
                      ontouchstart={(e) => handleActionTouchStart(e, action.id)}
                      ontouchmove={handleActionTouchMove}
                      ontouchend={handleActionTouchEnd}
                      ontouchcancel={() => { touchActionDragId = null; touchActionListRef = null; draggedActionId = null; dragOverActionId = null }}
                    >
                      <IconDragHandle style="font-size: 20px;" />
                    </div>
                    <span class="action-item-label">{action.label}</span>
                    <div class="ui-chip-group role-chips" role="group" aria-label={`Show ${action.label} on`}>
                      {#each MESSAGE_ACTION_ROLES as role}
                        <button
                          type="button"
                          class="ui-chip ui-chip-sm"
                          aria-pressed={draft.messageActionShownOn(action, role.id)}
                          aria-label={`${action.label} on ${role.label} messages`}
                          title={`${action.label} on ${role.label.toLowerCase()} messages`}
                          onclick={() => toggleMessageActionRole(action.id, role.id)}
                        >{role.label}</button>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            </section>

            <section class="ui-group">
              <div class="ui-group-head">
                <div class="ui-group-title">Editor buttons</div>
                <button
                  type="button"
                  class="ui-btn ui-btn-outline ui-btn-sm"
                  onclick={resetEditorActions}
                  title="Reset to defaults"
                  aria-label="Reset editor buttons to defaults"
                >Reset</button>
              </div>
              <p class="ui-hint">Actions offered when you finish editing a message.</p>
              <div class="ui-chip-group" role="group" aria-label="Editor buttons">
                {#each editorActionsForRender() as action (action.id)}
                  <button
                    type="button"
                    class="ui-chip"
                    aria-pressed={action.enabled}
                    onclick={() => toggleEditorAction(action.id)}
                  >{action.label}</button>
                {/each}
              </div>
            </section>

<style>
  /* Groups, hints, setting rows, chips, item lists and drag handles come
     from shared ui.css. Only the message-button rows are local. */
  .action-item { flex-wrap: wrap; }
  .action-item-label {
    flex: 1;
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--text);
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 8px 0;
  }
  .action-item.disabled-action .action-item-label { color: var(--muted); }
  .role-chips {
    flex-wrap: nowrap;
    margin-left: auto;
    padding-right: var(--s1);
  }
  @media (max-width: 640px) {
    /* Two-row layout: handle + name on the first line, role chips on
       their own line below, so button names never get squeezed out. */
    .action-item { row-gap: 0; }
    .role-chips {
      order: 10;
      flex-basis: 100%;
      margin-left: 0;
      padding: 2px 4px 8px;
    }
  }
</style>

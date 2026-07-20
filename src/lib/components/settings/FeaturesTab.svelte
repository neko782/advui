<script lang="ts">
  import { IconDragHandle, IconTravelExplore, IconCodeBlocks, IconTerminal, IconImagesmode, IconExtension } from '../../icons'
  import { DEFAULT_MESSAGE_ACTIONS } from '../../constants/defaults.js'
  import type { MessageActionRole } from '../../types'
  import type { SettingsDraft } from './settingsDraft.svelte'

  interface Props {
    draft: SettingsDraft
  }

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

  const toggleMessageAction = (id) => draft.toggleMessageAction(id)
  const toggleMessageActionRole = (id, role) => draft.toggleMessageActionRole(id, role)
  const resetMessageActions = () => draft.resetMessageActions()
  const toggleEditorAction = (id) => draft.toggleEditorAction(id)
  const resetEditorActions = () => draft.resetEditorActions()
  const updateDefaultTool = (key, value) => draft.updateDefaultTool(key, value)

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
    const touchY = e.touches[0].clientY
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
              <div class="ui-group-title">General</div>
              <label class="ui-switch" title="Show thinking controls">
                <input
                  type="checkbox"
                  checked={!!local.showThinkingSettings}
                  onchange={(event) => {
                    local.showThinkingSettings = !!event.currentTarget.checked
                    persistSettings()
                  }}
                  aria-label="Show thinking controls"
                />
                <span class="ui-switch-ui" aria-hidden="true"></span>
                <span class="ui-switch-label">Anthropic thinking controls</span>
              </label>
              <p class="ui-hint">Enable control of Anthropic-style thinking parameters in chat settings.</p>
              <label class="ui-switch" title="Fancy effects">
                <input
                  type="checkbox"
                  checked={!!local.fancyEffects}
                  onchange={(event) => {
                    local.fancyEffects = !!event.currentTarget.checked
                    persistSettings()
                  }}
                  aria-label="Fancy effects"
                />
                <span class="ui-switch-ui" aria-hidden="true"></span>
                <span class="ui-switch-label">Fancy effects</span>
              </label>
              <p class="ui-hint">Enable blur effects, shadows, and animations. Disable for better performance on slower devices.</p>
              <label class="ui-switch" title="Allow inline HTML">
                <input
                  type="checkbox"
                  checked={!!local.allowInlineHtml}
                  onchange={(event) => {
                    local.allowInlineHtml = !!event.currentTarget.checked
                    persistSettings()
                  }}
                  aria-label="Allow inline HTML"
                />
                <span class="ui-switch-ui" aria-hidden="true"></span>
                <span class="ui-switch-label">Allow inline HTML</span>
              </label>
              <p class="ui-hint">Allow HTML tags in markdown messages. Disabled by default for security.</p>
              <label class="ui-switch" title="Render LaTeX math">
                <input
                  type="checkbox"
                  checked={local.renderLatex !== false}
                  onchange={(event) => {
                    local.renderLatex = !!event.currentTarget.checked
                    persistSettings()
                  }}
                  aria-label="Render LaTeX math"
                />
                <span class="ui-switch-ui" aria-hidden="true"></span>
                <span class="ui-switch-label">Render LaTeX math</span>
              </label>
              <p class="ui-hint">Render math wrapped in $, $$, \(...\), or \[...\] delimiters using KaTeX.</p>
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
              <p class="ui-hint">Toggle and reorder the action buttons shown on chat messages. Drag to change order.</p>
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
                    <div class="message-role-checks" aria-label={`${action.label} message roles`}>
                      {#each MESSAGE_ACTION_ROLES as role}
                        {@const checked = action.roles?.[role.id] ?? DEFAULT_MESSAGE_ACTIONS.find(a => a.id === action.id)?.roles?.[role.id] ?? true}
                        <label class="role-check" title={`${action.label} on ${role.label.toLowerCase()} messages`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onchange={() => toggleMessageActionRole(action.id, role.id)}
                            aria-label={`${action.label} on ${role.label} messages`}
                          />
                          <span>{role.label}</span>
                        </label>
                      {/each}
                    </div>
                    <label class="action-toggle" title={action.enabled ? 'Disable' : 'Enable'}>
                      <input
                        type="checkbox"
                        checked={action.enabled}
                        onchange={() => toggleMessageAction(action.id)}
                        aria-label={`${action.enabled ? 'Disable' : 'Enable'} ${action.label}`}
                      />
                      <span class="ui-switch-ui" aria-hidden="true"></span>
                    </label>
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
              <p class="ui-hint">Toggle the action buttons shown when editing a message.</p>
              <div class="ui-item-list">
                {#each editorActionsForRender() as action (action.id)}
                  <div
                    class="ui-list-item action-item {!action.enabled ? 'disabled-action' : ''}"
                    data-id={action.id}
                  >
                    <span class="action-item-label">{action.label}</span>
                    <label class="action-toggle" title={action.enabled ? 'Disable' : 'Enable'}>
                      <input
                        type="checkbox"
                        checked={action.enabled}
                        onchange={() => toggleEditorAction(action.id)}
                        aria-label={`${action.enabled ? 'Disable' : 'Enable'} ${action.label}`}
                      />
                      <span class="ui-switch-ui" aria-hidden="true"></span>
                    </label>
                  </div>
                {/each}
              </div>
            </section>

            <section class="ui-group">
              <div class="ui-group-title">Composer & roles</div>
              <label class="ui-switch" title="Disable role switching">
                <input
                  type="checkbox"
                  checked={!!local.disableRoleSwitching}
                  onchange={(event) => {
                    local.disableRoleSwitching = !!event.currentTarget.checked
                    persistSettings()
                  }}
                  aria-label="Disable role switching"
                />
                <span class="ui-switch-ui" aria-hidden="true"></span>
                <span class="ui-switch-label">Disable role switching on messages</span>
              </label>
              <p class="ui-hint">Prevent changing the role of existing messages by clicking the role badge.</p>
              <label class="ui-switch" title="Disable send role popup">
                <input
                  type="checkbox"
                  checked={!!local.disableSendRolePopup}
                  onchange={(event) => {
                    local.disableSendRolePopup = !!event.currentTarget.checked
                    persistSettings()
                  }}
                  aria-label="Disable send role popup"
                />
                <span class="ui-switch-ui" aria-hidden="true"></span>
                <span class="ui-switch-label">Disable send role popup</span>
              </label>
              <p class="ui-hint">Hide the role selection popup on the send button. Messages will always send as user.</p>
              <label class="ui-switch" title="Show add without sending button">
                <input
                  type="checkbox"
                  checked={!!local.showAddWithoutSend}
                  onchange={(event) => {
                    local.showAddWithoutSend = !!event.currentTarget.checked
                    persistSettings()
                  }}
                  aria-label="Show add without sending button"
                />
                <span class="ui-switch-ui" aria-hidden="true"></span>
                <span class="ui-switch-label">Add without sending button</span>
              </label>
              <p class="ui-hint">Show a button next to send that adds a message to the chat without triggering an API response.</p>
              <label class="ui-switch" title="Show insert buttons between messages">
                <input
                  type="checkbox"
                  checked={local.showInsertButtons !== false}
                  onchange={(event) => {
                    local.showInsertButtons = !!event.currentTarget.checked
                    persistSettings()
                  }}
                  aria-label="Show insert buttons between messages"
                />
                <span class="ui-switch-ui" aria-hidden="true"></span>
                <span class="ui-switch-label">Insert buttons between messages</span>
              </label>
              <p class="ui-hint">Show the inline insert controls between existing messages.</p>
            </section>

            <section class="ui-group">
              <div class="ui-group-title">Default tools</div>
              <p class="ui-hint">Set default tool availability for new presets. Only applies to Responses API connections.</p>
              <div class="tools-grid">
                <label class="tool-card" title="Web search">
                  <div class="tool-card-icon"><IconTravelExplore style="font-size: 24px;" /></div>
                  <div class="tool-card-info">
                    <span class="tool-card-name">Web search</span>
                    <span class="tool-card-desc">Search the web for up-to-date information</span>
                  </div>
                  <div class="tool-card-toggle">
                    <input
                      type="checkbox"
                      checked={defaultToolsForRender().webSearch}
                      onchange={(event) => updateDefaultTool('webSearch', event.currentTarget.checked)}
                      aria-label="Web search default"
                    />
                    <span class="ui-switch-ui" aria-hidden="true"></span>
                  </div>
                </label>
                <label class="tool-card" title="Code interpreter">
                  <div class="tool-card-icon"><IconCodeBlocks style="font-size: 24px;" /></div>
                  <div class="tool-card-info">
                    <span class="tool-card-name">Code interpreter</span>
                    <span class="tool-card-desc">Run Python code in a sandboxed environment</span>
                  </div>
                  <div class="tool-card-toggle">
                    <input
                      type="checkbox"
                      checked={defaultToolsForRender().codeInterpreter}
                      onchange={(event) => updateDefaultTool('codeInterpreter', event.currentTarget.checked)}
                      aria-label="Code interpreter default"
                    />
                    <span class="ui-switch-ui" aria-hidden="true"></span>
                  </div>
                </label>
                <label class="tool-card" title="Shell">
                  <div class="tool-card-icon"><IconTerminal style="font-size: 24px;" /></div>
                  <div class="tool-card-info">
                    <span class="tool-card-name">Shell</span>
                    <span class="tool-card-desc">Execute shell commands on the server</span>
                  </div>
                  <div class="tool-card-toggle">
                    <input
                      type="checkbox"
                      checked={defaultToolsForRender().shell}
                      onchange={(event) => updateDefaultTool('shell', event.currentTarget.checked)}
                      aria-label="Shell default"
                    />
                    <span class="ui-switch-ui" aria-hidden="true"></span>
                  </div>
                </label>
                <label class="tool-card" title="Image generation">
                  <div class="tool-card-icon"><IconImagesmode style="font-size: 24px;" /></div>
                  <div class="tool-card-info">
                    <span class="tool-card-name">Image generation</span>
                    <span class="tool-card-desc">Generate images from text descriptions</span>
                  </div>
                  <div class="tool-card-toggle">
                    <input
                      type="checkbox"
                      checked={defaultToolsForRender().imageGeneration}
                      onchange={(event) => updateDefaultTool('imageGeneration', event.currentTarget.checked)}
                      aria-label="Image generation default"
                    />
                    <span class="ui-switch-ui" aria-hidden="true"></span>
                  </div>
                </label>
                <label class="tool-card" title="MCP servers">
                  <div class="tool-card-icon"><IconExtension style="font-size: 24px;" /></div>
                  <div class="tool-card-info">
                    <span class="tool-card-name">MCP</span>
                    <span class="tool-card-desc">Remote tool servers via Model Context Protocol</span>
                  </div>
                  <div class="tool-card-toggle">
                    <input
                      type="checkbox"
                      checked={defaultToolsForRender().mcp}
                      onchange={(event) => updateDefaultTool('mcp', event.currentTarget.checked)}
                      aria-label="MCP default"
                    />
                    <span class="ui-switch-ui" aria-hidden="true"></span>
                  </div>
                </label>
              </div>
            </section>

<style>
  /* Groups, hints, item lists, drag handles, switches and buttons come from
     shared ui.css. Only message-action rows and the tools grid are local. */
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
  .action-item.disabled-action .action-item-label {
    color: var(--muted);
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--muted) 50%, transparent);
  }
  .action-item.disabled-action {
    opacity: 0.7;
    background: color-mix(in srgb, var(--bg) 90%, var(--muted) 10%);
  }
  .message-role-checks {
    display: flex;
    align-items: center;
    gap: var(--s2);
    flex-wrap: wrap;
    margin-left: auto;
  }
  .role-check {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.8rem;
    color: var(--muted);
    user-select: none;
  }
  .role-check input {
    width: 14px;
    height: 14px;
    margin: 0;
    accent-color: var(--accent);
  }
  .action-toggle {
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    flex-shrink: 0;
    user-select: none;
  }
  .action-toggle > input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
    pointer-events: none;
  }
  /* Tools grid */
  .tools-grid {
    display: grid;
    gap: var(--s2);
  }
  .tool-card {
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: 12px var(--s4);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    cursor: pointer;
    transition: border-color var(--dur) var(--ease), background-color var(--dur) var(--ease);
    user-select: none;
  }
  .tool-card:hover {
    border-color: color-mix(in srgb, var(--border) 55%, var(--accent) 45%);
  }
  .tool-card-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    color: var(--accent);
    flex-shrink: 0;
    transition: background-color var(--dur) var(--ease);
  }
  .tool-card:hover .tool-card-icon {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .tool-card-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .tool-card-name {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
  }
  .tool-card-desc {
    font-size: 0.8rem;
    color: var(--muted);
    line-height: 1.3;
  }
  .tool-card-toggle {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }
  .tool-card-toggle > input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
    pointer-events: none;
  }
  .tool-card:has(.tool-card-toggle > input:checked) {
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
    background: color-mix(in srgb, var(--accent) 5%, var(--bg));
  }
  @media (max-width: 640px) {
    /* Two-row layout: handle + name + toggle on the first line, role
       checkboxes wrap to their own full-width line below, so button names
       never get squeezed out. */
    .action-item { row-gap: 0; }
    .message-role-checks {
      order: 10;
      flex-basis: 100%;
      margin-left: 0;
      padding: 2px 4px 8px;
    }
  }
</style>

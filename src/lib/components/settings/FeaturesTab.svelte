<script lang="ts">
  import { IconDragHandle, IconTravelExplore, IconCodeBlocks, IconTerminal, IconImagesmode, IconExtension } from '../../icons'
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
    const listEl = (e.currentTarget as HTMLElement).closest('.item-list')
    if (listEl) touchActionListRef = listEl as HTMLElement
  }

  function handleActionTouchMove(e: TouchEvent) {
    if (!touchActionDragId || !touchActionListRef) return
    e.preventDefault()
    const touchY = e.touches[0].clientY
    const items = touchActionListRef.querySelectorAll('.list-item')
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

            <section class="group">
              <div class="group-title">General</div>
              <label class="switch" title="Show thinking controls">
                <input
                  type="checkbox"
                  checked={!!local.showThinkingSettings}
                  onchange={(event) => {
                    local.showThinkingSettings = !!event.currentTarget.checked
                    persistSettings()
                  }}
                  aria-label="Show thinking controls"
                />
                <span class="switch-ui" aria-hidden="true"></span>
                <span class="switch-label">Anthropic thinking controls</span>
              </label>
              <p class="hint">Enable control of Anthropic-style thinking parameters in chat settings.</p>
              <label class="switch" title="Fancy effects">
                <input
                  type="checkbox"
                  checked={!!local.fancyEffects}
                  onchange={(event) => {
                    local.fancyEffects = !!event.currentTarget.checked
                    persistSettings()
                  }}
                  aria-label="Fancy effects"
                />
                <span class="switch-ui" aria-hidden="true"></span>
                <span class="switch-label">Fancy effects</span>
              </label>
              <p class="hint">Enable blur effects, shadows, and animations. Disable for better performance on slower devices.</p>
              <label class="switch" title="Allow inline HTML">
                <input
                  type="checkbox"
                  checked={!!local.allowInlineHtml}
                  onchange={(event) => {
                    local.allowInlineHtml = !!event.currentTarget.checked
                    persistSettings()
                  }}
                  aria-label="Allow inline HTML"
                />
                <span class="switch-ui" aria-hidden="true"></span>
                <span class="switch-label">Allow inline HTML</span>
              </label>
              <p class="hint">Allow HTML tags in markdown messages. Disabled by default for security.</p>
            </section>

            <section class="group">
              <div class="group-head">
                <div class="group-title">Message buttons</div>
                <button
                  type="button"
                  class="reset-btn"
                  onclick={resetMessageActions}
                  title="Reset to defaults"
                  aria-label="Reset message buttons to defaults"
                >Reset</button>
              </div>
              <p class="hint section-hint">Toggle and reorder the action buttons shown on chat messages. Drag to change order.</p>
              <div class="item-list reorder-list">
                {#each messageActionsForRender() as action (action.id)}
                  {@const isDragging = draggedActionId === action.id}
                  {@const isDragOver = dragOverActionId === action.id && draggedActionId !== action.id}
                  <div
                    class="list-item action-item {isDragging ? 'dragging' : ''} {isDragOver ? 'drag-over' : ''} {!action.enabled ? 'disabled-action' : ''}"
                    data-id={action.id}
                    draggable="true"
                    ondragstart={(e) => handleActionDragStart(e, action.id)}
                    ondragover={(e) => handleActionDragOver(e, action.id)}
                    ondrop={handleActionDrop}
                    ondragend={handleActionDragEnd}
                    role="listitem"
                  >
                    <div
                      class="drag-handle"
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
                      <span class="switch-ui" aria-hidden="true"></span>
                    </label>
                  </div>
                {/each}
              </div>
            </section>

            <section class="group">
              <div class="group-head">
                <div class="group-title">Editor buttons</div>
                <button
                  type="button"
                  class="reset-btn"
                  onclick={resetEditorActions}
                  title="Reset to defaults"
                  aria-label="Reset editor buttons to defaults"
                >Reset</button>
              </div>
              <p class="hint section-hint">Toggle the action buttons shown when editing a message.</p>
              <div class="item-list">
                {#each editorActionsForRender() as action (action.id)}
                  <div
                    class="list-item action-item {!action.enabled ? 'disabled-action' : ''}"
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
                      <span class="switch-ui" aria-hidden="true"></span>
                    </label>
                  </div>
                {/each}
              </div>
            </section>

            <section class="group">
              <div class="group-title">Composer & roles</div>
              <label class="switch" title="Disable role switching">
                <input
                  type="checkbox"
                  checked={!!local.disableRoleSwitching}
                  onchange={(event) => {
                    local.disableRoleSwitching = !!event.currentTarget.checked
                    persistSettings()
                  }}
                  aria-label="Disable role switching"
                />
                <span class="switch-ui" aria-hidden="true"></span>
                <span class="switch-label">Disable role switching on messages</span>
              </label>
              <p class="hint">Prevent changing the role of existing messages by clicking the role badge.</p>
              <label class="switch" title="Disable send role popup">
                <input
                  type="checkbox"
                  checked={!!local.disableSendRolePopup}
                  onchange={(event) => {
                    local.disableSendRolePopup = !!event.currentTarget.checked
                    persistSettings()
                  }}
                  aria-label="Disable send role popup"
                />
                <span class="switch-ui" aria-hidden="true"></span>
                <span class="switch-label">Disable send role popup</span>
              </label>
              <p class="hint">Hide the role selection popup on the send button. Messages will always send as user.</p>
              <label class="switch" title="Show add without sending button">
                <input
                  type="checkbox"
                  checked={!!local.showAddWithoutSend}
                  onchange={(event) => {
                    local.showAddWithoutSend = !!event.currentTarget.checked
                    persistSettings()
                  }}
                  aria-label="Show add without sending button"
                />
                <span class="switch-ui" aria-hidden="true"></span>
                <span class="switch-label">Add without sending button</span>
              </label>
              <p class="hint">Show a button next to send that adds a message to the chat without triggering an API response.</p>
              <label class="switch" title="Show insert buttons between messages">
                <input
                  type="checkbox"
                  checked={local.showInsertButtons !== false}
                  onchange={(event) => {
                    local.showInsertButtons = !!event.currentTarget.checked
                    persistSettings()
                  }}
                  aria-label="Show insert buttons between messages"
                />
                <span class="switch-ui" aria-hidden="true"></span>
                <span class="switch-label">Insert buttons between messages</span>
              </label>
              <p class="hint">Show the inline insert controls between existing messages.</p>
            </section>

            <section class="group">
              <div class="group-title">Default tools</div>
              <p class="hint section-hint">Set default tool availability for new presets. Only applies to Responses API connections.</p>
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
                    <span class="switch-ui" aria-hidden="true"></span>
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
                    <span class="switch-ui" aria-hidden="true"></span>
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
                    <span class="switch-ui" aria-hidden="true"></span>
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
                    <span class="switch-ui" aria-hidden="true"></span>
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
                    <span class="switch-ui" aria-hidden="true"></span>
                  </div>
                </label>
              </div>
            </section>

<style>
  @keyframes backdrop-fade-in {
    from { opacity: 0;
    }
    to { opacity: 1;
    }
  }
  @keyframes panel-slide-in {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(8px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }
  .hint {
    color: var(--muted);
    font-size: .85rem;
    margin-top: 2px;
    line-height: 1.4;
  }
  /* API key action buttons size */
  .group {
    display: grid;
    gap: 12px;
    padding: 20px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    transition: border-color 0.15s ease;
  }
  .group:hover {
    border-color: color-mix(in srgb, var(--border) 80%, var(--text) 20%);
  }
  .group-title {
    font-weight: 600;
    font-size: 1rem;
    letter-spacing: -0.01em;
    color: var(--text);
  }
  .group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 4px;
  }
  /* Item list for connections and presets */
  .section-hint {
    margin: 0 0 8px;
    opacity: 0.9;
  }
  .item-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 20px;
  }
  .list-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px;
    border-radius: 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .list-item:hover {
    border-color: color-mix(in srgb, var(--border) 60%, var(--accent) 40%);
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  }
  .list-item.dragging {
    opacity: 0.5;
    border-style: dashed;
    border-color: var(--accent);
    transform: scale(0.98);
    z-index: 10;
    background: color-mix(in srgb, var(--accent) 8%, var(--bg) 92%);
  }
  /* Reorder list with smooth transitions */
  .reorder-list .list-item {
    transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1), opacity 0.15s ease, border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
  }
  .reorder-list .list-item.dragging {
    transition: opacity 0.15s ease, border-color 0.15s ease;
  }
  /* Remove old drag-over highlight - items now shift visually */
  .list-item.drag-over {
    /* Items shift position instead of just highlighting */
  }
  .drag-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 44px;
    color: var(--muted);
    cursor: grab;
    border: none;
    background: transparent;
    border-radius: 8px;
    flex-shrink: 0;
    transition: color 0.15s ease, background 0.15s ease;
    opacity: 0.7;
    touch-action: none;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }
  .list-item:hover .drag-handle {
    opacity: 1;
  }
  .drag-handle:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--border) 40%, transparent);
  }
  .drag-handle:active {
    cursor: grabbing;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  /* Mobile: always show drag handle clearly */
  @media (pointer: coarse) {
    .drag-handle {
      opacity: 1;
      width: 44px;
      height: 48px;
    }
  }
  /* Form section styling */
  /* Add button styling */
  /* Legacy styles kept for backward compatibility */
  /* Toggle switch */
  .switch {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    user-select: none;
  }
  .switch > input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none;
  }
  .switch-ui {
    width: 46px;
    height: 26px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--border) 80%, var(--muted) 20%);
    position: relative;
    transition: background-color .2s ease, box-shadow .2s ease;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
  }
  .switch-ui::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2), 0 2px 6px rgba(0,0,0,0.1);
    transition: transform .2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .switch:hover .switch-ui {
    background: color-mix(in srgb, var(--border) 60%, var(--muted) 40%);
  }
  :global(:root[data-theme='dark']) .switch-ui {
    background: #2a2a2a;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.3);
  }
  :global(:root[data-theme='dark']) .switch-ui::after { background: #e6e6e6;
  }
  .switch > input:checked + .switch-ui {
    background: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
  }
  .switch > input:checked + .switch-ui::after { transform: translateX(20px);
  }
  .switch-label {
    font-size: .95rem;
    font-weight: 500;
    color: var(--text);
  }
  @media (max-width: 640px) {
    .group { padding: 16px; border-radius: 12px;
    }
  }
  /* Smooth scrollbar styling */
  /* Reset button */
  .reset-btn {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    color: var(--muted);
    font: inherit;
    font-size: 0.8rem;
    font-weight: 500;
    padding: 6px 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .reset-btn:hover {
    color: var(--text);
    border-color: color-mix(in srgb, var(--border) 60%, var(--text) 30%);
    background: var(--bg);
  }
  /* Action item in message buttons list */
  .action-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    flex-wrap: wrap;
  }
  .action-item-label {
    flex: 1;
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--text);
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 8px 4px;
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
    gap: 8px;
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
  .action-toggle .switch-ui {
    width: 40px;
    height: 22px;
  }
  .action-toggle .switch-ui::after {
    width: 16px;
    height: 16px;
  }
  .action-toggle > input:checked + .switch-ui {
    background: var(--accent) !important;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
  }
  .action-toggle > input:checked + .switch-ui::after {
    transform: translateX(18px);
  }
  .action-toggle:hover > input:not(:checked) + .switch-ui {
    background: color-mix(in srgb, var(--border) 60%, var(--muted) 40%);
  }
  :global(:root[data-theme='dark']) .action-toggle > input:not(:checked) + .switch-ui {
    background: #2a2a2a;
  }
  /* Tools grid */
  .tools-grid {
    display: grid;
    gap: 8px;
  }
  .tool-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 16px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    user-select: none;
  }
  .tool-card:hover {
    border-color: color-mix(in srgb, var(--border) 60%, var(--accent) 40%);
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  }
  .tool-card-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--accent) 10%, var(--panel) 90%);
    color: var(--accent);
    flex-shrink: 0;
    transition: background 0.15s ease;
  }
  .tool-card:hover .tool-card-icon {
    background: color-mix(in srgb, var(--accent) 16%, var(--panel) 84%);
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
  .tool-card-toggle .switch-ui {
    width: 46px;
    height: 26px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--border) 80%, var(--muted) 20%);
    position: relative;
    transition: background-color .2s ease, box-shadow .2s ease;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
  }
  .tool-card-toggle .switch-ui::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2), 0 2px 6px rgba(0,0,0,0.1);
    transition: transform .2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .tool-card:hover .tool-card-toggle > input:not(:checked) + .switch-ui {
    background: color-mix(in srgb, var(--border) 60%, var(--muted) 40%);
  }
  :global(:root[data-theme='dark']) .tool-card-toggle > input:not(:checked) + .switch-ui {
    background: #2a2a2a;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.3);
  }
  :global(:root[data-theme='dark']) .tool-card-toggle .switch-ui::after {
    background: #e6e6e6;
  }
  .tool-card-toggle > input:checked + .switch-ui {
    background: var(--accent) !important;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
  }
  .tool-card-toggle > input:checked + .switch-ui::after {
    transform: translateX(20px);
  }
  .tool-card:has(.tool-card-toggle > input:checked) {
    border-color: color-mix(in srgb, var(--accent) 30%, var(--border) 70%);
    background: color-mix(in srgb, var(--accent) 4%, var(--bg) 96%);
  }
</style>

<script lang="ts">
  import { formatRole } from '../../utils/format'
  import MessageMeta from './MessageMeta.svelte'
  import MessageBubble from './MessageBubble.svelte'
  import MessageActions from './MessageActions.svelte'
  import type { VisibleMessage, MessageRole } from '../../types'

  interface Props {
    vm: VisibleMessage
    total?: number
    visibleCount?: number
    locked?: boolean
    debug?: boolean
    editingId?: number | null
    editingText?: string
    hasFollowingAssistant?: boolean
    nextAssistantId?: number
    nextAssistantTyping?: boolean
    parentId?: number | null
    branchIndex?: number
    branchesLength?: number
    onSetRole?: (id: number, role: MessageRole) => void
    onEditInput?: (text: string) => void
    onEditKeydown?: (e: KeyboardEvent) => void
    onApplyEditSend?: () => void
    onApplyEditBranch?: () => void
    onApplyEditReplace?: () => void
    onCancelEdit?: () => void
    onChangeVariant?: (id: number, delta: number) => void
    onRefreshAssistant?: (id: number) => void
    onRefreshAfterUserIndex?: (index: number) => void
    onCopy?: (text: string) => void
    onDelete?: (id: number) => void
    onEdit?: (id: number) => void
    onMoveDown?: (id: number) => void
    onMoveUp?: (id: number) => void
    onDebugFuckBranch?: (id: number) => void
  }

  const props: Props = $props()
  // Keep these derived from props so they update when parent data changes
  const vm = $derived(props.vm)
  const m = $derived(vm.m)
  const isEditing = $derived(props.editingId === m.id)
  const branchesLength = $derived(Number(props.branchesLength) || 0)
  const branchIndex = $derived(Number(props.branchIndex) || 0)
  // Move should target the clicked message, not its parent
  function doMoveUp() { props.onMoveUp?.(m.id) }
  function doMoveDown() { props.onMoveDown?.(m.id) }
</script>

<div class={`row ${m.role}`}>
  <div class={`stack ${m.role} ${isEditing ? 'editing' : ''}`}>
    <MessageMeta role={m.role} label={formatRole(m.role)} locked={props.locked} debug={props.debug} messageId={m.id} onSetRole={(r) => props.onSetRole?.(m.id, r)} />
    <MessageBubble
      message={m}
      isEditing={isEditing}
      editingText={props.editingText}
      onEditInput={(t) => props.onEditInput?.(t)}
      onEditKeydown={props.onEditKeydown}
    />
    <!-- Error notices are now centralized at the list bottom -->
    <MessageActions
      message={m}
      index={vm.i}
      total={props.total}
      visibleCount={props.visibleCount}
      locked={props.locked}
      debug={props.debug}
      isEditing={isEditing}
      branchesLength={branchesLength}
      branchIndex={branchIndex}
      hasFollowingAssistant={props.hasFollowingAssistant}
      nextAssistantId={props.nextAssistantId}
      nextAssistantTyping={props.nextAssistantTyping}
      onApplyEditSend={props.onApplyEditSend}
      onApplyEditBranch={props.onApplyEditBranch}
      onApplyEditReplace={props.onApplyEditReplace}
      onCancelEdit={props.onCancelEdit}
      onChangeVariant={(d) => props.onChangeVariant?.(m.id, d)}
      onRefreshAssistant={props.onRefreshAssistant}
      onRefreshAfterUserIndex={props.onRefreshAfterUserIndex}
      onCopy={props.onCopy}
      onDelete={props.onDelete}
      onEdit={props.onEdit}
      onMoveDown={doMoveDown}
      onMoveUp={doMoveUp}
      onDebugFuckBranch={props.onDebugFuckBranch}
    />
  </div>
</div>

<style>
  .row { display: flex; max-width: var(--page-max); margin-inline: auto; width: 100%; padding-inline: 0; contain: layout style; }
  .row.user { justify-content: flex-end; }
  .row.assistant { justify-content: flex-start; }
  .row.system { justify-content: center; }
  .stack { display: grid; grid-auto-flow: row; grid-auto-rows: max-content; grid-template-columns: minmax(0, 1fr); gap: 2px; width: min(720px, 92%); }
  .stack.assistant { justify-content: start; }
  .stack.user { justify-content: end; }
  .stack.system { justify-content: center; width: 100%; max-width: var(--page-max); }
  .notice { font-size: 0.88rem; line-height: 1.3; padding: 6px 10px; border-radius: 10px; border: 1px solid color-mix(in srgb, #ef4444 45%, transparent); background: color-mix(in srgb, #ef4444 9%, transparent); color: color-mix(in srgb, #b91c1c 92%, transparent); }
  .stack.assistant .notice { justify-self: start; }
  .stack.user .notice { justify-self: end; }
  .stack.system .notice { justify-self: center; }
</style>

<script>
  import { formatRole } from '../../utils/format.js'
  import MessageMeta from './MessageMeta.svelte'
  import MessageBubble from './MessageBubble.svelte'
  import MessageActions from './MessageActions.svelte'
  const props = $props()
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
    <MessageMeta role={m.role} label={formatRole(m.role)} locked={props.locked} onSetRole={(r) => props.onSetRole?.(m.id, r)} />
    <MessageBubble
      message={m}
      isEditing={isEditing}
      editingText={props.editingText}
      onEditInput={(t) => props.onEditInput?.(t)}
      onEditKeydown={props.onEditKeydown}
    />
    {#if m?.error}
      <div class="notice error" role="status" aria-live="polite">Error: {m.error}</div>
    {/if}
    <MessageActions
      message={m}
      index={vm.i}
      total={props.total}
      visibleCount={props.visibleCount}
      locked={props.locked}
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
    />
  </div>
</div>

<style>
  .row { display: flex; max-width: var(--page-max); margin-inline: auto; width: 100%; padding-inline: 0; }
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

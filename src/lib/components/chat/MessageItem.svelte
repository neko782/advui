<script>
  import { formatRole } from '../../utils/format.js'
  import MessageMeta from './MessageMeta.svelte'
  import MessageBubble from './MessageBubble.svelte'
  import MessageActions from './MessageActions.svelte'
  const props = $props()
  const vm = props.vm
  const m = vm.m
  const isEditing = props.editingId === m.id
  const variantsLength = Array.isArray(m.variants) ? m.variants.length : 0
  const variantIndex = typeof m.variantIndex === 'number' ? m.variantIndex : 0
</script>

<div class={`row ${m.role}`}>
  <div class={`stack ${m.role} ${isEditing ? 'editing' : ''}`}>
    <MessageMeta role={m.role} label={formatRole(m.role)} onSetRole={(r) => props.onSetRole?.(m.id, r)} />
    <MessageBubble
      message={m}
      isEditing={isEditing}
      editingText={props.editingText}
      onEditInput={(t) => props.onEditInput?.(t)}
      onEditKeydown={props.onEditKeydown}
    />
    <MessageActions
      message={m}
      index={vm.i}
      total={props.total}
      isEditing={isEditing}
      variantsLength={variantsLength}
      variantIndex={variantIndex}
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
      onMoveDown={props.onMoveDown}
      onMoveUp={props.onMoveUp}
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
</style>

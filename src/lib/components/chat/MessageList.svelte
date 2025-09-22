<script>
  import MessageItem from './MessageItem.svelte'
  const props = $props()
  let listEl
  export function scrollToBottom() {
    try { listEl?.scrollTo({ top: listEl.scrollHeight, behavior: 'smooth' }) } catch {}
  }
</script>

<div class="messages" bind:this={listEl}>
  {#each props.items as vm (vm.m.id)}
    <MessageItem
      vm={vm}
      total={props.total}
      locked={props.locked}
      editingId={props.editingId}
      editingText={props.editingText}
      hasFollowingAssistant={props.followingMap?.[vm.i]?.has}
      nextAssistantId={props.followingMap?.[vm.i]?.id}
      nextAssistantTyping={props.followingMap?.[vm.i]?.typing}
      branchIndex={(props.selectedMap && vm?.m) ? (Number(props.selectedMap[vm.m.id]) || 0) : 0}
      branchesLength={(vm?.m && Array.isArray(vm.m.next)) ? vm.m.next.length : 0}
      onSetRole={props.onSetRole}
      onEditInput={props.onEditInput}
      onEditKeydown={props.onEditKeydown}
      onApplyEditSend={props.onApplyEditSend}
      onApplyEditBranch={props.onApplyEditBranch}
      onApplyEditReplace={props.onApplyEditReplace}
      onCancelEdit={props.onCancelEdit}
      onChangeVariant={props.onChangeVariant}
      onRefreshAssistant={props.onRefreshAssistant}
      onRefreshAfterUserIndex={props.onRefreshAfterUserIndex}
      onCopy={props.onCopy}
      onDelete={props.onDelete}
      onEdit={props.onEdit}
      onMoveDown={props.onMoveDown}
      onMoveUp={props.onMoveUp}
    />
  {/each}
</div>

<style>
  .messages { overflow: auto; padding: 16px 0 8px; display: grid; align-content: start; gap: 8px; }
</style>

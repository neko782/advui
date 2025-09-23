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
      visibleCount={(props.items?.length || 0)}
      locked={props.locked}
      debug={props.debug}
      editingId={props.editingId}
      editingText={props.editingText}
      hasFollowingAssistant={props.followingMap?.[vm.i]?.has}
      nextAssistantId={props.followingMap?.[vm.i]?.id}
      nextAssistantTyping={props.followingMap?.[vm.i]?.typing}
      parentId={(vm?.i > 0 && props.items?.[vm.i - 1]?.m?.id) ? props.items[vm.i - 1].m.id : null}
      branchIndex={(typeof vm?.variantIndex === 'number') ? vm.variantIndex : 0}
      branchesLength={(typeof vm?.variantsLength === 'number') ? vm.variantsLength : 1}
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
      onDebugFuckBranch={props.onDebugFuckBranch}
    />
  {/each}
  {#if props.notice}
    <div class="notice error" role="status" aria-live="polite">
      <span class="notice-text">{props.notice}</span>
      <button class="notice-close" aria-label="Dismiss notice" onclick={() => props.onDismissNotice?.()}>×</button>
    </div>
  {/if}
</div>

<style>
  .messages { overflow: auto; padding: 16px 0 8px; display: grid; align-content: start; gap: 8px; }
  .notice {
    font-size: 0.88rem; line-height: 1.3;
    padding: 6px 10px; border-radius: 10px;
    border: 1px solid color-mix(in srgb, #ef4444 45%, transparent);
    background: color-mix(in srgb, #ef4444 9%, transparent);
    color: color-mix(in srgb, #b91c1c 92%, transparent);
    max-width: var(--page-max); justify-self: center; width: min(720px, 92%);
    display: grid; grid-template-columns: 1fr auto; align-items: start; gap: 8px;
  }
  .notice-close {
    appearance: none; border: none; background: transparent; color: inherit;
    font-size: 16px; line-height: 1; padding: 2px 6px; cursor: pointer; border-radius: 6px;
  }
  .notice-close:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
</style>

<script lang="ts">
  import MessageItem from './MessageItem.svelte'
  import { IconAdd } from '../../icons'
  import type { VisibleMessage, MessageRole } from '../../types'

  interface Props {
    items?: VisibleMessage[]
    chatId?: string
    notice?: string
    total?: number
    locked?: boolean
    debug?: boolean
    editingId?: number | null
    editingText?: string
    followingMap?: Record<number, { has: boolean; id?: number; typing?: boolean }>
    onDismissNotice?: () => void
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
    onFork?: (id: number) => void
    onDebugFuckBranch?: (id: number) => void
    onDebugMessageDeath?: (id: number) => void
    onInsertBetween?: (afterIndex: number) => void
  }

  const props: Props = $props()
  let listEl: HTMLDivElement | undefined
  export function scrollToBottom(): void {
    // Instant scroll on mobile for better performance
    try { listEl?.scrollTo({ top: listEl.scrollHeight, behavior: 'instant' }) } catch {}
  }
</script>

<div class="messages" bind:this={listEl}>
  {#each props.items as vm, idx (`${props.chatId ?? ''}:${vm.m.id}`)}
    {#if idx > 0}
      <div class="insert-zone" class:disabled={props.locked} role="button" tabindex={props.locked ? -1 : 0} aria-label="Insert message here" aria-disabled={props.locked} onclick={() => !props.locked && props.onInsertBetween?.(idx - 1)} onkeydown={(e) => !props.locked && (e.key === 'Enter' || e.key === ' ') && props.onInsertBetween?.(idx - 1)}>
        <div class="insert-line"></div>
        <span class="insert-btn" aria-hidden="true"><IconAdd style="font-size: 18px;" /></span>
        <div class="insert-line"></div>
      </div>
    {/if}
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
      onFork={props.onFork}
      onDebugFuckBranch={props.onDebugFuckBranch}
      onDebugMessageDeath={props.onDebugMessageDeath}
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
  .messages { overflow: auto; padding: 16px 0 8px; display: grid; align-content: start; gap: 8px; contain: layout style; }
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

  .insert-zone {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 4px 0;
    margin: -2px 0;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s ease;
    max-width: var(--page-max);
    width: min(720px, 92%);
    justify-self: center;
  }
  .insert-zone:hover, .insert-zone:focus-visible { opacity: 1; }
  .insert-zone:focus-visible { outline: none; }
  .insert-zone.disabled { pointer-events: none; }
  .insert-line {
    flex: 1;
    height: 1px;
    background: var(--border);
    opacity: 0.6;
  }
  .insert-btn {
    color: var(--muted);
    line-height: 0;
    display: grid;
    place-items: center;
    transition: color 0.15s ease;
  }
  .insert-zone:hover .insert-btn, .insert-zone:focus-visible .insert-btn {
    color: var(--text);
  }
</style>

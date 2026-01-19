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
    allowInlineHtml?: boolean
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
  
  // Virtual scrolling state
  let listEl: HTMLDivElement | undefined = $state()
  let scrollTop = $state(0)
  let containerHeight = $state(600)
  
  const BUFFER_COUNT = 3

  // Height cache - persists across renders, only measures once per message
  let heightCache = $state<Record<number, number>>({})
  let heightVersion = $state(0)

  // Check if all items have been measured
  const allItemsMeasured = $derived.by(() => {
    void heightVersion
    const items = props.items ?? []
    if (items.length === 0) return true
    for (const item of items) {
      if (!heightCache[item.m.id]) return false
    }
    return true
  })

  function getItemHeight(index: number): number {
    void heightVersion
    const id = props.items?.[index]?.m?.id
    if (id !== undefined && heightCache[id]) {
      return heightCache[id]
    }
    return 0 // Should not happen when virtualization is enabled
  }

  // Pre-compute offsets for all items (only used when virtualized)
  const itemOffsets = $derived.by(() => {
    void heightVersion
    const items = props.items ?? []
    const offsets: number[] = []
    let offset = 0
    for (let i = 0; i < items.length; i++) {
      offsets.push(offset)
      offset += getItemHeight(i)
    }
    return offsets
  })

  const totalHeight = $derived.by(() => {
    void heightVersion
    const items = props.items ?? []
    if (items.length === 0) return 0
    const lastOffset = itemOffsets[items.length - 1] ?? 0
    return lastOffset + getItemHeight(items.length - 1)
  })

  const visibleRange = $derived.by(() => {
    void heightVersion
    const items = props.items ?? []
    if (items.length === 0) return { startIndex: 0, endIndex: 0 }
    
    // If not all items measured, show all items (no virtualization)
    if (!allItemsMeasured) {
      return { startIndex: 0, endIndex: items.length }
    }
    
    // Binary search for start index
    let startIndex = 0
    let lo = 0, hi = items.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1
      const offset = itemOffsets[mid] ?? 0
      const height = getItemHeight(mid)
      if (offset + height < scrollTop) {
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    startIndex = Math.max(0, lo - BUFFER_COUNT)

    // Find end index - use measured heights for buffer calculation
    const viewEnd = scrollTop + containerHeight
    let endIndex = startIndex
    for (let i = startIndex; i < items.length; i++) {
      endIndex = i + 1
      const offset = itemOffsets[i] ?? 0
      const height = getItemHeight(i)
      if (offset > viewEnd + height * BUFFER_COUNT) break
    }
    
    return { startIndex, endIndex: Math.min(items.length, endIndex) }
  })

  const visibleItems = $derived.by(() => {
    const items = props.items ?? []
    const { startIndex, endIndex } = visibleRange
    const result: { vm: VisibleMessage; index: number; offsetY: number }[] = []
    for (let i = startIndex; i < endIndex; i++) {
      const vm = items[i]
      if (vm) {
        // When not virtualized (allItemsMeasured = false), offsetY is not used
        result.push({ vm, index: i, offsetY: allItemsMeasured ? (itemOffsets[i] ?? 0) : 0 })
      }
    }
    return result
  })

  function handleScroll() {
    if (listEl) {
      scrollTop = listEl.scrollTop
    }
  }

  function measureItem(node: HTMLElement, id: number) {
    // Only measure once - skip if already cached
    if (heightCache[id]) return {}
    
    const measure = () => {
      if (heightCache[id]) return // Already measured
      const h = node.offsetHeight
      if (h > 0) {
        heightCache[id] = h
        heightVersion++
      }
    }
    
    requestAnimationFrame(measure)
    
    return {}
  }

  // Track container size
  $effect(() => {
    if (!listEl) return
    containerHeight = listEl.clientHeight
    const ro = new ResizeObserver((entries) => {
      containerHeight = entries[0]?.contentRect.height ?? 600
    })
    ro.observe(listEl)
    return () => ro.disconnect()
  })

  // Clear height cache when chat changes
  let lastChatId: string | undefined
  $effect(() => {
    if (props.chatId !== lastChatId) {
      lastChatId = props.chatId
      heightCache = {}
    }
  })

  export function scrollToBottom(): void {
    if (listEl) {
      listEl.scrollTo({ top: listEl.scrollHeight, behavior: 'instant' })
    }
  }
</script>

<div class="messages" bind:this={listEl} onscroll={handleScroll}>
  <div class="virtual-spacer" style={allItemsMeasured ? `height: ${totalHeight}px;` : ''}>
    {#each visibleItems as { vm, index: idx, offsetY } (vm.m.id)}
      <div
        class={allItemsMeasured ? 'virtual-item' : 'flow-item'}
        style={allItemsMeasured ? `transform: translateY(${offsetY}px);` : ''}
        use:measureItem={vm.m.id}
      >
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
          allowInlineHtml={props.allowInlineHtml}
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
      </div>
    {/each}
  </div>
  {#if props.notice}
    <div class="notice error" role="status" aria-live="polite">
      <span class="notice-text">{props.notice}</span>
      <button class="notice-close" aria-label="Dismiss notice" onclick={() => props.onDismissNotice?.()}>×</button>
    </div>
  {/if}
</div>

<style>
  .messages { overflow-y: auto; overflow-x: hidden; padding: 16px 0 8px; height: 100%; min-height: 0; }
  .virtual-spacer { position: relative; width: 100%; }
  .virtual-item { position: absolute; top: 0; left: 0; width: 100%; }
  .flow-item { position: relative; width: 100%; }
  .notice {
    position: sticky; bottom: 8px;
    font-size: 0.88rem; line-height: 1.3;
    padding: 6px 10px; border-radius: 10px;
    border: 1px solid color-mix(in srgb, #ef4444 45%, transparent);
    background: color-mix(in srgb, #ef4444 20%, var(--bg));
    color: color-mix(in srgb, #b91c1c 92%, transparent);
    max-width: var(--page-max); margin-inline: auto; width: min(720px, 92%);
    display: grid; grid-template-columns: 1fr auto; align-items: start; gap: 8px;
    z-index: 10;
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
    margin: -2px auto 0;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s ease;
    max-width: var(--page-max);
    width: min(720px, 92%);
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

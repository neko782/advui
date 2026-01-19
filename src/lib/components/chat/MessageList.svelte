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
  
  const ESTIMATED_HEIGHT = 150
  const BUFFER_COUNT = 3

  // Height cache - persists across renders, only measures once per message
  let heightCache = $state<Record<number, number>>({})
  let heightVersion = $state(0)
  
  // Track pending scroll adjustments and batch them
  let pendingMeasurements: Array<{ id: number; height: number; oldHeight: number }> = []
  let measurementFrameScheduled = false

  function getItemHeight(index: number): number {
    void heightVersion
    const id = props.items?.[index]?.m?.id
    if (id !== undefined && heightCache[id]) {
      return heightCache[id]
    }
    return ESTIMATED_HEIGHT
  }
  
  function getItemHeightById(id: number): number {
    if (heightCache[id]) {
      return heightCache[id]
    }
    return ESTIMATED_HEIGHT
  }
  
  function processPendingMeasurements() {
    measurementFrameScheduled = false
    if (pendingMeasurements.length === 0) return
    
    const items = props.items ?? []
    const currentScrollTop = scrollTop
    let scrollAdjustment = 0
    
    // Build a map of id to index for quick lookup
    const idToIndex = new Map<number, number>()
    for (let i = 0; i < items.length; i++) {
      const id = items[i]?.m?.id
      if (id !== undefined) idToIndex.set(id, i)
    }
    
    // Sort measurements by index to process from top to bottom
    const measurementsWithIndex = pendingMeasurements
      .map(m => ({ ...m, index: idToIndex.get(m.id) ?? -1 }))
      .filter(m => m.index >= 0)
      .sort((a, b) => a.index - b.index)
    
    // Calculate offset for each pending measurement and determine scroll adjustment
    // Process in order so cache updates affect subsequent offset calculations correctly
    for (const { id, height, oldHeight, index } of measurementsWithIndex) {
      // Calculate offset of this item (using current cache state)
      let itemOffset = 0
      for (let i = 0; i < index; i++) {
        itemOffset += getItemHeight(i)
      }
      
      // If this item ends above the current scroll position (plus any accumulated adjustment),
      // adjust scroll to keep visible content stable
      if (itemOffset + oldHeight <= currentScrollTop + scrollAdjustment) {
        scrollAdjustment += height - oldHeight
      }
      
      // Update the cache immediately so subsequent items use the correct height
      heightCache[id] = height
    }
    
    pendingMeasurements = []
    heightVersion++
    
    // Apply scroll adjustment if needed
    if (scrollAdjustment !== 0 && listEl) {
      listEl.scrollTop = listEl.scrollTop + scrollAdjustment
      scrollTop = listEl.scrollTop
    }
  }

  // Pre-compute offsets for all items
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

    // Find end index
    const viewEnd = scrollTop + containerHeight
    let endIndex = startIndex
    for (let i = startIndex; i < items.length; i++) {
      endIndex = i + 1
      const offset = itemOffsets[i] ?? 0
      if (offset > viewEnd + ESTIMATED_HEIGHT * BUFFER_COUNT) break
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
        result.push({ vm, index: i, offsetY: itemOffsets[i] ?? 0 })
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
        const oldHeight = getItemHeightById(id)
        pendingMeasurements.push({ id, height: h, oldHeight })
        
        // Schedule processing if not already scheduled
        if (!measurementFrameScheduled) {
          measurementFrameScheduled = true
          requestAnimationFrame(processPendingMeasurements)
        }
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
  <div class="virtual-spacer" style="height: {totalHeight}px;">
    {#each visibleItems as { vm, index: idx, offsetY } (vm.m.id)}
      <div
        class="virtual-item"
        style="transform: translateY({offsetY}px);"
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
  .notice {
    position: sticky; bottom: 8px;
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

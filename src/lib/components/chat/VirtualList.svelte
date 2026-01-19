<script lang="ts">
  import { onMount } from 'svelte'

  interface Props {
    items: any[]
    itemHeight?: number
    overscan?: number
    children: any
  }

  const props: Props = $props()
  
  // Estimated item height - we'll measure real heights
  const estimatedHeight = props.itemHeight ?? 120
  const overscan = props.overscan ?? 3
  
  let containerEl: HTMLDivElement | undefined = $state()
  let scrollTop = $state(0)
  let containerHeight = $state(0)
  
  // Track measured heights for each item
  let measuredHeights: Map<number, number> = $state(new Map())
  
  // Calculate positions based on measured/estimated heights
  const itemPositions = $derived.by(() => {
    const positions: { top: number; height: number }[] = []
    let currentTop = 0
    
    for (let i = 0; i < props.items.length; i++) {
      const height = measuredHeights.get(i) ?? estimatedHeight
      positions.push({ top: currentTop, height })
      currentTop += height
    }
    
    return positions
  })
  
  const totalHeight = $derived(
    itemPositions.length > 0 
      ? itemPositions[itemPositions.length - 1].top + itemPositions[itemPositions.length - 1].height
      : 0
  )
  
  // Calculate visible range with overscan
  const visibleRange = $derived.by(() => {
    if (!containerHeight || props.items.length === 0) {
      return { start: 0, end: Math.min(10, props.items.length) }
    }
    
    // Binary search for start index
    let start = 0
    let end = itemPositions.length - 1
    
    while (start < end) {
      const mid = Math.floor((start + end) / 2)
      if (itemPositions[mid].top + itemPositions[mid].height < scrollTop) {
        start = mid + 1
      } else {
        end = mid
      }
    }
    
    const startIndex = Math.max(0, start - overscan)
    
    // Find end index
    const viewEnd = scrollTop + containerHeight
    let endIndex = start
    
    while (endIndex < itemPositions.length && itemPositions[endIndex].top < viewEnd) {
      endIndex++
    }
    
    endIndex = Math.min(props.items.length, endIndex + overscan)
    
    return { start: startIndex, end: endIndex }
  })
  
  const visibleItems = $derived(
    props.items.slice(visibleRange.start, visibleRange.end).map((item, i) => ({
      item,
      index: visibleRange.start + i,
      style: `position: absolute; top: ${itemPositions[visibleRange.start + i]?.top ?? 0}px; left: 0; right: 0;`
    }))
  )
  
  function handleScroll(e: Event) {
    const target = e.target as HTMLDivElement
    scrollTop = target.scrollTop
  }
  
  // Measure item heights after render
  export function measureItem(index: number, height: number) {
    if (height > 0 && measuredHeights.get(index) !== height) {
      measuredHeights.set(index, height)
      measuredHeights = new Map(measuredHeights) // trigger reactivity
    }
  }
  
  export function scrollToBottom() {
    if (containerEl) {
      containerEl.scrollTo({ top: totalHeight, behavior: 'instant' })
    }
  }
  
  export function getScrollContainer() {
    return containerEl
  }
  
  onMount(() => {
    if (containerEl) {
      containerHeight = containerEl.clientHeight
      
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          containerHeight = entry.contentRect.height
        }
      })
      
      resizeObserver.observe(containerEl)
      
      return () => resizeObserver.disconnect()
    }
  })
</script>

<div 
  class="virtual-container" 
  bind:this={containerEl}
  onscroll={handleScroll}
>
  <div class="virtual-content" style="height: {totalHeight}px;">
    {@render props.children(visibleItems, measureItem)}
  </div>
</div>

<style>
  .virtual-container {
    overflow: auto;
    height: 100%;
    contain: strict;
  }
  
  .virtual-content {
    position: relative;
    width: 100%;
  }
</style>

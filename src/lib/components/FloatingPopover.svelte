<script lang="ts">
  import type { Snippet } from 'svelte'

  let { open, anchor, maxWidth = 480, maxHeight = 420, fill = false, className = '', children }: {
    open: boolean
    anchor?: HTMLElement
    maxWidth?: number
    maxHeight?: number
    fill?: boolean
    className?: string
    children: Snippet
  } = $props()

  let panel = $state<HTMLDivElement>()
  let bounds = $state({ left: 8, top: '8px', bottom: 'auto', width: 320, height: 320 })

  $effect(() => {
    if (!open || !panel || !anchor) return
    const viewport = window.visualViewport
    let frame = 0
    const measure = (revealAnchor = false) => {
      if (!anchor) return
      let rect = anchor.getBoundingClientRect()
      const left = (viewport?.offsetLeft ?? 0) + 8
      const top = (viewport?.offsetTop ?? 0) + 8
      const right = left + (viewport?.width ?? window.innerWidth) - 16
      const bottom = top + (viewport?.height ?? window.innerHeight) - 16
      // Opening a popup never moves the form. On keyboard resize, reveal
      // only an anchor that has actually moved outside the visible frame.
      if (revealAnchor && (rect.top < top || rect.bottom > bottom)) {
        anchor.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
        rect = anchor.getBoundingClientRect()
      }
      const above = Math.max(0, rect.top - top - 8)
      const below = Math.max(0, bottom - rect.bottom - 8)
      const placeAbove = above > below
      const width = Math.max(0, Math.min(maxWidth, right - left))
      bounds = {
        left: Math.max(left, Math.min(rect.left, right - width)),
        top: placeAbove ? 'auto' : `${Math.max(top, rect.bottom + 8)}px`,
        bottom: placeAbove ? `${window.innerHeight - Math.min(bottom, rect.top - 8)}px` : 'auto',
        width,
        height: Math.min(maxHeight, placeAbove ? above : below),
      }
    }
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => measure())
    }
    const onResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => measure(true))
    }
    measure()
    // Top-layer positioning escapes clipping and transformed ancestors while
    // preserving DOM ancestry for the containing settings' event handlers.
    panel.showPopover?.()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(anchor)
    viewport?.addEventListener('resize', onResize)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', update, true)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      viewport?.removeEventListener('resize', onResize)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', update, true)
    }
  })
</script>

{#if open}
  <div class={`floating-popover ${className}`} class:fill popover="manual" bind:this={panel}
    style={`left: ${bounds.left}px; top: ${bounds.top}; bottom: ${bounds.bottom}; width: ${bounds.width}px; max-height: ${bounds.height}px; height: ${fill ? `${bounds.height}px` : 'auto'}`}>
    {@render children()}
  </div>
{/if}

<style>
  .floating-popover { position: fixed; inset: auto; margin: 0; padding: 0; display: flex; flex-direction: column; min-height: 0; overflow: hidden; box-sizing: border-box; border: 1px solid var(--border); border-radius: 12px; background: var(--panel); color: var(--text); box-shadow: var(--float-shadow); z-index: 1100; }
  .fill { container-type: size; }
</style>

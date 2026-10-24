<script lang="ts">
  import type { Snippet } from 'svelte'
  import { IconCollapseContent } from '../icons'
  let { active = true, children }: { active?: boolean; children: Snippet } = $props()
  let expanded = $state(false)
  let root: HTMLDivElement
  function collapse() {
    if (document.activeElement instanceof HTMLElement && root.contains(document.activeElement)) document.activeElement.blur()
    expanded = false
  }
  $effect(() => { if (!active) collapse() })
</script>

<div class="field-editor" bind:this={root}
  onfocusin={(event) => { if (event.target instanceof HTMLTextAreaElement) expanded = true }}
  onfocusout={(event) => { if (!(event.relatedTarget instanceof HTMLTextAreaElement)) expanded = false }}>
  {@render children()}
  {#if expanded && active}
    <button type="button" class="collapse-btn" onpointerdown={(event) => event.preventDefault()} onclick={collapse}>
      <IconCollapseContent style="font-size: 16px;" /> Collapse
    </button>
  {/if}
</div>

<style>
  .field-editor { position: relative; height: 100%; min-height: 0; }
  .field-editor :global(.ui-textarea) { min-height: 68px; transition: min-height .18s ease .25s, border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
  @media (hover: hover) and (pointer: fine) {
    .field-editor :global(.ui-textarea:hover) { min-height: 320px; transition-delay: .12s; }
  }
  .field-editor :global(.ui-textarea:focus) { min-height: 320px; transition-delay: 0s; }
  .collapse-btn { display: none; position: absolute; top: 8px; right: 12px; z-index: 11; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--border); border-radius: var(--r-pill); background: var(--bg); color: var(--text); font: inherit; font-size: .8rem; cursor: pointer; box-shadow: var(--modal-shadow); }
  @media (max-width: 640px) {
    .field-editor :global(.ui-textarea) { min-height: 72px; resize: none; transition: none; }
    .field-editor :global(.ui-field:has(.ui-textarea):focus-within),
    .field-editor :global(.greeting-row:focus-within) { position: absolute; inset: 0; z-index: 10; display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 10px 12px 12px; box-sizing: border-box; background: var(--panel); }
    .field-editor :global(.ui-field:has(.ui-textarea):focus-within > span) { padding-right: 110px; min-height: 24px; display: flex; align-items: center; }
    .field-editor :global(.ui-field:has(.ui-textarea):focus-within .ui-textarea),
    .field-editor :global(.greeting-row:focus-within .ui-textarea) { flex: 1 1 auto; min-height: 0; height: auto; }
    .field-editor :global(.greeting-row:focus-within) { padding-top: 44px; }
    .field-editor :global(.greeting-row:focus-within .ui-icon-btn) { display: none; }
    .collapse-btn { display: inline-flex; }
  }
</style>

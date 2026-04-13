<script lang="ts">
  import { IconSend, IconCallSplit, IconPublishedWithChanges, IconClose, IconChevronLeft, IconChevronRight, IconAutorenew, IconContentCopy, IconDelete, IconEdit, IconArrowDownward, IconArrowUpward, IconDangerous } from '../../icons'
  import type { Message, MessageActionButton } from '../../types'

  interface Props {
    message: Message
    index?: number
    total?: number
    visibleCount?: number
    locked?: boolean
    debug?: boolean
    isEditing?: boolean
    branchesLength?: number
    branchIndex?: number
    hasFollowingAssistant?: boolean
    nextAssistantId?: number
    nextAssistantTyping?: boolean
    messageActions?: MessageActionButton[]
    onApplyEditSend?: () => void
    onApplyEditBranch?: () => void
    onApplyEditReplace?: () => void
    onCancelEdit?: () => void
    onChangeVariant?: (delta: number) => void
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
  }

  const props: Props = $props()
  // Ensure message reference stays reactive with Svelte 5 runes
  const m = $derived(props.message)

  // Build a set of enabled action IDs and their order from settings
  const enabledActions = $derived((() => {
    const actions = props.messageActions
    if (!Array.isArray(actions) || actions.length === 0) return null
    const enabled = new Set<string>()
    for (const a of actions) {
      if (a.enabled) enabled.add(a.id)
    }
    return enabled
  })())

  // Order from settings (action id -> position)
  const actionOrder = $derived((() => {
    const actions = props.messageActions
    if (!Array.isArray(actions) || actions.length === 0) return null
    const order = new Map<string, number>()
    actions.forEach((a, i) => order.set(a.id, i))
    return order
  })())

  function isEnabled(id: string): boolean {
    return enabledActions === null || enabledActions.has(id)
  }

  // Build ordered actions list, respecting enabled state and custom order
  const orderedActions = $derived((() => {
    const items: { id: string; render: string }[] = []
    if (isEnabled('regenerate')) {
      if (m.role === 'assistant') {
        items.push({ id: 'regenerate', render: 'regenerate-assistant' })
      } else if (m.role === 'user' && props.hasFollowingAssistant) {
        items.push({ id: 'regenerate', render: 'regenerate-following' })
      } else if (m.role === 'user') {
        items.push({ id: 'regenerate', render: 'regenerate-after-user' })
      }
    }
    if (isEnabled('copy')) items.push({ id: 'copy', render: 'copy' })
    if (isEnabled('delete')) items.push({ id: 'delete', render: 'delete' })
    if (isEnabled('edit')) items.push({ id: 'edit', render: 'edit' })
    if (isEnabled('fork') && m.role !== 'assistant') items.push({ id: 'fork', render: 'fork' })
    if (isEnabled('moveDown')) items.push({ id: 'moveDown', render: 'moveDown' })
    if (isEnabled('moveUp')) items.push({ id: 'moveUp', render: 'moveUp' })

    if (actionOrder) {
      items.sort((a, b) => (actionOrder.get(a.id) ?? 99) - (actionOrder.get(b.id) ?? 99))
    }
    return items
  })())
</script>

<div class={`actions ${m.role}`}>
  {#if props.isEditing}
    <button class="action-btn" onclick={props.onApplyEditSend} aria-label="Send (branch + reply)" title="Send (branch + reply)" disabled={props.locked}>
      <IconSend style="font-size: 20px;" />
    </button>
    <button class="action-btn" onclick={props.onApplyEditBranch} aria-label="Branch (no reply)" title="Branch (no reply)" disabled={props.locked}>
      <IconCallSplit style="font-size: 20px;" />
    </button>
    <button class="action-btn" onclick={props.onApplyEditReplace} aria-label="Replace in current branch" title="Replace in current branch" disabled={props.locked}>
      <IconPublishedWithChanges style="font-size: 20px;" />
    </button>
    <button class="action-btn" onclick={props.onCancelEdit} aria-label="Cancel edit" title="Cancel" disabled={props.locked}>
      <IconClose style="font-size: 20px;" />
    </button>
  {:else}
    {#if props.branchesLength > 1}
      <span class="variants">
        <button class="action-btn" onclick={() => props.onChangeVariant?.(-1)} aria-label="Previous branch" title="Previous" disabled={props.locked || m.typing || props.branchIndex <= 0}>
          <IconChevronLeft style="font-size: 20px;" />
        </button>
        <span class="variant-counter" aria-live="polite">{(props.branchIndex || 0) + 1}/{props.branchesLength}</span>
        <button class="action-btn" onclick={() => props.onChangeVariant?.(1)} aria-label="Next branch" title="Next" disabled={props.locked || m.typing || props.branchIndex >= (props.branchesLength - 1)}>
          <IconChevronRight style="font-size: 20px;" />
        </button>
      </span>
    {/if}

    {#each orderedActions as action (action.id)}
      {#if action.render === 'regenerate-assistant'}
        <button class="action-btn" onclick={() => props.onRefreshAssistant?.(m.id)} aria-label="Regenerate response" title="Regenerate" disabled={props.locked || m.typing}>
          <IconAutorenew style="font-size: 20px;" />
        </button>
      {:else if action.render === 'regenerate-following'}
        <button class="action-btn" onclick={() => props.onRefreshAssistant?.(props.nextAssistantId)} aria-label="Regenerate following response" title="Regenerate following response" disabled={props.locked || props.nextAssistantTyping}>
          <IconAutorenew style="font-size: 20px;" />
        </button>
      {:else if action.render === 'regenerate-after-user'}
        <button class="action-btn" onclick={() => props.onRefreshAfterUserIndex?.(props.index)} aria-label="Generate following response" title="Generate following response" disabled={props.locked}>
          <IconAutorenew style="font-size: 20px;" />
        </button>
      {:else if action.render === 'copy'}
        <button class="action-btn" onclick={() => props.onCopy?.(m.content)} aria-label="Copy message" title="Copy" disabled={m.typing}>
          <IconContentCopy style="font-size: 20px;" />
        </button>
      {:else if action.render === 'delete'}
        <button class="action-btn" onclick={() => props.onDelete?.(m.id)} aria-label="Delete message" title="Delete" disabled={props.locked || m.typing}>
          <IconDelete style="font-size: 20px;" />
        </button>
      {:else if action.render === 'edit'}
        <button class="action-btn" onclick={() => props.onEdit?.(m.id)} aria-label="Edit message" title="Edit" disabled={props.locked || m.typing}>
          <IconEdit style="font-size: 20px;" />
        </button>
      {:else if action.render === 'fork'}
        <button class="action-btn" onclick={() => props.onFork?.(m.id)} aria-label="Fork message" title="Fork" disabled={props.locked || m.typing}>
          <IconCallSplit style="font-size: 20px;" />
        </button>
      {:else if action.render === 'moveDown'}
        <button class="action-btn" onclick={() => props.onMoveDown?.(m.id)} aria-label="Move down" title="Down" disabled={props.locked || m.typing || props.index === ((props.visibleCount || props.total || 1) - 1)}>
          <IconArrowDownward style="font-size: 20px;" />
        </button>
      {:else if action.render === 'moveUp'}
        <button class="action-btn" onclick={() => props.onMoveUp?.(m.id)} aria-label="Move up" title="Up" disabled={props.locked || m.typing || props.index === 0}>
          <IconArrowUpward style="font-size: 20px;" />
        </button>
      {/if}
    {/each}

    {#if props.debug}
      <button class="action-btn debug" onclick={() => props.onDebugFuckBranch?.(m.id)} aria-label="Fuck up branching" title="Fuck up branching" disabled={props.locked || m.typing}>
        <IconDangerous style="font-size: 20px;" />
      </button>
      <button class="action-btn debug" onclick={() => props.onDebugMessageDeath?.(m.id)} aria-label="Message death (simulate bug)" title="Message death (simulate bug)" disabled={props.locked || m.typing}>
        <IconDelete style="font-size: 20px;" />
      </button>
    {/if}
  {/if}
</div>

<style>
  .actions { display: flex; gap: 6px; margin-top: 6px; align-items: center; }
  .actions.user { justify-self: end; }
  .actions.assistant { justify-self: start; }
  .actions.system { justify-self: center; }
  .variants { display: inline-flex; align-items: center; gap: 6px; }
  /* Place branch/variant selector at end for user messages */
  .actions.user .variants { order: 99; }
  .variant-counter { align-self: center; font-size: .8rem; color: var(--muted); min-width: 36px; text-align: center; }
  /* Compact icon-only action buttons (match Chat.svelte design) */
  .action-btn {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    color: color-mix(in srgb, var(--muted) 70%, var(--text) 30%);
    background: transparent;
    border: none;
    border-radius: 8px;
    line-height: 1;
    padding: 0;
    cursor: default;
    transition: color .15s ease, background-color .15s ease, transform .1s ease;
  }
  .action-btn:hover:not(:disabled),
  .action-btn:focus-visible:not(:disabled) {
    color: var(--accent);
    background-color: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .action-btn:active:not(:disabled) {
    transform: scale(0.9);
  }
  :global(:root[data-theme='dark']) .action-btn {
    color: color-mix(in srgb, var(--muted) 55%, var(--text) 45%);
  }
  :global(:root[data-theme='dark']) .action-btn:hover:not(:disabled),
  :global(:root[data-theme='dark']) .action-btn:focus-visible:not(:disabled) {
    color: var(--accent);
    background-color: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .action-btn:disabled { opacity: .4; cursor: not-allowed; }
  /* No special styles for .debug to keep consistency with other buttons */
</style>

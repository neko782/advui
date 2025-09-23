<script>
  import Icon from '../../Icon.svelte'
  const props = $props()
  // Ensure message reference stays reactive with Svelte 5 runes
  const m = $derived(props.message)
</script>

<div class={`actions ${m.role}`}>
  {#if props.isEditing}
    <button class="action-btn" onclick={props.onApplyEditSend} aria-label="Send (branch + reply)" title="Send (branch + reply)" disabled={props.locked}>
      <Icon name="send" size={20} />
    </button>
    <button class="action-btn" onclick={props.onApplyEditBranch} aria-label="Branch (no reply)" title="Branch (no reply)" disabled={props.locked}>
      <Icon name="call_split" size={20} />
    </button>
    <button class="action-btn" onclick={props.onApplyEditReplace} aria-label="Replace in current branch" title="Replace in current branch" disabled={props.locked}>
      <Icon name="published_with_changes" size={20} />
    </button>
    <button class="action-btn" onclick={props.onCancelEdit} aria-label="Cancel edit" title="Cancel" disabled={props.locked}>
      <Icon name="close" size={20} />
    </button>
  {:else}
    {#if props.branchesLength > 1}
      <span class="variants">
        <button class="action-btn" onclick={() => props.onChangeVariant?.(-1)} aria-label="Previous branch" title="Previous" disabled={props.locked || m.typing || props.branchIndex <= 0}>
          <Icon name="chevron_left" size={20} />
        </button>
        <span class="variant-counter" aria-live="polite">{(props.branchIndex || 0) + 1}/{props.branchesLength}</span>
        <button class="action-btn" onclick={() => props.onChangeVariant?.(1)} aria-label="Next branch" title="Next" disabled={props.locked || m.typing || props.branchIndex >= (props.branchesLength - 1)}>
          <Icon name="chevron_right" size={20} />
        </button>
      </span>
    {/if}

    {#if m.role === 'assistant'}
      <button class="action-btn" onclick={() => props.onRefreshAssistant?.(m.id)} aria-label="Regenerate response" title="Regenerate" disabled={props.locked || m.typing}>
        <Icon name="autorenew" size={20} />
      </button>
    {:else if m.role === 'user' && props.hasFollowingAssistant}
      <button class="action-btn" onclick={() => props.onRefreshAssistant?.(props.nextAssistantId)} aria-label="Regenerate following response" title="Regenerate following response" disabled={props.locked || props.nextAssistantTyping}>
        <Icon name="autorenew" size={20} />
      </button>
    {:else if m.role === 'user'}
      <button class="action-btn" onclick={() => props.onRefreshAfterUserIndex?.(props.index)} aria-label="Generate following response" title="Generate following response" disabled={props.locked}>
        <Icon name="autorenew" size={20} />
      </button>
    {/if}

    <button class="action-btn" onclick={() => props.onCopy?.(m.content)} aria-label="Copy message" title="Copy" disabled={props.locked || m.typing}>
      <Icon name="content_copy" size={20} />
    </button>
    <button class="action-btn" onclick={() => props.onDelete?.(m.id)} aria-label="Delete message" title="Delete" disabled={props.locked || m.typing}>
      <Icon name="delete" size={20} />
    </button>
    <button class="action-btn" onclick={() => props.onEdit?.(m.id)} aria-label="Edit message" title="Edit" disabled={props.locked || m.typing}>
      <Icon name="edit" size={20} />
    </button>
    <button class="action-btn" onclick={() => props.onMoveDown?.(m.id)} aria-label="Move down" title="Down" disabled={props.locked || m.typing || props.index === ((props.visibleCount || props.total || 1) - 1)}>
      <Icon name="arrow_downward" size={20} />
    </button>
    <button class="action-btn" onclick={() => props.onMoveUp?.(m.id)} aria-label="Move up" title="Up" disabled={props.locked || m.typing || props.index === 0}>
      <Icon name="arrow_upward" size={20} />
    </button>
    {#if props.debug}
      <button class="action-btn debug" onclick={() => props.onDebugFuckBranch?.(m.id)} aria-label="Fuck up branching" title="Fuck up branching" disabled={props.locked || m.typing}>
        <Icon name="dangerous" size={20} />
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
    color: var(--muted);
    background: transparent;
    border: none;
    border-radius: 8px;
    line-height: 1;
    padding: 0;
    cursor: default;
    transition: color .15s ease;
  }
  .action-btn:hover { color: #ffffff; }
  .action-btn:focus-visible { color: #ffffff; }
  .action-btn:disabled { opacity: .5; cursor: not-allowed; }
  /* No special styles for .debug to keep consistency with other buttons */
</style>

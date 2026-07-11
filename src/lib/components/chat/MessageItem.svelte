<script lang="ts">
  import { formatRole } from '../../utils/format'
  import MessageMeta from './MessageMeta.svelte'
  import MessageBubble from './MessageBubble.svelte'
  import MessageActions from './MessageActions.svelte'
  import { IconPerson } from '../../icons'
  import type { VisibleMessage, MessageRole, MessageActionButton, EditorActionButton } from '../../types'
  import type { Character } from '../../types/tavern'

  interface Props {
    vm: VisibleMessage
    /** Tavern: character bound to this chat (adds avatar + name to assistant messages). */
    character?: Character | null
    /** Tavern: active persona name (labels user messages). */
    personaName?: string
    /** Tavern: avatar shape ('circle' default, or 'rounded' square). */
    avatarShape?: 'circle' | 'rounded'
    imageCache?: Record<string, { data: string; mimeType?: string; name?: string }>
    total?: number
    visibleCount?: number
    locked?: boolean
    debug?: boolean
    editingId?: number | null
    editingText?: string
    isInsertedMessage?: boolean
    hasFollowingAssistant?: boolean
    nextAssistantId?: number
    nextAssistantTyping?: boolean
    parentId?: number | null
    branchIndex?: number
    branchesLength?: number
    allowInlineHtml?: boolean
    renderLatex?: boolean
    messageActions?: MessageActionButton[]
    editorActions?: EditorActionButton[]
    disableRoleSwitching?: boolean
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
    onDeleteInserted?: () => void
    onDebugFuckBranch?: (id: number) => void
    onDebugMessageDeath?: (id: number) => void
  }

  const props: Props = $props()
  // Keep these derived from props so they update when parent data changes
  const vm = $derived(props.vm)
  const m = $derived(vm.m)
  const isEditing = $derived(props.editingId === m.id)
  const branchesLength = $derived(Number(props.branchesLength) || 0)
  const branchIndex = $derived(Number(props.branchIndex) || 0)
  // Tavern: assistant messages show the character avatar + name,
  // user messages are labeled with the active persona name.
  const showCharacter = $derived(!!props.character && m.role === 'assistant')
  const roleLabel = $derived.by(() => {
    if (showCharacter) return props.character!.nickname || props.character!.name || formatRole(m.role)
    if (props.character && m.role === 'user' && props.personaName) return props.personaName
    return formatRole(m.role)
  })
  // Move should target the clicked message, not its parent
  function doMoveUp() { props.onMoveUp?.(m.id) }
  function doMoveDown() { props.onMoveDown?.(m.id) }
</script>

<div class={`row ${m.role}`}>
  <div class={`stack ${m.role} ${isEditing ? 'editing' : ''}`}>
    {#if showCharacter}
      <div class="char-header">
        {#if props.character!.avatar}
          <img class="char-avatar {props.avatarShape === 'rounded' ? 'rounded' : ''}" src={props.character!.avatar} alt={props.character!.name} loading="lazy" />
        {:else}
          <div class="char-avatar placeholder {props.avatarShape === 'rounded' ? 'rounded' : ''}"><IconPerson style="font-size: 18px;" /></div>
        {/if}
        <MessageMeta role={m.role} label={roleLabel} locked={props.locked} debug={props.debug} messageId={m.id} disabled={props.disableRoleSwitching} onSetRole={(r) => props.onSetRole?.(m.id, r)} />
      </div>
    {:else}
      <MessageMeta role={m.role} label={roleLabel} locked={props.locked} debug={props.debug} messageId={m.id} disabled={props.disableRoleSwitching} onSetRole={(r) => props.onSetRole?.(m.id, r)} />
    {/if}
    <MessageBubble
      message={m}
      imageCache={props.imageCache}
      isEditing={isEditing}
      editingText={props.editingText}
      allowInlineHtml={props.allowInlineHtml}
      renderLatex={props.renderLatex}
      onEditInput={(t) => props.onEditInput?.(t)}
      onEditKeydown={props.onEditKeydown}
    />
    <!-- Error notices are now centralized at the list bottom -->
    <MessageActions
      message={m}
      index={vm.i}
      total={props.total}
      visibleCount={props.visibleCount}
      locked={props.locked}
      debug={props.debug}
      isEditing={isEditing}
      branchesLength={branchesLength}
      branchIndex={branchIndex}
      hasFollowingAssistant={props.hasFollowingAssistant}
      nextAssistantId={props.nextAssistantId}
      nextAssistantTyping={props.nextAssistantTyping}
      messageActions={props.messageActions}
      editorActions={props.editorActions}
      isInsertedMessage={props.isInsertedMessage && isEditing}
      onApplyEditSend={props.onApplyEditSend}
      onApplyEditBranch={props.onApplyEditBranch}
      onApplyEditReplace={props.onApplyEditReplace}
      onCancelEdit={props.onCancelEdit}
      onDeleteInserted={props.onDeleteInserted}
      onChangeVariant={(d) => props.onChangeVariant?.(m.id, d)}
      onRefreshAssistant={props.onRefreshAssistant}
      onRefreshAfterUserIndex={props.onRefreshAfterUserIndex}
      onCopy={props.onCopy}
      onDelete={props.onDelete}
      onEdit={props.onEdit}
      onMoveDown={doMoveDown}
      onMoveUp={doMoveUp}
      onFork={props.onFork}
      onDebugFuckBranch={props.onDebugFuckBranch}
      onDebugMessageDeath={props.onDebugMessageDeath}
    />
  </div>
</div>

<style>
  .row { display: flex; max-width: var(--page-max); margin-inline: auto; width: 100%; padding-inline: 0; contain: layout style; }
  .row.user { justify-content: flex-end; }
  .row.assistant { justify-content: flex-start; }
  .row.system { justify-content: center; }
  .char-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  /* The meta badge already carries its own bottom margin; neutralize it so the
     avatar and name stay vertically centered on one line. */
  .char-header :global(.meta) { margin-bottom: 0; }
  .char-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    object-position: top;
    background: var(--border);
    display: block;
    flex: 0 0 auto;
  }
  .char-avatar.rounded { border-radius: 8px; }
  .char-avatar.placeholder { display: grid; place-items: center; color: var(--muted); }
  .stack { display: grid; grid-auto-flow: row; grid-auto-rows: max-content; grid-template-columns: minmax(0, 1fr); gap: 2px; width: min(720px, 92%); }
  .stack.assistant { justify-content: start; }
  .stack.user { justify-content: end; }
  .stack.system { justify-content: center; width: 100%; max-width: var(--page-max); }
  .notice { font-size: 0.88rem; line-height: 1.3; padding: 6px 10px; border-radius: 10px; border: 1px solid color-mix(in srgb, #ef4444 45%, transparent); background: color-mix(in srgb, #ef4444 9%, transparent); color: color-mix(in srgb, #b91c1c 92%, transparent); }
  .stack.assistant .notice { justify-self: start; }
  .stack.user .notice { justify-self: end; }
  .stack.system .notice { justify-self: center; }
</style>

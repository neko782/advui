<script lang="ts">
  // What the model did before replying: thinking and tool calls as one-line
  // steps. Collapsed, it shows only the latest step; opened, every step, and
  // each step opens again to show its reasoning or the tool's input and output.
  import { activityTitle, activityHasDetail, activityOf } from '../../api/activity'
  import type { ActivityKind, ActivityStep, Message } from '../../types'
  import MarkdownContent from './LazyMarkdownContent.svelte'
  import {
    IconLightbulb, IconTravelExplore, IconLanguage, IconCodeBlocks, IconTerminal,
    IconImagesmode, IconExtension, IconBuild, IconExpandMore, IconSchedule, IconForum, IconAltRoute,
  } from '../../icons'

  interface Props {
    message: Message
    allowInlineHtml?: boolean
    renderLatex?: boolean
  }

  let { message, allowInlineHtml, renderLatex }: Props = $props()

  const ICONS: Record<ActivityKind, typeof IconBuild> = {
    thinking: IconLightbulb,
    search: IconTravelExplore,
    fetch: IconLanguage,
    code: IconCodeBlocks,
    shell: IconTerminal,
    image: IconImagesmode,
    mcp: IconExtension,
    mcp_list: IconExtension,
    time: IconSchedule,
    chats: IconForum,
    steer: IconAltRoute,
    tool: IconBuild,
  }

  const steps = $derived<ActivityStep[]>(activityOf(message))
  const live = $derived(!!message.typing)
  const latest = $derived(steps[steps.length - 1])
  const working = $derived(live && steps.some(step => step.status === 'running'))
  const failed = $derived(steps.filter(step => step.status === 'failed').length)

  let open = $state(false)
  let openSteps = $state<Record<string, boolean>>({})
  let lastMessageId = $state<number | null>(null)

  // A different message (e.g. switching variants) starts collapsed.
  $effect(() => {
    const id = message?.id ?? null
    if (id !== lastMessageId) {
      lastMessageId = id
      open = false
      openSteps = {}
    }
  })

  function toggleStep(id: string) {
    openSteps = { ...openSteps, [id]: !openSteps[id] }
  }

  function headerSummary(): string {
    if (!latest) return ''
    if (live) return activityTitle(latest, true)
    const thoughts = steps.filter(step => step.kind === 'thinking').length
    const steers = steps.filter(step => step.kind === 'steer').length
    const tools = steps.length - thoughts - steers
    const parts: string[] = []
    if (thoughts) parts.push(thoughts === 1 ? 'Thought' : `Thought ${thoughts} times`)
    if (tools) parts.push(`used ${tools === 1 ? '1 tool' : `${tools} tools`}`)
    if (steers) parts.push(steers === 1 ? 'steered once' : `steered ${steers} times`)
    const text = parts.join(', ')
    return text.charAt(0).toUpperCase() + text.slice(1)
  }
</script>

{#if steps.length}
  <div class="activity" class:open>
    <button type="button" class="header" aria-expanded={open} onclick={() => (open = !open)}>
      {#if working}
        <span class="spinner" aria-hidden="true"></span>
      {:else if latest}
        {@const LatestIcon = ICONS[live ? latest.kind : 'thinking']}
        <LatestIcon class="kind-icon" aria-hidden="true" />
      {/if}
      <span class="title" class:shimmer={working}>{headerSummary()}</span>
      {#if !live && failed}<span class="failed-count">{failed} failed</span>{/if}
      <IconExpandMore class="chevron" aria-hidden="true" />
    </button>

    {#if open}
      <ol class="steps">
        {#each steps as step (step.id)}
          {@const Icon = ICONS[step.kind] ?? IconBuild}
          {@const expandable = activityHasDetail(step)}
          {@const stepOpen = !!openSteps[step.id]}
          {@const stepRunning = live && step.status === 'running'}
          <li class="step" class:failed={step.status === 'failed'}>
            <button type="button" class="step-row" disabled={!expandable} aria-expanded={expandable ? stepOpen : undefined}
              onclick={() => toggleStep(step.id)}>
              {#if stepRunning}
                <span class="spinner small" aria-hidden="true"></span>
              {:else}
                <Icon class="kind-icon" aria-hidden="true" />
              {/if}
              <span class="step-title" class:shimmer={stepRunning}>{activityTitle(step, live)}</span>
              {#if expandable}<IconExpandMore class="chevron" aria-hidden="true" />{/if}
            </button>
            {#if expandable && stepOpen}
              <div class="detail">
                {#if step.kind === 'steer'}
                  <p class="steer-text">{step.text}</p>
                {:else if step.kind === 'thinking'}
                  <div class="thinking">
                    <MarkdownContent content={step.text} {allowInlineHtml} {renderLatex} streaming={stepRunning} />
                  </div>
                {:else}
                  {#if step.input?.trim()}
                    <div class="part-label">Input</div>
                    <pre>{step.input}</pre>
                  {/if}
                  {#if step.error?.trim()}
                    <div class="part-label">Error</div>
                    <pre class="error">{step.error}</pre>
                  {/if}
                  {#if step.output?.trim()}
                    <div class="part-label">Output</div>
                    <pre>{step.output}</pre>
                  {/if}
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
  </div>
{/if}

<style>
  .activity { display: grid; gap: 4px; margin: 8px 0 6px; justify-self: stretch; min-width: 0; font-size: 0.85rem; }
  button { font: inherit; color: inherit; background: transparent; border: none; padding: 0; cursor: pointer; text-align: left; }
  button:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
  .header { display: flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; justify-self: start; color: var(--muted); }
  .header:hover { color: var(--text); }
  .title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .failed-count { flex-shrink: 0; font-size: 0.78rem; color: var(--danger); }
  .activity :global(.kind-icon) { flex-shrink: 0; font-size: 16px; }
  .activity :global(.chevron) { flex-shrink: 0; font-size: 16px; transition: transform .2s ease; }
  .activity.open > .header :global(.chevron) { transform: rotate(180deg); }
  .steps { list-style: none; margin: 0; padding: 2px 0 2px 8px; border-left: 2px solid var(--border); display: grid; gap: 2px; min-width: 0; }
  .step { display: grid; gap: 4px; min-width: 0; }
  .step-row { display: flex; align-items: center; gap: 6px; min-width: 0; width: 100%; padding: 2px 4px; border-radius: 6px; color: var(--muted); }
  .step-row:not(:disabled):hover { color: var(--text); background: color-mix(in srgb, var(--panel), var(--text) 5%); }
  .step-row:disabled { cursor: default; opacity: 1; }
  .step-row[aria-expanded='true'] { color: var(--text); }
  .step-row[aria-expanded='true'] :global(.chevron) { transform: rotate(180deg); }
  .step-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .step.failed .step-row { color: var(--danger); }
  .detail { display: grid; gap: 4px; min-width: 0; margin: 0 0 6px 26px; }
  .thinking { color: var(--muted); font-size: 0.85rem; overflow-x: auto; }
  .thinking :global(p) { margin: 0.35em 0; }
  .thinking :global(p:first-child) { margin-top: 0; }
  .thinking :global(p:last-child) { margin-bottom: 0; }
  .steer-text { margin: 0; color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; }
  .part-label { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  pre { margin: 0; padding: 8px; border-radius: 8px; background: var(--bg); border: 1px solid var(--border); font-size: 0.78rem; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 260px; overflow-y: auto; }
  pre.error { color: var(--danger); }
  .spinner { flex-shrink: 0; width: 12px; height: 12px; margin: 2px; border-radius: 50%; border: 2px solid color-mix(in srgb, currentColor 25%, transparent); border-top-color: currentColor; animation: spin .8s linear infinite; }
  .spinner.small { width: 10px; height: 10px; margin: 3px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .shimmer {
    background: linear-gradient(90deg, var(--muted) 0%, var(--text) 50%, var(--muted) 100%);
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: shimmer 1.8s linear infinite;
  }
  @keyframes shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
  @media (prefers-reduced-motion: reduce) {
    .spinner, .shimmer { animation: none; }
    .shimmer { color: var(--text); background: none; }
  }
</style>

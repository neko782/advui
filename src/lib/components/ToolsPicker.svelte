<script lang="ts" module>
  import type { PresetFields, DisabledTools } from '../types'
  import { IconTravelExplore, IconCodeBlocks, IconTerminal, IconImagesmode, IconExtension } from '../icons'

  /** The tool-related slice shared by presets and per-chat settings. */
  export type ToolsValue = Partial<Pick<PresetFields,
    | 'webSearchEnabled'
    | 'codeInterpreterEnabled' | 'codeInterpreterNetworkEnabled' | 'codeInterpreterAllowedDomains'
    | 'shellEnabled' | 'shellNetworkEnabled' | 'shellAllowedDomains'
    | 'imageGenerationEnabled' | 'imageGenerationModel'
    | 'mcpEnabled' | 'mcpServers'
  >>

  /** Built-in tools, in display order. */
  export const TOOLS = [
    { id: 'webSearch', key: 'webSearchEnabled', label: 'Web search', short: 'Search', desc: 'Search the web for up-to-date information', icon: IconTravelExplore, options: false },
    { id: 'codeInterpreter', key: 'codeInterpreterEnabled', label: 'Code interpreter', short: 'Code', desc: 'Run Python code in a sandboxed environment', icon: IconCodeBlocks, options: true },
    { id: 'shell', key: 'shellEnabled', label: 'Shell', short: 'Shell', desc: 'Execute shell commands on the server', icon: IconTerminal, options: true },
    { id: 'imageGeneration', key: 'imageGenerationEnabled', label: 'Image generation', short: 'Images', desc: 'Generate images from text descriptions', icon: IconImagesmode, options: true },
    { id: 'mcp', key: 'mcpEnabled', label: 'MCP', short: 'MCP', desc: 'Remote tool servers via Model Context Protocol', icon: IconExtension, options: true },
  ] as const
</script>

<script lang="ts">
  // The single tools control: one chip per tool, with the tool's own options
  // opening in a popup anchored to it. Used by the chat settings popover, the preset
  // editor and the new-preset defaults so tools look and behave the same
  // everywhere.
  import FloatingPopover from './FloatingPopover.svelte'
  import { IconExpandMore, IconClose } from '../icons'

  interface Props {
    value: ToolsValue
    onChange?: (patch: ToolsValue) => void
    disabled?: boolean
    /** Show per-tool options (network, model, servers). Off for plain on/off defaults. */
    configurable?: boolean
    /** Short chip labels for narrow surfaces. */
    compact?: boolean
    /** Tools switched off app-wide; they are not offered at all. */
    hidden?: DisabledTools
  }

  let { value, onChange, disabled = false, configurable = true, compact = false, hidden = {} }: Props = $props()

  type Tool = typeof TOOLS[number]
  type NetTool = 'codeInterpreter' | 'shell'
  type NetMode = 'off' | 'any' | 'list'

  const NET_MODES: { id: NetMode, label: string }[] = [
    { id: 'off', label: 'Off' },
    { id: 'any', label: 'Any domain' },
    { id: 'list', label: 'Allowlist' },
  ]

  let openTool = $state<Tool['id'] | null>(null)
  const visibleTools = $derived(TOOLS.filter(tool => !hidden[tool.id]))
  let root: HTMLDivElement
  const anchors = $state<Partial<Record<Tool['id'], HTMLElement>>>({})
  // "Allowlist" with nothing typed yet is stored the same as "Any domain",
  // so remember the choice locally until a domain is entered.
  let listMode = $state<Partial<Record<NetTool, boolean>>>({})

  // Options only exist for a tool that is on; if it gets switched off from
  // elsewhere (e.g. a preset change) the panel goes with it.
  const shownTool = $derived(visibleTools.find(tool => tool.id === openTool && configurable && !!value[tool.key]) ?? null)

  // The options popup closes on an outside press or Escape, without also
  // closing whatever panel the picker sits in.
  $effect(() => {
    if (!shownTool) return
    const outside = (event: PointerEvent) => { if (!root.contains(event.target as Node)) openTool = null }
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const tool = openTool
      openTool = null
      event.stopImmediatePropagation()
      if (tool) anchors[tool]?.querySelector<HTMLButtonElement>('.tool-more')?.focus()
    }
    window.addEventListener('pointerdown', outside, true)
    root.addEventListener('keydown', onKeydown)
    return () => { window.removeEventListener('pointerdown', outside, true); root.removeEventListener('keydown', onKeydown) }
  })

  function patch(next: ToolsValue) {
    if (!disabled) onChange?.(next)
  }

  function toggle(tool: Tool) {
    if (disabled) return
    const next = !value[tool.key]
    patch({ [tool.key]: next })
    if (!next) {
      if (openTool === tool.id) openTool = null
    } else if (configurable && tool.id === 'mcp' && !value.mcpServers?.length) {
      // MCP does nothing without a server, so go straight to its options.
      openTool = 'mcp'
    }
  }

  function netMode(tool: NetTool): NetMode {
    if (!value[`${tool}NetworkEnabled`]) return 'off'
    return value[`${tool}AllowedDomains`] || listMode[tool] ? 'list' : 'any'
  }

  function setNetMode(tool: NetTool, mode: NetMode) {
    if (disabled) return
    listMode = { ...listMode, [tool]: mode === 'list' }
    if (mode === 'off') patch({ [`${tool}NetworkEnabled`]: false })
    else if (mode === 'any') patch({ [`${tool}NetworkEnabled`]: true, [`${tool}AllowedDomains`]: undefined })
    else patch({ [`${tool}NetworkEnabled`]: true })
  }

  type McpServer = NonNullable<ToolsValue['mcpServers']>[number]

  function mcpServers(): McpServer[] {
    return (value.mcpServers || []).map(server => ({ ...server, label: server?.label || '', url: server?.url || '' }))
  }

  function updateMcpServer(index: number, change: Partial<McpServer>) {
    patch({ mcpServers: mcpServers().map((server, i) => (i === index ? { ...server, ...change } : server)) })
  }
</script>

<div class="tools" class:compact bind:this={root}>
  <div class="ui-chip-group" role="group" aria-label="Tools">
    {#each visibleTools as tool (tool.id)}
      {@const on = !!value[tool.key]}
      {@const hasOptions = configurable && tool.options && on}
      <span class="tool" class:split={hasOptions} bind:this={anchors[tool.id]}>
        <button type="button" class="ui-chip" aria-pressed={on} aria-label={tool.label} title={tool.desc}
          {disabled} onclick={() => toggle(tool)}>
          <tool.icon style="font-size: 18px;" />
          <span>{compact ? tool.short : tool.label}</span>
        </button>
        {#if hasOptions}
          <button type="button" class="ui-chip on tool-more" class:expanded={shownTool?.id === tool.id}
            aria-expanded={shownTool?.id === tool.id} aria-label={`${tool.label} options`} title={`${tool.label} options`}
            {disabled} onclick={() => (openTool = openTool === tool.id ? null : tool.id)}>
            <IconExpandMore style="font-size: 18px;" />
          </button>
        {/if}
      </span>
    {/each}
  </div>

  <FloatingPopover open={!!shownTool} anchor={shownTool ? anchors[shownTool.id] : undefined} maxWidth={320} maxHeight={400}>
  {#if shownTool}
    <div class="tool-options" role="group" aria-label={`${shownTool.label} options`}>
      {#if shownTool.id === 'codeInterpreter' || shownTool.id === 'shell'}
        {@const tool = shownTool.id}
        {@const mode = netMode(tool)}
        <div class="option-label">{shownTool.label} network access</div>
        <div class="ui-segmented ui-segmented-bordered" role="radiogroup" aria-label={`${shownTool.label} network access`}>
          {#each NET_MODES as option (option.id)}
            <button type="button" role="radio" class="ui-segment" class:active={mode === option.id}
              aria-checked={mode === option.id} {disabled} onclick={() => setNetMode(tool, option.id)}>{option.label}</button>
          {/each}
        </div>
        {#if mode === 'list'}
          <input class="ui-input" type="text" placeholder="api.github.com, pypi.org"
            value={value[`${tool}AllowedDomains`] || ''} {disabled}
            oninput={(event) => patch({ [`${tool}AllowedDomains`]: event.currentTarget.value || undefined })}
            aria-label={`${shownTool.label} allowed domains`} />
          <div class="option-hint">Comma-separated. Leave empty to allow any domain.</div>
        {/if}
      {:else if shownTool.id === 'imageGeneration'}
        <div class="option-label">Image generation model</div>
        <input class="ui-input" type="text" placeholder="gpt-image-1" value={value.imageGenerationModel || ''} {disabled}
          oninput={(event) => patch({ imageGenerationModel: event.currentTarget.value || undefined })}
          aria-label="Image generation model" />
      {:else if shownTool.id === 'mcp'}
        <div class="option-label">MCP servers</div>
        {#each value.mcpServers || [] as server, index (index)}
          <div class="server">
            <div class="server-row">
              <input class="ui-input" type="text" placeholder="https://example.com/mcp" value={server?.url || ''} {disabled}
                oninput={(event) => updateMcpServer(index, { url: event.currentTarget.value })}
                aria-label={`MCP server URL ${index + 1}`} />
              <button type="button" class="ui-icon-btn ui-icon-btn-sm danger" {disabled}
                onclick={() => patch({ mcpServers: mcpServers().filter((_, i) => i !== index) })}
                aria-label={`Remove MCP server ${index + 1}`} title="Remove server">
                <IconClose style="font-size: 16px;" />
              </button>
            </div>
            <div class="server-details">
              <input class="ui-input" type="text" placeholder="Name (optional)" value={server?.label || ''} {disabled}
                oninput={(event) => updateMcpServer(index, { label: event.currentTarget.value })}
                aria-label={`MCP server name ${index + 1}`} />
              <input class="ui-input" type="password" placeholder="Access token" value={server?.authorization || ''} {disabled}
                autocomplete="off" data-1p-ignore data-lpignore="true"
                oninput={(event) => updateMcpServer(index, { authorization: event.currentTarget.value || undefined })}
                aria-label={`MCP server access token ${index + 1}`} />
              <input class="ui-input allowed" type="text" placeholder="Allowed tools — empty for all" value={server?.allowedTools || ''} {disabled}
                oninput={(event) => updateMcpServer(index, { allowedTools: event.currentTarget.value || undefined })}
                aria-label={`MCP server allowed tools ${index + 1}`} />
            </div>
          </div>
        {:else}
          <div class="option-hint">No servers yet — MCP needs at least one.</div>
        {/each}
        <button type="button" class="ui-btn ui-btn-outline ui-btn-sm add-server" {disabled}
          onclick={() => patch({ mcpServers: [...mcpServers(), { label: '', url: '' }] })}>Add server</button>
      {/if}
    </div>
  {/if}
  </FloatingPopover>
</div>

<style>
  .tools { display: grid; gap: var(--s2); min-width: 0; }
  .tool { display: inline-flex; min-width: 0; }
  .compact .ui-chip:not(.tool-more) { padding: 0 9px; gap: 5px; }
  .compact .tool-more { padding: 0 3px; }
  /* A tool with options is one chip in two parts: toggle, then options. */
  .tool.split > .ui-chip:first-child { border-top-right-radius: 0; border-bottom-right-radius: 0; }
  .tool-more {
    padding: 0 5px;
    margin-left: -1px;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  .tool-more :global(svg) { transition: transform var(--dur) var(--ease); }
  .tool-more.expanded { background: color-mix(in srgb, var(--accent) 24%, var(--bg)); }
  .tool-more.expanded :global(svg) { transform: rotate(180deg); }
  .tool-options { display: grid; gap: var(--s2); min-width: 0; padding: var(--s3); overflow-y: auto; }
  .option-label { font-size: 0.8rem; font-weight: 500; color: var(--muted); }
  .option-hint { font-size: 0.75rem; color: var(--muted); }
  .ui-segmented { width: 100%; }
  .ui-segment { flex: 1; padding: 6px 8px; font-size: 0.85rem; }
  .server { display: grid; gap: var(--s1); }
  .server + .server { padding-top: var(--s2); border-top: 1px solid var(--border); }
  .server-details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s1); }
  .server-details .ui-input { padding: 6px var(--s2); font-size: 0.8rem; }
  .server-details .allowed { grid-column: 1 / -1; }
  .server-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--s1); align-items: center; }
  .add-server { justify-self: start; }
</style>

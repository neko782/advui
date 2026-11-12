<script lang="ts">
  // What the model did with MCP servers in this message: each call's
  // arguments and result, collapsed by default.
  import { formatMcpLabel } from '../../api/core'
  import type { McpCallItem, McpResponseItem } from '../../types'

  let { items }: { items?: McpResponseItem[] } = $props()

  const OUTPUT_LIMIT = 4000
  const calls = $derived((items || []).filter((item): item is McpCallItem => item.type === 'mcp_call'))
  const failed = $derived(calls.filter(call => call.error).length)
  let open = $state(false)

  /** Pretty-print JSON payloads; leave anything else as the server sent it. */
  function pretty(raw: string | null | undefined): string {
    if (!raw) return ''
    try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw }
  }

  function clip(text: string): string {
    return text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}\n… ${text.length - OUTPUT_LIMIT} more characters` : text
  }
</script>

{#if calls.length}
  <div class="mcp">
    <button type="button" class="mcp-toggle" aria-expanded={open} onclick={() => (open = !open)}>
      <span class="mcp-label">{calls.length === 1 ? '1 MCP call' : `${calls.length} MCP calls`}{failed ? ` · ${failed} failed` : ''}</span>
      <span class={`chevron ${open ? 'open' : ''}`} aria-hidden="true"></span>
    </button>
    {#if open}
      <div class="mcp-body">
        {#each calls as call (call.id)}
          {@const args = pretty(call.arguments)}
          {@const output = pretty(call.output)}
          <div class="call">
            <div class="call-head">
              <span class="server">{formatMcpLabel(call.serverLabel)}</span>
              <code>{call.name || 'tool'}</code>
              {#if call.error}<span class="failed">failed</span>{/if}
            </div>
            {#if args && args !== '{}'}
              <div class="part-label">Arguments</div>
              <pre>{args}</pre>
            {/if}
            {#if call.error}
              <div class="part-label">Error</div>
              <pre class="error">{call.error}</pre>
            {:else if output}
              <div class="part-label">Result</div>
              <pre>{clip(output)}</pre>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .mcp { display: grid; gap: 6px; margin: 10px 0 6px; }
  .mcp-toggle { display: inline-flex; align-items: center; gap: 6px; justify-self: start; font-size: 0.85rem; color: var(--muted); background: transparent; border: none; padding: 0; cursor: pointer; }
  .mcp-toggle:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; }
  .mcp-label { font-weight: 600; }
  .chevron { width: 10px; height: 10px; position: relative; }
  .chevron::before { content: ''; border: 4px solid transparent; border-top-color: currentColor; display: block; transform-origin: center; transition: transform .2s ease; }
  .chevron.open::before { transform: rotate(180deg); }
  .mcp-body { display: grid; gap: 10px; border: 1px solid var(--border); border-radius: 10px; padding: 10px; font-size: 0.85rem; background: color-mix(in srgb, var(--panel), #ffffff 4%); min-width: 0; }
  .call { display: grid; gap: 4px; min-width: 0; }
  .call + .call { padding-top: 10px; border-top: 1px solid var(--border); }
  .call-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .server { font-weight: 600; }
  .failed { color: var(--danger); font-size: 0.8rem; font-weight: 600; }
  .part-label { font-size: 0.75rem; color: var(--muted); }
  pre { margin: 0; padding: 8px; border-radius: 8px; background: var(--bg); font-size: 0.8rem; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 240px; overflow-y: auto; }
  pre.error { color: var(--danger); }
</style>

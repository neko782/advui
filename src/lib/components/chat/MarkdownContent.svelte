<script lang="ts">
  import { onDestroy } from 'svelte'
  import { copyText } from '../../utils/clipboard'
  import { buildMarkdownBlocks, type MarkdownCodeBlock } from '../../utils/markdown'

  interface Props {
    content?: string
    allowInlineHtml?: boolean
    streaming?: boolean
  }

  const props: Props = $props()

  let copyFeedback = $state<{ key: string; ok: boolean } | null>(null)
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null

  const blocks = $derived(
    buildMarkdownBlocks(props.content ?? '', {
      allowInlineHtml: props.allowInlineHtml,
      streaming: props.streaming,
    })
  )

  async function handleCopy(block: MarkdownCodeBlock) {
    const ok = await copyText(block.codeText)
    copyFeedback = { key: block.key, ok }

    if (copyResetTimer) {
      clearTimeout(copyResetTimer)
    }

    copyResetTimer = setTimeout(() => {
      copyFeedback = null
      copyResetTimer = null
    }, 1500)
  }

  function getCopyLabel(blockKey: string): string {
    if (copyFeedback?.key !== blockKey) {
      return 'Copy'
    }

    return copyFeedback.ok ? 'Copied!' : 'Failed'
  }

  onDestroy(() => {
    if (copyResetTimer) {
      clearTimeout(copyResetTimer)
    }
  })
</script>

{#each blocks as block (block.key)}
  {#if block.kind === 'code'}
    <div class="code-block-wrapper">
      <div class="code-block-header">
        <span class="code-lang">{block.langLabel}</span>
        <button type="button" class="code-copy-btn" aria-label="Copy code" onclick={() => void handleCopy(block)}>
          {getCopyLabel(block.key)}
        </button>
      </div>
      <pre><code class={`hljs language-${block.langClass}`}>{@html block.codeHtml}</code></pre>
    </div>
  {:else if block.kind === 'table'}
    <div class="table-block-wrapper">
      <table>
        <thead>
          <tr>
            {#each block.header as cell, cellIndex (cellIndex)}
              <th style={cell.align ? `text-align: ${cell.align};` : undefined}>
                {@html cell.html}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each block.rows as row, rowIndex (rowIndex)}
            <tr>
              {#each row as cell, cellIndex (cellIndex)}
                <td style={cell.align ? `text-align: ${cell.align};` : undefined}>
                  {@html cell.html}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    {@html block.html}
  {/if}
{/each}

<script lang="ts">
  import { feature } from '../../features.svelte'
  let props: {
    content?: string
    allowInlineHtml?: boolean
    renderLatex?: boolean
    streaming?: boolean
  } = $props()

  // Plain conversation text needs neither the Markdown parser nor math/code
  // rendering. Keep those dependencies out of the initial chat render.
  const formatted = $derived(/[\\`*_~$@#[\]<>|]|https?:\/\/|www\.|\n\s*\n|(?:^|\n)\s*(?:[-+]|\d+[.)])\s/.test(props.content ?? ''))
</script>

{#if formatted}
  {#await feature('markdown')}
    <span style="white-space: pre-wrap">{props.content ?? ''}</span>
  {:then { default: MarkdownContent }}
    <MarkdownContent {...props} />
  {:catch}
    <span style="white-space: pre-wrap">{props.content ?? ''}</span>
  {/await}
{:else}
  <p style="white-space: pre-wrap">{props.content ?? ''}</p>
{/if}

///<reference types="svelte" />
;
import { onDestroy } from 'svelte'
import { copyText } from '../../utils/clipboard'
import { buildMarkdownBlocks, type MarkdownCodeBlock } from '../../utils/markdown';
;

  interface Props {
    content?: string
    allowInlineHtml?: boolean
    renderLatex?: boolean
    streaming?: boolean
  };function $$render() {

  
  
  


  const props: Props = $props()

  let copyFeedback = $state<{ key: string; ok: boolean } | null>(null)
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null

  const blocks = $derived(
    buildMarkdownBlocks(props.content ?? '', {
      allowInlineHtml: props.allowInlineHtml,
      renderLatex: props.renderLatex,
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
;
async () => {

   for(let block of __sveltets_2_ensureArray(blocks)){block.key;
  if(block.kind === 'code'){
     { svelteHTML.createElement("div", { "class":`code-block-wrapper`,});
       { svelteHTML.createElement("div", { "class":`code-block-header`,});
         { svelteHTML.createElement("span", { "class":`code-lang`,});block.langLabel; }
         { svelteHTML.createElement("button", {       "type":`button`,"class":`code-copy-btn`,"aria-label":`Copy code`,"onclick":() => void handleCopy(block),});
          getCopyLabel(block.key);
         }
       }
       { svelteHTML.createElement("pre", {}); { svelteHTML.createElement("code", { "class":`hljs language-${block.langClass}`,}); block.codeHtml; } }
     }
  } else if (block.kind === 'table'){
     { svelteHTML.createElement("div", { "class":`table-block-wrapper`,});
       { svelteHTML.createElement("table", {});
         { svelteHTML.createElement("thead", {});
           { svelteHTML.createElement("tr", {});
                for(let cell of __sveltets_2_ensureArray(block.header)){let cellIndex = 1;cellIndex;
               { svelteHTML.createElement("th", { "style":cell.align ? `text-align: ${cell.align};` : undefined,});
                 cell.html;
               }
            }
           }
         }
         { svelteHTML.createElement("tbody", {});
              for(let row of __sveltets_2_ensureArray(block.rows)){let rowIndex = 1;rowIndex;
             { svelteHTML.createElement("tr", {});
                  for(let cell of __sveltets_2_ensureArray(row)){let cellIndex = 1;cellIndex;
                 { svelteHTML.createElement("td", { "style":cell.align ? `text-align: ${cell.align};` : undefined,});
                   cell.html;
                 }
              }
             }
          }
         }
       }
     }
  }else{
     block.html;
  }
}
};
return { props: {} as any as Props, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const MarkdownContent__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type MarkdownContent__SvelteComponent_ = ReturnType<typeof MarkdownContent__SvelteComponent_>;
/*Ωignore_endΩ*/export default MarkdownContent__SvelteComponent_;
import MarkdownIt from 'markdown-it'

// markdown-it instance configured for our chat bubbles
const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: true })
md.disable('code') // disallow indented code blocks; require fenced blocks

const defaultRenderLink = md.renderer.rules.link_open || function(tokens, idx, options, env, self) {
  return self.renderToken(tokens, idx, options)
}

md.renderer.rules.link_open = function(tokens, idx, options, env, self) {
  const a = tokens[idx]
  const targetIndex = a.attrIndex('target')
  if (targetIndex < 0) a.attrPush(['target', '_blank']); else a.attrs[targetIndex][1] = '_blank'
  const relIndex = a.attrIndex('rel')
  if (relIndex < 0) a.attrPush(['rel', 'noopener noreferrer']); else a.attrs[relIndex][1] = 'noopener noreferrer'
  return defaultRenderLink(tokens, idx, options, env, self)
}

export function renderMarkdown(src) {
  return md.render(String(src || ''))
}

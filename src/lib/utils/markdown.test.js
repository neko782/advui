import { describe, it, expect } from 'vitest'
import { buildMarkdownBlocks, renderMarkdown } from './markdown.js'

describe('renderMarkdown link sanitization', () => {
  it('blocks javascript URLs', () => {
    const html = renderMarkdown('[xss](javascript:alert(1))')
    expect(html).toContain('href="#"')
    expect(html).not.toContain('javascript:alert(1)')
  })

  it('allows safe absolute URLs', () => {
    const html = renderMarkdown('[safe](https://example.com)')
    expect(html).toContain('href="https://example.com"')
  })

  it('allows relative links', () => {
    const html = renderMarkdown('[relative](/docs/page)')
    expect(html).toContain('href="/docs/page"')
  })

  it('renders when cache is disabled', () => {
    const html = renderMarkdown('**hello**', { cache: false })
    expect(html).toContain('<strong>hello</strong>')
  })
})

describe('buildMarkdownBlocks', () => {
  it('separates text, code, and table blocks', () => {
    const blocks = buildMarkdownBlocks('intro\n\n```js\nconst x = 1\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |')

    expect(blocks.map((block) => block.kind)).toEqual(['html', 'code', 'table'])
    expect(blocks[1].codeText).toContain('const x = 1')
    expect(blocks[2].header[0].html).toBe('a')
    expect(blocks[2].rows[0][1].html).toBe('2')
  })

  it('defers inline html rendering for the streaming tail block', () => {
    const blocks = buildMarkdownBlocks('hello <span>world</span>', {
      allowInlineHtml: true,
      streaming: true,
    })

    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('html')
    expect(blocks[0].html).toContain('&lt;span&gt;world&lt;/span&gt;')
    expect(blocks[0].html).not.toContain('<span>world</span>')
  })

  it('renders inline html normally once streaming is finished', () => {
    const blocks = buildMarkdownBlocks('hello <span>world</span>', {
      allowInlineHtml: true,
    })

    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('html')
    expect(blocks[0].html).toContain('<span>world</span>')
  })
})

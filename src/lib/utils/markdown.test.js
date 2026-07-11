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

  it('blocks protocol-relative links', () => {
    const html = renderMarkdown('[evil](//evil.com/path)')
    expect(html).toContain('href="#"')
    expect(html).not.toContain('//evil.com')
  })

  it('renders when cache is disabled', () => {
    const html = renderMarkdown('**hello**', { cache: false })
    expect(html).toContain('<strong>hello</strong>')
  })
})

describe('renderMarkdown LaTeX', () => {
  it('renders inline math', () => {
    const html = renderMarkdown('Euler wrote $e^{i\\pi} + 1 = 0$.')

    expect(html).toContain('class="katex"')
    expect(html).toContain('e^{i\\pi} + 1 = 0')
  })

  it('renders display math', () => {
    const html = renderMarkdown('$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$')

    expect(html).toContain('class="katex-display"')
    expect(html).toContain('\\int_0^1 x^2 \\, dx = \\frac{1}{3}')
  })

  it('renders backslash-delimited inline and display math', () => {
    const inline = renderMarkdown('Euler wrote \\(e^{i\\pi} + 1 = 0\\).')
    const display = renderMarkdown('Result: \\[\\sum_{n=1}^{\\infty} \\frac{1}{n^2}\\]')

    expect(inline).toContain('class="katex"')
    expect(inline).not.toContain('class="katex-display"')
    expect(display).toContain('class="katex-display"')
  })

  it('leaves LaTeX delimiters as text when rendering is disabled', () => {
    const html = renderMarkdown('Math: $x^2$ and \\(y^2\\)', { renderLatex: false })

    expect(html).not.toContain('class="katex"')
    expect(html).toContain('$x^2$')
    expect(html).toContain('(y^2)')
  })

  it('leaves dollar-delimited content in code blocks untouched', () => {
    const blocks = buildMarkdownBlocks('```text\n$not_math$\n```')

    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('code')
    expect(blocks[0].codeText).toBe('$not_math$')
    expect(blocks[0].codeHtml).not.toContain('class="katex"')
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

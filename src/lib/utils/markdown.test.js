import { describe, it, expect } from 'vitest'
import { renderMarkdown } from './markdown.js'

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
})

import { describe, it, expect } from 'vitest'
import { tiptapDocToHtml, printableDocument, escapeHtml } from '../src/shared/tiptapHtml'

const doc = (content: unknown[]): unknown => ({ type: 'doc', content })
const text = (t: string, marks?: unknown[]): unknown => ({ type: 'text', text: t, ...(marks ? { marks } : {}) })
const para = (nodes: unknown[]): unknown => ({ type: 'paragraph', content: nodes })

describe('tiptapDocToHtml', () => {
  it('renders headings, paragraphs, and inline marks', () => {
    const html = tiptapDocToHtml(
      doc([
        { type: 'heading', attrs: { level: 1 }, content: [text('Title')] },
        para([text('a ', undefined), text('bold', [{ type: 'bold' }]), text(' and ', undefined), text('code', [{ type: 'code' }])])
      ])
    )
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<p>a <strong>bold</strong> and <code>code</code></p>')
  })

  it('escapes HTML in text and links', () => {
    const html = tiptapDocToHtml(doc([para([text('<script>alert(1)</script>')])]))
    expect(html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
    expect(escapeHtml('a & b < c > "d"')).toBe('a &amp; b &lt; c &gt; &quot;d&quot;')
  })

  it('renders task lists with disabled checkboxes reflecting state', () => {
    const tasks = { type: 'taskList', content: [
      { type: 'taskItem', attrs: { checked: false }, content: [para([text('todo')])] },
      { type: 'taskItem', attrs: { checked: true }, content: [para([text('done')])] }
    ] }
    const html = tiptapDocToHtml(doc([tasks]))
    expect(html).toContain('<input type="checkbox" disabled /> todo')
    expect(html).toContain('<input type="checkbox" disabled checked /> done')
  })

  it('renders links, code blocks, blockquotes, and rules', () => {
    expect(tiptapDocToHtml(doc([para([text('x', [{ type: 'link', attrs: { href: 'https://a.dev' } }])])]))).toBe(
      '<p><a href="https://a.dev">x</a></p>'
    )
    expect(tiptapDocToHtml(doc([{ type: 'codeBlock', content: [text('const a=1')] }]))).toBe('<pre><code>const a=1</code></pre>')
    expect(tiptapDocToHtml(doc([{ type: 'blockquote', content: [para([text('q')])] }]))).toBe('<blockquote><p>q</p></blockquote>')
    expect(tiptapDocToHtml(doc([{ type: 'horizontalRule' }]))).toBe('<hr />')
  })
})

describe('printableDocument', () => {
  it('produces a full HTML document with the title and body', () => {
    const out = printableDocument('My Note', '<p>hi</p>')
    expect(out.startsWith('<!doctype html>')).toBe(true)
    expect(out).toContain('<title>My Note</title>')
    expect(out).toContain('<div class="doc-title">My Note</div>')
    expect(out).toContain('<p>hi</p>')
  })
  it('escapes the title', () => {
    expect(printableDocument('<b>x</b>', '')).toContain('<div class="doc-title">&lt;b&gt;x&lt;/b&gt;</div>')
  })
})

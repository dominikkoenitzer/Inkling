import { describe, it, expect } from 'vitest'
import { tiptapDocToMarkdown } from '../src/shared/markdown'

const doc = (content: unknown[]): unknown => ({ type: 'doc', content })
const text = (t: string, marks?: unknown[]): unknown => ({ type: 'text', text: t, ...(marks ? { marks } : {}) })
const para = (nodes: unknown[]): unknown => ({ type: 'paragraph', content: nodes })

describe('tiptapDocToMarkdown', () => {
  it('renders headings and paragraphs', () => {
    const md = tiptapDocToMarkdown(
      doc([
        { type: 'heading', attrs: { level: 2 }, content: [text('Chapter 4')] },
        para([text('Some notes here.')])
      ])
    )
    expect(md).toBe('## Chapter 4\n\nSome notes here.\n')
  })

  it('applies inline marks (bold, italic, code, link)', () => {
    const md = tiptapDocToMarkdown(
      doc([
        para([
          text('a ', undefined),
          text('bold', [{ type: 'bold' }]),
          text(' and ', undefined),
          text('italic', [{ type: 'italic' }]),
          text(' and ', undefined),
          text('x = 1', [{ type: 'code' }]),
          text(' ', undefined),
          text('link', [{ type: 'link', attrs: { href: 'https://x.dev' } }])
        ])
      ])
    )
    expect(md).toBe('a **bold** and *italic* and `x = 1` [link](https://x.dev)\n')
  })

  it('renders bullet and ordered lists', () => {
    const bullet = { type: 'bulletList', content: [
      { type: 'listItem', content: [para([text('one')])] },
      { type: 'listItem', content: [para([text('two')])] }
    ] }
    expect(tiptapDocToMarkdown(doc([bullet]))).toBe('- one\n- two\n')

    const ordered = { type: 'orderedList', content: [
      { type: 'listItem', content: [para([text('first')])] },
      { type: 'listItem', content: [para([text('second')])] }
    ] }
    expect(tiptapDocToMarkdown(doc([ordered]))).toBe('1. first\n2. second\n')
  })

  it('renders task lists with checkbox state', () => {
    const tasks = { type: 'taskList', content: [
      { type: 'taskItem', attrs: { checked: false }, content: [para([text('todo')])] },
      { type: 'taskItem', attrs: { checked: true }, content: [para([text('done')])] }
    ] }
    expect(tiptapDocToMarkdown(doc([tasks]))).toBe('- [ ] todo\n- [x] done\n')
  })

  it('renders blockquotes, code blocks, and rules', () => {
    expect(tiptapDocToMarkdown(doc([{ type: 'blockquote', content: [para([text('quoted')])] }]))).toBe('> quoted\n')
    expect(
      tiptapDocToMarkdown(doc([{ type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const a = 1')] }]))
    ).toBe('```ts\nconst a = 1\n```\n')
    expect(tiptapDocToMarkdown(doc([{ type: 'horizontalRule' }]))).toBe('---\n')
  })

  it('returns empty string for an empty or malformed doc', () => {
    expect(tiptapDocToMarkdown(doc([para([])]))).toBe('')
    expect(tiptapDocToMarkdown(null)).toBe('')
    expect(tiptapDocToMarkdown('nonsense')).toBe('')
  })

  it('preserves non-first-paragraph blocks inside a list item (regression)', () => {
    const item = { type: 'listItem', content: [para([text('step one')]), { type: 'codeBlock', content: [text('run()')] }] }
    const md = tiptapDocToMarkdown(doc([{ type: 'bulletList', content: [item] }]))
    expect(md).toContain('- step one')
    expect(md).toContain('run()') // second block no longer dropped
  })

  it('escapes markdown metacharacters so literal text round-trips (regression)', () => {
    expect(tiptapDocToMarkdown(doc([para([text('- not a list')])]))).toBe('\\- not a list\n')
    expect(tiptapDocToMarkdown(doc([para([text('# not a heading')])]))).toBe('\\# not a heading\n')
    expect(tiptapDocToMarkdown(doc([para([text('use *args and _kw_')])]))).toBe('use \\*args and \\_kw\\_\n')
  })
})

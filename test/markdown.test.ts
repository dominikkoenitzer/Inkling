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

  it('fences a code block one longer than the longest backtick run in it', () => {
    expect(tiptapDocToMarkdown(doc([{ type: 'codeBlock', content: [text('a\n```\nb')] }]))).toBe('````\na\n```\nb\n````\n')
    expect(
      tiptapDocToMarkdown(doc([{ type: 'codeBlock', attrs: { language: 'md' }, content: [text('x\n````\ny')] }]))
    ).toBe('`````md\nx\n````\ny\n`````\n')
  })

  it('numbers an ordered list from its start', () => {
    const items = [
      { type: 'listItem', content: [para([text('five')])] },
      { type: 'listItem', content: [para([text('six')])] }
    ]
    expect(tiptapDocToMarkdown(doc([{ type: 'orderedList', attrs: { start: 5 }, content: items }]))).toBe('5. five\n6. six\n')
    expect(tiptapDocToMarkdown(doc([{ type: 'orderedList', attrs: { start: 1 }, content: items }]))).toBe('1. five\n2. six\n')
  })
  it('numbers an ordered list from 1 when a number would run past nine digits', () => {
    const items = [
      { type: 'listItem', content: [para([text('five')])] },
      { type: 'listItem', content: [para([text('six')])] }
    ]
    const from = (start: number): string => tiptapDocToMarkdown(doc([{ type: 'orderedList', attrs: { start }, content: items }]))
    expect(from(999999998)).toBe('999999998. five\n999999999. six\n')
    expect(from(999999999)).toBe('1. five\n2. six\n')
    expect(from(1234567890)).toBe('1. five\n2. six\n')
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

  it('keeps a paragraph of dashes as text, not a rule', () => {
    expect(tiptapDocToMarkdown(doc([para([text('---')])]))).toBe('\\---\n')
    expect(tiptapDocToMarkdown(doc([para([text('-- -')])]))).toBe('\\-- -\n')
    expect(tiptapDocToMarkdown(doc([para([text('***')])]))).toBe('\\*\\*\\*\n')
    expect(tiptapDocToMarkdown(doc([para([text('___')])]))).toBe('\\_\\_\\_\n')
    expect(tiptapDocToMarkdown(doc([para([text('-')])]))).toBe('\\-\n')
    expect(tiptapDocToMarkdown(doc([para([text('1.')])]))).toBe('1\\.\n')
  })

  it('escapes block markers on every line of a paragraph, not just the first', () => {
    const br = { type: 'hardBreak' }
    const after = (line: string): string => tiptapDocToMarkdown(doc([para([text('intro'), br, text(line)])]))
    expect(after('# text')).toBe('intro  \n\\# text\n')
    expect(after('> quote')).toBe('intro  \n\\> quote\n')
    expect(after('- item')).toBe('intro  \n\\- item\n')
    expect(after('+ item')).toBe('intro  \n\\+ item\n')
    expect(after('* item')).toBe('intro  \n\\* item\n')
    expect(after('1. one')).toBe('intro  \n1\\. one\n')
    expect(after('2) two')).toBe('intro  \n2\\) two\n')
    // a dash or equals line under text would make the line above a heading
    expect(after('---')).toBe('intro  \n\\---\n')
    expect(after('===')).toBe('intro  \n\\===\n')
  })

  it('escapes block markers at the start of a list item', () => {
    const bullet = { type: 'bulletList', content: [{ type: 'listItem', content: [para([text('# not a heading')])] }] }
    expect(tiptapDocToMarkdown(doc([bullet]))).toBe('- \\# not a heading\n')
  })

  it('fences inline code with more backticks than it contains', () => {
    const code = (t: string): string => tiptapDocToMarkdown(doc([para([text(t, [{ type: 'code' }])])]))
    expect(code('a`b')).toBe('``a`b``\n')
    expect(code('``x``')).toBe('``` ``x`` ```\n')
    expect(code('`tick')).toBe('`` `tick ``\n')
    expect(code(' padded ')).toBe('`  padded  `\n')
    expect(code('plain')).toBe('`plain`\n')
  })
})

import { describe, it, expect } from 'vitest'
import { markdownToDoc, markdownToNote, inline, type PMNode } from '../src/shared/markdownImport'
import { tiptapDocToMarkdown } from '../src/shared/markdown'

const blocks = (md: string): PMNode[] => markdownToDoc(md).content ?? []
const text = (n: PMNode): string => (typeof n.text === 'string' ? n.text : (n.content ?? []).map(text).join(''))
const marksOf = (n: PMNode): string[] => (n.marks ?? []).map((m) => m.type)

describe('markdownToDoc — blocks', () => {
  it('parses headings and clamps below the editor’s three levels', () => {
    const out = blocks('# One\n\n## Two\n\n##### Five')
    expect(out.map((b) => b.attrs?.level)).toEqual([1, 2, 3])
    expect(out.map(text)).toEqual(['One', 'Two', 'Five'])
  })

  it('joins wrapped lines into one paragraph and splits on blank lines', () => {
    const out = blocks('first line\ncontinued here\n\nsecond para')
    expect(out).toHaveLength(2)
    expect(text(out[0])).toBe('first line continued here')
    expect(text(out[1])).toBe('second para')
  })

  it('parses bullet and ordered lists, keeping the ordered start index', () => {
    const bullets = blocks('- a\n- b')[0]
    expect(bullets.type).toBe('bulletList')
    expect(bullets.content).toHaveLength(2)

    const ordered = blocks('3. three\n4. four')[0]
    expect(ordered.type).toBe('orderedList')
    expect(ordered.attrs?.start).toBe(3)
  })

  it('parses task lists into taskItems with the right checked state', () => {
    const list = blocks('- [ ] open\n- [x] done')[0]
    expect(list.type).toBe('taskList')
    expect(list.content?.map((i) => i.attrs?.checked)).toEqual([false, true])
    // New tasks carry no id until the note is saved and they're linked up.
    expect(list.content?.every((i) => i.attrs?.taskId === null)).toBe(true)
  })

  it('nests a deeper list under the item above it', () => {
    const list = blocks('- outer\n  - inner')[0]
    expect(list.type).toBe('bulletList')
    expect(list.content).toHaveLength(1)
    const nested = list.content?.[0].content?.find((c) => c.type === 'bulletList')
    expect(nested).toBeDefined()
    expect(text(nested as PMNode)).toBe('inner')
  })

  it('keeps a fenced code block verbatim, including its language', () => {
    const code = blocks('```ts\nconst a = 1\n\nconst b = 2\n```')[0]
    expect(code.type).toBe('codeBlock')
    expect(code.attrs?.language).toBe('ts')
    expect(text(code)).toBe('const a = 1\n\nconst b = 2')
  })

  it('does not treat markdown inside a code fence as markdown', () => {
    const code = blocks('```\n# not a heading\n- not a list\n```')[0]
    expect(code.type).toBe('codeBlock')
    expect(text(code)).toBe('# not a heading\n- not a list')
  })

  it('parses blockquotes and horizontal rules', () => {
    expect(blocks('> quoted')[0].type).toBe('blockquote')
    expect(blocks('---')[0].type).toBe('horizontalRule')
    expect(blocks('***')[0].type).toBe('horizontalRule')
  })

  it('never returns an empty document', () => {
    expect(markdownToDoc('').content).toEqual([{ type: 'paragraph' }])
    expect(markdownToDoc('   \n\n  ').content).toEqual([{ type: 'paragraph' }])
  })
})

describe('inline marks', () => {
  it('reads bold, italic, strike, highlight and code', () => {
    expect(marksOf(inline('**b**')[0])).toEqual(['bold'])
    expect(marksOf(inline('__b__')[0])).toEqual(['bold'])
    expect(marksOf(inline('*i*')[0])).toEqual(['italic'])
    expect(marksOf(inline('_i_')[0])).toEqual(['italic'])
    expect(marksOf(inline('~~s~~')[0])).toEqual(['strike'])
    expect(marksOf(inline('==h==')[0])).toEqual(['highlight'])
    expect(marksOf(inline('`c`')[0])).toEqual(['code'])
  })

  it('prefers bold over italic so ** is not read as two *', () => {
    const nodes = inline('**bold**')
    expect(nodes).toHaveLength(1)
    expect(nodes[0].text).toBe('bold')
    expect(marksOf(nodes[0])).toEqual(['bold'])
  })

  it('keeps surrounding plain text', () => {
    const nodes = inline('a **b** c')
    expect(nodes.map((n) => n.text)).toEqual(['a ', 'b', ' c'])
  })

  it('reads links with their href', () => {
    const [node] = inline('[Inkling](https://example.com)')
    expect(node.text).toBe('Inkling')
    expect(node.marks?.[0]).toEqual({ type: 'link', attrs: { href: 'https://example.com' } })
  })

  it('reads [[wiki-links]] as unresolved noteLink nodes', () => {
    const [node] = inline('[[Chapter 4]]')
    expect(node.type).toBe('noteLink')
    expect(node.attrs).toEqual({ noteId: null, label: 'Chapter 4' })
  })

  it('leaves an escaped delimiter as literal text', () => {
    const nodes = inline('a \\*not italic\\* b')
    expect(nodes).toHaveLength(1)
    expect(nodes[0].text).toBe('a *not italic* b')
    expect(marksOf(nodes[0])).toEqual([])
  })

  it('does not treat markdown inside inline code as markdown', () => {
    const nodes = inline('`**raw**`')
    expect(nodes).toHaveLength(1)
    expect(nodes[0].text).toBe('**raw**')
    expect(marksOf(nodes[0])).toEqual(['code'])
  })
})

describe('markdownToNote', () => {
  it('lifts a leading H1 into the title and drops it from the body', () => {
    const { title, doc } = markdownToNote('# My page\n\nbody text')
    expect(title).toBe('My page')
    expect(doc.content).toHaveLength(1)
    expect(text(doc.content![0])).toBe('body text')
  })

  it('falls back to the supplied name when there is no leading H1', () => {
    const { title, doc } = markdownToNote('just text', 'notes-export')
    expect(title).toBe('notes-export')
    expect(text(doc.content![0])).toBe('just text')
  })

  it('does not lift an H2, or an H1 that is not first', () => {
    expect(markdownToNote('## Sub\n\nbody').title).toBeNull()
    expect(markdownToNote('intro\n\n# Later').title).toBeNull()
  })

  it('leaves a usable empty body when the file was only a title', () => {
    const { title, doc } = markdownToNote('# Only a title')
    expect(title).toBe('Only a title')
    expect(doc.content).toEqual([{ type: 'paragraph' }])
  })
})

describe('round trip with the exporter', () => {
  it('survives export → import → export unchanged', () => {
    const source = [
      '# Chapter 4',
      '',
      'Some **bold** and *italic* and `code`.',
      '',
      '## Notes',
      '',
      '- first',
      '- second',
      '',
      '1. one',
      '2. two',
      '',
      '- [ ] todo',
      '- [x] done',
      '',
      '> a quote',
      '',
      '```ts',
      'const x = 1',
      '```',
      ''
    ].join('\n')

    const once = tiptapDocToMarkdown(markdownToDoc(source) as never)
    const twice = tiptapDocToMarkdown(markdownToDoc(once) as never)
    expect(twice.trim()).toBe(once.trim())
  })

  it('carries a wiki-link through the round trip', () => {
    const md = tiptapDocToMarkdown(markdownToDoc('See [[Lab safety]] first.') as never)
    expect(md).toContain('[[Lab safety]]')
  })
})

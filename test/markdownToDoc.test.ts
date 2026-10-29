import { describe, expect, it } from 'vitest'
import { markdownToDoc } from '../src/shared/markdownToDoc'
import { tiptapDocToMarkdown } from '../src/shared/markdown'

type Node = Record<string, unknown>
type Mark = { type: string; attrs?: Record<string, unknown> }

const t = (text: string, ...marks: Mark[]): Node => (marks.length ? { type: 'text', text, marks } : { type: 'text', text })
const bold = { type: 'bold' }
const italic = { type: 'italic' }
const code = { type: 'code' }
const strike = { type: 'strike' }
const highlight = { type: 'highlight' }
const link = (href: string): Mark => ({ type: 'link', attrs: { href } })
const p = (...content: Node[]): Node => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' })
const h = (level: number, ...content: Node[]): Node => ({ type: 'heading', attrs: { level }, content })
const li = (...content: Node[]): Node => ({ type: 'listItem', content })
const task = (checked: boolean, ...content: Node[]): Node => ({ type: 'taskItem', attrs: { checked, taskId: null }, content })
const ul = (...content: Node[]): Node => ({ type: 'bulletList', content })
const ol = (...content: Node[]): Node => ({ type: 'orderedList', content })
const tasks = (...content: Node[]): Node => ({ type: 'taskList', content })
const doc = (...content: Node[]): Node => ({ type: 'doc', content })
const br = { type: 'hardBreak' }

describe('markdownToDoc blocks', () => {
  it('gives an empty paragraph for empty input', () => {
    expect(markdownToDoc('')).toEqual(doc(p()))
    expect(markdownToDoc('  \n\n\t\n')).toEqual(doc(p()))
  })

  it('reads headings and clamps the level to three', () => {
    expect(markdownToDoc('# One\n## Two\n### Three\n###### Six')).toEqual(
      doc(h(1, t('One')), h(2, t('Two')), h(3, t('Three')), h(3, t('Six')))
    )
    expect(markdownToDoc('## Closed ##')).toEqual(doc(h(2, t('Closed'))))
    expect(markdownToDoc('#hashtag')).toEqual(doc(p(t('#hashtag'))))
    expect(markdownToDoc('#')).toEqual(doc({ type: 'heading', attrs: { level: 1 } }))
  })

  it('makes every line its own paragraph, so card lines stay apart', () => {
    expect(markdownToDoc('Photosynthesis :: Light to energy\nMitochondria :: Powerhouse')).toEqual(
      doc(p(t('Photosynthesis :: Light to energy')), p(t('Mitochondria :: Powerhouse')))
    )
    expect(markdownToDoc('a\r\nb')).toEqual(doc(p(t('a')), p(t('b'))))
  })

  it('keeps leading spaces, which continue a card answer', () => {
    expect(markdownToDoc('Term ::\n  first part')).toEqual(doc(p(t('Term ::')), p(t('  first part'))))
  })

  it('turns two trailing spaces or a backslash into a hard break', () => {
    expect(markdownToDoc('one  \ntwo\\\nthree')).toEqual(doc(p(t('one'), br, t('two'), br, t('three'))))
    // At the end of a paragraph neither one breaks.
    expect(markdownToDoc('end  \n\nnext')).toEqual(doc(p(t('end')), p(t('next'))))
    expect(markdownToDoc('slash\\')).toEqual(doc(p(t('slash\\'))))
  })

  it('does not let stray trailing spaces swallow the next list item', () => {
    expect(markdownToDoc('- a  \n- b')).toEqual(doc(ul(li(p(t('a'))), li(p(t('b'))))))
  })

  it('reads bullet lists with any marker', () => {
    expect(markdownToDoc('- a\n* b\n+ c')).toEqual(doc(ul(li(p(t('a'))), li(p(t('b'))), li(p(t('c'))))))
  })

  it('reads ordered lists and keeps a start other than one', () => {
    expect(markdownToDoc('1. a\n2) b')).toEqual(doc(ol(li(p(t('a'))), li(p(t('b'))))))
    expect(markdownToDoc('3. c\n4. d')).toEqual(doc({ ...ol(li(p(t('c'))), li(p(t('d')))), attrs: { start: 3 } }))
  })

  it('reads task items as unlinked checkboxes', () => {
    expect(markdownToDoc('- [ ] open\n- [x] done\n* [X] also done\n- [ ]')).toEqual(
      doc(tasks(task(false, p(t('open'))), task(true, p(t('done'))), task(true, p(t('also done'))), task(false, p())))
    )
  })

  it('nests by indentation', () => {
    expect(markdownToDoc('- a\n  - b\n    - c\n- d')).toEqual(
      doc(ul(li(p(t('a')), ul(li(p(t('b')), ul(li(p(t('c'))))))), li(p(t('d')))))
    )
    expect(markdownToDoc('1. a\n   - b')).toEqual(doc(ol(li(p(t('a')), ul(li(p(t('b'))))))))
    expect(markdownToDoc('- [ ] a\n  - [x] b')).toEqual(doc(tasks(task(false, p(t('a')), tasks(task(true, p(t('b'))))))))
  })

  it('keeps an indented paragraph inside its item', () => {
    expect(markdownToDoc('- a\n  more\n\n  after a gap\n- b')).toEqual(
      doc(ul(li(p(t('a')), p(t('more')), p(t('after a gap'))), li(p(t('b')))))
    )
  })

  it('starts a new list when the kind changes', () => {
    expect(markdownToDoc('- a\n- [ ] b\n1. c')).toEqual(doc(ul(li(p(t('a')))), tasks(task(false, p(t('b')))), ol(li(p(t('c'))))))
  })

  it('ends a list at an unindented line', () => {
    expect(markdownToDoc('- a\nplain')).toEqual(doc(ul(li(p(t('a')))), p(t('plain'))))
    expect(markdownToDoc('- a\n\n- b\n\nplain')).toEqual(doc(ul(li(p(t('a'))), li(p(t('b')))), p(t('plain'))))
  })

  it('reads fenced code with and without a language', () => {
    expect(markdownToDoc('```ts\nconst a = 1\n\nlet *b* = 2\n```')).toEqual(
      doc({ type: 'codeBlock', attrs: { language: 'ts' }, content: [t('const a = 1\n\nlet *b* = 2')] })
    )
    expect(markdownToDoc('~~~\nx\n~~~')).toEqual(doc({ type: 'codeBlock', attrs: { language: null }, content: [t('x')] }))
    expect(markdownToDoc('```\n```')).toEqual(doc({ type: 'codeBlock', attrs: { language: null } }))
    // An unclosed fence runs to the end.
    expect(markdownToDoc('```\nopen')).toEqual(doc({ type: 'codeBlock', attrs: { language: null }, content: [t('open')] }))
  })

  it('reads quotes and rules', () => {
    expect(markdownToDoc('> a\n>\n> - b')).toEqual(doc({ type: 'blockquote', content: [p(t('a')), ul(li(p(t('b'))))] }))
    expect(markdownToDoc('---\n***\n___\n- - -')).toEqual(doc(...Array(4).fill({ type: 'horizontalRule' })))
  })
})

describe('markdownToDoc inline', () => {
  it('reads each mark', () => {
    expect(markdownToDoc('**b** __b__ *i* _i_ ~~s~~ ==h== `c`')).toEqual(
      doc(
        p(
          t('b', bold),
          t(' '),
          t('b', bold),
          t(' '),
          t('i', italic),
          t(' '),
          t('i', italic),
          t(' '),
          t('s', strike),
          t(' '),
          t('h', highlight),
          t(' '),
          t('c', code)
        )
      )
    )
  })

  it('nests marks and keeps partly formatted words whole', () => {
    expect(markdownToDoc('***both*** **Photo**synthesis')).toEqual(doc(p(t('both', bold, italic), t(' '), t('Photo', bold), t('synthesis'))))
    expect(markdownToDoc('*a **b** c*')).toEqual(doc(p(t('a ', italic), t('b', bold, italic), t(' c', italic))))
    expect(markdownToDoc('***a** b*')).toEqual(doc(p(t('a', bold, italic), t(' b', italic))))
  })

  it('stays fast on a line of unmatched markers', () => {
    const line = '**a *b ~~c ==d _e '.repeat(400)
    const started = Date.now()
    markdownToDoc(line)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('reads links with formatting inside, web and mail only', () => {
    expect(markdownToDoc('[**x**](https://example.com) [mail](mailto:a@b.c)')).toEqual(
      doc(p(t('x', link('https://example.com'), bold), t(' '), t('mail', link('mailto:a@b.c'))))
    )
    expect(markdownToDoc('[run](javascript:alert(1))')).toEqual(doc(p(t('run'))))
  })

  it('reads code spans of any fence length', () => {
    expect(markdownToDoc('``a`b`` `` `x `` ` y`')).toEqual(doc(p(t('a`b', code), t(' '), t('`x', code), t(' '), t(' y', code))))
  })

  it('leaves unclosed markers and intraword underscores as text', () => {
    expect(markdownToDoc('**not bold *nor this `nor [this](')).toEqual(doc(p(t('**not bold *nor this `nor [this]('))))
    expect(markdownToDoc('snake_case_name a * b')).toEqual(doc(p(t('snake_case_name a * b'))))
  })

  it('unescapes punctuation', () => {
    expect(markdownToDoc('\\# a\\*b\\_c \\[x\\] \\\\ 1\\. \\q')).toEqual(doc(p(t('# a*b_c [x] \\ 1. \\q'))))
  })
})

describe('round trip with tiptapDocToMarkdown', () => {
  const samples = [
    '# Biology\n\n## Cells\n\nPlain text with **bold**, *italic*, ~~gone~~, ==marked== and `code`.\n\nA [link](https://example.com) here.\n\nLine one  \nline two\n\nPhotosynthesis :: How plants turn light into energy\n\nMitochondria :: Makes the energy the cell runs on\n',
    '- one\n- two\n  - nested\n  - also nested\n\n- three\n\n1. first\n2. second\n\n- [ ] open task\n- [x] done task\n',
    '```ts\nconst a = 1\n```\n\n> A quote\n\n---\n\nAfter the rule\n'
  ]
  for (const md of samples) {
    it(`keeps Markdown as it was: ${JSON.stringify(md.slice(0, 24))}`, () => {
      expect(tiptapDocToMarkdown(markdownToDoc(md))).toBe(md)
    })
  }

  const docs: Array<[string, Node]> = [
    ['headings and marks', doc(h(1, t('Big '), t('idea', italic)), p(t('Photo', bold), t('synthesis')), p(t('both', bold, italic)))],
    ['links and code', doc(p(t('see '), t('docs', link('https://example.com/a?b=1')), t(' and '), t('npm i', code), t(' or '), t('a`b', code)))],
    ['nested lists', doc(ul(li(p(t('a')), ul(li(p(t('b'))), li(p(t('c'))))), li(p(t('d')))), ol(li(p(t('one'))), li(p(t('two')))))],
    ['task lists', doc(tasks(task(false, p(t('open'))), task(true, p(t('done')), tasks(task(false, p(t('sub')))))))],
    ['code block', doc({ type: 'codeBlock', attrs: { language: 'ts' }, content: [t('const a = 1\nconst b = 2')] }, p(t('after')))],
    ['characters that need escaping', doc(p(t('a*b_c [x] \\ back`tick')), p(t('# not a heading')), p(t('1. not a list')), p(t('- not a bullet')), p(t('> not a quote')))],
    ['hard breaks', doc(p(t('one'), br, t('- two')), ul(li(p(t('a'), br, t('b')))))],
    ['card lines', doc(p(t('Term ::')), p(t('  first part')), p(t('Cell :: '), t('Smallest', bold), t(' unit')))],
    ['quote and rule', doc({ type: 'blockquote', content: [p(t('a')), p(t('b'))] }, { type: 'horizontalRule' }, p(t('end')))],
    ['tildes and equals as text', doc(p(t('~~draft~~')), p(t('x==y and z==w')), p(t('~~~')), p(t('~~~ not code')), p(t('~5 min, a = b, a == b, a ~~ b')))],
    ['tildes and equals beside marks', doc(p(t('~gone~', strike), t(' and '), t('=x=', highlight)), p(t('a~'), t('b', strike), t('~c')), p(t('a =='), t('b', bold), t('== c')))],
    ['runs of three or more tildes or equals', doc(p(t('if a === b and c === d')), p(t('x ~~~ y ~~~~ z')), p(t('a === b', highlight)), p(t('a ~~~ b', strike)))]
  ]
  for (const [name, d] of docs) {
    it(`keeps the doc as it was: ${name}`, () => {
      expect(markdownToDoc(tiptapDocToMarkdown(d))).toEqual(d)
    })
  }

  // Markdown cannot mark a space at a mark's edge, so the spaces come back plain around the marked text.
  for (const mark of [bold, italic, strike, highlight]) {
    it(`keeps the text and the ${mark.type} of a run with spaces at its edges`, () => {
      const back = markdownToDoc(tiptapDocToMarkdown(doc(p(t('a'), t(' b ', mark), t('c'), t(' d e  ', mark), t('f')))))
      expect(back).toEqual(doc(p(t('a '), t('b', mark), t(' c '), t('d e', mark), t('  f'))))
    })
  }
  it('keeps the text and marks of a link with a bold run that ends in a space', () => {
    const d = doc(p(t('see '), t('the docs ', bold, link('https://example.com')), t('now')))
    expect(markdownToDoc(tiptapDocToMarkdown(d))).toEqual(doc(p(t('see '), t('the docs', link('https://example.com'), bold), t(' ', link('https://example.com')), t('now'))))
  })
})

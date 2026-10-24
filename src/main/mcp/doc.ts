/**
 * Edits on a stored note doc for the MCP server: sections under a heading and exact text
 * swaps. Only the blocks an edit touches are rebuilt from Markdown; every other block stays
 * as stored, ids and all. Pure, so it is tested without a database.
 */
import { tiptapDocToMarkdown } from '@shared/markdown'
import { markdownToDoc } from '@shared/markdownToDoc'
import { extractNoteTaskItems, stampTaskIds } from '@shared/noteTasks'
import { extractNoteCardLines, stampCardLines } from '@shared/noteCards'

export type Block = Record<string, unknown>
export type Doc = { type: 'doc'; content: Block[] }

const docOf = (content: Block[]): Doc => ({ type: 'doc', content })

/** One block as Markdown, without the trailing newline. Empty for a blank line. */
export const blockMarkdown = (block: Block): string => tiptapDocToMarkdown(docOf([block])).replace(/\n$/, '')

/** The whole doc as Markdown, the text read_note shows. */
export const docMarkdown = (blocks: Block[]): string => tiptapDocToMarkdown(docOf(blocks))

export const isBlank = (b: Block): boolean => b.type === 'paragraph' && !(Array.isArray(b.content) && b.content.length > 0)

/** Markdown as blocks; nothing at all for blank text. */
export function parseBlocks(md: string): Block[] {
  if (!md.trim()) return []
  return markdownToDoc(md).content.filter((b) => !isBlank(b))
}

const plain = (n: Block): string => {
  if (typeof n.text === 'string') return n.text
  return Array.isArray(n.content) ? (n.content as Block[]).map(plain).join('') : ''
}

/** A heading as the user would type it: no leading #, spaces collapsed, any case. */
const headingKey = (s: string): string => s.replace(/^\s*#+\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase()

export interface Section {
  /** Index of the heading block. */
  heading: number
  /** First block after the section, exclusive. */
  end: number
  level: number
}

/** The headings of a doc, for error messages. */
export function headings(blocks: Block[]): string[] {
  return blocks.filter((b) => b.type === 'heading').map((b) => plain(b).trim())
}

/**
 * The section under the heading called `name`: the heading itself up to the next heading of
 * the same or a higher level. Throws a message the assistant can act on when there is none
 * or more than one.
 */
export function findSection(blocks: Block[], name: string): Section {
  const key = headingKey(name)
  const hits = blocks.flatMap((b, i) => (b.type === 'heading' && headingKey(plain(b)) === key ? [i] : []))
  if (hits.length === 0) {
    const all = headings(blocks)
    throw new Error(
      all.length > 0
        ? `There is no heading "${name.trim()}" in this note. Its headings: ${all.slice(0, 30).map((h) => `"${h}"`).join(', ')}.`
        : 'This note has no headings. Use append_to_note or edit_note instead.'
    )
  }
  if (hits.length > 1) throw new Error(`${hits.length} headings are called "${name.trim()}". Use edit_note to change the one you mean.`)
  const at = hits[0]
  const level = Number((blocks[at].attrs as Record<string, unknown> | undefined)?.level ?? 1)
  let end = at + 1
  while (end < blocks.length) {
    const b = blocks[end]
    if (b.type === 'heading' && Number((b.attrs as Record<string, unknown> | undefined)?.level ?? 1) <= level) break
    end++
  }
  return { heading: at, end, level }
}

/** Picks an old id for each new key: the same text first, then, with `inOrder`, what is left in order. */
function matchIds(old: Array<{ key: string; id: number }>, keys: string[], inOrder: boolean): number[] {
  const free = [...old]
  const out = keys.map((key) => {
    const at = free.findIndex((o) => o.key === key)
    return at === -1 ? 0 : free.splice(at, 1)[0].id
  })
  if (!inOrder) return out
  return out.map((id) => (id > 0 ? id : (free.shift()?.id ?? 0)))
}

/**
 * Gives rebuilt blocks the ids their old version carried: a to-do line keeps its to-do (and
 * so its date and history), a card line keeps its cards and their schedule. Lines are paired
 * by the same text; with `inOrder`, as when a line is reworded in place, the rest pair up in
 * order, the way the editor keeps an id on a line being typed in.
 */
export function carryIds(oldBlocks: Block[], newBlocks: Block[], inOrder = false): Block[] {
  const oldTasks = extractNoteTaskItems(docOf(oldBlocks)).flatMap((i) => (i.taskId !== null ? [{ key: i.title, id: i.taskId }] : []))
  const oldLines = extractNoteCardLines(docOf(oldBlocks)).flatMap((l) => (l.lineId !== null ? [{ key: l.front, id: l.lineId }] : []))
  let doc = docOf(newBlocks)
  doc = stampTaskIds(doc, matchIds(oldTasks, extractNoteTaskItems(doc).map((i) => i.title), inOrder))
  const lines = extractNoteCardLines(doc)
  const lineIds = matchIds(oldLines, lines.map((l) => l.front), inOrder)
  const perParagraph: number[] = []
  lines.forEach((l, i) => (perParagraph[l.paragraph] = lineIds[i]))
  return stampCardLines(doc, perParagraph).content
}

/** Drops blank lines at the end of a run of blocks. */
export function trimBlankEnd(blocks: Block[]): Block[] {
  const out = [...blocks]
  while (out.length > 0 && isBlank(out[out.length - 1])) out.pop()
  return out
}

/** The doc with `md` added at the end of the section under `heading`, or of the note without one. */
export function appendBlocks(blocks: Block[], md: string, heading?: string): Block[] {
  const added = parseBlocks(md)
  if (heading === undefined) return [...trimBlankEnd(blocks), ...added]
  const s = findSection(blocks, heading)
  const body = trimBlankEnd(blocks.slice(s.heading + 1, s.end))
  return [...blocks.slice(0, s.heading + 1), ...body, ...added, ...blocks.slice(s.end)]
}

/** The doc with the section under `heading` holding `md` instead, and what it held before. */
export function replaceSection(blocks: Block[], heading: string, md: string): { blocks: Block[]; previous: string } {
  const s = findSection(blocks, heading)
  const old = blocks.slice(s.heading + 1, s.end)
  const next = carryIds(old, parseBlocks(md))
  return { blocks: [...blocks.slice(0, s.heading + 1), ...next, ...blocks.slice(s.end)], previous: docMarkdown(old) }
}

/** The section under `heading`, heading line included, as Markdown. */
export function sectionMarkdown(blocks: Block[], heading: string): string {
  const s = findSection(blocks, heading)
  return docMarkdown(blocks.slice(s.heading, s.end))
}

/**
 * The doc with `oldText` swapped for `newText`, both in the Markdown read_note shows.
 * The text must be found exactly once unless `all` is set. Returns how many were swapped.
 */
export function replaceText(blocks: Block[], oldText: string, newText: string, all = false): { blocks: Block[]; count: number } {
  if (!oldText.trim()) throw new Error('oldText cannot be empty or only spaces.')
  // The note's Markdown, block by block, with where each block sits in it.
  const spans: Array<{ index: number; start: number; end: number }> = []
  let full = ''
  blocks.forEach((b, index) => {
    const md = blockMarkdown(b)
    if (!md) return
    if (full) full += '\n\n'
    spans.push({ index, start: full.length, end: full.length + md.length })
    full += md
  })

  const matches: number[] = []
  for (let at = full.indexOf(oldText); at !== -1; at = full.indexOf(oldText, at + oldText.length)) matches.push(at)
  if (matches.length === 0) {
    throw new Error('oldText is not in the note. Copy it from read_note exactly, Markdown marks and line breaks included.')
  }
  if (matches.length > 1 && !all) {
    throw new Error(`oldText is in the note ${matches.length} times. Add more of the text around it so it matches once, or set replaceAll.`)
  }

  // Each match touches a run of blocks; overlapping runs are rebuilt together.
  const runs: Array<{ first: number; last: number; matches: number[] }> = []
  for (const m of matches) {
    // A match that starts or ends in the blank line between two blocks takes in both of them.
    const first = spans.findIndex((s, i) => (i + 1 < spans.length ? spans[i + 1].start : full.length) > m)
    let last = first
    while (last + 1 < spans.length && spans[last].end < m + oldText.length) last++
    const prev = runs[runs.length - 1]
    if (prev && first <= prev.last) {
      prev.last = Math.max(prev.last, last)
      prev.matches.push(m)
    } else runs.push({ first, last, matches: [m] })
  }

  let out = [...blocks]
  for (const run of [...runs].reverse()) {
    const from = spans[run.first]
    const to = spans[run.last]
    let text = full.slice(from.start, to.end)
    for (const m of [...run.matches].reverse()) {
      const at = m - from.start
      text = text.slice(0, at) + newText + text.slice(at + oldText.length)
    }
    const old = out.slice(from.index, to.index + 1)
    out = [...out.slice(0, from.index), ...carryIds(old, parseBlocks(text), true), ...out.slice(to.index + 1)]
  }
  return { blocks: out, count: matches.length }
}

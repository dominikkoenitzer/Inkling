import type { Schema } from '@tiptap/pm/model'

type Json = { type?: unknown; text?: unknown; content?: unknown }

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }

/** A stored note as the editor opens it. Not `editable` when this build cannot hold all of it. */
export interface OpenedNote {
  doc: Record<string, unknown>
  editable: boolean
}

/** Every line of text in `node`, one per block, hard breaks included. */
function lines(node: unknown): string[] {
  if (!node || typeof node !== 'object') return []
  const n = node as Json
  if (typeof n.text === 'string') return [n.text]
  if (n.type === 'hardBreak') return ['\n']
  const kids = Array.isArray(n.content) ? n.content : []
  if (kids.length === 0) return ['']
  // Inline children run on in one line, block children each start their own.
  const inline = kids.every((k) => k && typeof k === 'object' && (typeof (k as Json).text === 'string' || (k as Json).type === 'hardBreak'))
  if (inline) return kids.flatMap(lines).join('').split('\n')
  return kids.flatMap(lines)
}

/** Plain paragraphs holding `text`, line by line. */
function textDoc(text: string[]): Record<string, unknown> {
  const content = text.map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }))
  return content.length ? { type: 'doc', content } : EMPTY_DOC
}

/**
 * A stored note's doc for the editor. One this build cannot read whole (a newer Inkling's node, or
 * no doc at all) opens as its text and read-only, so it is never shown empty and saved over.
 */
export function openNote(content: string, schema: Schema): OpenedNote {
  if (content.trim() === '') return { doc: EMPTY_DOC, editable: true }
  let json: unknown
  try {
    json = JSON.parse(content)
  } catch {
    return { doc: textDoc(content.split(/\r?\n/)), editable: false }
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { doc: textDoc(content.split(/\r?\n/)), editable: false }
  try {
    schema.nodeFromJSON(json)
    return { doc: json as Record<string, unknown>, editable: true }
  } catch {
    return { doc: textDoc(lines(json)), editable: false }
  }
}

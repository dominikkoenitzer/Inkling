import { Node, mergeAttributes, nodeInputRule, nodePasteRule } from '@tiptap/core'

/**
 * `[[Wiki-link]]` — an inline reference from one note to another.
 *
 * Typing `[[Chapter 4]]` turns into a chip the moment the closing brackets land. The node
 * carries `noteId: null` until the next save, when the main process resolves the label to
 * an existing page (or creates one) and the id is stamped back in — exactly the flow the
 * note↔task checkboxes already use, so an unsaved link is never a broken link.
 *
 * It is an atom: the label is an attribute rather than editable content, so a half-deleted
 * link can't leave a dangling `[[`.
 */
export const NoteLink = Node.create({
  name: 'noteLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      noteId: {
        default: null,
        parseHTML: (el) => {
          const v = (el as HTMLElement).getAttribute('data-note-id')
          return v ? Number(v) : null
        },
        renderHTML: (attrs) => (attrs.noteId ? { 'data-note-id': String(attrs.noteId) } : {})
      },
      label: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-label') ?? (el as HTMLElement).textContent ?? '',
        renderHTML: (attrs) => ({ 'data-label': String(attrs.label ?? '') })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-note-link]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-note-link': '',
        class: 'note-link',
        // Unresolved links are styled differently until the save round-trip assigns an id.
        'data-pending': node.attrs.noteId ? null : ''
      }),
      String(node.attrs.label ?? '')
    ]
  },

  /** Plain-text and Markdown export see the original `[[…]]` syntax, not a bare word. */
  renderText({ node }) {
    return `[[${node.attrs.label ?? ''}]]`
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: /\[\[([^[\]]+)\]\]$/,
        type: this.type,
        getAttributes: (match) => ({ label: match[1].trim(), noteId: null })
      })
    ]
  },

  addPasteRules() {
    return [
      nodePasteRule({
        find: /\[\[([^[\]]+)\]\]/g,
        type: this.type,
        getAttributes: (match) => ({ label: match[1].trim(), noteId: null })
      })
    ]
  }
})

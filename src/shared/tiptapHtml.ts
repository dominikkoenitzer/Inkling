/**
 * Convert a TipTap / ProseMirror document into semantic HTML, and wrap it in a
 * clean printable document (used for PDF export via Electron's printToPDF).
 * Pure and dependency-free.
 */

interface PMMark {
  type: string
  attrs?: Record<string, unknown>
}
interface PMNode {
  type?: string
  text?: string
  marks?: PMMark[]
  attrs?: Record<string, unknown>
  content?: PMNode[]
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

function renderInline(nodes?: PMNode[]): string {
  if (!nodes) return ''
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '<br />'
      if (n.type !== 'text') return renderInline(n.content)
      let t = escapeHtml(n.text ?? '')
      for (const m of n.marks ?? []) {
        switch (m.type) {
          case 'bold':
            t = `<strong>${t}</strong>`
            break
          case 'italic':
            t = `<em>${t}</em>`
            break
          case 'underline':
            t = `<u>${t}</u>`
            break
          case 'strike':
            t = `<s>${t}</s>`
            break
          case 'code':
            t = `<code>${t}</code>`
            break
          case 'highlight':
            t = `<mark>${t}</mark>`
            break
          case 'link': {
            const href = m.attrs?.href
            if (typeof href === 'string' && href) t = `<a href="${escapeHtml(href)}">${t}</a>`
            break
          }
        }
      }
      return t
    })
    .join('')
}

// list-item body: inline the leading paragraph, recurse for nested lists
function itemBody(item: PMNode): string {
  return (item.content ?? [])
    .map((k) => (k.type === 'paragraph' ? renderInline(k.content) : renderBlock(k)))
    .join('')
}

function renderBlock(n: PMNode): string {
  switch (n.type) {
    case 'paragraph': {
      const c = renderInline(n.content)
      return c ? `<p>${c}</p>` : '<p></p>'
    }
    case 'heading': {
      const l = Math.min(Math.max(Number(n.attrs?.level ?? 1), 1), 6)
      return `<h${l}>${renderInline(n.content)}</h${l}>`
    }
    case 'bulletList':
      return `<ul>${(n.content ?? []).map((li) => `<li>${itemBody(li)}</li>`).join('')}</ul>`
    case 'orderedList':
      return `<ol>${(n.content ?? []).map((li) => `<li>${itemBody(li)}</li>`).join('')}</ol>`
    case 'taskList':
      return `<ul class="tasks">${(n.content ?? [])
        .map((li) => `<li><input type="checkbox" disabled${li.attrs?.checked ? ' checked' : ''} /> ${itemBody(li)}</li>`)
        .join('')}</ul>`
    case 'blockquote':
      return `<blockquote>${(n.content ?? []).map(renderBlock).join('')}</blockquote>`
    case 'codeBlock':
      return `<pre><code>${escapeHtml((n.content ?? []).map((c) => c.text ?? '').join(''))}</code></pre>`
    case 'horizontalRule':
      return '<hr />'
    default:
      return (n.content ?? []).map(renderBlock).join('')
  }
}

export function tiptapDocToHtml(doc: unknown): string {
  const root = doc as PMNode
  if (!root || !Array.isArray(root.content)) return ''
  return root.content.map(renderBlock).join('\n')
}

const PRINT_CSS = `
  *{box-sizing:border-box}
  body{font:15px/1.65 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;max-width:720px;margin:0 auto;padding:8px 4px}
  h1,h2,h3,h4{line-height:1.25;margin:1.4em 0 .5em;font-weight:700}
  h1{font-size:1.9em}h2{font-size:1.45em}h3{font-size:1.2em}
  p{margin:.6em 0}
  a{color:#12805f}
  code{background:#f1f2f1;padding:.12em .35em;border-radius:4px;font:.9em ui-monospace,Menlo,Consolas,monospace}
  pre{background:#f6f7f6;padding:14px 16px;border-radius:8px;overflow:auto}
  pre code{background:none;padding:0}
  blockquote{margin:.8em 0;padding:.2em 0 .2em 16px;border-left:3px solid #1d9e75;color:#555}
  ul,ol{padding-left:1.5em}
  ul.tasks{list-style:none;padding-left:.15em}
  ul.tasks li{margin:.2em 0}
  ul.tasks input{margin-right:.5em}
  hr{border:none;border-top:1px solid #ddd;margin:1.6em 0}
  mark{background:#fff2a8;padding:0 .15em}
  .doc-title{font-size:2.1em;font-weight:800;margin:0 0 .15em;letter-spacing:-.5px}
  .doc-meta{color:#8a8a8a;font-size:.82em;margin-bottom:1.6em;border-bottom:1px solid #eee;padding-bottom:1em}
`

/** Wrap rendered body HTML in a standalone, print-styled document. */
export function printableDocument(title: string, bodyHtml: string): string {
  const t = escapeHtml(title || 'Untitled')
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${t}</title><style>${PRINT_CSS}</style></head><body><div class="doc-title">${t}</div><div class="doc-meta">Exported from Inkling</div>${bodyHtml}</body></html>`
}

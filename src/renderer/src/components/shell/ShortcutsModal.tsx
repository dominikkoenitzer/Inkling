import { useApp } from '@/stores/app'
import { Kbd, Modal } from '@/components/ui'
import type { Exit } from '@/lib/motion'
import { keyLabel, shortcutsKey } from '@/lib/keys'

const GROUPS: Array<{ title: string; rows: Array<[string, string[]]> }> = [
  {
    title: 'Getting around',
    rows: [
      ['Search', ['Ctrl+K']],
      ['New note', ['Ctrl+N']],
      ['Today', ['Ctrl+1']],
      ['Flashcards', ['Ctrl+2']],
      ['Settings', ['Ctrl+,']],
      ['These shortcuts', [shortcutsKey()]]
    ]
  },
  {
    title: 'In a note',
    rows: [
      ['Heading', ['#', '##']],
      ['List', ['-']],
      ['To-do', ['[ ]']],
      ['Tick the to-do', ['Ctrl+Enter']],
      ['Bold, italic', ['Ctrl+B', 'Ctrl+I']]
    ]
  },
  {
    title: 'Reviewing cards',
    rows: [
      ['Show the answer', ['Space', 'Enter']],
      ['Good', ['Enter']],
      ['Again, Hard, Good, Easy', ['1', '2', '3', '4']],
      ['Stop', ['Esc']]
    ]
  }
]

export function ShortcutsModal(exit: Exit): React.JSX.Element {
  return (
    <Modal title="Keyboard shortcuts" width={460} onClose={() => useApp.getState().setShortcutsOpen(false)} {...exit}>
      <div className="space-y-5">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-1 text-xs font-medium text-faint">{g.title}</h3>
            <ul>
              {g.rows.map(([label, keys]) => (
                <li key={label} className="flex h-8 items-center justify-between gap-4 text-sm">
                  <span>{label}</span>
                  <span className="flex gap-1">
                    {keys.map((k) => (
                      <Kbd key={k}>{keyLabel(k)}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  )
}

import { useApp } from '@/stores/app'
import { isColorKey } from '@/lib/colors'
import { EmptyState } from '@/components/Inky'
import { PageEditor } from '@/components/notes/PageEditor'
import { StickyBoard } from '@/components/notes/StickyBoard'
import { TasksView } from '@/components/tasks/TasksView'
import { CalendarView } from '@/components/calendar/CalendarView'
import { StudyView } from '@/components/study/StudyView'
import { GradesView } from '@/components/grades/GradesView'

export function MainPane(): React.JSX.Element {
  const { tab, notesView, activeNotebookId, selectedNoteId, notebooks } = useApp()
  const notebook = notebooks.find((n) => n.id === activeNotebookId)

  if (!notebook) {
    return <EmptyState pose="wave" title="Welcome to Inkling" hint="Create your first notebook with the + button on the left rail." />
  }
  const color = isColorKey(notebook.color) ? notebook.color : 'teal'

  if (tab === 'notes') {
    if (notesView === 'board') return <StickyBoard notebook={notebook} />
    if (selectedNoteId !== null) return <PageEditor key={selectedNoteId} noteId={selectedNoteId} notebook={notebook} />
    return (
      <EmptyState
        pose="neutral"
        color={color}
        title="Pick a page, or start a fresh one"
        hint="Pages live in the sidebar. Stickies live on the board. Everything auto-saves — no save button, ever."
      />
    )
  }
  if (tab === 'tasks') return <TasksView notebook={notebook} />
  if (tab === 'calendar') return <CalendarView notebook={notebook} />
  if (tab === 'study') return <StudyView notebook={notebook} />
  return <GradesView notebook={notebook} />
}

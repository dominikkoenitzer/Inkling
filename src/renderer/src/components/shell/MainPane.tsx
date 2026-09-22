import { lazy, Suspense } from 'react'
import { useApp } from '@/stores/app'
import { isColorKey } from '@/lib/colors'
import { EmptyState } from '@/components/Inky'
import { TasksView } from '@/components/tasks/TasksView'
import { TodayView } from '@/components/today/TodayView'
import { StudyView } from '@/components/study/StudyView'
import { GradesView } from '@/components/grades/GradesView'
import { StatsView } from '@/components/stats/StatsView'

// TipTap and ProseMirror are two thirds of the renderer bundle, and the app opens on Today.
// Loading the editor when a page is first opened keeps that out of startup.
const PageEditor = lazy(() => import('@/components/notes/PageEditor').then((m) => ({ default: m.PageEditor })))

export function MainPane(): React.JSX.Element {
  const { tab, activeNotebookId, selectedNoteId, notebooks } = useApp()
  const notebook = notebooks.find((n) => n.id === activeNotebookId)

  if (!notebook) {
    return <EmptyState pose="wave" title="Welcome to Inkling" hint="Create your first notebook with the + button on the left rail." />
  }
  const color = isColorKey(notebook.color) ? notebook.color : 'teal'

  if (tab === 'notes') {
    if (selectedNoteId !== null) {
      return (
        <Suspense fallback={<div className="p-10 text-sm text-faint">Opening…</div>}>
          <PageEditor key={selectedNoteId} noteId={selectedNoteId} notebook={notebook} />
        </Suspense>
      )
    }
    return (
      <EmptyState
        pose="neutral"
        color={color}
        title="Pick a page, or start a fresh one"
        hint="Pages live in the sidebar. Everything auto-saves. No save button, ever."
      />
    )
  }
  if (tab === 'today') return <TodayView />
  if (tab === 'tasks') return <TasksView notebook={notebook} />
  if (tab === 'study') return <StudyView notebook={notebook} />
  if (tab === 'stats') return <StatsView />
  return <GradesView notebook={notebook} />
}

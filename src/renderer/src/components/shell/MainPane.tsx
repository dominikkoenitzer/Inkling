import { lazy, Suspense } from 'react'
import { Plus } from 'lucide-react'
import { useApp } from '@/stores/app'
import { EmptyState } from '@/components/Inky'
import { Button } from '@/components/ui'
import { TodayView } from '@/components/today/TodayView'
import { StudyView } from '@/components/study/StudyView'

// TipTap and ProseMirror are most of the renderer bundle, and the app opens on Today.
const PageEditor = lazy(() => import('@/components/notes/PageEditor').then((m) => ({ default: m.PageEditor })))

export function MainPane(): React.JSX.Element {
  const view = useApp((s) => s.view)
  const selectedNoteId = useApp((s) => s.selectedNoteId)

  if (view === 'today') return <TodayView />
  if (view === 'study') return <StudyView />
  if (selectedNoteId !== null) {
    return (
      <Suspense fallback={null}>
        <PageEditor key={selectedNoteId} noteId={selectedNoteId} />
      </Suspense>
    )
  }
  return (
    <EmptyState
      title="Pick a note, or start a new one."
      action={
        <Button variant="primary" onClick={() => void useApp.getState().newNote()}>
          <Plus size={15} /> New note
        </Button>
      }
    />
  )
}

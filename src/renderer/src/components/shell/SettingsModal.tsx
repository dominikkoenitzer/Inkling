import { useApp } from '@/stores/app'
import { Modal, Segmented } from '@/components/ui'

export function SettingsModal(): React.JSX.Element {
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)

  return (
    <Modal title="Settings" onClose={() => useApp.getState().setSettingsOpen(false)}>
      <div className="flex items-center justify-between">
        <span className="text-sm">Theme</span>
        <Segmented
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' }
          ]}
          value={theme}
          onChange={setTheme}
        />
      </div>
      <p className="mt-6 border-t border-edge pt-4 text-xs text-faint">Inkling {__APP_VERSION__}</p>
    </Modal>
  )
}

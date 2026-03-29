import { useStore } from '../store'
import './AppDialogHost.css'

export function AppDialogHost() {
  const dialog = useStore(s => s.appDialog)
  const resolveAppDialog = useStore(s => s.resolveAppDialog)

  if (!dialog) return null

  const closeByOverlay = () => {
    if (dialog.mode === 'confirm') {
      resolveAppDialog('cancel')
      return
    }
    resolveAppDialog('confirm')
  }

  return (
    <div className="app-dialog-overlay" onClick={closeByOverlay}>
      <div className="app-dialog-shell" onClick={e => e.stopPropagation()}>
        <div className="app-dialog-header">
          <span>{dialog.title}</span>
        </div>

        <div className="app-dialog-body">
          <p>{dialog.message}</p>
        </div>

        <div className="app-dialog-footer">
          {dialog.mode === 'confirm' && (
            <button
              className="btn-ghost"
              onClick={() => resolveAppDialog('cancel')}
            >
              {dialog.cancelText || '取消'}
            </button>
          )}
          <button
            className="btn-primary"
            onClick={() => resolveAppDialog('confirm')}
          >
            {dialog.confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

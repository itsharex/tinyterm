import { useEffect } from 'react'
import { useStore } from '../store'
import { Check, X, Info } from 'lucide-react'
import './ToastHost.css'

const ICONS = {
  success: Check,
  error: X,
  info: Info,
}

export function ToastHost() {
  const toasts = useStore(s => s.toasts)
  const removeToast = useStore(s => s.removeToast)

  return (
    <div className="toast-host">
      {toasts.map(toast => {
        const Icon = ICONS[toast.type]
        return (
          <ToastItem
            key={toast.id}
            toast={toast}
            icon={<Icon size={14} />}
            onRemove={() => removeToast(toast.id)}
          />
        )
      })}
    </div>
  )
}

function ToastItem({
  toast,
  icon,
  onRemove,
}: {
  toast: { id: string; message: string; type: 'success' | 'error' | 'info' }
  icon: React.ReactNode
  onRemove: () => void
}) {
  useEffect(() => {
    const timer = setTimeout(onRemove, 2000)
    return () => clearTimeout(timer)
  }, [onRemove])

  return (
    <div className={`toast-item toast-${toast.type}`}>
      <span className="toast-icon">{icon}</span>
      <span className="toast-message">{toast.message}</span>
    </div>
  )
}

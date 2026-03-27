import { X, Plus } from 'lucide-react'
import { useStore } from '../store'
import type { BookmarkTab } from '../types'
import './SessionTabBar.css'

interface Props {
  bookmarkTab: BookmarkTab
}

export function SessionTabBar({ bookmarkTab }: Props) {
  const { closeSession, setActiveSession, openSession } = useStore()

  const handleAddSession = async () => {
    // Connect to the host associated with this BookmarkTab
    const hostId = bookmarkTab.hostId || bookmarkTab.bookmarkId
    if (!hostId) return
    await openSession(hostId, bookmarkTab.id)
  }

  return (
    <div className="session-tab-bar glass-panel">
      <div className="session-tabs">
        {bookmarkTab.sessions.map((session, index) => (
          <div
            key={session.id}
            className={`session-tab ${session.id === bookmarkTab.activeSessionId ? 'active' : ''} status-${session.status}`}
            onClick={() => setActiveSession(bookmarkTab.id, session.id)}
          >
            <span className="session-status-dot" />
            <span className="session-tab-title">
              {session.title || `终端 ${index + 1}`}
            </span>
            <button
              className="session-tab-close"
              onClick={e => {
                e.stopPropagation()
                closeSession(bookmarkTab.id, session.id)
              }}
              title="关闭"
            >
              <X size={11} strokeWidth={2.5} />
            </button>
          </div>
        ))}

        {/* Only show + button if this tab has a host to connect to */}
        {(bookmarkTab.hostId || bookmarkTab.bookmarkId) && (
          <button
            className="session-tab-add"
            onClick={handleAddSession}
            title="新建终端连接"
          >
            <Plus size={14} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  )
}
import { useEffect, useRef, useState } from 'react'
import { Plus, X, Server, ChevronLeft, ChevronRight } from 'lucide-react'
import logoSrc from '/assets/logo.png'
import { useStore } from './store'
import { Toolbar } from './components/Toolbar'
import { TerminalView } from './components/TerminalView'
import { FileManager } from './components/FileManager'
import { CredentialsModal } from './components/CredentialsModal'
import { HostsModal } from './components/HostsModal'

import { listen } from '@tauri-apps/api/event'
import type { TransferProgress, BookmarkTab } from './types'
import './styles/app.css'

export default function App() {
  const {
    loadAll,
    bookmarkTabs,
    activeBookmarkTabId,
    setActiveBookmarkTab,
    removeBookmarkTab,
    updateTransfer,
    credentialsModalOpen,
    hostsModalOpen,
    openHostsModal,
    closeSession,
    setActiveSession,
    openSession,
    toggleSideTerminal,
  } = useStore()

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useEffect(() => {
    loadAll()
    const unlisten = listen<TransferProgress>('transfer-progress', event => {
      updateTransfer(event.payload)
    })
    return () => {
      unlisten.then(fn => fn())
    }
  }, [])



  const handleAddSession = async (bookmarkTabId: string) => {
    const tab = bookmarkTabs.find(t => t.id === bookmarkTabId)
    if (!tab) return
    const hostId = tab.hostId || tab.bookmarkId
    if (!hostId) return
    await openSession(hostId, bookmarkTabId)
  }

  return (
    <div className="app-root">
      <div className="app-container">
        {/* ── Top toolbar (centered pill) ───────────────── */}
        <Toolbar />

        {/* ── Body: sidebar + content ───────────────────── */}
        <div className="app-body">

          {/* ── Left sidebar: Host tabs ───────────────── */}
          <div className={`host-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
            <div className="host-sidebar-inner">
              {bookmarkTabs.length === 0 ? (
                <div className="host-sidebar-empty">
                  <Server size={20} strokeWidth={1.5} opacity={0.35} />
                  {!sidebarCollapsed && <span>无主机</span>}
                </div>
              ) : (
                <div className="host-sidebar-tabs">
                  {bookmarkTabs.map(tab => {
                    const sessionStatus = tab.sessions.find(
                      s => s.id === tab.activeSessionId
                    )?.status ?? 'idle'
                    const hostColor =
                      tab.hostId || tab.bookmarkId
                        ? (useStore.getState().hosts.find(h => h.id === (tab.hostId || tab.bookmarkId))?.color ?? '#7c5cbf')
                        : '#7c5cbf'
                    return (
                      <div
                        key={tab.id}
                        className={`host-sidebar-tab ${tab.id === activeBookmarkTabId ? 'active' : ''}`}
                        onClick={() => setActiveBookmarkTab(tab.id)}
                        title={tab.title}
                        style={{
                          ['--host-accent' as any]: hostColor,
                        }}
                      >
                        <span className={`host-dot status-${sessionStatus}`} />
                        {!sidebarCollapsed && (
                          <span className="host-sidebar-tab-title">{tab.title}</span>
                        )}
                        {!sidebarCollapsed && (
                          <button
                            className="host-sidebar-tab-close"
                            onClick={e => {
                              e.stopPropagation()
                              removeBookmarkTab(tab.id)
                            }}
                            title="关闭"
                          >
                            <X size={11} strokeWidth={2.5} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {sidebarCollapsed ? (
                <button
                  className="host-sidebar-add-icon"
                  onClick={openHostsModal}
                  title="添加主机"
                >
                  <Plus size={14} strokeWidth={2.5} />
                </button>
              ) : (
                <button
                  className="host-sidebar-add"
                  onClick={openHostsModal}
                  title="添加主机"
                >
                  <Plus size={13} strokeWidth={2.5} />
                  <span>添加主机</span>
                </button>
              )}
            </div>

            <button
              className="sidebar-collapse-btn"
              onClick={() => setSidebarCollapsed(c => !c)}
              title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            >
              {sidebarCollapsed
                ? <ChevronRight size={13} strokeWidth={2} />
                : <ChevronLeft size={13} strokeWidth={2} />
              }
            </button>
          </div>

          {/* ── Main content area ─────────────────────── */}
          <div className="main-content">
            {bookmarkTabs.length === 0 ? (
              /* Empty state — no host tabs at all */
              <div className="empty-state glass-panel">
                <div className="empty-state-content">
                  <div className="empty-icon" />
                  <h2>TinyTerm</h2>
                  <p>
                    点击左侧 <strong>添加主机</strong> 或顶部 <strong>主机</strong> 开始连接
                  </p>
                </div>
              </div>
            ) : (
              /*
               * Render ALL bookmark tabs simultaneously.
               * Only the active one is visible; others have display:none.
               * This preserves xterm instances across tab switches.
               */
              bookmarkTabs.map(bookmarkTab => (
                <HostTabPanel
                  key={bookmarkTab.id}
                  bookmarkTab={bookmarkTab}
                  isActive={bookmarkTab.id === activeBookmarkTabId}
                  onAddSession={handleAddSession}
                  onCloseSession={closeSession}
                  onSetActiveSession={setActiveSession}
                  onToggleSideTerminal={toggleSideTerminal}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {credentialsModalOpen && <CredentialsModal />}
      {hostsModalOpen && <HostsModal />}
    </div>
  )
}

// ── Per-host panel (session tabs + terminals) ─────────────────────────────────
// Rendered for every BookmarkTab, hidden via CSS when not active.
// This is the key to preserving xterm instances across host-tab switches.

interface HostTabPanelProps {
  bookmarkTab: BookmarkTab
  isActive: boolean
  onAddSession: (bookmarkTabId: string) => void
  onCloseSession: (bookmarkTabId: string, sessionTabId: string) => void
  onSetActiveSession: (bookmarkTabId: string, sessionTabId: string) => void
  onToggleSideTerminal: (bookmarkTabId: string, sessionTabId: string) => void
}

interface SessionTabContextMenu {
  x: number
  y: number
  sessionId: string
}

function HostTabPanel({
  bookmarkTab,
  isActive,
  onAddSession,
  onCloseSession,
  onSetActiveSession,
  onToggleSideTerminal,
}: HostTabPanelProps) {
  const [tabContextMenu, setTabContextMenu] = useState<SessionTabContextMenu | null>(null)
  const tabContextMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!tabContextMenu) return

    const handlePointerDown = (event: MouseEvent) => {
      if (
        tabContextMenuRef.current &&
        !tabContextMenuRef.current.contains(event.target as Node)
      ) {
        setTabContextMenu(null)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [tabContextMenu])

  return (
    <div
      className="content-area"
      style={{ display: isActive ? 'flex' : 'none' }}
    >
      {/* ── Session tab strip ── */}
      <div className="session-tabstrip">
        <div className="session-tabs-scroll">
          {bookmarkTab.sessions.map((session, index) => (
            <div
              key={session.id}
              className={`session-chrome-tab ${session.id === bookmarkTab.activeSessionId ? 'active' : ''} status-${session.status}`}
              onClick={() => onSetActiveSession(bookmarkTab.id, session.id)}
              onContextMenu={e => {
                e.preventDefault()
                e.stopPropagation()
                setTabContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  sessionId: session.id,
                })
              }}
            >
              <span className="session-chrome-dot" />
              <span className="session-chrome-title">
                {session.title || `终端 ${index + 1}`}
              </span>
              <button
                className="session-chrome-close"
                onClick={e => {
                  e.stopPropagation()
                  onCloseSession(bookmarkTab.id, session.id)
                }}
                title="关闭标签"
              >
                <X size={11} strokeWidth={2.5} />
              </button>
            </div>
          ))}
        </div>

        {(bookmarkTab.hostId || bookmarkTab.bookmarkId) && (
          <button
            className="session-tab-new"
            onClick={() => onAddSession(bookmarkTab.id)}
            title="新建终端"
          >
            <Plus size={14} strokeWidth={2.5} />
          </button>
        )}
      </div>

      {tabContextMenu && (() => {
        const targetSession = bookmarkTab.sessions.find(s => s.id === tabContextMenu.sessionId)
        if (!targetSession) return null

        return (
          <div
            ref={tabContextMenuRef}
            className="glass-panel"
            style={{
              position: 'fixed',
              top: tabContextMenu.y,
              left: tabContextMenu.x,
              zIndex: 2400,
              minWidth: '160px',
              padding: '4px',
              borderRadius: '10px',
            }}
          >
            <button
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '7px 10px',
                background: 'transparent',
                border: 'none',
                borderRadius: '8px',
                color: 'var(--color-text-primary)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onClick={() => {
                onToggleSideTerminal(bookmarkTab.id, targetSession.id)
                setTabContextMenu(null)
              }}
            >
              {targetSession.sideTerminalOpen ? '关闭右侧辅助终端' : '打开右侧辅助终端'}
            </button>
          </div>
        )
      })()}

      {/* ── Terminal workspace ── */}
      <div className="workspace">
        {bookmarkTab.sessions.length === 0 ? (
          <div className="terminal-area glass-panel">
            <div className="terminal-inner">
              <div className="empty-session">
                <div className="empty-session-icon">
                  <img
                    src={logoSrc}
                    alt="TinyTerm logo"
                    style={{
                      width: '62%',
                      height: '62%',
                      objectFit: 'contain',
                      opacity: 0.92,
                      filter: 'drop-shadow(0 0 10px rgba(140, 110, 220, 0.18))',
                    }}
                  />
                </div>
                <p>点击 + 新建终端连接</p>
              </div>
            </div>
          </div>
        ) : (
          /*
           * Render ALL sessions for this host simultaneously.
           * Only the active session's terminal-area is visible.
           * This preserves xterm instances across session-tab switches.
           */
          bookmarkTab.sessions.map(session => (
            <div
              key={session.id}
              className="terminal-area glass-panel"
              style={{
                display: session.id === bookmarkTab.activeSessionId ? 'flex' : 'none',
              }}
            >
              <div
                className="terminal-inner"
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  gap: session.sideTerminalOpen ? '6px' : '0',
                }}
              >
                <div style={{ flex: session.sideTerminalOpen ? '1 1 50%' : '1 1 100%', minWidth: 0, minHeight: 0 }}>
                  <TerminalView
                    session={session}
                    isVisible={session.id === bookmarkTab.activeSessionId && isActive}
                  />
                </div>

                {session.sideTerminalOpen && session.sideTerminalSessionId && session.sideTerminalStatus === 'connected' && (
                  <div
                    style={{
                      flex: '1 1 50%',
                      minWidth: 0,
                      minHeight: 0,
                      borderLeft: '1px solid rgba(120, 90, 200, 0.18)',
                      position: 'relative',
                    }}
                  >
                    <button
                      className="session-tab-new"
                      onClick={() => onToggleSideTerminal(bookmarkTab.id, session.id)}
                      title="关闭右侧辅助终端"
                      style={{
                        position: 'absolute',
                        top: '6px',
                        right: '6px',
                        zIndex: 2,
                        background: 'rgba(20, 13, 52, 0.72)',
                      }}
                    >
                      <X size={14} strokeWidth={2.2} />
                    </button>
                    <TerminalView
                      session={session}
                      backendSessionId={session.sideTerminalSessionId}
                      isVisible={session.id === bookmarkTab.activeSessionId && isActive}
                    />
                  </div>
                )}

                {session.sideTerminalOpen && session.sideTerminalStatus === 'connecting' && (
                  <div
                    style={{
                      flex: '1 1 50%',
                      minWidth: 0,
                      minHeight: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'rgba(200, 190, 240, 0.72)',
                      fontSize: '12px',
                      borderLeft: '1px solid rgba(120, 90, 200, 0.18)',
                    }}
                  >
                    正在打开辅助终端...
                  </div>
                )}

                {session.sideTerminalOpen && session.sideTerminalStatus === 'error' && (
                  <div
                    style={{
                      flex: '1 1 50%',
                      minWidth: 0,
                      minHeight: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#ff8f8f',
                      fontSize: '12px',
                      borderLeft: '1px solid rgba(120, 90, 200, 0.18)',
                      padding: '12px',
                      textAlign: 'center',
                    }}
                  >
                    {session.sideTerminalError || '辅助终端打开失败'}
                  </div>
                )}
              </div>

              {session.status === 'connected' && (
                <FileManager
                  session={session}
                  bookmarkTabId={bookmarkTab.id}
                />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
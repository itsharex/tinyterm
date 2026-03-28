import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { TransferProgress, FileInfo, SessionTab } from '../types'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  ChevronUp, ChevronDown, Folder, File as FileIcon2,
  RefreshCw, FolderPlus, Trash2, Pencil, HardDrive,
  ArrowRight, ArrowLeft, Monitor, Server, Eye, EyeOff, X,
} from 'lucide-react'

import { useStore } from '../store'
import './FileManager.css'

interface Props {
  session: SessionTab
  bookmarkTabId: string
}

interface RemoteDeleteStatus {
  path: string
  is_dir: boolean
  success: boolean
  error?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function getFileColor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    txt: '#a0c0e0', md: '#a0c0e0', json: '#f5c842', js: '#f5c842',
    ts: '#4fc3f7', tsx: '#4fc3f7', jsx: '#4fc3f7', py: '#4caf8a',
    rs: '#f4732a', go: '#00bcd4', sh: '#ce93d8', bash: '#ce93d8',
    png: '#e57373', jpg: '#e57373', jpeg: '#e57373', gif: '#e57373',
    svg: '#ffb74d', zip: '#b39ddb', tar: '#b39ddb', gz: '#b39ddb',
    pdf: '#ef5350', html: '#ff8a65', css: '#42a5f5',
  }
  return map[ext] ?? '#7a7a9a'
}

function FileItemIcon({ isDir, name }: { isDir: boolean; name: string }) {
  if (isDir) return <Folder size={14} strokeWidth={1.6} className="fm-item-icon dir" />
  return <FileIcon2 size={14} strokeWidth={1.6} className="fm-item-icon file" style={{ color: getFileColor(name) }} />
}

// ── Context Menu ──────────────────────────────────────────────────────────────

interface CtxMenu { x: number; y: number; file: FileInfo; side: 'local' | 'remote' }
type InlineAction =
  | { type: 'rename'; side: 'local' | 'remote'; file: FileInfo; value: string }
  | { type: 'new-folder'; side: 'local' | 'remote'; value: string }

function ContextMenu({
  menu, onClose, onDelete, onRename, deleteLabel = '删除',
}: {
  menu: CtxMenu
  onClose: () => void
  onDelete: (f: FileInfo, side: 'local' | 'remote') => void
  onRename: (f: FileInfo, side: 'local' | 'remote') => void
  deleteLabel?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  const menuNode = (
    <div
      ref={ref}
      className="fm-ctx-menu glass-panel"
      style={{ position: 'fixed', top: menu.y, left: menu.x, zIndex: 2000 }}
    >
      <div className="fm-ctx-item" onClick={() => { onRename(menu.file, menu.side); onClose() }}>
        <Pencil size={12} strokeWidth={1.8} /> 重命名
      </div>
      <div className="fm-ctx-divider" />
      <div className="fm-ctx-item danger" onClick={() => { onDelete(menu.file, menu.side); onClose() }}>
        <Trash2 size={12} strokeWidth={1.8} /> {deleteLabel}
      </div>
    </div>
  )

  return createPortal(menuNode, document.body)
}

// ── Single Panel ──────────────────────────────────────────────────────────────

interface PanelProps {
  side: 'local' | 'remote'
  title: string
  icon: React.ReactNode
  files: FileInfo[]
  currentPath: string
  loading: boolean
  error?: string
  selectedPaths: Set<string>
  onSelectionChange: (file: FileInfo, mode: 'single' | 'toggle' | 'range') => void
  onNavigate: (path: string) => void
  onGoUp: () => void
  onToggleHidden: () => void
  showHidden: boolean
  disabled?: boolean
  busyLabel?: string
  onRefresh: () => void
  onNewFolder: () => void
  onContextMenu: (e: React.MouseEvent, file: FileInfo) => void
}

function Panel({
  side, title, icon, files, currentPath, loading, error,
  selectedPaths, onSelectionChange, onNavigate, onGoUp, onToggleHidden, showHidden, disabled = false, busyLabel, onRefresh, onNewFolder, onContextMenu,
}: PanelProps) {
  const [editingPath, setEditingPath] = useState(false)
  const [pathInput, setPathInput] = useState(currentPath)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editingPath) setPathInput(currentPath)
  }, [currentPath, editingPath])

  const commitPath = () => {
    setEditingPath(false)
    if (pathInput !== currentPath) onNavigate(pathInput)
  }

  return (
    <div className={`fm-panel fm-panel--${side}${disabled ? ' fm-panel--disabled' : ''}`}>
      {/* Panel header */}
      <div className="fm-panel-header">
        <span className="fm-panel-icon">{icon}</span>
        <span className="fm-panel-title">{title}</span>
        <div className="fm-panel-actions">
          <button
            className="fm-icon-btn"
            onClick={onToggleHidden}
            title={showHidden ? '隐藏隐藏文件' : '显示隐藏文件'}
            disabled={disabled}
          >
            {showHidden
              ? <Eye size={13} strokeWidth={1.8} />
              : <EyeOff size={13} strokeWidth={1.8} />}
          </button>
          <button className="fm-icon-btn" onClick={onRefresh} title="刷新" disabled={disabled}>
            <RefreshCw size={13} strokeWidth={1.8} />
          </button>
          <button className="fm-icon-btn" onClick={onNewFolder} title="新建文件夹" disabled={disabled}>
            <FolderPlus size={13} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* Path bar */}
      <div className="fm-path-bar">
        <button className="fm-icon-btn fm-up-btn" onClick={onGoUp} title="上级目录" disabled={disabled}>
          <ChevronUp size={13} strokeWidth={2.2} />
        </button>
        {editingPath ? (
          <input
            ref={inputRef}
            className="fm-path-input"
            value={pathInput}
            onChange={e => setPathInput(e.target.value)}
            onBlur={commitPath}
            onKeyDown={e => {
              if (e.key === 'Enter') commitPath()
              if (e.key === 'Escape') { setEditingPath(false); setPathInput(currentPath) }
            }}
            disabled={disabled}
            autoFocus
          />
        ) : (
          <div
            className="fm-path-display"
            onClick={() => {
              if (disabled) return
              setEditingPath(true)
              setPathInput(currentPath)
            }}
            title={currentPath}
          >
            {currentPath}
          </div>
        )}
      </div>

      {/* File list */}
      <div className="fm-list">
        {loading ? (
          <div className="fm-status">加载中...</div>
        ) : error ? (
          <div className="fm-status error">{error}</div>
        ) : files.length === 0 ? (
          <div className="fm-status muted">空目录</div>
        ) : (
          files.map(file => {
            const isSelected = selectedPaths.has(file.path)
            return (
              <div
                key={file.path}
                className={`fm-item${isSelected ? ' fm-item--selected' : ''}`}
                onClick={e => {
                  if (disabled) return
                  if (e.shiftKey) onSelectionChange(file, 'range')
                  else if (e.metaKey || e.ctrlKey) onSelectionChange(file, 'toggle')
                  else onSelectionChange(file, 'single')
                }}
                onDoubleClick={() => {
                  if (disabled) return
                  file.is_dir && onNavigate(file.path)
                }}
                onContextMenu={e => {
                  if (disabled) {
                    e.preventDefault()
                    e.stopPropagation()
                    return
                  }
                  e.preventDefault()
                  e.stopPropagation()
                  onContextMenu(e, file)
                }}
              >
                <FileItemIcon isDir={file.is_dir} name={file.name} />
                <span className="fm-item-name">{file.name}</span>
                {!file.is_dir && (
                  <span className="fm-item-size">{formatSize(file.size)}</span>
                )}
              </div>
            )
          })
        )}
      </div>

      {disabled && (
        <div className="fm-panel-overlay">
          <span>{busyLabel || '处理中...'}</span>
        </div>
      )}
    </div>
  )
}

// ── Transfer Queue ─────────────────────────────────────────────────────────────

interface ConfirmDialogAction {
  label: string
  onClick: () => void
  variant?: 'primary' | 'ghost'
}

interface TransferConflictState {
  transferId: string
  direction: 'upload' | 'download'
  fileName: string
  targetPath: string
  remainingPaths: string[]
  applyToAll: boolean
}

interface ConfirmDialogProps {
  title: string
  message: string
  onCancel: () => void
  actions?: ConfirmDialogAction[]
}

function ConfirmDialog({ title, message, onCancel, actions }: ConfirmDialogProps) {
  const resolvedActions = actions && actions.length > 0
    ? actions
    : [
        { label: '取消', onClick: onCancel, variant: 'ghost' as const },
      ]

  return createPortal(
    <div className="modal-overlay" style={{ zIndex: 3000 }}>
      <div className="cf-shell" onClick={e => e.stopPropagation()}>
        <div className="cm-header">
          <div className="cm-header-left">
            <span>{title}</span>
          </div>
        </div>
        <div className="cf-body">
          <p style={{ margin: 0, color: 'var(--color-text-primary)', whiteSpace: 'pre-line' }}>{message}</p>
        </div>
        <div className="cf-footer">
          {resolvedActions.map(action => (
            <button
              key={action.label}
              className={action.variant === 'ghost' ? 'btn-ghost' : 'btn-primary'}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}

function TransferQueue({ transfers, onCancel }: { transfers: TransferProgress[]; onCancel: (transferId: string) => void }) {
  const active = transfers.filter((t: TransferProgress) => t.status !== 'done')
  if (active.length === 0) return null

  // Packed folder transfers keep transferred_bytes so we can distinguish them from plain file transfers.
  const activeFolders = active.filter(t => t.transferred_bytes !== undefined)
  const activeFiles = active.filter(t => t.transferred_bytes === undefined)

  const isFolderOverall = activeFolders.length > 0
  const topTask = isFolderOverall 
    ? activeFolders[0] 
    : (activeFiles.find(t => t.status === 'transferring') || activeFiles[0])

  // If transferring a folder, find which specific internal file is currently flying
  const subTask = isFolderOverall 
    ? activeFiles.find(t => t.status === 'transferring' || t.status === 'pending') 
    : null

  if (!topTask) return null

  const topPercent = topTask.total > 0 ? Math.min(100, Math.round((topTask.transferred / topTask.total) * 100)) : 0

  let topStatusLabel = '传输中'
  if (topTask.status === 'pending') topStatusLabel = '等待中'
  else if (topTask.status === 'error') topStatusLabel = topTask.error === '用户取消' || topTask.error === 'Cancelled' ? '已取消' : '失败'
  else if (topTask.status === 'conflict') topStatusLabel = '冲突'

  // Descriptive badge
  let badgeText = ''
  if (isFolderOverall && activeFiles.length > 0) {
    badgeText = ` 共 ${topTask.total} 项`
  } else if (activeFiles.length > 1) {
    badgeText = ` 剩余 ${activeFiles.length - 1} 项`
  }

  const isErrorState = topTask.status === 'error' || topTask.status === 'conflict'
  const statusText = isErrorState ? topStatusLabel : `${topStatusLabel} ${topPercent}%`
  const errorText = topTask.error && topTask.error !== '用户取消' && topTask.error !== 'Cancelled'
    ? topTask.error
    : null

  return (
    <div className="fm-transfer-queue">
      <div className="fm-transfer-compact">
        <div className="fm-tc-header">
          <span className="fm-tc-icon">
            {topTask.direction === 'upload'
              ? <ArrowRight size={12} strokeWidth={2.5} />
              : <ArrowLeft size={12} strokeWidth={2.5} />}
          </span>
          <span className="fm-tc-filename" title={topTask.error ? `${topTask.file_name}\n${topTask.error}` : topTask.file_name}>
            {topTask.file_name}
          </span>
          {badgeText && <span className="fm-tc-badge">{badgeText}</span>}
          <span className="fm-tc-spacer" />
          <span className="fm-tc-percent" title={topTask.error || statusText}>
            {statusText}
          </span>
          {(topTask.status === 'pending' || topTask.status === 'transferring') && (
            <button
              className="fm-tc-cancel"
              onClick={() => active.forEach(t => onCancel(t.id))}
              title="全部取消"
            >
              <X size={12} strokeWidth={2.5} />
            </button>
          )}
        </div>
        <div className="fm-tc-track">
          <div
            className="fm-tc-fill"
            style={{
              width: `${topPercent}%`,
              background: isErrorState ? 'rgba(220, 50, 50, 0.8)' : 'var(--color-accent)'
            }}
          />
        </div>

        {errorText && (
          <div className="fm-tc-error" title={errorText}>
            {errorText}
          </div>
        )}

        {/* Sub-file if transmitting a folder */}
        {subTask && subTask.file_name !== topTask.file_name && (
          <div style={{ marginTop: 6 }}>
            <div className="fm-tc-header" style={{ opacity: 0.7, marginBottom: 3 }}>
              <span className="fm-tc-icon">
                 <FileIcon2 size={10} strokeWidth={2.5} />
              </span>
              <span className="fm-tc-filename" title={subTask.file_name} style={{ fontSize: 10 }}>
                {subTask.file_name}
              </span>
              <span className="fm-tc-spacer" />
              <span className="fm-tc-percent" style={{ fontSize: 10 }}>
                {subTask.total > 0 ? Math.min(100, Math.round((subTask.transferred / subTask.total) * 100)) : 0}%
              </span>
            </div>
            <div className="fm-tc-track" style={{ height: 3, background: 'rgba(255, 255, 255, 0.05)' }}>
              <div
                className="fm-tc-fill"
                style={{
                  width: `${subTask.total > 0 ? Math.min(100, Math.round((subTask.transferred / subTask.total) * 100)) : 0}%`,
                  background: 'var(--color-accent)',
                  opacity: 0.6
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main FileManager ───────────────────────────────────────────────────────────

interface ConfirmState {
  title: string
  message: string
  actions: ConfirmDialogAction[]
}

export function FileManager({ session, bookmarkTabId }: Props) {
  // Local panel state
  const [localFiles, setLocalFiles] = useState<FileInfo[]>([])
  const [localPath, setLocalPath] = useState(session.localPath || '')
  const [localLoading, setLocalLoading] = useState(false)
  const [localError, setLocalError] = useState<string>()
  const [localDeleting, setLocalDeleting] = useState(false)

  // Remote panel state
  const [remoteFiles, setRemoteFiles] = useState<FileInfo[]>([])
  const [remotePath, setRemotePath] = useState(session.remotePath || '/')
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [remoteError, setRemoteError] = useState<string>()
  const [remoteDeleting, setRemoteDeleting] = useState(false)

  // Hidden files toggle
  const [showLocalHidden, setShowLocalHidden] = useState(false)
  const [showRemoteHidden, setShowRemoteHidden] = useState(false)

  // Selection + drag state
  const [selectedLocalPaths, setSelectedLocalPaths] = useState<string[]>([])
  const [selectedRemotePaths, setSelectedRemotePaths] = useState<string[]>([])
  const [lastSelectedLocalPath, setLastSelectedLocalPath] = useState<string | null>(null)
  const [lastSelectedRemotePath, setLastSelectedRemotePath] = useState<string | null>(null)

  // Context menu / inline actions
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)
  const [inlineAction, setInlineAction] = useState<InlineAction | null>(null)

  // Confirm dialog
  const [confirmDialog, setConfirmDialog] = useState<ConfirmState | null>(null)
  const [transferConflict, setTransferConflict] = useState<TransferConflictState | null>(null)

  const transfers = useStore(s => s.transfers)
  const updateTransfer = useStore(s => s.updateTransfer)
  const toggleFm = useStore(s => s.toggleFm)
  const updateSessionPath = useStore(s => s.updateSessionPath)
  const collapsed = !session.fmOpen

  // Track previous fmOpen to detect false→true edge
  const prevFmOpenRef = useRef<boolean>(!!session.fmOpen)

  // ── Load functions ────────────────────────────────────────────────────────

  const loadLocal = useCallback(async (path: string) => {
    if (!path) return
    setLocalLoading(true)
    setLocalError(undefined)
    try {
      const files = await invoke<FileInfo[]>('list_local_dir', { path })
      setLocalFiles(files)
      setLocalPath(path)
      setSelectedLocalPaths(prev => prev.filter(p => files.some(f => f.path === p)))
    } catch (e: any) {
      setLocalError(String(e))
    } finally {
      setLocalLoading(false)
    }
  }, [])

  const loadRemote = useCallback(async (path: string) => {
    if (!session.sessionId) return
    setRemoteLoading(true)
    setRemoteError(undefined)
    try {
      const files = await invoke<FileInfo[]>('list_remote_dir', { sessionId: session.sessionId, path })
      setRemoteFiles(files)
      setRemotePath(path)
      setSelectedRemotePaths(prev => prev.filter(p => files.some(f => f.path === p)))
    } catch (e: any) {
      const errMsg = String(e)
      const isNoSuchFile = /no such file|SFTP\(2\)/i.test(errMsg)

      if (isNoSuchFile && path !== '/') {
        // The tracked path doesn't exist on the remote — walk up to the
        // nearest existing parent, then fall back to home / root.
        const parent = path.replace(/\/[^/]+\/?$/, '') || '/'
        if (parent !== path) {
          // Try the parent directory first (recursive — will keep walking up)
          setRemoteLoading(false)
          return loadRemote(parent)
        }

        // Parent is also "/" and that failed — try fetching home via backend
        try {
          const home = await invoke<string>('get_remote_cwd', { sessionId: session.sessionId })
          if (home && home !== path) {
            setRemoteLoading(false)
            return loadRemote(home)
          }
        } catch { /* ignore */ }

        // Last resort: try "/"
        if (path !== '/') {
          setRemoteLoading(false)
          return loadRemote('/')
        }
      }

      setRemoteError(errMsg)
    } finally {
      setRemoteLoading(false)
    }
  }, [session.sessionId])

  // Prime panel-level loading state before the first paint after expand so
  // the shell opens immediately and each side renders its own loading state.
  useLayoutEffect(() => {
    if (!!session.fmOpen && !prevFmOpenRef.current) {
      setLocalLoading(true)
      if (session.sessionId && session.status === 'connected') {
        setRemoteLoading(true)
      }
    }
  }, [session.fmOpen, session.sessionId, session.status])

  // Load when file manager is opened — triggers every time fmOpen goes false→true
  useEffect(() => {
    const isOpen = !!session.fmOpen
    const wasOpen = prevFmOpenRef.current
    prevFmOpenRef.current = isOpen

    if (!isOpen) {
      return
    }

    // Only act on the rising edge (closed → opened)
    if (wasOpen) return

    const localPromise = localPath
      ? loadLocal(localPath)
      : import('@tauri-apps/api/path').then(m => m.homeDir()).then(h => loadLocal(h)).catch(() => loadLocal('/'))

    let remotePromise: Promise<unknown> = Promise.resolve()

    // Remote panel — two-phase open:
    //
    // Phase 1 (instant): load the last-known path immediately so the panel
    //   shows content right away with no blank loading screen.
    //
    // Phase 2 (background): ask the backend for the *real* pwd via an exec
    //   channel reading /proc/<pid>/cwd of the live PTY shell.  If the real
    //   pwd differs from what we already loaded, navigate there automatically.
    //   This corrects timing gaps in client-side cd tracking (e.g. a "cd"
    //   done within the first 800 ms before get_remote_cwd initialised
    //   homePathRef, or any cd the tracker simply missed).
    if (session.sessionId && session.status === 'connected') {
      const knownPath = session.terminalPath || remotePath || '/'
      remotePromise = loadRemote(knownPath)
        .then(() => invoke<string>('get_remote_cwd', { sessionId: session.sessionId }))
        .then(realCwd => {
          if (!realCwd) return
          updateSessionPath(bookmarkTabId, session.id, realCwd)
          if (realCwd !== knownPath) {
            return loadRemote(realCwd)
          }
        })
        .catch(() => { /* non-Linux or exec failed — phase 1 result is fine */ })
    }

    Promise.allSettled([localPromise, remotePromise]).catch(() => {})
  }, [session.fmOpen])

  // Live-follow: when the file manager is already open and the user cds in the
  // terminal, navigate the remote panel to the new directory automatically.
  // (The on-open sync above already handles the "just expanded" case via
  // get_remote_cwd, so this is only for navigation while FM stays open.)
  useEffect(() => {
    if (!session.terminalPath || collapsed || !session.sessionId) return
    if (session.terminalPath !== remotePath) {
      loadRemote(session.terminalPath)
    }
  }, [session.terminalPath])

  // ── Navigation helpers ────────────────────────────────────────────────────

  const goLocalUp = () => {
    const parts = localPath.replace(/\/$/, '').split('/')
    loadLocal(parts.slice(0, -1).join('/') || '/')
  }

  const goRemoteUp = () => {
    const parts = remotePath.replace(/\/$/, '').split('/')
    loadRemote(parts.slice(0, -1).join('/') || '/')
  }

  const joinPath = (dir: string, name: string) =>
    `${dir.replace(/\/$/, '')}/${name}`

  const shellQuote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`

  const selectedLocalPathSet = useMemo(() => new Set(selectedLocalPaths), [selectedLocalPaths])
  const selectedRemotePathSet = useMemo(() => new Set(selectedRemotePaths), [selectedRemotePaths])

  const visibleLocalFiles = useMemo(
    () => showLocalHidden ? localFiles : localFiles.filter(file => !file.name.startsWith('.')),
    [localFiles, showLocalHidden],
  )
  const visibleRemoteFiles = useMemo(
    () => showRemoteHidden ? remoteFiles : remoteFiles.filter(file => !file.name.startsWith('.')),
    [remoteFiles, showRemoteHidden],
  )

  const updateSelection = (
    files: FileInfo[],
    target: FileInfo,
    mode: 'single' | 'toggle' | 'range',
    selectedPaths: string[],
    setSelectedPaths: React.Dispatch<React.SetStateAction<string[]>>,
    lastSelectedPath: string | null,
    setLastSelectedPath: React.Dispatch<React.SetStateAction<string | null>>,
  ) => {
    if (mode === 'single') {
      setSelectedPaths([target.path])
      setLastSelectedPath(target.path)
      return
    }

    if (mode === 'toggle') {
      setSelectedPaths(prev => (
        prev.includes(target.path)
          ? prev.filter(path => path !== target.path)
          : [...prev, target.path]
      ))
      setLastSelectedPath(target.path)
      return
    }

    const anchorPath = lastSelectedPath ?? selectedPaths[selectedPaths.length - 1] ?? target.path
    const anchorIndex = files.findIndex(file => file.path === anchorPath)
    const targetIndex = files.findIndex(file => file.path === target.path)
    if (anchorIndex === -1 || targetIndex === -1) {
      setSelectedPaths([target.path])
      setLastSelectedPath(target.path)
      return
    }
    const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
    setSelectedPaths(files.slice(start, end + 1).map(file => file.path))
    setLastSelectedPath(target.path)
  }

  const handleLocalSelectionChange = (file: FileInfo, mode: 'single' | 'toggle' | 'range') => {
    updateSelection(
      visibleLocalFiles,
      file,
      mode,
      selectedLocalPaths,
      setSelectedLocalPaths,
      lastSelectedLocalPath,
      setLastSelectedLocalPath,
    )
  }

  const handleRemoteSelectionChange = (file: FileInfo, mode: 'single' | 'toggle' | 'range') => {
    updateSelection(
      visibleRemoteFiles,
      file,
      mode,
      selectedRemotePaths,
      setSelectedRemotePaths,
      lastSelectedRemotePath,
      setLastSelectedRemotePath,
    )
  }

  // ── Upload (local → remote) ───────────────────────────────────────────────

  type TransferTaskOptions = {
    transferId?: string
    displayName?: string
    progressTotal?: number
    progressStart?: number
    progressSpan?: number
    displayTargetPath?: string
  }

  const startTransferTask = useCallback((
    direction: 'upload' | 'download',
    sourcePath: string,
    targetPath: string,
    overwrite = false,
    options?: TransferTaskOptions,
  ): Promise<{ transferId: string, fileName: string, conflict: boolean, error?: string }> => {
    return new Promise((resolve) => {
      const fileName = options?.displayName ?? sourcePath.split('/').pop() ?? 'file'
      const transferId = options?.transferId ?? `${direction}:${targetPath}`
      const displayTargetPath = options?.displayTargetPath ?? targetPath
      const progressTotal = options?.progressTotal ?? 0
      const progressStart = options?.progressStart ?? 0

      updateTransfer({
        id: transferId,
        file_name: fileName,
        direction,
        total: progressTotal,
        transferred: progressStart,
        status: 'pending',
        target_path: displayTargetPath,
      })

      const unlistenPromise = listen('transfer-progress', (event) => {
        const progress = event.payload as TransferProgress
        if (progress.id !== transferId) return

        if (progress.status === 'done') {
          unlistenPromise.then(unlisten => unlisten())
          resolve({ transferId, fileName, conflict: false })
        } else if (progress.status === 'conflict') {
          unlistenPromise.then(unlisten => unlisten())
          resolve({ transferId, fileName, conflict: true })
        } else if (progress.status === 'error') {
          unlistenPromise.then(unlisten => unlisten())
          resolve({ transferId, fileName, conflict: false, error: progress.error })
        }
      })

      const invokePromise = direction === 'upload'
        ? invoke('upload_file', {
            sessionId: session.sessionId,
            localPath: sourcePath,
            remotePath: targetPath,
            overwrite,
            transferId: options?.transferId,
            displayName: options?.displayName,
            progressTotal: options?.progressTotal,
            progressStart: options?.progressStart,
            progressSpan: options?.progressSpan,
            targetPathOverride: options?.displayTargetPath,
          })
        : invoke('download_file', {
            sessionId: session.sessionId,
            remotePath: sourcePath,
            localPath: targetPath,
            overwrite,
            transferId: options?.transferId,
            displayName: options?.displayName,
            progressTotal: options?.progressTotal,
            progressStart: options?.progressStart,
            progressSpan: options?.progressSpan,
            targetPathOverride: options?.displayTargetPath,
          })

      invokePromise.catch((e) => {
        unlistenPromise.then(unlisten => unlisten())
        const message = String(e)
        if (message.includes('CONFLICT:')) {
          updateTransfer({
            id: transferId,
            file_name: fileName,
            direction,
            total: 0,
            transferred: 0,
            status: 'conflict',
            error: message,
            target_path: displayTargetPath,
            conflict_path: displayTargetPath,
          })
          resolve({ transferId, fileName, conflict: true })
        } else {
          updateTransfer({
            id: transferId,
            file_name: fileName,
            direction,
            total: 0,
            transferred: 0,
            status: 'error',
            error: message,
            target_path: displayTargetPath,
          })
          resolve({ transferId, fileName, conflict: false, error: message })
        }
      })
    })
  }, [session.sessionId, updateTransfer])

  const runUploadQueue = useCallback(async (
    localFilePaths: string[],
    targetRemoteDir: string,
    startIndex = 0,
    overwriteAll = false,
  ) => {
    if (!session.sessionId || localFilePaths.length === 0) return

    if (startIndex === 0) {
      localFilePaths.forEach(p => {
        const fn = p.split('/').pop() ?? 'file'
        const target = joinPath(targetRemoteDir, fn)
        updateTransfer({ id: `upload:${target}`, file_name: fn, direction: 'upload', total: 0, transferred: 0, status: 'pending', target_path: target })
      })
    }

    for (let index = startIndex; index < localFilePaths.length; index += 1) {
      const localFilePath = localFilePaths[index]
      const fileName = localFilePath.split('/').pop() ?? 'file'
      const remoteTarget = joinPath(targetRemoteDir, fileName)
      const transferId = `upload:${remoteTarget}`

      if (useStore.getState().transfers.find(t => t.id === transferId)?.status === 'error') {
        continue // Skip if cancelled
      }

      const result = await startTransferTask('upload', localFilePath, remoteTarget, overwriteAll)
      if (result.conflict) {
        setTransferConflict({
          transferId: result.transferId,
          direction: 'upload',
          fileName,
          targetPath: remoteTarget,
          remainingPaths: localFilePaths.slice(index),
          applyToAll: false,
        })
        return
      }
    }

    await loadRemote(targetRemoteDir)
  }, [session.sessionId, startTransferTask, loadRemote, updateTransfer])

  const runDownloadQueue = useCallback(async (
    remoteFilePaths: string[],
    targetLocalDir: string,
    startIndex = 0,
    overwriteAll = false,
  ) => {
    if (!session.sessionId || remoteFilePaths.length === 0) return

    if (startIndex === 0) {
      remoteFilePaths.forEach(p => {
        const fn = p.split('/').pop() ?? 'file'
        const target = joinPath(targetLocalDir, fn)
        updateTransfer({ id: `download:${target}`, file_name: fn, direction: 'download', total: 0, transferred: 0, status: 'pending', target_path: target })
      })
    }

    for (let index = startIndex; index < remoteFilePaths.length; index += 1) {
      const remoteFilePath = remoteFilePaths[index]
      const fileName = remoteFilePath.split('/').pop() ?? 'file'
      const localTarget = joinPath(targetLocalDir, fileName)
      const transferId = `download:${localTarget}`

      if (useStore.getState().transfers.find(t => t.id === transferId)?.status === 'error') {
        continue // Skip if cancelled
      }

      const result = await startTransferTask('download', remoteFilePath, localTarget, overwriteAll)
      if (result.conflict) {
        setTransferConflict({
          transferId: result.transferId,
          direction: 'download',
          fileName,
          targetPath: localTarget,
          remainingPaths: remoteFilePaths.slice(index),
          applyToAll: false,
        })
        return
      }
    }

    await loadLocal(targetLocalDir)
  }, [session.sessionId, startTransferTask, loadLocal, updateTransfer])

  const waitForStageProgress = useCallback((
    transferId: string,
    expectedProgress: number,
    start: () => Promise<unknown>,
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      let settled = false
      let unlistenFn: null | (() => void) = null

      const finish = (handler: () => void) => {
        if (settled) return
        settled = true
        if (unlistenFn) unlistenFn()
        handler()
      }

      const unlistenPromise = listen<TransferProgress>('transfer-progress', event => {
        const progress = event.payload
        if (progress.id !== transferId) return

        if (progress.status === 'error') {
          finish(() => reject(new Error(progress.error || '阶段任务失败')))
          return
        }

        if ((progress.transferred ?? 0) >= expectedProgress) {
          finish(() => resolve())
        }
      })

      unlistenPromise.then(unlisten => {
        unlistenFn = unlisten
      }).catch(error => {
        finish(() => reject(error))
      })

      start().catch(error => {
        finish(() => reject(error))
      })
    })
  }, [])

  const doUpload = useCallback(async (localItems: FileInfo[], targetRemoteDir: string, overwriteAll = false) => {
    if (!session.sessionId) return

    const { tempDir } = await import('@tauri-apps/api/path')
    const localTmpDir = await tempDir()

    const folderItems = localItems.filter(i => i.is_dir)
    const fileItems = localItems.filter(i => !i.is_dir)

    for (const folder of folderItems) {
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const localSubTmp = joinPath(localTmpDir, `tinyterm-pack-${stamp}`)
      const tmpTarLocal = joinPath(localSubTmp, '.tinyterm-pack.tar')
      const tmpTarRemote = joinPath(targetRemoteDir, `.tinyterm-pack-${stamp}.tar`)
      const remoteTarget = joinPath(targetRemoteDir, folder.name)
      const transferId = `upload:${remoteTarget}`

      updateTransfer({
        id: transferId,
        file_name: folder.name,
        direction: 'upload',
        total: 100,
        transferred: 0,
        transferred_bytes: 0,
        status: 'pending',
        target_path: remoteTarget,
      })

      try {
        await invoke('create_local_dir', { path: localSubTmp })

        await waitForStageProgress(transferId, 20, () => invoke('pack_local_dir', {
          sourceDir: folder.path,
          targetTarPath: tmpTarLocal,
          transferId,
          displayName: folder.name,
          direction: 'upload',
          progressTotal: 100,
          progressStart: 0,
          progressSpan: 20,
          targetPath: remoteTarget,
        }))

        const result = await startTransferTask('upload', tmpTarLocal, tmpTarRemote, true, {
          transferId,
          displayName: folder.name,
          progressTotal: 100,
          progressStart: 20,
          progressSpan: 60,
          displayTargetPath: remoteTarget,
        })
        if (result.error) throw new Error(result.error)

        updateTransfer({
          id: transferId,
          file_name: folder.name,
          direction: 'upload',
          total: 100,
          transferred: 90,
          status: 'transferring',
          target_path: remoteTarget,
        })

        if (overwriteAll) {
          try {
            await invoke('delete_remote', { sessionId: session.sessionId, path: remoteTarget, isDir: true })
          } catch (e) {
            console.warn('Failed to delete remote folder before unpack:', e)
          }
        }

        const tarCmd = overwriteAll
          ? `mkdir -p ${shellQuote(targetRemoteDir)} && tar -xf ${shellQuote(tmpTarRemote)} -C ${shellQuote(targetRemoteDir)}`
          : `mkdir -p ${shellQuote(targetRemoteDir)} && tar -k -xf ${shellQuote(tmpTarRemote)} -C ${shellQuote(targetRemoteDir)}`

        await invoke('execute_remote_command', {
          sessionId: session.sessionId,
          command: tarCmd,
        })

        updateTransfer({
          id: transferId,
          file_name: folder.name,
          direction: 'upload',
          total: 100,
          transferred: 100,
          status: 'done',
          target_path: remoteTarget,
        })
      } catch (e) {
        updateTransfer({
          id: transferId,
          file_name: folder.name,
          direction: 'upload',
          total: 100,
          transferred: 0,
          status: 'error',
          error: String(e),
          target_path: remoteTarget,
        })
      } finally {
        await invoke('execute_remote_command', {
          sessionId: session.sessionId,
          command: `rm -f ${shellQuote(tmpTarRemote)}`,
        }).catch(() => {})
        await invoke('delete_local', { path: tmpTarLocal, isDir: false }).catch(() => {})
        await invoke('delete_local', { path: localSubTmp, isDir: true }).catch(() => {})
      }
    }

    if (fileItems.length > 0) {
      await runUploadQueue(fileItems.map(i => i.path), targetRemoteDir, 0, overwriteAll)
    } else {
      await loadRemote(targetRemoteDir)
    }
  }, [session.sessionId, joinPath, updateTransfer, runUploadQueue, loadRemote, shellQuote, waitForStageProgress])

  // ── Download (remote → local) ─────────────────────────────────────────────

  const doDownload = useCallback(async (remoteItems: FileInfo[], targetLocalDir: string, overwriteAll = false) => {
    if (!session.sessionId) return

    const { tempDir } = await import('@tauri-apps/api/path')
    const localTmpDir = await tempDir()

    const folderItems = remoteItems.filter(i => i.is_dir)
    const fileItems = remoteItems.filter(i => !i.is_dir)

    for (const folder of folderItems) {
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const localSubTmp = joinPath(localTmpDir, `tinyterm-pack-${stamp}`)
      const tmpTarLocal = joinPath(localSubTmp, '.tinyterm-pack.tar')
      const remoteParent = folder.path.substring(0, folder.path.lastIndexOf('/')) || '/'
      const tmpTarRemote = joinPath(remoteParent, `.tinyterm-pack-${stamp}.tar`)
      const localTarget = joinPath(targetLocalDir, folder.name)
      const transferId = `download:${localTarget}`

      updateTransfer({
        id: transferId,
        file_name: folder.name,
        direction: 'download',
        total: 100,
        transferred: 0,
        transferred_bytes: 0,
        status: 'pending',
        target_path: localTarget,
      })

      try {
        await invoke('create_local_dir', { path: localSubTmp })

        updateTransfer({
          id: transferId,
          file_name: folder.name,
          direction: 'download',
          total: 100,
          transferred: 10,
          status: 'transferring',
          target_path: localTarget,
        })

        const packCmd = `tar -cf ${shellQuote(tmpTarRemote)} -C ${shellQuote(remoteParent)} ${shellQuote(folder.name)}`
        await invoke('execute_remote_command', {
          sessionId: session.sessionId,
          command: packCmd,
        })

        updateTransfer({
          id: transferId,
          file_name: folder.name,
          direction: 'download',
          total: 100,
          transferred: 20,
          status: 'transferring',
          target_path: localTarget,
        })

        const result = await startTransferTask('download', tmpTarRemote, tmpTarLocal, true, {
          transferId,
          displayName: folder.name,
          progressTotal: 100,
          progressStart: 20,
          progressSpan: 60,
          displayTargetPath: localTarget,
        })
        if (result.error) throw new Error(result.error)

        if (overwriteAll) {
          try {
            await invoke('delete_local', { path: localTarget, isDir: true })
          } catch (e) {
            console.warn('Failed to delete local folder before unpack:', e)
          }
        }

        await waitForStageProgress(transferId, 100, () => invoke('unpack_local_dir', {
          tarPath: tmpTarLocal,
          targetDir: targetLocalDir,
          overwrite: overwriteAll,
          transferId,
          displayName: folder.name,
          direction: 'download',
          progressTotal: 100,
          progressStart: 80,
          progressSpan: 20,
          targetPath: localTarget,
        }))

        updateTransfer({
          id: transferId,
          file_name: folder.name,
          direction: 'download',
          total: 100,
          transferred: 100,
          status: 'done',
          target_path: localTarget,
        })
      } catch (e) {
        updateTransfer({
          id: transferId,
          file_name: folder.name,
          direction: 'download',
          total: 100,
          transferred: 0,
          status: 'error',
          error: String(e),
          target_path: localTarget,
        })
      } finally {
        await invoke('execute_remote_command', {
          sessionId: session.sessionId,
          command: `rm -f ${shellQuote(tmpTarRemote)}`,
        }).catch(() => {})
        await invoke('delete_local', { path: tmpTarLocal, isDir: false }).catch(() => {})
        await invoke('delete_local', { path: localSubTmp, isDir: true }).catch(() => {})
      }
    }

    if (fileItems.length > 0) {
      await runDownloadQueue(fileItems.map(i => i.path), targetLocalDir, 0, overwriteAll)
    } else {
      await loadLocal(targetLocalDir)
    }
  }, [session.sessionId, joinPath, updateTransfer, runDownloadQueue, loadLocal, shellQuote, waitForStageProgress])

  // ── Arrow button transfers ────────────────────────────────────────────────

  const selectedLocalTransferItems = visibleLocalFiles
    .filter(item => selectedLocalPathSet.has(item.path))

  // Include both files AND directories so folders can be downloaded
  const selectedRemoteItems = visibleRemoteFiles
    .filter(item => selectedRemotePathSet.has(item.path))

  const handleTransferToRemote = () => {
    if (localDeleting || remoteDeleting) return

    if (selectedLocalTransferItems.length === 0) {
      alert('请先在本地面板选择要上传的文件或文件夹')
      return
    }

    const folderConflicts = selectedLocalTransferItems.filter(localItem =>
      localItem.is_dir && visibleRemoteFiles.some(remoteItem => remoteItem.name === localItem.name)
    )

    if (folderConflicts.length > 0) {
      const conflictNames = folderConflicts.map(c => c.name).join(', ')
      setConfirmDialog({
        title: '文件夹合并/覆盖确认',
        message: `目标目录中已存在 ${folderConflicts.length} 个同名文件夹（如：${conflictNames.slice(0, 50)}${conflictNames.length > 50 ? '...' : ''}）。\n继续上传将合并目录。若遇到同名文件，请选择处理方式：`,
        actions: [
          {
            label: '取消',
            variant: 'ghost',
            onClick: () => setConfirmDialog(null),
          },
          {
            label: '跳过现有文件',
            variant: 'primary',
            onClick: () => {
              setConfirmDialog(null)
              void doUpload(selectedLocalTransferItems, remotePath, false)
            },
          },
          {
            label: '全部覆盖',
            variant: 'primary',
            onClick: () => {
              setConfirmDialog(null)
              void doUpload(selectedLocalTransferItems, remotePath, true)
            },
          },
        ],
      })
      return
    }

    const fileConflicts = selectedLocalTransferItems.filter(localItem =>
      !localItem.is_dir && visibleRemoteFiles.some(remoteItem => remoteItem.name === localItem.name)
    )

    if (fileConflicts.length > 0) {
      const conflictNames = fileConflicts.map(c => c.name).join(', ')
      setConfirmDialog({
        title: '文件覆盖确认',
        message: `目标目录中已存在 ${fileConflicts.length} 个同名文件（如：${conflictNames.slice(0, 50)}${conflictNames.length > 50 ? '...' : ''}）。\n请选择处理方式：`,
        actions: [
          {
            label: '取消',
            variant: 'ghost',
            onClick: () => setConfirmDialog(null),
          },
          {
            label: '逐个询问',
            variant: 'primary',
            onClick: () => {
              setConfirmDialog(null)
              void doUpload(selectedLocalTransferItems, remotePath, false)
            },
          },
          {
            label: '全部覆盖',
            variant: 'primary',
            onClick: () => {
              setConfirmDialog(null)
              void doUpload(selectedLocalTransferItems, remotePath, true)
            },
          },
        ],
      })
      return
    }

    const itemCount = selectedLocalTransferItems.length
    const itemNames = selectedLocalTransferItems.map(p => p.name).join(', ')
    const hasFolder = selectedLocalTransferItems.some(i => i.is_dir)
    const typeLabel = hasFolder ? '个项目' : '个文件'
    setConfirmDialog({
      title: '确认上传',
      message: `确定上传 ${itemCount} ${typeLabel}到远程目录？\n${itemNames.length > 100 ? itemNames.slice(0, 100) + '...' : itemNames}`,
      actions: [
        {
          label: '取消',
          variant: 'ghost',
          onClick: () => setConfirmDialog(null),
        },
        {
          label: '开始上传',
          variant: 'primary',
          onClick: () => {
            setConfirmDialog(null)
            void doUpload(selectedLocalTransferItems, remotePath, false)
          },
        },
      ],
    })
  }

  const handleTransferToLocal = () => {
    if (localDeleting || remoteDeleting) return

    if (selectedRemoteItems.length === 0) {
      alert('请先在远程面板选择要下载的文件或文件夹')
      return
    }

    const folderConflicts = selectedRemoteItems.filter(remoteItem =>
      remoteItem.is_dir && visibleLocalFiles.some(localItem => localItem.name === remoteItem.name)
    )

    if (folderConflicts.length > 0) {
      const conflictNames = folderConflicts.map(c => c.name).join(', ')
      setConfirmDialog({
        title: '文件夹合并/覆盖确认',
        message: `目标目录中已存在 ${folderConflicts.length} 个同名文件夹（如：${conflictNames.slice(0, 50)}${conflictNames.length > 50 ? '...' : ''}）。\n继续下载将合并目录。若遇到同名文件，请选择处理方式：`,
        actions: [
          {
            label: '取消',
            variant: 'ghost',
            onClick: () => setConfirmDialog(null),
          },
          {
            label: '跳过现有文件',
            variant: 'primary',
            onClick: () => {
              setConfirmDialog(null)
              void doDownload(selectedRemoteItems, localPath, false)
            },
          },
          {
            label: '全部覆盖',
            variant: 'primary',
            onClick: () => {
              setConfirmDialog(null)
              void doDownload(selectedRemoteItems, localPath, true)
            },
          },
        ],
      })
      return
    }

    const fileConflicts = selectedRemoteItems.filter(remoteItem =>
      !remoteItem.is_dir && visibleLocalFiles.some(localItem => localItem.name === remoteItem.name)
    )

    if (fileConflicts.length > 0) {
      // For files, we can also offer an upfront 'overwrite all' to save time, or let it fall through to the individual queue
      const conflictNames = fileConflicts.map(c => c.name).join(', ')
      setConfirmDialog({
        title: '文件覆盖确认',
        message: `目标目录中已存在 ${fileConflicts.length} 个同名文件（如：${conflictNames.slice(0, 50)}${conflictNames.length > 50 ? '...' : ''}）。\n请选择处理方式：`,
        actions: [
          {
            label: '取消',
            variant: 'ghost',
            onClick: () => setConfirmDialog(null),
          },
          {
            label: '逐个询问',
            variant: 'primary',
            onClick: () => {
              setConfirmDialog(null)
              void doDownload(selectedRemoteItems, localPath, false)
            },
          },
          {
            label: '全部覆盖',
            variant: 'primary',
            onClick: () => {
              setConfirmDialog(null)
              void doDownload(selectedRemoteItems, localPath, true)
            },
          },
        ],
      })
      return
    }

    const itemCount = selectedRemoteItems.length
    const itemNames = selectedRemoteItems.map(p => p.name).join(', ')
    const hasFolder = selectedRemoteItems.some(i => i.is_dir)
    const typeLabel = hasFolder ? '个项目' : '个文件'
    setConfirmDialog({
      title: '确认下载',
      message: `确定下载 ${itemCount} ${typeLabel}到本地目录？\n${itemNames.length > 100 ? itemNames.slice(0, 100) + '...' : itemNames}`,
      actions: [
        {
          label: '取消',
          variant: 'ghost',
          onClick: () => setConfirmDialog(null),
        },
        {
          label: '开始下载',
          variant: 'primary',
          onClick: () => {
            setConfirmDialog(null)
            void doDownload(selectedRemoteItems, localPath, false)
          },
        },
      ],
    })
  }

  const handleCancelTransfer = async (transferId: string) => {
    const activeTransfer = transfers.find(t => t.id === transferId)
    if (!activeTransfer) return

    try {
      await invoke('cancel_transfer', { transferId })
    } catch (e) {
      console.warn('Failed to cancel transfer on backend:', e)
    }

    updateTransfer({
      id: transferId,
      file_name: activeTransfer.file_name,
      direction: activeTransfer.direction,
      total: activeTransfer.total ?? 0,
      transferred: activeTransfer.transferred ?? 0,
      status: 'error',
      error: '用户取消',
      target_path: activeTransfer.target_path,
    })

    // Remove the transfer after 2 seconds based on user request "点击取消，隔2秒就消失"
    setTimeout(() => {
      updateTransfer({
        id: transferId,
        file_name: activeTransfer.file_name,
        direction: activeTransfer.direction,
        total: activeTransfer.total ?? 0,
        transferred: activeTransfer.transferred ?? 0,
        status: 'done'
      })
    }, 2000)
  }

  const handleConflictSkip = async () => {
    if (!transferConflict) return

    updateTransfer({
      id: transferConflict.transferId,
      file_name: transferConflict.fileName,
      direction: transferConflict.direction,
      total: 0,
      transferred: 0,
      status: 'error',
      error: '已跳过',
      target_path: transferConflict.targetPath,
      conflict_path: transferConflict.targetPath,
    })

    const remaining = transferConflict.remainingPaths.slice(1)
    const direction = transferConflict.direction
    const targetPath = transferConflict.targetPath
    setTransferConflict(null)

    if (remaining.length === 0) {
      if (direction === 'upload') await loadRemote(remotePath)
      else await loadLocal(localPath)
      return
    }

    if (direction === 'upload') {
      await runUploadQueue(remaining, remotePath)
    } else {
      await runDownloadQueue(remaining, localPath)
    }

    if (targetPath) {
      if (direction === 'upload') await loadRemote(remotePath)
      else await loadLocal(localPath)
    }
  }

  const handleConflictOverwrite = async () => {
    if (!transferConflict) return

    const { direction, remainingPaths, targetPath } = transferConflict
    // remainingPaths[0] is the source of the conflicted file
    const sourcePath = remainingPaths[0]
    const remaining = remainingPaths.slice(1)

    setTransferConflict(null)

    // Re-run the same transfer with overwrite=true — backend will skip conflict check
    await startTransferTask(direction, sourcePath, targetPath, true)

    if (remaining.length === 0) {
      if (direction === 'upload') await loadRemote(remotePath)
      else await loadLocal(localPath)
      return
    }

    if (direction === 'upload') {
      await runUploadQueue(remaining, remotePath)
    } else {
      await runDownloadQueue(remaining, localPath)
    }
  }

  // ── CRUD operations ───────────────────────────────────────────────────────

  const handleDelete = async (file: FileInfo, side: 'local' | 'remote') => {
    if (side === 'local' ? localDeleting : remoteDeleting) return

    const selectedPaths = side === 'local' ? selectedLocalPaths : selectedRemotePaths
    const visibleFiles = side === 'local' ? visibleLocalFiles : visibleRemoteFiles
    const selectedSet = new Set(selectedPaths)
    const selectedItems = selectedSet.has(file.path)
      ? visibleFiles.filter(item => selectedSet.has(item.path))
      : [file]

    const label = selectedItems.length === 1
      ? `"${selectedItems[0].name}"`
      : `${selectedItems.length} 项`

    if (!confirm(`确认删除 ${label} ?`)) return

    try {
      if (side === 'local') setLocalDeleting(true)
      else setRemoteDeleting(true)

      const waitForRemoteDelete = (path: string, isDir: boolean) => new Promise<void>((resolve, reject) => {
        let settled = false
        let unlistenFn: null | (() => void) = null

        const finish = (handler: () => void) => {
          if (settled) return
          settled = true
          if (unlistenFn) unlistenFn()
          handler()
        }

        const unlistenPromise = listen<RemoteDeleteStatus>('remote-delete-status', event => {
          const payload = event.payload
          if (payload.path !== path || payload.is_dir !== isDir) return

          if (payload.success) {
            finish(() => resolve())
          } else {
            finish(() => reject(new Error(payload.error || '远端删除失败')))
          }
        })

        unlistenPromise.then(unlisten => {
          unlistenFn = unlisten
        }).catch(error => finish(() => reject(error)))

        invoke('delete_remote_async', { sessionId: session.sessionId, path, isDir })
          .catch(error => finish(() => reject(error)))
      })

      for (const item of selectedItems) {
        if (side === 'local') {
          await invoke('delete_local', { path: item.path, isDir: item.is_dir })
        } else {
          await waitForRemoteDelete(item.path, item.is_dir)
        }
      }

      if (side === 'local') {
        setSelectedLocalPaths([])
        setLastSelectedLocalPath(null)
        loadLocal(localPath)
      } else {
        setSelectedRemotePaths([])
        setLastSelectedRemotePath(null)
        loadRemote(remotePath)
      }
    } catch (e) { alert('删除失败: ' + String(e)) }
    finally {
      if (side === 'local') setLocalDeleting(false)
      else setRemoteDeleting(false)
    }
  }

  const handleRename = async (file: FileInfo, side: 'local' | 'remote') => {
    setCtxMenu(null)
    setInlineAction({ type: 'rename', side, file, value: file.name })
  }

  const handleNewFolder = async (side: 'local' | 'remote') => {
    if ((side === 'local' && localDeleting) || (side === 'remote' && remoteDeleting)) return

    setCtxMenu(null)
    setInlineAction({ type: 'new-folder', side, value: '' })
  }

  const cancelInlineAction = () => setInlineAction(null)

  const submitInlineAction = async () => {
    if (!inlineAction) return

    const rawValue = inlineAction.value.trim()
    if (!rawValue) {
      alert(inlineAction.type === 'rename' ? '请输入新名称' : '请输入文件夹名称')
      return
    }

    try {
      if (inlineAction.type === 'rename') {
        const { file, side } = inlineAction
        if (rawValue === file.name) {
          setInlineAction(null)
          return
        }
        const dir = file.path.substring(0, file.path.lastIndexOf('/') + 1)
        const newPath = dir + rawValue

        if (side === 'local') {
          await invoke('rename_local', { oldPath: file.path, newPath })
          setInlineAction(null)
          loadLocal(localPath)
        } else {
          await invoke('rename_remote', { sessionId: session.sessionId, oldPath: file.path, newPath })
          setInlineAction(null)
          loadRemote(remotePath)
        }
        return
      }

      if (inlineAction.side === 'local') {
        await invoke('create_local_dir', { path: joinPath(localPath, rawValue) })
        setInlineAction(null)
        loadLocal(localPath)
      } else {
        await invoke('create_remote_dir', { sessionId: session.sessionId, path: joinPath(remotePath, rawValue) })
        setInlineAction(null)
        loadRemote(remotePath)
      }
    } catch (e) {
      alert((inlineAction.type === 'rename' ? '重命名失败: ' : '创建失败: ') + String(e))
    }
  }

  const handleInlineActionKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submitInlineAction()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelInlineAction()
    }
  }

  // ── Collapse bar ──────────────────────────────────────────────────────────

  const activeTransfers = transfers.filter(t => t.status !== 'done')
  const uploadBusy = transfers.some(t => t.direction === 'upload' && (t.status === 'pending' || t.status === 'transferring' || t.status === 'conflict'))
  const downloadBusy = transfers.some(t => t.direction === 'download' && (t.status === 'pending' || t.status === 'transferring' || t.status === 'conflict'))

  return (
    <div
      className={`fm-root${collapsed ? ' fm-root--collapsed' : ''}`}
      onClick={() => {
        if (ctxMenu) setCtxMenu(null)
      }}
    >
      {/* Expanded content — rendered BEFORE bar in DOM so column-reverse puts it above */}
      {!collapsed && (
        <div className="fm-content glass-panel">
          {/* Transfer queue */}
          <TransferQueue transfers={transfers} onCancel={handleCancelTransfer} />

          {/* Dual panels */}
          <div className="fm-panels">
            {/* Left — Local */}
            <Panel
              side="local"
              title="本地"
              icon={<Monitor size={13} strokeWidth={1.8} />}
              files={visibleLocalFiles}
              currentPath={localPath}
              loading={localLoading}
              error={localError}
              selectedPaths={selectedLocalPathSet}
              disabled={localDeleting}
              busyLabel="删除中..."
              onSelectionChange={handleLocalSelectionChange}
              onNavigate={loadLocal}
              onGoUp={goLocalUp}
              onToggleHidden={() => setShowLocalHidden(v => !v)}
              showHidden={showLocalHidden}
              onRefresh={() => loadLocal(localPath)}
              onNewFolder={() => handleNewFolder('local')}
              onContextMenu={(e, file) => setCtxMenu({ x: e.clientX, y: e.clientY, file, side: 'local' })}
            />

            {/* Center divider */}
            <div className="fm-divider">
              <div className="fm-divider-line" />
              <div className="fm-divider-arrows">
                <button
                  className={`fm-transfer-btn${uploadBusy ? ' is-loading' : ''}`}
                  onClick={handleTransferToRemote}
                  title={uploadBusy ? '上传中...' : '上传选中文件到远程当前目录'}
                  type="button"
                  disabled={localDeleting || remoteDeleting || uploadBusy}
                >
                  {uploadBusy
                    ? <span className="fm-transfer-spinner" />
                    : <ArrowRight size={14} strokeWidth={2} className="fm-divider-icon" />}
                </button>
                <button
                  className={`fm-transfer-btn${downloadBusy ? ' is-loading' : ''}`}
                  onClick={handleTransferToLocal}
                  title={downloadBusy ? '下载中...' : '下载选中文件到本地当前目录'}
                  type="button"
                  disabled={localDeleting || remoteDeleting || downloadBusy}
                >
                  {downloadBusy
                    ? <span className="fm-transfer-spinner" />
                    : <ArrowLeft size={14} strokeWidth={2} className="fm-divider-icon" />}
                </button>
              </div>
              <div className="fm-divider-line" />
            </div>

            {/* Right — Remote */}
            <Panel
              side="remote"
              title="远程"
              icon={<Server size={13} strokeWidth={1.8} />}
              files={visibleRemoteFiles}
              currentPath={remotePath}
              loading={remoteLoading}
              error={remoteError}
              selectedPaths={selectedRemotePathSet}
              disabled={remoteDeleting}
              busyLabel="删除中..."
              onSelectionChange={handleRemoteSelectionChange}
              onNavigate={loadRemote}
              onGoUp={goRemoteUp}
              onToggleHidden={() => setShowRemoteHidden(v => !v)}
              showHidden={showRemoteHidden}
              onRefresh={() => loadRemote(remotePath)}
              onNewFolder={() => handleNewFolder('remote')}
              onContextMenu={(e, file) => setCtxMenu({ x: e.clientX, y: e.clientY, file, side: 'remote' })}
            />
          </div>
        </div>
      )}

      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          actions={confirmDialog.actions}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {transferConflict && (
        <ConfirmDialog
          title="检测到同名目标"
          message={`目标中已存在同名项：${transferConflict.fileName}\n${transferConflict.targetPath}\n\n请选择如何处理当前冲突项。`}
          actions={[
            {
              label: '取消剩余传输',
              variant: 'ghost',
              onClick: () => {
                setTransferConflict(null)
              },
            },
            {
              label: '跳过当前项',
              variant: 'primary',
              onClick: () => {
                void handleConflictSkip()
              },
            },
            {
              label: '覆盖当前项',
              variant: 'primary',
              onClick: () => { void handleConflictOverwrite() },
            },
          ]}
          onCancel={() => setTransferConflict(null)}
        />
      )}

      {inlineAction && (
        <div className="modal-overlay" style={{ zIndex: 2100 }}>
          <div className="cf-shell" onClick={e => e.stopPropagation()}>
            <div className="cm-header">
              <div className="cm-header-left">
                <span>
                  {inlineAction.type === 'rename'
                    ? `重命名${inlineAction.file.is_dir ? '文件夹' : '文件'}`
                    : '新建文件夹'}
                </span>
              </div>
            </div>
            <div className="cf-body">
              <div className="cf-field full">
                <label className="cf-label">
                  {inlineAction.type === 'rename' ? '名称' : '文件夹名称'}
                </label>
                <input
                  className="form-input"
                  value={inlineAction.value}
                  onChange={e => setInlineAction(action => action ? { ...action, value: e.target.value } : action)}
                  onKeyDown={handleInlineActionKeyDown}
                  autoFocus
                />
              </div>
            </div>
            <div className="cf-footer">
              <button className="btn-ghost" onClick={cancelInlineAction}>取消</button>
              <button className="btn-primary" onClick={submitInlineAction}>
                {inlineAction.type === 'rename' ? '确定重命名' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Collapse handle — sits at the bottom due to column-reverse */}
      <div className="fm-bar" onClick={() => toggleFm(bookmarkTabId, session.id)}>
        {collapsed
          ? <ChevronDown size={12} strokeWidth={2.2} className="fm-bar-arrow" />
          : <ChevronUp size={12} strokeWidth={2.2} className="fm-bar-arrow" />}
        <HardDrive size={12} strokeWidth={1.8} className="fm-bar-icon" />
        <span className="fm-bar-title">文件管理</span>
        {activeTransfers.length > 0 && (
          <span className="fm-bar-badge">{activeTransfers.length}</span>
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          menu={ctxMenu}
          onClose={() => setCtxMenu(null)}
          onDelete={handleDelete}
          onRename={handleRename}
          deleteLabel={
            (() => {
              const selectedPaths = ctxMenu.side === 'local' ? selectedLocalPaths : selectedRemotePaths
              const count = selectedPaths.includes(ctxMenu.file.path) ? selectedPaths.length : 1
              return count > 1 ? `删除 ${count} 项` : '删除'
            })()
          }
        />
      )}
    </div>
  )
}

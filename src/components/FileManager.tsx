import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { TransferProgress } from '../types'
import { invoke } from '@tauri-apps/api/core'
import {
  ChevronUp, ChevronDown, Folder, File as FileIcon2,
  RefreshCw, FolderPlus, Trash2, Pencil, HardDrive,
  ArrowRight, ArrowLeft, Monitor, Server, Eye, EyeOff, X,
} from 'lucide-react'
import type { FileInfo, SessionTab } from '../types'
import { useStore } from '../store'
import './FileManager.css'

interface Props {
  session: SessionTab
  bookmarkTabId: string
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
  onRefresh: () => void
  onNewFolder: () => void
  onContextMenu: (e: React.MouseEvent, file: FileInfo) => void
}

function Panel({
  side: _side, title, icon, files, currentPath, loading, error,
  selectedPaths, onSelectionChange, onNavigate, onGoUp, onToggleHidden, showHidden, onRefresh, onNewFolder, onContextMenu,
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
    <div className="fm-panel">
      {/* Panel header */}
      <div className="fm-panel-header">
        <span className="fm-panel-icon">{icon}</span>
        <span className="fm-panel-title">{title}</span>
        <div className="fm-panel-actions">
          <button
            className="fm-icon-btn"
            onClick={onToggleHidden}
            title={showHidden ? '隐藏隐藏文件' : '显示隐藏文件'}
          >
            {showHidden
              ? <Eye size={13} strokeWidth={1.8} />
              : <EyeOff size={13} strokeWidth={1.8} />}
          </button>
          <button className="fm-icon-btn" onClick={onRefresh} title="刷新">
            <RefreshCw size={13} strokeWidth={1.8} />
          </button>
          <button className="fm-icon-btn" onClick={onNewFolder} title="新建文件夹">
            <FolderPlus size={13} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* Path bar */}
      <div className="fm-path-bar">
        <button className="fm-icon-btn fm-up-btn" onClick={onGoUp} title="上级目录">
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
            autoFocus
          />
        ) : (
          <div
            className="fm-path-display"
            onClick={() => { setEditingPath(true); setPathInput(currentPath) }}
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
                  if (e.shiftKey) onSelectionChange(file, 'range')
                  else if (e.metaKey || e.ctrlKey) onSelectionChange(file, 'toggle')
                  else onSelectionChange(file, 'single')
                }}
                onDoubleClick={() => file.is_dir && onNavigate(file.path)}
                onContextMenu={e => {
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
    </div>
  )
}

// ── Transfer Queue ─────────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDialog({ title, message, onConfirm, onCancel }: ConfirmDialogProps) {
  return createPortal(
    <div className="modal-overlay" style={{ zIndex: 3000 }}>
      <div className="cf-shell" onClick={e => e.stopPropagation()}>
        <div className="cm-header">
          <div className="cm-header-left">
            <span>{title}</span>
          </div>
        </div>
        <div className="cf-body">
          <p style={{ margin: 0, color: 'var(--color-text-primary)' }}>{message}</p>
        </div>
        <div className="cf-footer">
          <button className="btn-ghost" onClick={onCancel}>取消</button>
          <button className="btn-primary" onClick={onConfirm}>确定</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function TransferQueue({ transfers, onCancel }: { transfers: TransferProgress[]; onCancel: (fileName: string) => void }) {
  const active = transfers.filter((t: TransferProgress) => t.status !== 'done')
  if (active.length === 0) return null
  return (
    <div className="fm-transfer-queue">
      {active.map(t => (
        <div key={t.file_name} className="fm-transfer-row">
          <span className="fm-transfer-dir-icon">
            {t.direction === 'upload'
              ? <ArrowRight size={11} strokeWidth={2.5} />
              : <ArrowLeft size={11} strokeWidth={2.5} />}
          </span>
          <span className="fm-transfer-name">{t.file_name}</span>
          <div className="fm-transfer-track">
            <div
              className="fm-transfer-fill"
              style={{ width: `${t.total ? Math.round((t.transferred / t.total) * 100) : 0}%` }}
            />
          </div>
          <span className="fm-transfer-pct">
            {t.total ? Math.round((t.transferred / t.total) * 100) : 0}%
          </span>
          {t.status === 'transferring' && (
            <button
              className="fm-transfer-cancel"
              onClick={() => onCancel(t.file_name)}
              title="取消"
            >
              <X size={12} strokeWidth={2} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main FileManager ───────────────────────────────────────────────────────────

interface ConfirmState {
  title: string
  message: string
  onConfirm: () => void
}

export function FileManager({ session, bookmarkTabId }: Props) {
  // Local panel state
  const [localFiles, setLocalFiles] = useState<FileInfo[]>([])
  const [localPath, setLocalPath] = useState(session.localPath || '')
  const [localLoading, setLocalLoading] = useState(false)
  const [localError, setLocalError] = useState<string>()

  // Remote panel state
  const [remoteFiles, setRemoteFiles] = useState<FileInfo[]>([])
  const [remotePath, setRemotePath] = useState(session.remotePath || '/')
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [remoteError, setRemoteError] = useState<string>()

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

  // Load when file manager is opened — triggers every time fmOpen goes false→true
  useEffect(() => {
    const isOpen = !!session.fmOpen
    const wasOpen = prevFmOpenRef.current
    prevFmOpenRef.current = isOpen

    // Only act on the rising edge (closed → opened)
    if (!isOpen || wasOpen) return

    // Local panel: restore last path or fall back to home dir
    if (localPath) {
      loadLocal(localPath)
    } else {
      import('@tauri-apps/api/path').then(m => m.homeDir()).then(h => loadLocal(h)).catch(() => loadLocal('/'))
    }

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
      // Phase 1 — show something immediately
      const knownPath = session.terminalPath || remotePath || '/'
      loadRemote(knownPath)

      // Phase 2 — background sync to real pwd
      invoke<string>('get_remote_cwd', { sessionId: session.sessionId })
        .then(realCwd => {
          if (!realCwd) return
          // Sync the store so TerminalView tracking stays consistent
          updateSessionPath(bookmarkTabId, session.id, realCwd)
          // Only reload if the real pwd differs from what we already loaded
          if (realCwd !== knownPath) {
            loadRemote(realCwd)
          }
        })
        .catch(() => { /* non-Linux or exec failed — phase 1 result is fine */ })
    }
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

  const doUpload = useCallback(async (localFilePaths: string[], targetRemoteDir: string) => {
    console.debug('[tinyterm:fm:upload:start]', {
      sessionId: session.sessionId,
      localFilePaths,
      targetRemoteDir,
    })
    if (!session.sessionId || localFilePaths.length === 0) {
      console.debug('[tinyterm:fm:upload:skip]', {
        reason: !session.sessionId ? 'missing-session-id' : 'empty-file-list',
      })
      return
    }

    // Start transfers as pending
    for (const localFilePath of localFilePaths) {
      const fileName = localFilePath.split('/').pop() ?? 'file'
      updateTransfer({
        file_name: fileName,
        direction: 'upload',
        total: 0,
        transferred: 0,
        status: 'pending',
      })
    }

    try {
      for (const localFilePath of localFilePaths) {
        const fileName = localFilePath.split('/').pop() ?? 'file'
        const remoteTarget = joinPath(targetRemoteDir, fileName)
        console.debug('[tinyterm:fm:upload:file]', {
          localFilePath,
          remoteTarget,
        })
        await invoke('upload_file', {
          sessionId: session.sessionId,
          localPath: localFilePath,
          remotePath: remoteTarget,
        })
      }
      console.debug('[tinyterm:fm:upload:done]', {
        count: localFilePaths.length,
        targetRemoteDir,
      })
      await loadRemote(targetRemoteDir)
    } catch (e) {
      console.error('[tinyterm:fm:upload:error]', e)
      alert('上传失败: ' + String(e))
    }
  }, [session.sessionId, loadRemote, updateTransfer])

  // ── Download (remote → local) ─────────────────────────────────────────────

  const doDownload = useCallback(async (remoteFilePaths: string[], targetLocalDir: string) => {
    console.debug('[tinyterm:fm:download:start]', {
      sessionId: session.sessionId,
      remoteFilePaths,
      targetLocalDir,
    })
    if (!session.sessionId || remoteFilePaths.length === 0) {
      console.debug('[tinyterm:fm:download:skip]', {
        reason: !session.sessionId ? 'missing-session-id' : 'empty-file-list',
      })
      return
    }

    // Start transfers as pending
    for (const remoteFilePath of remoteFilePaths) {
      const fileName = remoteFilePath.split('/').pop() ?? 'file'
      updateTransfer({
        file_name: fileName,
        direction: 'download',
        total: 0,
        transferred: 0,
        status: 'pending',
      })
    }

    try {
      for (const remoteFilePath of remoteFilePaths) {
        const fileName = remoteFilePath.split('/').pop() ?? 'file'
        const localTarget = joinPath(targetLocalDir, fileName)
        console.debug('[tinyterm:fm:download:file]', {
          remoteFilePath,
          localTarget,
        })
        await invoke('download_file', {
          sessionId: session.sessionId,
          remotePath: remoteFilePath,
          localPath: localTarget,
        })
      }
      console.debug('[tinyterm:fm:download:done]', {
        count: remoteFilePaths.length,
        targetLocalDir,
      })
      await loadLocal(targetLocalDir)
    } catch (e) {
      console.error('[tinyterm:fm:download:error]', e)
      alert('下载失败: ' + String(e))
    }
  }, [session.sessionId, loadLocal, updateTransfer])

  // ── Arrow button transfers ────────────────────────────────────────────────

  const selectedLocalTransferPaths = visibleLocalFiles
    .filter(item => selectedLocalPathSet.has(item.path) && !item.is_dir)
    .map(item => item.path)

  const selectedRemoteTransferPaths = visibleRemoteFiles
    .filter(item => selectedRemotePathSet.has(item.path) && !item.is_dir)
    .map(item => item.path)

  const handleTransferToRemote = () => {
    if (selectedLocalTransferPaths.length === 0) {
      alert('请先在本地面板选择要上传的文件')
      return
    }
    const fileCount = selectedLocalTransferPaths.length
    const fileNames = selectedLocalTransferPaths.map(p => p.split('/').pop()).join(', ')
    setConfirmDialog({
      title: '确认上传',
      message: `确定上传 ${fileCount} 个文件到远程目录？\n${fileNames.length > 100 ? fileNames.slice(0, 100) + '...' : fileNames}`,
      onConfirm: () => {
        setConfirmDialog(null)
        doUpload(selectedLocalTransferPaths, remotePath)
      },
    })
  }

  const handleTransferToLocal = () => {
    if (selectedRemoteTransferPaths.length === 0) {
      alert('请先在远程面板选择要下载的文件')
      return
    }
    const fileCount = selectedRemoteTransferPaths.length
    const fileNames = selectedRemoteTransferPaths.map(p => p.split('/').pop()).join(', ')
    setConfirmDialog({
      title: '确认下载',
      message: `确定下载 ${fileCount} 个文件到本地目录？\n${fileNames.length > 100 ? fileNames.slice(0, 100) + '...' : fileNames}`,
      onConfirm: () => {
        setConfirmDialog(null)
        doDownload(selectedRemoteTransferPaths, localPath)
      },
    })
  }

  const handleCancelTransfer = (fileName: string) => {
    // Mark transfer as cancelled - the backend doesn't support cancellation yet
    // but we can at least update the UI state
    updateTransfer({
      file_name: fileName,
      direction: 'upload', // direction doesn't matter for cancellation
      total: 0,
      transferred: 0,
      status: 'error',
      error: '用户取消',
    })
  }

  // ── CRUD operations ───────────────────────────────────────────────────────

  const handleDelete = async (file: FileInfo, side: 'local' | 'remote') => {
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
      for (const item of selectedItems) {
        if (side === 'local') {
          await invoke('delete_local', { path: item.path, isDir: item.is_dir })
        } else {
          await invoke('delete_remote', { sessionId: session.sessionId, path: item.path, isDir: item.is_dir })
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
  }

  const handleRename = async (file: FileInfo, side: 'local' | 'remote') => {
    setCtxMenu(null)
    setInlineAction({ type: 'rename', side, file, value: file.name })
  }

  const handleNewFolder = async (side: 'local' | 'remote') => {
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
                  className="fm-transfer-btn"
                  onClick={handleTransferToRemote}
                  title="上传选中文件到远程当前目录"
                  type="button"
                >
                  <ArrowRight size={14} strokeWidth={2} className="fm-divider-icon" />
                </button>
                <button
                  className="fm-transfer-btn"
                  onClick={handleTransferToLocal}
                  title="下载选中文件到本地当前目录"
                  type="button"
                >
                  <ArrowLeft size={14} strokeWidth={2} className="fm-divider-icon" />
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
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
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
        {!collapsed && (
          <span className="fm-bar-hint">拖拽文件跨面板传输</span>
        )}
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
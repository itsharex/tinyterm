import { useState } from 'react'
import './HostsModal.css'
import {
  X, Plus, PlugZap, Pencil, Trash2, Server, Search, ChevronRight, AlertCircle,
} from 'lucide-react'
import { useStore } from '../store'
import type { Bookmark, Profile } from '../types'

type HostFormData = {
  title: string
  host: string
  port: number
  profile_id: string   // required — must link a Credential
  color: string
  description: string
  start_directory_remote: string
  term: string
  encode: string
  enable_sftp: boolean
  keepalive_interval: number
  // kept for Bookmark compat but always derived from credential
  username: string
  auth_type: 'profile'
  password: string | undefined
  private_key: string | undefined
  passphrase: string | undefined
  group_id: string | undefined
  start_directory_local: string
}

function defaultForm(host?: Bookmark): HostFormData {
  return {
    title: host?.title ?? '',
    host: host?.host ?? '',
    port: host?.port ?? 22,
    profile_id: host?.profile_id ?? '',
    color: host?.color ?? '#7c5cbf',
    description: host?.description ?? '',
    start_directory_remote: host?.start_directory_remote ?? '',
    term: host?.term ?? 'xterm-256color',
    encode: host?.encode ?? 'utf8',
    enable_sftp: host?.enable_sftp ?? true,
    keepalive_interval: host?.keepalive_interval ?? 30000,
    username: host?.username ?? '',
    auth_type: 'profile',
    password: undefined,
    private_key: undefined,
    passphrase: undefined,
    group_id: host?.group_id ?? undefined,
    start_directory_local: host?.start_directory_local ?? '',
  }
}

export function HostsModal() {
  const {
    hostsModalOpen,
    closeHostsModal,
    hosts,
    credentials,
    createBookmark,
    updateBookmark,
    deleteBookmark,
    openHostTab,
    openConfirmDialog,
  } = useStore()

  const [editingHost, setEditingHost] = useState<Bookmark | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [connectingHostId, setConnectingHostId] = useState<string | null>(null)

  if (!hostsModalOpen) return null

  const filtered = filter
    ? hosts.filter(h =>
        (h.title || '').toLowerCase().includes(filter.toLowerCase()) ||
        h.host.toLowerCase().includes(filter.toLowerCase())
      )
    : hosts

  const handleConnect = async (hostId: string) => {
    setConnectingHostId(hostId)
    // 强制让 React 先渲染 loading 状态到 UI 上
    await new Promise(resolve => setTimeout(resolve, 50))
    try {
      await openHostTab(hostId)
    } finally {
      setConnectingHostId(null)
    }
  }

  const handleEdit = (h: Bookmark) => {
    setEditingHost(h)
    setFormOpen(true)
  }

  const handleDelete = async (id: string) => {
    const confirmed = await openConfirmDialog({
      title: '删除 Host',
      message: '确认删除该主机？',
      confirmText: '删除',
      cancelText: '取消',
    })
    if (!confirmed) return
    await deleteBookmark(id)
  }

  const handleSave = async (data: HostFormData) => {
    // Resolve username from credential
    const cred = credentials.find(c => c.id === data.profile_id)
    const resolved: Omit<Bookmark, 'id' | 'created_at' | 'updated_at' | 'password_encrypted'> = {
      ...data,
      username: cred?.username ?? '',
      auth_type: 'profile',
    }
    if (editingHost) {
      await updateBookmark({ ...editingHost, ...resolved, password_encrypted: false })
    } else {
      await createBookmark(resolved)
    }
    setFormOpen(false)
    setEditingHost(null)
  }

  return (
    <div
      className="modal-overlay"
      onClick={e => e.target === e.currentTarget && closeHostsModal()}
    >
      <div className="hm-shell">
        {/* Header */}
        <div className="hm-header">
          <div className="hm-header-left">
            <Server size={18} strokeWidth={1.8} />
            <span>Hosts</span>
          </div>
          <button className="hm-close-btn" onClick={closeHostsModal}>
            <X size={16} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="hm-toolbar">
          <div className="hm-search-wrap">
            <Search size={13} className="hm-search-icon" />
            <input
              className="hm-search-input"
              placeholder="搜索主机名 / IP..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <button
            className="hm-add-btn"
            onClick={() => { setEditingHost(null); setFormOpen(true) }}
            disabled={credentials.length === 0}
            title={credentials.length === 0 ? '请先创建 Credential' : '新建 Host'}
            aria-label="新建 Host"
          >
            <Plus size={15} strokeWidth={2.4} />
          </button>
        </div>

        {credentials.length === 0 && (
          <div className="hm-no-cred-tip">
            <AlertCircle size={14} />
            请先在 <strong>Credentials</strong> 中创建认证配置，再添加 Host
          </div>
        )}

        {/* List */}
        <div className="hm-list">
          {filtered.length === 0 ? (
            <div className="hm-empty">
              {filter ? '未找到匹配主机' : '暂无主机'}
            </div>
          ) : (
            filtered.map(h => {
              const cred = credentials.find(c => c.id === h.profile_id)
              return (
                <HostRow
                  key={h.id}
                  host={h}
                  credential={cred}
                  connecting={connectingHostId === h.id}
                  onConnect={() => handleConnect(h.id)}
                  onEdit={() => handleEdit(h)}
                  onDelete={() => handleDelete(h.id)}
                />
              )
            })
          )}
        </div>
      </div>

      {formOpen && (
        <HostForm
          host={editingHost}
          credentials={credentials}
          onSave={handleSave}
          onCancel={() => { setFormOpen(false); setEditingHost(null) }}
        />
      )}
    </div>
  )
}

// ── Host Row ──────────────────────────────────────────────────────────────────

function HostRow({
  host, credential, connecting, onConnect, onEdit, onDelete,
}: {
  host: Bookmark
  credential?: Profile
  connecting: boolean
  onConnect: () => Promise<void>
  onEdit: () => void
  onDelete: () => void
}) {
  const dot = host.color || '#7c5cbf'

  return (
    <div className="hm-row">
      <span className="hm-row-dot" style={{ background: dot, boxShadow: `0 0 6px ${dot}99` }} />

      <div className="hm-row-info">
        <div className="hm-row-name">{host.title || host.host}</div>
        <div className="hm-row-meta">
          <span className="hm-row-addr">{host.host}:{host.port}</span>
          {credential ? (
            <span className="hm-row-cred-badge">
              {credential.auth_type === 'privateKey' ? 'key' : 'pwd'} · {credential.title}
            </span>
          ) : (
            <span className="hm-row-cred-badge missing">无 Credential</span>
          )}
        </div>
      </div>

      <div className="hm-row-actions">
        <button
          className={`hm-connect-btn${connecting ? ' is-loading' : ''}`}
          onClick={onConnect}
          title="连接"
          aria-label="连接"
          disabled={connecting}
        >
          {connecting ? (
            <span className="hm-connect-spinner" />
          ) : (
            <PlugZap size={15} strokeWidth={2.2} />
          )}
        </button>
        <button className="hm-icon-btn" onClick={onEdit} title="编辑" disabled={connecting}>
          <Pencil size={14} strokeWidth={1.8} />
        </button>
        <button className="hm-icon-btn danger" onClick={onDelete} title="删除" disabled={connecting}>
          <Trash2 size={14} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  )
}

// ── Host Form ─────────────────────────────────────────────────────────────────

function HostForm({
  host, credentials, onSave, onCancel,
}: {
  host: Bookmark | null
  credentials: Profile[]
  onSave: (data: HostFormData) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm] = useState<HostFormData>(defaultForm(host ?? undefined))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  const set = <K extends keyof HostFormData>(key: K, val: HostFormData[K]) =>
    setForm(prev => ({ ...prev, [key]: val }))

  const selectedCred = credentials.find(c => c.id === form.profile_id)

  const handleSave = async () => {
    if (!form.host.trim()) { setError('请填写主机地址'); return }
    if (!form.profile_id) { setError('请选择一个 Credential'); return }
    setError(undefined)
    setSaving(true)
    try { await onSave(form) } catch (e: any) { setError(String(e)) } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 200 }}>
      <div className="hf-shell">
        <div className="hm-header">
          <div className="hm-header-left">
            <Server size={16} strokeWidth={1.8} />
            <span>{host ? '编辑 Host' : '新建 Host'}</span>
          </div>
          <button className="hm-close-btn" onClick={onCancel}><X size={16} /></button>
        </div>

        <div className="hf-body">
          {/* Name */}
          <div className="hf-field full">
            <label className="hf-label">名称（可选）</label>
            <input className="form-input" placeholder="My Production Server"
              value={form.title} onChange={e => set('title', e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus />
          </div>

          {/* Host + Port */}
          <div className="hf-row">
            <div className="hf-field" style={{ flex: 3 }}>
              <label className="hf-label">主机地址 *</label>
              <input className="form-input" placeholder="192.168.1.1 / example.com"
                value={form.host} onChange={e => set('host', e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            </div>
            <div className="hf-field" style={{ flex: 1 }}>
              <label className="hf-label">端口</label>
              <input className="form-input" type="number" min={1} max={65535}
                value={form.port} onChange={e => set('port', parseInt(e.target.value) || 22)} />
            </div>
          </div>

          {/* Credential — required */}
          <div className="hf-field full">
            <label className="hf-label">Credential *</label>
            {credentials.length === 0 ? (
              <div className="hf-no-cred">
                <AlertCircle size={13} />
                请先创建 Credential
              </div>
            ) : (
              <div className="hf-cred-list">
                {credentials.map(c => (
                  <button
                    key={c.id}
                    className={`hf-cred-item${form.profile_id === c.id ? ' selected' : ''}`}
                    onClick={() => set('profile_id', c.id)}
                    type="button"
                  >
                    <span className="hf-cred-dot">
                      {c.auth_type === 'privateKey' ? 'KEY' : 'PWD'}
                    </span>
                    <span className="hf-cred-name">{c.title}</span>
                    <span className="hf-cred-user">{c.username}</span>
                    {form.profile_id === c.id && (
                      <ChevronRight size={13} className="hf-cred-check" />
                    )}
                  </button>
                ))}
              </div>
            )}
            {selectedCred && (
              <div className="hf-cred-resolved">
                将使用用户名 <code>{selectedCred.username}</code>，
                认证方式：{selectedCred.auth_type === 'privateKey' ? '私钥' : '密码'}
              </div>
            )}
          </div>

          {/* Remote start dir */}
          <div className="hf-field full">
            <label className="hf-label">远程初始目录（可选）</label>
            <input className="form-input" placeholder="/home/user"
              value={form.start_directory_remote}
              onChange={e => set('start_directory_remote', e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </div>

          {/* Color + Description */}
          <div className="hf-row">
            <div className="hf-field" style={{ flex: 1 }}>
              <label className="hf-label">标签颜色</label>
              <input type="color" className="form-input hf-color-input"
                value={form.color} onChange={e => set('color', e.target.value)} />
            </div>
            <div className="hf-field" style={{ flex: 3 }}>
              <label className="hf-label">备注</label>
              <input className="form-input" placeholder="可选"
                value={form.description} onChange={e => set('description', e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            </div>
          </div>

          {error && (
            <div className="hf-error">
              <AlertCircle size={13} />
              {error}
            </div>
          )}
        </div>

        <div className="hf-footer">
          <div className="hf-footer-group">
            <button className="btn-ghost" onClick={onCancel} disabled={saving}>取消</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving || credentials.length === 0}>
              {saving ? '保存中...' : host ? '更新' : '创建'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
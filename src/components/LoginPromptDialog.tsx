import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { X, LogIn, User, KeyRound } from 'lucide-react'
import './LoginPromptDialog.css'

export function LoginPromptDialog() {
  const loginDialog = useStore(s => s.loginDialog)
  const resolveLoginDialog = useStore(s => s.resolveLoginDialog)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)
  const usernameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (loginDialog) {
      setUsername(loginDialog.defaultUsername || '')
      setPassword('')
      setSaving(false)
      // Focus username if empty, otherwise focus password
      setTimeout(() => {
        if (loginDialog.defaultUsername) {
          passwordRef.current?.focus()
        } else {
          usernameRef.current?.focus()
        }
      }, 50)
    }
  }, [loginDialog])

  if (!loginDialog) return null

  const handleSubmit = () => {
    if (!username.trim()) return
    setSaving(true)
    resolveLoginDialog({ username: username.trim(), password })
  }

  const handleCancel = () => {
    resolveLoginDialog(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.target === usernameRef.current) {
        passwordRef.current?.focus()
      } else {
        handleSubmit()
      }
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 200 }} onClick={handleCancel}>
      <div className="lp-shell" onClick={e => e.stopPropagation()}>
        <div className="hm-header">
          <div className="hm-header-left">
            <LogIn size={16} strokeWidth={1.8} />
            <span>{loginDialog.title}</span>
          </div>
          <button className="hm-close-btn" onClick={handleCancel}><X size={16} /></button>
        </div>

        <div className="lp-body">
          <div className="lp-host-info">{loginDialog.host}</div>

          <div className="hf-field full">
            <label className="hf-label">
              <User size={12} style={{ marginRight: 5, verticalAlign: -2 }} />
              用户名
            </label>
            <input
              ref={usernameRef}
              className="form-input"
              placeholder="root"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={handleKeyDown}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={saving}
            />
          </div>

          <div className="hf-field full">
            <label className="hf-label">
              <KeyRound size={12} style={{ marginRight: 5, verticalAlign: -2 }} />
              密码
            </label>
            <input
              ref={passwordRef}
              className="form-input"
              type="password"
              placeholder="输入密码"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={saving}
            />
          </div>
        </div>

        <div className="hf-footer">
          <div className="hf-footer-group">
            <button className="btn-ghost" onClick={handleCancel} disabled={saving}>取消</button>
            <button className="btn-primary" onClick={handleSubmit} disabled={saving || !username.trim()}>
              {saving ? '连接中...' : '连接'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

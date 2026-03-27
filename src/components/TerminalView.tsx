import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { invoke, Channel } from '@tauri-apps/api/core'
import type { SessionTab } from '../types'
import { useStore } from '../store'
import '@xterm/xterm/css/xterm.css'
import './TerminalView.css'

function encodeKeyEvent(event: KeyboardEvent): string | null {
  if (event.metaKey) return null

  if (event.ctrlKey && !event.altKey) {
    const key = event.key
    if (key.length === 1) {
      const ch = key.toUpperCase()
      const code = ch.charCodeAt(0)
      if (code >= 65 && code <= 90) {
        return String.fromCharCode(code - 64)
      }
      if (key === ' ') return '\x00'
      if (key === '[') return '\x1b'
      if (key === '\\') return '\x1c'
      if (key === ']') return '\x1d'
      if (key === '^') return '\x1e'
      if (key === '_') return '\x1f'
    }
  }

  switch (event.key) {
    case 'Enter':
      return '\r'
    case 'Tab':
      return event.shiftKey ? '\x1b[Z' : '\t'
    case 'Backspace':
      return '\x7f'
    case 'Escape':
      return '\x1b'
    case 'ArrowUp':
      return '\x1b[A'
    case 'ArrowDown':
      return '\x1b[B'
    case 'ArrowRight':
      return '\x1b[C'
    case 'ArrowLeft':
      return '\x1b[D'
    case 'Home':
      return '\x1b[H'
    case 'End':
      return '\x1b[F'
    case 'Delete':
      return '\x1b[3~'
    case 'Insert':
      return '\x1b[2~'
    case 'PageUp':
      return '\x1b[5~'
    case 'PageDown':
      return '\x1b[6~'
    default:
      break
  }

  if (!event.ctrlKey && !event.altKey && !event.metaKey && event.key.length === 1) {
    return event.key
  }

  if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.length === 1) {
    return '\x1b' + event.key
  }

  return null
}

interface Props {
  session: SessionTab
  isVisible: boolean
  backendSessionId?: string
}

export function TerminalView({ session, isVisible, backendSessionId }: Props) {
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  const settings = useStore(s => s.settings)
  const activeBookmarkTabId = useStore(s => s.activeBookmarkTabId)
  const reconnectSession = useStore(s => s.reconnectSession)

  const [passwordInput, setPasswordInput] = useState('')
  const [reconnecting, setReconnecting] = useState(false)

  const isAuthError =
    session.status === 'error' &&
    /auth|password|credential|permission denied/i.test(session.error ?? '')

  // ── Terminal setup ────────────────────────────────────────────────────────

  useEffect(() => {
    const resolvedSessionId = backendSessionId ?? session.sessionId
    if (!termRef.current || !resolvedSessionId || session.status !== 'connected') return

    const sessionId = resolvedSessionId

    const term = new Terminal({
      cursorBlink: settings?.cursor_blink ?? true,
      cursorStyle: (settings?.cursor_style as any) ?? 'block',
      fontSize: settings?.font_size ?? 14,
      fontFamily: settings?.font_family ?? "Menlo, Monaco, 'Courier New', monospace",
      theme: {
        background: '#050310',
        foreground: '#c8ffc8',
        cursor: '#9b7ee0',
        cursorAccent: '#1a1035',
        selectionBackground: 'rgba(130, 100, 220, 0.3)',
        black: '#1a1035',
        red: '#e55',
        green: '#4caf8a',
        yellow: '#f0a040',
        blue: '#4a90e2',
        magenta: '#b06add',
        cyan: '#40c0c0',
        white: '#c8ffc8',
        brightBlack: '#5a4a7a',
        brightRed: '#ff6666',
        brightGreen: '#66ffaa',
        brightYellow: '#ffc060',
        brightBlue: '#66aaff',
        brightMagenta: '#cc88ff',
        brightCyan: '#66dddd',
        brightWhite: '#ffffff',
      },
      scrollback: settings?.scrollback ?? 5000,
      allowTransparency: false,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(termRef.current)
    fitAddon.fit()

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    // ── Input: custom keyboard path ───────────────────────────────────────
    //
    // In some macOS WebView environments xterm's textarea/input pipeline can
    // miss fast consecutive printable characters. We keep xterm for rendering,
    // selection and output, but send keyboard input through a native keydown
    // handler so each physical key event maps directly to terminal bytes.

    const sendToSession = (data: string) => {
      invoke('write_to_session', { sessionId, data }).catch(() => {})
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return

      const data = encodeKeyEvent(event)
      if (!data) return

      event.preventDefault()
      event.stopPropagation()
      sendToSession(data)
    }

    const textarea = term.textarea
    textarea?.addEventListener('keydown', handleKeyDown, true)

    term.onBinary(data => {
      sendToSession(data)
    })

    // ── Resize ────────────────────────────────────────────────────────────

    term.onResize(({ cols, rows }) => {
      invoke('resize_terminal', { sessionId, cols, rows }).catch(() => {})
    })

    // ── Output: direct write, no batching ─────────────────────────────────
    //
    // Like the reference project:
    //   socket.onmessage = (ev) => term.write(ev.data)
    //
    // The Rust reader thread already batches output in 5ms windows before
    // sending via Channel, so we don't need to batch again on the JS side.

    const channel = new Channel<string>()
    channel.onmessage = (data: string) => {
      term.write(data)
    }

    invoke('subscribe_session', { sessionId, dataChannel: channel }).catch(
      err => console.error('subscribe_session:', err),
    )

    // ── ResizeObserver ────────────────────────────────────────────────────

    const ro = new ResizeObserver(() => fitAddon.fit())
    ro.observe(termRef.current!)

    // ── Cleanup ───────────────────────────────────────────────────────────

    return () => {
      ro.disconnect()
      textarea?.removeEventListener('keydown', handleKeyDown, true)
      term.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
  }, [backendSessionId, session.sessionId, session.status])

  // Re-fit when the tab becomes visible
  useEffect(() => {
    if (isVisible && fitAddonRef.current) {
      const t = setTimeout(() => fitAddonRef.current?.fit(), 30)
      return () => clearTimeout(t)
    }
  }, [isVisible])

  // ── Reconnect handling ────────────────────────────────────────────────────

  const handleReconnect = async () => {
    if (!activeBookmarkTabId) return
    setReconnecting(true)
    try {
      await reconnectSession(
        activeBookmarkTabId,
        session.id,
        isAuthError ? passwordInput : undefined,
      )
    } finally {
      setReconnecting(false)
      setPasswordInput('')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="terminal-wrapper">
      {session.status === 'connecting' && (
        <div className="terminal-status connecting">
          <div className="status-dot connecting" />
          正在连接 {session.title}...
        </div>
      )}

      {session.status === 'error' && (
        <div className="terminal-status error">
          <div className="error-header">
            <span className="error-icon">⚠</span>
            <span>连接失败</span>
          </div>
          <div className="error-detail">{session.error}</div>

          {isAuthError && (
            <div className="reconnect-form">
              <input
                type="password"
                className="reconnect-password"
                placeholder="输入密码重试..."
                value={passwordInput}
                onChange={e => setPasswordInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleReconnect() }}
                autoFocus
              />
            </div>
          )}

          <button
            className="reconnect-btn"
            disabled={reconnecting}
            onClick={handleReconnect}
          >
            {reconnecting ? '重新连接中...' : '↺ 重新连接'}
          </button>
        </div>
      )}

      <div ref={termRef} className="terminal-container" />
    </div>
  )
}
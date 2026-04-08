import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { invoke, Channel } from '@tauri-apps/api/core'
import type { SessionTab } from '../types'
import { useStore } from '../store'
import '@xterm/xterm/css/xterm.css'
import './TerminalView.css'

const TERMINAL_THEME = {
  background: '#08111b',
  foreground: '#aebdca',
  cursor: '#ffbf69',
  cursorAccent: '#08111b',
  selectionBackground: 'rgba(115, 167, 255, 0.24)',
  black: '#16202b',
  red: '#ef6b73',
  green: '#7ccf92',
  yellow: '#e7c36f',
  blue: '#73a7ff',
  magenta: '#c792ea',
  cyan: '#66c7d1',
  white: '#b7c4cf',
  brightBlack: '#55606d',
  brightRed: '#ff8b94',
  brightGreen: '#99e6a8',
  brightYellow: '#ffd98a',
  brightBlue: '#94c2ff',
  brightMagenta: '#ddb3ff',
  brightCyan: '#8be0e8',
  brightWhite: '#d7e1ea',
}

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
  const visibleRef = useRef(isVisible)
  const sessionIdRef = useRef<string | null>(null)

  const settings = useStore(s => s.settings)
  const activeBookmarkTabId = useStore(s => s.activeBookmarkTabId)
  const reconnectSession = useStore(s => s.reconnectSession)
  const appZoom = useStore(s => s.appZoom)

  const [passwordInput, setPasswordInput] = useState('')
  const [reconnecting, setReconnecting] = useState(false)

  const isAuthError =
    session.status === 'error' &&
    /auth|password|credential|permission denied/i.test(session.error ?? '')

  useEffect(() => {
    visibleRef.current = isVisible
  }, [isVisible])

  // ── Terminal setup ────────────────────────────────────────────────────────

  useEffect(() => {
    const resolvedSessionId = backendSessionId ?? session.sessionId
    if (!termRef.current || !resolvedSessionId || session.status !== 'connected') return

    const sessionId = resolvedSessionId
    sessionIdRef.current = sessionId

    const baseFontSize = settings?.font_size ?? 12
    const zoomFactor = typeof appZoom === 'number' && appZoom > 0 ? appZoom : 1
    const initialFontSize = Math.max(8, Math.round(baseFontSize * zoomFactor))

    const term = new Terminal({
      cursorBlink: settings?.cursor_blink ?? true,
      cursorStyle: (settings?.cursor_style as any) ?? 'block',
      fontSize: initialFontSize,
      fontFamily: settings?.font_family ?? "Menlo, Monaco, 'Courier New', monospace",
      theme: TERMINAL_THEME,
      scrollback: settings?.scrollback ?? 5000,
      allowTransparency: false,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(termRef.current)

    if (visibleRef.current && termRef.current.clientWidth > 0 && termRef.current.clientHeight > 0) {
      fitAddon.fit()
    }

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

    // ── Copy/Paste shortcuts ──────────────────────────────────────────────

    const handleCopyPaste = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC')
      const modifier = isMac ? event.metaKey : event.ctrlKey

      if (modifier && event.key === 'c' && term.hasSelection()) {
        event.preventDefault()
        const selection = term.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection).catch(() => {})
        }
        return
      }

      if (modifier && event.key === 'v') {
        event.preventDefault()
        navigator.clipboard.readText().then(text => {
          if (text) {
            sendToSession(text)
          }
        }).catch(() => {})
        return
      }
    }

    window.addEventListener('keydown', handleCopyPaste)

    // ── Handle copy/paste events from context menu ────────────────────────

    const handleCopyEvent = (event: ClipboardEvent) => {
      const selection = term.getSelection()
      if (selection) {
        event.preventDefault()
        event.clipboardData?.setData('text/plain', selection)
      }
    }

    const handlePasteEvent = (event: ClipboardEvent) => {
      event.preventDefault()
      const text = event.clipboardData?.getData('text')
      if (text) {
        sendToSession(text)
      }
    }

    // Listen on textarea directly for copy/paste from context menu
    textarea?.addEventListener('copy', handleCopyEvent)
    textarea?.addEventListener('paste', handlePasteEvent)

    // ── Auto copy on selection ────────────────────────────────────────────

    term.onSelectionChange(() => {
      const selection = term.getSelection()
      if (selection) {
        navigator.clipboard.writeText(selection).catch(() => {})
      }
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

    const ro = new ResizeObserver(() => {
      if (!visibleRef.current || !termRef.current) return
      if (termRef.current.clientWidth === 0 || termRef.current.clientHeight === 0) return
      fitAddon.fit()
    })
    ro.observe(termRef.current!)

    // ── Cleanup ───────────────────────────────────────────────────────────

    return () => {
      ro.disconnect()
      window.removeEventListener('keydown', handleCopyPaste)
      textarea?.removeEventListener('copy', handleCopyEvent)
      textarea?.removeEventListener('paste', handlePasteEvent)
      textarea?.removeEventListener('keydown', handleKeyDown, true)
      term.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
      sessionIdRef.current = null
    }
  }, [
    backendSessionId,
    session.sessionId,
    session.status,
    settings?.cursor_blink,
    settings?.cursor_style,
    settings?.font_family,
    settings?.font_size,
    settings?.scrollback,
  ])

  // ── Dynamic font size update on zoom change ──────────────────────────────

  useEffect(() => {
    const term = xtermRef.current
    const fitAddon = fitAddonRef.current
    if (!term || !fitAddon) return

    const baseFontSize = settings?.font_size ?? 12
    const zoomFactor = typeof appZoom === 'number' && appZoom > 0 ? appZoom : 1
    const scaledFontSize = Math.max(8, Math.round(baseFontSize * zoomFactor))

    if (term.options.fontSize !== scaledFontSize) {
      term.options.fontSize = scaledFontSize
      // Give the terminal a moment to apply the new font size
      setTimeout(() => {
        if (termRef.current && termRef.current.clientWidth > 0 && termRef.current.clientHeight > 0) {
          fitAddon.fit()
        }
      }, 10)
    }
  }, [appZoom, settings?.font_size])

  // Re-fit when the tab becomes visible
  useEffect(() => {
    if (!isVisible) return

    const resolvedSessionId = backendSessionId ?? session.sessionId
    const t = setTimeout(() => {
      const container = termRef.current
      const fitAddon = fitAddonRef.current
      const term = xtermRef.current
      if (!container || !fitAddon || !term) return
      if (container.clientWidth === 0 || container.clientHeight === 0) return

      fitAddon.fit()

      if (resolvedSessionId) {
        invoke('resize_terminal', {
          sessionId: resolvedSessionId,
          cols: term.cols,
          rows: term.rows,
        }).catch(() => {})
      }
    }, 30)

    return () => clearTimeout(t)
  }, [isVisible, backendSessionId, session.sessionId])

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
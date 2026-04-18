import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { nanoid } from 'nanoid'
import type {
  Bookmark,
  BookmarkGroup,
  BookmarkTab,
  HostReachabilityStatus,
  Profile,
  SessionTab,
  Settings,
  TransferProgress,
} from '../types'

// ── App Zoom Initialization ──────────────────────────────────────────────────

const APP_ZOOM_STORAGE_KEY = 'tinyterm.appZoom'
const APP_ZOOM_MIN = 0.8
const APP_ZOOM_MAX = 1.4

function getInitialAppZoom(): number {
  if (typeof window === 'undefined') return 0.8

  const stored = window.localStorage.getItem(APP_ZOOM_STORAGE_KEY)
  
  // 如果没有存储值，使用新的默认值 0.8
  if (!stored) {
    window.localStorage.setItem(APP_ZOOM_STORAGE_KEY, '0.8')
    return 0.8
  }
  
  const storedZoom = Number(stored)
  
  // 如果是旧的默认值 1（允许一些浮点误差），迁移到新的默认值 0.8
  if (Number.isFinite(storedZoom) && storedZoom >= 0.95 && storedZoom <= 1.05) {
    window.localStorage.setItem(APP_ZOOM_STORAGE_KEY, '0.8')
    return 0.8
  }
  
  if (!Number.isFinite(storedZoom)) return 0.8
  
  // 限制在范围内
  return Math.min(APP_ZOOM_MAX, Math.max(APP_ZOOM_MIN, Number(storedZoom.toFixed(2))))
}

// 立即设置 CSS 变量，确保初始渲染就使用正确的缩放值
if (typeof window !== 'undefined') {
  const initialZoom = getInitialAppZoom()
  document.documentElement.style.setProperty('--app-zoom', String(initialZoom))
}

interface AppState {
  // Data
  bookmarks: Bookmark[]
  bookmarkGroups: BookmarkGroup[]
  profiles: Profile[]
  settings: Settings | null

  // Aliases
  hosts: Bookmark[]
  credentials: Profile[]

  // UI state
  bookmarkTabs: BookmarkTab[]
  activeBookmarkTabId: string | null
  hostReachabilityById: Record<string, HostReachabilityStatus>
  appZoom: number
  setAppZoom: (zoom: number) => void

  // File manager
  transfers: TransferProgress[]

  // Modals
  credentialsModalOpen: boolean
  hostsModalOpen: boolean
  appDialog: AppDialogState | null

  // Actions - Data loading
  loadAll: () => Promise<void>
  loadBookmarks: () => Promise<void>
  loadProfiles: () => Promise<void>
  loadSettings: () => Promise<void>

  // Bookmark/Host CRUD
  createBookmark: (bookmark: Omit<Bookmark, 'id' | 'created_at' | 'updated_at' | 'password_encrypted'>) => Promise<Bookmark>
  updateBookmark: (bookmark: Bookmark) => Promise<Bookmark>
  deleteBookmark: (id: string) => Promise<void>

  // Profile/Credential CRUD
  createProfile: (profile: Omit<Profile, 'id' | 'created_at' | 'password_encrypted'>) => Promise<Profile>
  updateProfile: (profile: Profile) => Promise<Profile>
  deleteProfile: (id: string) => Promise<void>

  // Settings
  saveSettings: (settings: Settings) => Promise<void>

  // Bookmark Groups
  createBookmarkGroup: (title: string) => Promise<BookmarkGroup>
  deleteBookmarkGroup: (id: string) => Promise<void>

  // Host Tab management
  openHostTab: (hostId: string) => Promise<void>
  addBookmarkTab: (title?: string, hostId?: string) => BookmarkTab
  removeBookmarkTab: (tabId: string) => void
  setActiveBookmarkTab: (tabId: string) => void

  // Session Tab management
  openSession: (hostId: string, bookmarkTabId?: string) => Promise<void>
  closeSession: (bookmarkTabId: string, sessionTabId: string) => Promise<void>
  setActiveSession: (bookmarkTabId: string, sessionTabId: string) => void
  markSessionDisconnected: (bookmarkTabId: string, sessionTabId: string, reason?: string) => Promise<void>
  markHostSessionsDisconnected: (hostId: string, reason?: string) => Promise<void>
  reconnectSession: (bookmarkTabId: string, sessionTabId: string, password?: string) => Promise<void>
  reconnectHostSessions: (hostId: string, password?: string) => Promise<void>
  updateSessionPath: (bookmarkTabId: string, sessionId: string, path: string) => void
  toggleFm: (bookmarkTabId: string, sessionId: string) => void
  toggleSideTerminal: (bookmarkTabId: string, sessionTabId: string) => Promise<void>
  setHostReachability: (hostId: string, status: HostReachabilityStatus) => void

  // Modal controls
  openCredentialsModal: () => void
  closeCredentialsModal: () => void
  openHostsModal: () => void
  closeHostsModal: () => void

  // Unified app dialog
  openConfirmDialog: (options: {
    title: string
    message: string
    confirmText?: string
    cancelText?: string
  }) => Promise<boolean>
  openAlertDialog: (options: {
    title: string
    message: string
    confirmText?: string
  }) => Promise<void>
  resolveAppDialog: (action: 'confirm' | 'cancel') => void

  // Transfer progress
  updateTransfer: (progress: TransferProgress) => void
}

const DEFAULT_SETTINGS: Settings = {
  font_size: 12,
  font_family: "Menlo, Monaco, 'Courier New', monospace",
  theme: 'dark',
  opacity: 1.0,
  language: 'zh',
  scrollback: 5000,
  show_hidden_files: false,
  default_protocol: 'ssh',
  cursor_style: 'block',
  cursor_blink: true,
  bell_style: 'none',
}

type AppDialogState = {
  mode: 'confirm' | 'alert'
  title: string
  message: string
  confirmText: string
  cancelText?: string
}

let pendingAppDialogResolve: ((action: 'confirm' | 'cancel') => void) | null = null

function showAppDialog(
  set: (partial: Partial<AppState>) => void,
  dialog: AppDialogState,
): Promise<'confirm' | 'cancel'> {
  if (pendingAppDialogResolve) {
    pendingAppDialogResolve('cancel')
    pendingAppDialogResolve = null
  }

  return new Promise(resolve => {
    pendingAppDialogResolve = resolve
    set({ appDialog: dialog })
  })
}

function settleAppDialog(
  set: (partial: Partial<AppState>) => void,
  action: 'confirm' | 'cancel',
) {
  const resolve = pendingAppDialogResolve
  pendingAppDialogResolve = null
  set({ appDialog: null })
  resolve?.(action)
}

type HostKeyPrompt = {
  host: string
  port: number
  key_type: string
  fingerprint: string
  reason: 'unknown' | 'mismatch' | string
}

function extractHostKeyPrompt(error: unknown): HostKeyPrompt | null {
  const message = String(error)
  const marker = 'HOST_KEY_PROMPT:'
  const markerIndex = message.indexOf(marker)
  if (markerIndex === -1) {
    return null
  }

  try {
    return JSON.parse(message.slice(markerIndex + marker.length).trim()) as HostKeyPrompt
  } catch {
    return null
  }
}

function buildHostKeyPromptMessage(prompt: HostKeyPrompt) {
  const summary = `${prompt.host}:${prompt.port}\n${prompt.key_type}\n${prompt.fingerprint}`

  if (prompt.reason === 'mismatch') {
    return `检测到主机指纹变更。\n\n${summary}\n\n这可能是主机重装，也可能是中间人攻击。仅在你确认这是可信的新指纹时继续。`
  }

  return `首次连接到该主机，需要确认 SSH 指纹。\n\n${summary}\n\n确认后会保存为受信任主机。`
}

async function createSessionWithTrust(bookmarkId: string, cols: number, rows: number, password?: string | null) {
  const connect = () => invoke<{ session_id: string }>('create_session', {
    request: {
      bookmark_id: bookmarkId,
      cols,
      rows,
      password: password ?? null,
    },
  })

  try {
    return await connect()
  } catch (error) {
    const prompt = extractHostKeyPrompt(error)
    if (!prompt) {
      throw error
    }

    const confirmed = await useStore.getState().openConfirmDialog({
      title: 'SSH 主机指纹确认',
      message: buildHostKeyPromptMessage(prompt),
      confirmText: '信任并继续',
      cancelText: '取消',
    })
    if (!confirmed) {
      throw new Error('已取消信任该 SSH 主机指纹')
    }

    await invoke('trust_host_key', {
      request: {
        host: prompt.host,
        port: prompt.port,
        key_type: prompt.key_type,
        fingerprint: prompt.fingerprint,
      },
    })

    return connect()
  }
}

function normalizeSettings(settings: Settings): Settings {
  const looksLikeLegacyDefaults =
    (settings.font_size === 14 || settings.font_size === 13) &&
    settings.font_family === DEFAULT_SETTINGS.font_family &&
    settings.theme === DEFAULT_SETTINGS.theme &&
    settings.opacity === DEFAULT_SETTINGS.opacity &&
    settings.language === DEFAULT_SETTINGS.language &&
    settings.scrollback === DEFAULT_SETTINGS.scrollback &&
    settings.show_hidden_files === DEFAULT_SETTINGS.show_hidden_files &&
    settings.default_protocol === DEFAULT_SETTINGS.default_protocol &&
    settings.cursor_style === DEFAULT_SETTINGS.cursor_style &&
    settings.cursor_blink === DEFAULT_SETTINGS.cursor_blink &&
    settings.bell_style === DEFAULT_SETTINGS.bell_style

  if (!looksLikeLegacyDefaults) {
    return settings
  }

  return {
    ...settings,
    font_size: DEFAULT_SETTINGS.font_size,
  }
}

function makeBookmarkTab(title = 'New Tab', hostId?: string): BookmarkTab {
  return {
    id: nanoid(),
    title,
    bookmarkId: hostId,
    hostId,
    sessions: [],
    activeSessionId: null,
  }
}

export const useStore = create<AppState>((set, get) => ({
  bookmarks: [],
  bookmarkGroups: [],
  profiles: [],
  settings: null,

  // Aliases — kept in sync with bookmarks/profiles
  hosts: [],
  credentials: [],

  bookmarkTabs: [],
  activeBookmarkTabId: null,
  hostReachabilityById: {},
  appZoom: getInitialAppZoom(),
  setAppZoom: (zoom: number) => set({ appZoom: zoom }),
  transfers: [],

  credentialsModalOpen: false,
  hostsModalOpen: false,
  appDialog: null,

  // ── Data loading ──────────────────────────────────────────────────────────

  loadAll: async () => {
    await Promise.all([
      get().loadBookmarks(),
      get().loadProfiles(),
      get().loadSettings(),
    ])
  },

  loadBookmarks: async () => {
    try {
      const bookmarks = await invoke<Bookmark[]>('list_bookmarks')
      // BookmarkGroups are optional — ignore if command doesn't exist
      let bookmarkGroups: BookmarkGroup[] = []
      try {
        bookmarkGroups = await invoke<BookmarkGroup[]>('list_bookmark_groups')
      } catch {
        // command may not exist in all builds
      }
      set(state => {
        const nextReachability = { ...state.hostReachabilityById }
        const bookmarkIds = new Set(bookmarks.map(b => b.id))
        Object.keys(nextReachability).forEach(id => {
          if (!bookmarkIds.has(id)) {
            delete nextReachability[id]
          }
        })

        return { bookmarks, bookmarkGroups, hosts: bookmarks, hostReachabilityById: nextReachability }
      })
    } catch (e) {
      console.error('loadBookmarks:', e)
    }
  },

  loadProfiles: async () => {
    try {
      const profiles = await invoke<Profile[]>('list_profiles')
      set({ profiles, credentials: profiles })
    } catch (e) {
      console.error('loadProfiles:', e)
    }
  },

  loadSettings: async () => {
    try {
      const fetchedSettings = await invoke<Settings>('get_settings')
      const settings = normalizeSettings(fetchedSettings)
      set({ settings })

      if (settings.font_size !== fetchedSettings.font_size) {
        invoke('update_settings', { settings }).catch(() => {})
      }
    } catch {
      set({ settings: DEFAULT_SETTINGS })
    }
  },

  // ── Bookmark / Host CRUD ──────────────────────────────────────────────────

  createBookmark: async (data) => {
    const bookmark = await invoke<Bookmark>('create_bookmark', {
      bookmark: {
        ...data,
        id: nanoid(),
        password_encrypted: false,
        created_at: Date.now(),
        updated_at: Date.now(),
      },
    })
    set(state => ({
      bookmarks: [...state.bookmarks, bookmark],
      hosts: [...state.hosts, bookmark],
    }))
    return bookmark
  },

  updateBookmark: async (bookmark) => {
    const updated = await invoke<Bookmark>('update_bookmark', { bookmark })
    set(state => ({
      bookmarks: state.bookmarks.map(b => b.id === updated.id ? updated : b),
      hosts: state.hosts.map(b => b.id === updated.id ? updated : b),
    }))
    return updated
  },

  deleteBookmark: async (id) => {
    await invoke('delete_bookmark', { id })
    set(state => ({
      bookmarks: state.bookmarks.filter(b => b.id !== id),
      hosts: state.hosts.filter(b => b.id !== id),
      hostReachabilityById: Object.fromEntries(
        Object.entries(state.hostReachabilityById).filter(([key]) => key !== id)
      ),
    }))
  },

  // ── Profile / Credential CRUD ─────────────────────────────────────────────

  createProfile: async (data) => {
    const profile = await invoke<Profile>('create_profile', {
      profile: {
        ...data,
        id: nanoid(),
        password_encrypted: false,
        created_at: Date.now(),
      },
    })
    set(state => ({
      profiles: [...state.profiles, profile],
      credentials: [...state.credentials, profile],
    }))
    return profile
  },

  updateProfile: async (profile) => {
    const updated = await invoke<Profile>('update_profile', { profile })
    set(state => ({
      profiles: state.profiles.map(p => p.id === updated.id ? updated : p),
      credentials: state.credentials.map(p => p.id === updated.id ? updated : p),
    }))
    return updated
  },

  deleteProfile: async (id) => {
    await invoke('delete_profile', { id })
    set(state => ({
      profiles: state.profiles.filter(p => p.id !== id),
      credentials: state.credentials.filter(p => p.id !== id),
    }))
  },

  // ── Settings ──────────────────────────────────────────────────────────────

  saveSettings: async (settings) => {
    await invoke('update_settings', { settings })
    set({ settings })
  },

  // ── Bookmark Groups ───────────────────────────────────────────────────────

  createBookmarkGroup: async (title) => {
    const group = await invoke<BookmarkGroup>('create_bookmark_group', {
      group: {
        id: nanoid(),
        title,
        parent_id: null,
        order_index: get().bookmarkGroups.length,
        created_at: Date.now(),
      },
    })
    set(state => ({ bookmarkGroups: [...state.bookmarkGroups, group] }))
    return group
  },

  deleteBookmarkGroup: async (id) => {
    await invoke('delete_bookmark_group', { id })
    set(state => ({ bookmarkGroups: state.bookmarkGroups.filter(g => g.id !== id) }))
  },

  // ── Host Tab management ───────────────────────────────────────────────────

  /**
   * If a BookmarkTab already exists for this hostId, activate it.
   * Otherwise create a new tab and start the first session.
   */
  openHostTab: async (hostId: string) => {
    const { bookmarkTabs, bookmarks, addBookmarkTab, openSession, setActiveBookmarkTab } = get()

    // Check if tab already exists for this host
    const existing = bookmarkTabs.find(t => t.hostId === hostId || t.bookmarkId === hostId)
    if (existing) {
      setActiveBookmarkTab(existing.id)

      const activeSession = existing.sessions.find(s => s.id === existing.activeSessionId)
      const hasLiveSession = activeSession?.status === 'connected' || activeSession?.status === 'connecting'

      if (!hasLiveSession) {
        await openSession(hostId, existing.id)
      }

      set({ hostsModalOpen: false })
      return
    }

    const host = bookmarks.find(b => b.id === hostId)
    if (!host) return

    const tabTitle = host.title || host.host
    const tab = addBookmarkTab(tabTitle, hostId)

    // Open the first session in this new tab
    await openSession(hostId, tab.id)

    set({ hostsModalOpen: false })
  },

  addBookmarkTab: (title, hostId) => {
    const tab = makeBookmarkTab(title || 'New Tab', hostId)
    set(state => ({
      bookmarkTabs: [...state.bookmarkTabs, tab],
      activeBookmarkTabId: tab.id,
    }))
    return tab
  },

  removeBookmarkTab: (tabId) => {
    const { bookmarkTabs, activeBookmarkTabId } = get()

    // Close all backend sessions in this tab
    const tab = bookmarkTabs.find(t => t.id === tabId)
    if (tab) {
      tab.sessions.forEach(s => {
        if (s.sessionId) {
          invoke('close_session', { sessionId: s.sessionId }).catch(() => {})
        }
      })
    }

    const filtered = bookmarkTabs.filter(t => t.id !== tabId)
    if (filtered.length === 0) {
      set({ bookmarkTabs: [], activeBookmarkTabId: null })
      return
    }
    const newActive = activeBookmarkTabId === tabId
      ? filtered[filtered.length - 1].id
      : activeBookmarkTabId
    set({ bookmarkTabs: filtered, activeBookmarkTabId: newActive })
  },

  setActiveBookmarkTab: (tabId) => {
    set({ activeBookmarkTabId: tabId })
  },

  // ── Session Tab management ────────────────────────────────────────────────

  openSession: async (hostId: string, bookmarkTabId?: string) => {
    const tabId = bookmarkTabId || get().activeBookmarkTabId
    if (!tabId) return

    const bookmark = get().bookmarks.find(b => b.id === hostId)
    if (!bookmark) return

    const sessionTab: SessionTab = {
      id: nanoid(),
      title: bookmark.title || bookmark.host,
      bookmarkId: hostId,
      status: 'connecting',
      cols: 80,
      rows: 24,
      localPath: '',
      remotePath: '/',
      terminalPath: undefined,
      sideTerminalOpen: false,
      sideTerminalSessionId: undefined,
      sideTerminalStatus: 'disconnected',
      sideTerminalError: undefined,
    }

    // Add session tab optimistically
    set(state => ({
      bookmarkTabs: state.bookmarkTabs.map(tab =>
        tab.id === tabId
          ? { ...tab, sessions: [...tab.sessions, sessionTab], activeSessionId: sessionTab.id }
          : tab
      ),
    }))

    // Connect to backend
    try {
      const result = await createSessionWithTrust(hostId, 80, 24, null)

      const localPath = await getHomeDir()

      set(state => ({
        bookmarkTabs: state.bookmarkTabs.map(tab =>
          tab.id === tabId
            ? {
                ...tab,
                sessions: tab.sessions.map(s =>
                  s.id === sessionTab.id
                    ? { ...s, sessionId: result.session_id, status: 'connected', localPath }
                    : s
                ),
              }
            : tab
        ),
      }))
    } catch (e: any) {
      set(state => ({
        bookmarkTabs: state.bookmarkTabs.map(tab =>
          tab.id === tabId
            ? {
                ...tab,
                sessions: tab.sessions.map(s =>
                  s.id === sessionTab.id
                    ? { ...s, status: 'error', error: String(e) }
                    : s
                ),
              }
            : tab
        ),
      }))
    }
  },

  closeSession: async (bookmarkTabId, sessionTabId) => {
    const { bookmarkTabs } = get()
    const tab = bookmarkTabs.find(t => t.id === bookmarkTabId)
    if (!tab) return

    const session = tab.sessions.find(s => s.id === sessionTabId)
    if (session?.sessionId) {
      try {
        await invoke('close_session', { sessionId: session.sessionId })
      } catch (e) {
        console.error('closeSession:', e)
      }
    }

    set(state => {
      let removedTargetTab = false

      const bookmarkTabs = state.bookmarkTabs
        .map(t => {
          if (t.id !== bookmarkTabId) return t
          const sessions = t.sessions.filter(s => s.id !== sessionTabId)
          if (sessions.length === 0) {
            removedTargetTab = true
            return null
          }

          const activeSessionId =
            t.activeSessionId === sessionTabId
              ? sessions[sessions.length - 1]?.id ?? null
              : t.activeSessionId

          return { ...t, sessions, activeSessionId }
        })
        .filter((t): t is BookmarkTab => t !== null)

      if (!removedTargetTab) {
        return { bookmarkTabs }
      }

      const activeBookmarkTabId =
        state.activeBookmarkTabId === bookmarkTabId
          ? bookmarkTabs[bookmarkTabs.length - 1]?.id ?? null
          : state.activeBookmarkTabId

      return { bookmarkTabs, activeBookmarkTabId }
    })
  },

  setActiveSession: (bookmarkTabId, sessionTabId) => {
    set(state => ({
      bookmarkTabs: state.bookmarkTabs.map(t =>
        t.id === bookmarkTabId ? { ...t, activeSessionId: sessionTabId } : t
      ),
    }))
  },

  markSessionDisconnected: async (bookmarkTabId, sessionTabId, reason) => {
    const { bookmarkTabs } = get()
    const tab = bookmarkTabs.find(t => t.id === bookmarkTabId)
    const session = tab?.sessions.find(s => s.id === sessionTabId)
    if (!session) return

    if (session.sessionId) {
      try {
        await invoke('close_session', { sessionId: session.sessionId })
      } catch {
        // Ignore close errors; UI state still needs to move to disconnected.
      }
    }

    if (session.sideTerminalSessionId) {
      try {
        await invoke('close_session', { sessionId: session.sideTerminalSessionId })
      } catch {
        // Ignore close errors for side terminal as well.
      }
    }

    set(state => ({
      bookmarkTabs: state.bookmarkTabs.map(t =>
        t.id !== bookmarkTabId ? t : {
          ...t,
          sessions: t.sessions.map(s =>
            s.id !== sessionTabId ? s : {
              ...s,
              status: 'disconnected',
              error: reason ?? '连接已断开，请点击重连。',
              sideTerminalOpen: false,
              sideTerminalSessionId: undefined,
              sideTerminalStatus: 'disconnected',
              sideTerminalError: undefined,
            }
          ),
        }
      ),
    }))
  },

  markHostSessionsDisconnected: async (hostId, reason) => {
    const { bookmarkTabs } = get()
    const targets: Array<{ bookmarkTabId: string; sessionTabId: string }> = []

    bookmarkTabs.forEach(tab => {
      const tabHostId = tab.hostId || tab.bookmarkId
      if (tabHostId !== hostId) return

      tab.sessions.forEach(session => {
        if (session.status === 'disconnected') return
        targets.push({ bookmarkTabId: tab.id, sessionTabId: session.id })
      })
    })

    for (const target of targets) {
      await get().markSessionDisconnected(target.bookmarkTabId, target.sessionTabId, reason)
    }
  },

  reconnectSession: async (bookmarkTabId, sessionTabId, password) => {
    const { bookmarkTabs } = get()
    const tab = bookmarkTabs.find(t => t.id === bookmarkTabId)
    const session = tab?.sessions.find(s => s.id === sessionTabId)
    if (!session) return

    // Close old backend session if any
    if (session.sessionId) {
      try { await invoke('close_session', { sessionId: session.sessionId }) } catch { /* ignore */ }
    }

    // Set to connecting
    set(state => ({
      bookmarkTabs: state.bookmarkTabs.map(t =>
        t.id !== bookmarkTabId ? t : {
          ...t,
          sessions: t.sessions.map(s =>
            s.id !== sessionTabId ? s : {
              ...s,
              status: 'connecting',
              sessionId: undefined,
              error: undefined,
              terminalPath: undefined,
            }
          ),
        }
      ),
    }))

    try {
      const result = await createSessionWithTrust(session.bookmarkId, session.cols, session.rows, password ?? null)
      const localPath = await getHomeDir()
      set(state => ({
        bookmarkTabs: state.bookmarkTabs.map(t =>
          t.id !== bookmarkTabId ? t : {
            ...t,
            sessions: t.sessions.map(s =>
              s.id !== sessionTabId ? s : {
                ...s,
                sessionId: result.session_id,
                status: 'connected',
                localPath,
              }
            ),
          }
        ),
      }))
    } catch (e: any) {
      set(state => ({
        bookmarkTabs: state.bookmarkTabs.map(t =>
          t.id !== bookmarkTabId ? t : {
            ...t,
            sessions: t.sessions.map(s =>
              s.id !== sessionTabId ? s : { ...s, status: 'error', error: String(e) }
            ),
          }
        ),
      }))
    }
  },

  reconnectHostSessions: async (hostId, password) => {
    const { bookmarkTabs } = get()
    const targets: Array<{ bookmarkTabId: string; sessionTabId: string }> = []

    bookmarkTabs.forEach(tab => {
      const tabHostId = tab.hostId || tab.bookmarkId
      if (tabHostId !== hostId) return

      tab.sessions.forEach(session => {
        if (session.status !== 'disconnected' && session.status !== 'error') return
        targets.push({ bookmarkTabId: tab.id, sessionTabId: session.id })
      })
    })

    let hasConnectedSession = false
    for (const target of targets) {
      await get().reconnectSession(target.bookmarkTabId, target.sessionTabId, password)
      const refreshed = get().bookmarkTabs
        .find(tab => tab.id === target.bookmarkTabId)
        ?.sessions.find(session => session.id === target.sessionTabId)
      if (refreshed?.status === 'connected') {
        hasConnectedSession = true
      }
    }

    if (hasConnectedSession) {
      get().setHostReachability(hostId, 'reachable')
    }
  },

  updateSessionPath: (bookmarkTabId, sessionId, path) => {
    set(state => ({
      bookmarkTabs: state.bookmarkTabs.map(t =>
        t.id !== bookmarkTabId ? t : {
          ...t,
          sessions: t.sessions.map(s =>
            s.id !== sessionId ? s : { ...s, terminalPath: path, remotePath: path }
          ),
        }
      ),
    }))
  },

  // ── Modal controls ────────────────────────────────────────────────────────

  toggleFm: (bookmarkTabId, sessionId) => set(state => ({
    bookmarkTabs: state.bookmarkTabs.map(t =>
      t.id === bookmarkTabId
        ? { ...t, sessions: t.sessions.map(s =>
            s.id === sessionId ? { ...s, fmOpen: !s.fmOpen } : s
          )}
        : t
    )
  })),

  toggleSideTerminal: async (bookmarkTabId, sessionTabId) => {
    const { bookmarkTabs, bookmarks } = get()
    const tab = bookmarkTabs.find(t => t.id === bookmarkTabId)
    const session = tab?.sessions.find(s => s.id === sessionTabId)
    if (!tab || !session) return

    if (session.sideTerminalOpen && session.sideTerminalSessionId) {
      try {
        await invoke('close_session', { sessionId: session.sideTerminalSessionId })
      } catch (e) {
        console.error('close side terminal session:', e)
      }

      set(state => ({
        bookmarkTabs: state.bookmarkTabs.map(t =>
          t.id !== bookmarkTabId ? t : {
            ...t,
            sessions: t.sessions.map(s =>
              s.id !== sessionTabId
                ? s
                : {
                    ...s,
                    sideTerminalOpen: false,
                    sideTerminalSessionId: undefined,
                    sideTerminalStatus: 'disconnected',
                    sideTerminalError: undefined,
                  }
            ),
          }
        ),
      }))
      return
    }

    const bookmark = bookmarks.find(b => b.id === session.bookmarkId)
    if (!bookmark) return

    set(state => ({
      bookmarkTabs: state.bookmarkTabs.map(t =>
        t.id !== bookmarkTabId ? t : {
          ...t,
          sessions: t.sessions.map(s =>
            s.id !== sessionTabId
              ? s
              : {
                  ...s,
                  sideTerminalOpen: true,
                  sideTerminalSessionId: undefined,
                  sideTerminalStatus: 'connecting',
                  sideTerminalError: undefined,
                }
          ),
        }
      ),
    }))

    try {
      const result = await createSessionWithTrust(bookmark.id, session.cols || 80, session.rows || 24, null)

      set(state => ({
        bookmarkTabs: state.bookmarkTabs.map(t =>
          t.id !== bookmarkTabId ? t : {
            ...t,
            sessions: t.sessions.map(s =>
              s.id !== sessionTabId
                ? s
                : {
                    ...s,
                    sideTerminalOpen: true,
                    sideTerminalSessionId: result.session_id,
                    sideTerminalStatus: 'connected',
                    sideTerminalError: undefined,
                  }
            ),
          }
        ),
      }))
    } catch (e: any) {
      set(state => ({
        bookmarkTabs: state.bookmarkTabs.map(t =>
          t.id !== bookmarkTabId ? t : {
            ...t,
            sessions: t.sessions.map(s =>
              s.id !== sessionTabId
                ? s
                : {
                    ...s,
                    sideTerminalOpen: false,
                    sideTerminalSessionId: undefined,
                    sideTerminalStatus: 'error',
                    sideTerminalError: String(e),
                  }
            ),
          }
        ),
      }))
    }
  },

  setHostReachability: (hostId, status) => {
    set(state => {
      if (state.hostReachabilityById[hostId] === status) {
        return state
      }
      return {
        hostReachabilityById: {
          ...state.hostReachabilityById,
          [hostId]: status,
        },
      }
    })
  },

  openCredentialsModal: () => set({ credentialsModalOpen: true }),
  closeCredentialsModal: () => set({ credentialsModalOpen: false }),
  openHostsModal: () => set({ hostsModalOpen: true }),
  closeHostsModal: () => set({ hostsModalOpen: false }),

  // ── Unified app dialog ──────────────────────────────────────────────────

  openConfirmDialog: async ({ title, message, confirmText = '确认', cancelText = '取消' }) => {
    const action = await showAppDialog(set as any, {
      mode: 'confirm',
      title,
      message,
      confirmText,
      cancelText,
    })
    return action === 'confirm'
  },

  openAlertDialog: async ({ title, message, confirmText = '知道了' }) => {
    await showAppDialog(set as any, {
      mode: 'alert',
      title,
      message,
      confirmText,
    })
  },

  resolveAppDialog: (action) => {
    settleAppDialog(set as any, action)
  },

  // ── Transfer progress ─────────────────────────────────────────────────────

  updateTransfer: (progress) => {
    set(state => {
      const transferId = progress.id || `${progress.direction}:${progress.file_name}`
      const idx = state.transfers.findIndex(t => (t.id || `${t.direction}:${t.file_name}`) === transferId)
      if (idx >= 0) {
        const transfers = [...state.transfers]
        transfers[idx] = { ...transfers[idx], ...progress, id: transferId }
        return { transfers }
      }
      return { transfers: [...state.transfers, { ...progress, id: transferId }] }
    })
  },
}))

async function getHomeDir(): Promise<string> {
  try {
    const { homeDir } = await import('@tauri-apps/api/path')
    return await homeDir()
  } catch {
    return '/'
  }
}
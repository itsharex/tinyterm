import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { nanoid } from 'nanoid'
import type {
  Bookmark,
  BookmarkGroup,
  BookmarkTab,
  Profile,
  SessionTab,
  Settings,
  TransferProgress,
} from '../types'

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

  // File manager
  transfers: TransferProgress[]

  // Modals
  credentialsModalOpen: boolean
  hostsModalOpen: boolean

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
  reconnectSession: (bookmarkTabId: string, sessionTabId: string, password?: string) => Promise<void>
  updateSessionPath: (bookmarkTabId: string, sessionId: string, path: string) => void
  toggleFm: (bookmarkTabId: string, sessionId: string) => void
  toggleSideTerminal: (bookmarkTabId: string, sessionTabId: string) => Promise<void>

  // Modal controls
  openCredentialsModal: () => void
  closeCredentialsModal: () => void
  openHostsModal: () => void
  closeHostsModal: () => void

  // Transfer progress
  updateTransfer: (progress: TransferProgress) => void
}

const DEFAULT_SETTINGS: Settings = {
  font_size: 14,
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
  transfers: [],

  credentialsModalOpen: false,
  hostsModalOpen: false,

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
      set({ bookmarks, bookmarkGroups, hosts: bookmarks })
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
      const settings = await invoke<Settings>('get_settings')
      set({ settings })
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
      // Close hosts modal
      set({ hostsModalOpen: false })
      return
    }

    const host = bookmarks.find(b => b.id === hostId)
    if (!host) return

    const tabTitle = host.title || host.host
    const tab = addBookmarkTab(tabTitle, hostId)

    // Close modal before connecting
    set({ hostsModalOpen: false })

    // Open the first session in this new tab
    await openSession(hostId, tab.id)
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
      const result = await invoke<{ session_id: string }>('create_session', {
        request: {
          bookmark_id: hostId,
          cols: 80,
          rows: 24,
          password: null,
        },
      })

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

    set(state => ({
      bookmarkTabs: state.bookmarkTabs.map(t => {
        if (t.id !== bookmarkTabId) return t
        const sessions = t.sessions.filter(s => s.id !== sessionTabId)
        const activeSessionId =
          t.activeSessionId === sessionTabId
            ? sessions[sessions.length - 1]?.id ?? null
            : t.activeSessionId
        return { ...t, sessions, activeSessionId }
      }),
    }))
  },

  setActiveSession: (bookmarkTabId, sessionTabId) => {
    set(state => ({
      bookmarkTabs: state.bookmarkTabs.map(t =>
        t.id === bookmarkTabId ? { ...t, activeSessionId: sessionTabId } : t
      ),
    }))
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
      const result = await invoke<{ session_id: string }>('create_session', {
        request: {
          bookmark_id: session.bookmarkId,
          cols: session.cols,
          rows: session.rows,
          password: password ?? null,
        },
      })
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
      const result = await invoke<{ session_id: string }>('create_session', {
        request: {
          bookmark_id: bookmark.id,
          cols: session.cols || 80,
          rows: session.rows || 24,
          password: null,
        },
      })

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
  openCredentialsModal: () => set({ credentialsModalOpen: true }),
  closeCredentialsModal: () => set({ credentialsModalOpen: false }),
  openHostsModal: () => set({ hostsModalOpen: true }),
  closeHostsModal: () => set({ hostsModalOpen: false }),

  // ── Transfer progress ─────────────────────────────────────────────────────

  updateTransfer: (progress) => {
    set(state => {
      const idx = state.transfers.findIndex(t => t.file_name === progress.file_name)
      if (idx >= 0) {
        const transfers = [...state.transfers]
        transfers[idx] = progress
        return { transfers }
      }
      return { transfers: [...state.transfers, progress] }
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
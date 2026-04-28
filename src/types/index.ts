export interface Bookmark {
  id: string
  title: string
  host: string
  port: number
  username: string
  auth_type: 'password' | 'privateKey' | 'profile'
  password?: string
  password_encrypted: boolean
  private_key?: string
  passphrase?: string
  profile_id?: string
  group_id?: string
  term: string
  encode: string
  color?: string
  description?: string
  start_directory_remote?: string
  start_directory_local?: string
  enable_sftp: boolean
  keepalive_interval: number
  created_at: number
  updated_at: number
}

// Host is a semantic alias for Bookmark (same fields, same backend table)
export type Host = Bookmark

export type HostReachabilityStatus = 'unknown' | 'reachable' | 'unreachable'

export interface BookmarkGroup {
  id: string
  title: string
  parent_id?: string
  order_index: number
  created_at: number
}

export interface Profile {
  id: string
  title: string
  username: string
  auth_type: 'password' | 'privateKey'
  password?: string
  password_encrypted: boolean
  private_key?: string
  passphrase?: string
  created_at: number
}

// Credential is a semantic alias for Profile (same fields, same backend table)
export type Credential = Profile

export interface Settings {
  font_size: number
  font_family: string
  theme: string
  opacity: number
  language: string
  scrollback: number
  show_hidden_files: boolean
  default_protocol: string
  cursor_style: string
  cursor_blink: boolean
  bell_style: string
}

export interface FileInfo {
  name: string
  path: string
  is_dir: boolean
  size: number
  modified?: number
  permissions?: string
  owner?: string
}

export interface TransferProgress {
  id: string
  file_name: string
  direction: 'upload' | 'download'
  total: number
  transferred: number
  transferred_bytes?: number  // bytes transferred so far (for folder downloads)
  status: 'pending' | 'transferring' | 'done' | 'error' | 'conflict'
  error?: string
  target_path?: string
  conflict_path?: string
  conflict_is_dir?: boolean
  session_id?: string   // which session tab this transfer belongs to
  group_id?: string     // batch group id for multi-file transfers
}

// A "bookmark tab" is a top-level tab corresponding to a Host
// It contains session tabs (individual SSH connections)
export interface BookmarkTab {
  id: string
  title: string
  bookmarkId?: string  // if linked to a specific bookmark/host
  hostId?: string      // explicit host reference (same as bookmarkId semantically)
  sessions: SessionTab[]
  activeSessionId: string | null
}

// A "session tab" is an individual SSH terminal connection within a BookmarkTab
export interface SessionTab {
  id: string
  title: string
  bookmarkId: string
  sessionId?: string        // backend session ID
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  error?: string
  cols: number
  rows: number
  localPath: string
  remotePath: string
  terminalPath?: string     // current working directory reported by the terminal
  fmOpen?: boolean          // 文件管理器是否展开
  sideTerminalOpen?: boolean        // 是否打开右侧辅助终端面板
  sideTerminalSessionId?: string    // 右侧辅助终端对应的后端会话 ID
  sideTerminalStatus?: 'connecting' | 'connected' | 'disconnected' | 'error'
  sideTerminalError?: string
}
# TinyTerm - Modern SSH Terminal Client

![TinyTerm Logo](src-tauri/logo.png)

TinyTerm is a modern, cross-platform SSH terminal client built with Tauri and React. It provides a sleek, user-friendly interface for managing SSH connections, terminal sessions, and file transfers.

## ✨ Features

### 🚀 Core Features
- **Multi-tab Interface**: Manage multiple SSH connections in tabbed interface
- **Session Management**: Create, save, and organize SSH connections as bookmarks
- **Dual Terminal Panels**: Side-by-side terminal sessions for efficient multitasking
- **File Manager**: Built-in SFTP file browser with drag-and-drop support
- **Connection Profiles**: Save authentication profiles for reuse across connections

### 🔐 Authentication Support
- Password authentication
- Private key authentication (RSA, DSA, ECDSA, ED25519)
- Encrypted credential storage
- Profile-based authentication management

### 🎨 User Experience
- Modern, responsive UI with dark/light themes
- Customizable terminal settings (fonts, colors, cursor style)
- Real-time file transfer progress
- Keyboard shortcuts for common operations
- Collapsible sidebar for better screen utilization

### 🔧 Technical Features
- Built with Tauri for native performance and small bundle size
- React frontend with TypeScript for type safety
- Rust backend for SSH operations using `ssh2` crate
- SQLite database for local data storage
- Cross-platform support (Windows, macOS, Linux)

## 📦 Installation

### Prerequisites
- Node.js 18+ and npm
- Rust and Cargo (for Tauri development)
- System dependencies for `ssh2` crate

### Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/miaokela/tinyterm.git
   cd tinyterm
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Install Tauri CLI**
   ```bash
   npm install @tauri-apps/cli
   ```

4. **Run in development mode**
   ```bash
   npm run tauri dev
   ```

### Production Build

```bash
# Build for current platform
npm run tauri build

# Build for specific platform
npm run tauri build -- --target universal-apple-darwin  # macOS universal
npm run tauri build -- --target x86_64-pc-windows-msvc  # Windows
npm run tauri build -- --target x86_64-unknown-linux-gnu # Linux
```

## 🚀 Usage

### Creating a Connection

1. Click the "+" button in the sidebar to add a new connection
2. Fill in connection details:
   - **Host**: Server address (IP or domain)
   - **Port**: SSH port (default: 22)
   - **Username**: Login username
   - **Authentication**: Choose password or private key
   - **Color**: Optional color coding for visual organization

3. Save as bookmark for future use

### Managing Sessions

- **New Tab**: `Ctrl/Cmd + T` or click "+" on tab bar
- **Close Tab**: `Ctrl/Cmd + W` or click "×" on tab
- **Switch Tabs**: `Ctrl/Cmd + Tab` or click tab
- **Split Terminal**: Click split button for side-by-side terminals

### File Transfers

1. Open file manager by clicking folder icon
2. Navigate local and remote directories
3. Drag and drop files between panes
4. Monitor transfer progress in real-time

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + N` | New connection |
| `Ctrl/Cmd + T` | New tab |
| `Ctrl/Cmd + W` | Close tab |
| `Ctrl/Cmd + ,` | Open settings |
| `Ctrl/Cmd + F` | Toggle file manager |
| `Ctrl/Cmd + \` | Split terminal |

## 🏗️ Project Structure

```
tinyterm/
├── src/                    # Frontend React application
│   ├── components/        # React components
│   │   ├── TerminalView.tsx    # Terminal display component
│   │   ├── FileManager.tsx     # SFTP file browser
│   │   ├── Toolbar.tsx         # Main toolbar
│   │   ├── HostsModal.tsx      # Connection management modal
│   │   └── CredentialsModal.tsx # Authentication modal
│   ├── store/             # Zustand state management
│   ├── styles/            # CSS stylesheets
│   ├── types/             # TypeScript type definitions
│   └── App.tsx            # Main application component
├── src-tauri/             # Rust backend
│   ├── src/
│   │   ├── commands/      # Tauri command handlers
│   │   │   ├── ssh.rs          # SSH connection management
│   │   │   ├── sftp.rs         # SFTP file operations
│   │   │   ├── bookmark.rs     # Bookmark CRUD operations
│   │   │   └── profile.rs      # Profile management
│   │   ├── models.rs      # Data models and database
│   │   ├── storage.rs     # Local storage utilities
│   │   └── main.rs        # Application entry point
│   ├── Cargo.toml         # Rust dependencies
│   └── tauri.conf.json    # Tauri configuration
├── public/                # Static assets
├── icons/                 # Application icons
└── package.json          # Node.js dependencies
```

## 🔧 Configuration

### Application Settings

Settings are stored locally and can be configured via the settings dialog:

- **Terminal**: Font size, font family, theme, cursor style
- **Interface**: Language, opacity, default protocol
- **Behavior**: Scrollback lines, bell style, hidden files

### Database

TinyTerm uses SQLite for local data storage:
- `bookmarks.db`: Stores connections, profiles, and settings
- Location: Platform-specific user data directory

### Environment Variables

```bash
# Development logging
RUST_LOG=debug    # Enable debug logging
TAURI_LOG_LEVEL=debug  # Tauri debug logging
```

## 🧪 Testing

### Docker Test Environment

A Docker-based test environment is included for development:

```bash
# Build and run test SSH server
cd docker-test
docker build -t tinyterm-test .
docker run -p 2222:22 tinyterm-test
```

Test credentials:
- Username: `testuser`
- Password: `testpass`

### Manual Testing

1. Start development server: `npm run tauri dev`
2. Test SSH connections to local or remote servers
3. Verify file transfer functionality
4. Test UI responsiveness and theme switching

## 📚 API Reference

### Frontend API

```typescript
// Store actions
const {
  // Connection management
  openHostTab,
  removeBookmarkTab,
  setActiveBookmarkTab,
  
  // Session management
  openSession,
  closeSession,
  reconnectSession,
  
  // File operations
  updateTransfer,
  
  // UI state
  openCredentialsModal,
  openHostsModal,
} = useStore();
```

### Backend Commands

```rust
// SSH connection
#[tauri::command]
async fn connect_ssh(
    bookmark_id: String,
    cols: u32,
    rows: u32,
    password: Option<String>,
) -> Result<SessionResponse>;

// File transfer
#[tauri::command]
async fn upload_file(
    bookmark_id: String,
    local_path: String,
    remote_path: String,
) -> Result<()>;

// Bookmark management
#[tauri::command]
async fn create_bookmark(bookmark: Bookmark) -> Result<String>;
```

## 🐛 Troubleshooting

### Common Issues

1. **SSH Connection Failed**
   - Verify network connectivity
   - Check firewall settings
   - Validate credentials
   - Ensure SSH service is running on target

2. **Private Key Authentication Fails**
   - Verify key format (PEM format required)
   - Check passphrase if key is encrypted
   - Ensure key permissions are correct

3. **Build Errors**
   - Ensure Rust toolchain is up to date: `rustup update`
   - Install required system dependencies for `ssh2`
   - Clear build cache: `cargo clean`

### Debug Logging

Enable detailed logging:
```bash
# Development
npm run tauri dev -- --verbose

# Check logs
tail -f ~/.config/tinyterm/logs/app.log
```

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Development Guidelines

- Follow TypeScript best practices
- Use functional components with hooks
- Maintain consistent code style (ESLint/Prettier)
- Write meaningful commit messages
- Update documentation for new features

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Tauri](https://tauri.app/) for the amazing framework
- [xterm.js](https://xtermjs.org/) for terminal emulation
- [ssh2](https://github.com/alexcrichton/ssh2-rs) for Rust SSH implementation
- [React](https://reactjs.org/) and [Zustand](https://github.com/pmndrs/zustand) for frontend

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/miaokela/tinyterm/issues)
- **Documentation**: [Project Wiki](https://github.com/miaokela/tinyterm/wiki)
- **Email**: miaokela@github.com

---

**TinyTerm** - Making SSH connections beautiful and productive ✨
# Changelog

All notable changes to TinyTerm will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.5] - 2026-05-06

### Added
- 添加 Claude Code 项目助手指令配置文档

## [Unreleased]

### Added
- Initial project structure with Tauri + React
- SSH terminal emulation using xterm.js
- Multi-tab interface for managing connections
- Bookmark system for saving SSH connections
- File manager with SFTP support
- Dual terminal panels for side-by-side sessions
- Authentication profiles for credential management
- Settings management (fonts, themes, terminal preferences)
- Real-time file transfer progress monitoring
- Docker test environment for development

### Features
- **SSH Connections**: Support for password and private key authentication
- **Session Management**: Create, save, and organize SSH connections
- **File Transfers**: Drag-and-drop file upload/download via SFTP
- **UI/UX**: Modern interface with dark/light themes, collapsible sidebar
- **Cross-platform**: Windows, macOS, and Linux support

### Technical
- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Rust with Tauri framework
- **State Management**: Zustand for React state
- **Database**: SQLite for local data storage
- **Terminal**: xterm.js with fit and web-links addons
- **SSH Library**: ssh2-rs for Rust SSH implementation

## [0.1.0] - 2024-03-27

### Added
- Initial release of TinyTerm
- Basic SSH terminal functionality
- Connection bookmarking system
- File manager with basic SFTP operations
- Authentication profile management
- Application settings configuration
- Cross-platform build support

### Fixed
- Initial commit with working prototype

### Known Issues
- Some edge cases in file transfer error handling
- Limited keyboard shortcut customization
- Basic theme support (dark/light only)

---
**Note**: This is the initial release. Future versions will include more features and improvements based on user feedback.
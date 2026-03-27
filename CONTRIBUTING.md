# Contributing to TinyTerm

Thank you for your interest in contributing to TinyTerm! This document provides guidelines and instructions for contributing to the project.

## 🎯 Code of Conduct

Please be respectful and considerate of others when contributing to this project. We aim to foster an inclusive and welcoming community.

## 📋 How to Contribute

### Reporting Bugs
1. Check if the bug has already been reported in the [Issues](https://github.com/miaokela/tinyterm/issues)
2. If not, create a new issue with:
   - A clear, descriptive title
   - Steps to reproduce the bug
   - Expected vs actual behavior
   - Screenshots if applicable
   - Environment details (OS, version, etc.)

### Suggesting Features
1. Check if the feature has already been suggested
2. Create a new issue with:
   - A clear description of the feature
   - Use cases and benefits
   - Any implementation ideas you have
   - Screenshots or mockups if applicable

### Submitting Code Changes
1. Fork the repository
2. Create a new branch: `git checkout -b feature/your-feature-name`
3. Make your changes
4. Add or update tests as needed
5. Update documentation
6. Commit your changes: `git commit -m 'Add some feature'`
7. Push to your fork: `git push origin feature/your-feature-name`
8. Open a Pull Request

## 🏗️ Development Setup

### Prerequisites
- Node.js 18+ and npm
- Rust and Cargo
- Git

### Setup Steps
```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/tinyterm.git
cd tinyterm

# Install dependencies
npm install

# Install Tauri CLI
npm install @tauri-apps/cli

# Run development server
npm run tauri dev
```

## 📁 Project Structure

```
tinyterm/
├── src/                    # Frontend (React + TypeScript)
│   ├── components/        # React components
│   ├── store/            # Zustand state management
│   ├── styles/           # CSS styles
│   ├── types/            # TypeScript types
│   └── App.tsx           # Main app component
├── src-tauri/            # Backend (Rust)
│   ├── src/commands/     # Tauri commands
│   ├── src/models.rs     # Data models
│   └── Cargo.toml        # Rust dependencies
└── public/               # Static assets
```

## 💻 Coding Standards

### TypeScript/React
- Use functional components with hooks
- Follow TypeScript strict mode
- Use meaningful variable and function names
- Add JSDoc comments for complex functions
- Keep components focused and reusable

```typescript
// Good example
interface Props {
  title: string;
  onClose: () => void;
}

export const Modal: React.FC<Props> = ({ title, onClose }) => {
  return (
    <div className="modal">
      <h2>{title}</h2>
      <button onClick={onClose}>Close</button>
    </div>
  );
};
```

### Rust
- Follow Rust naming conventions
- Use `anyhow` for error handling
- Add documentation comments
- Write tests for critical functions

```rust
/// Connects to an SSH server using the provided bookmark
///
/// # Arguments
/// * `bookmark` - Connection details
/// * `password` - Optional password for authentication
///
/// # Returns
/// Result containing the SSH session or an error
pub fn connect_ssh(bookmark: &Bookmark, password: Option<&str>) -> Result<Session> {
    // Implementation
}
```

### Git Commit Messages
Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

Examples:
```
feat(ssh): add private key authentication support
fix(terminal): resolve memory leak in xterm.js
docs(readme): update installation instructions
```

## 🧪 Testing

### Frontend Testing
```bash
# Run tests
npm test

# Run tests with coverage
npm test -- --coverage
```

### Backend Testing
```bash
# Run Rust tests
cd src-tauri
cargo test

# Run specific test
cargo test test_ssh_connection
```

### Manual Testing
Test the following areas:
1. SSH connections with various authentication methods
2. File transfers (upload/download)
3. UI responsiveness and theme switching
4. Keyboard shortcuts
5. Error handling and recovery

## 📝 Documentation

### Updating Documentation
- Update README.md for significant changes
- Add JSDoc/rustdoc comments for new APIs
- Update type definitions when interfaces change
- Keep CONTRIBUTING.md up to date

### Adding New Features
When adding a new feature:
1. Update the README.md Features section
2. Add usage examples if applicable
3. Update API documentation
4. Add changelog entry

## 🔍 Code Review Process

1. Pull requests will be reviewed by maintainers
2. Address all review comments
3. Ensure all tests pass
4. Update documentation as needed
5. Squash commits if requested

### Review Checklist
- [ ] Code follows project standards
- [ ] Tests are added/updated
- [ ] Documentation is updated
- [ ] No breaking changes (or documented if intentional)
- [ ] Performance considerations addressed
- [ ] Security considerations addressed

## 🐛 Debugging

### Frontend Debugging
```bash
# Enable debug logging
TAURI_LOG_LEVEL=debug npm run tauri dev

# Use React DevTools
# Install extension for your browser
```

### Backend Debugging
```bash
# Run with verbose logging
RUST_LOG=debug npm run tauri dev

# Check logs
tail -f ~/.config/tinyterm/logs/app.log
```

## 🚀 Release Process

1. Update version numbers:
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
2. Update CHANGELOG.md
3. Create release tag: `git tag v1.0.0`
4. Push tag: `git push origin v1.0.0`
5. Create GitHub release with release notes

## ❓ Getting Help

- Check existing documentation
- Search existing issues
- Ask in discussions
- Contact maintainers

## 🙏 Thank You!

Your contributions help make TinyTerm better for everyone. Thank you for taking the time to contribute!
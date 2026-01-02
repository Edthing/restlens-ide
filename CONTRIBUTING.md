# Contributing to REST Lens IDE

Thank you for your interest in contributing to REST Lens IDE! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please be respectful and constructive in all interactions. We welcome contributors of all backgrounds and experience levels.

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+
- VS Code (for testing the extension)

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/restlens/restlens-ide.git
   cd restlens-ide
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build all packages:
   ```bash
   npm run build
   ```

### Project Structure

```
restlens-ide/
├── packages/
│   ├── shared/           # Shared types and utilities
│   ├── lsp-server/       # Language Server Protocol implementation
│   └── vscode-extension/ # VS Code extension
├── fixtures/             # Sample OpenAPI specs for testing
└── ...
```

## Development

### Building

```bash
# Build all packages
npm run build

# Build specific package
cd packages/lsp-server && npm run build
```

### Testing

```bash
# Run all tests
npm test

# Test the extension in VS Code
# 1. Open the project in VS Code
# 2. Press F5 to launch Extension Development Host
# 3. Open a sample OpenAPI file from fixtures/
```

### Debugging

1. Open the project in VS Code
2. Go to Run and Debug (Ctrl+Shift+D)
3. Select "Launch Extension" or "Attach to Server"
4. Set breakpoints and press F5

## Making Changes

### Branching

- Create a feature branch from `main`
- Use descriptive branch names: `feature/add-hover-docs`, `fix/token-refresh`

### Commits

- Write clear, concise commit messages
- Reference issues when applicable: `Fix token refresh (#123)`

### Pull Requests

1. Ensure all tests pass
2. Update documentation if needed
3. Add a clear description of changes
4. Request review from maintainers

## Architecture

### LSP Server

The Language Server handles:
- Document validation
- API communication with REST Lens
- Converting violations to LSP diagnostics
- Caching results

Key files:
- `packages/lsp-server/src/server.ts` - Main server
- `packages/lsp-server/src/api-client.ts` - REST Lens API client
- `packages/lsp-server/src/diagnostics.ts` - Violation conversion

### VS Code Extension

The extension handles:
- OAuth authentication flow
- User interface (status bar, commands)
- LSP client communication
- Configuration management

Key files:
- `packages/vscode-extension/src/extension.ts` - Entry point
- `packages/vscode-extension/src/auth/` - OAuth implementation
- `packages/vscode-extension/src/ui/` - UI components

## License

By contributing, you agree that your contributions will be licensed under the GPL-3.0 license.

## Questions?

- Open an issue for bugs or feature requests
- Check existing issues before creating new ones

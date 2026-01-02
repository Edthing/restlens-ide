# REST Lens IDE

Real-time OpenAPI specification evaluation for VS Code.

## Features

- **Real-time validation**: See REST API design violations as you write OpenAPI specs
- **Inline diagnostics**: Violations appear directly in your editor
- **Severity-based colors**: Status bar reflects error/warning/info severity
- **25+ built-in rules**: REST API best practices based on research
- **Custom rules**: Organization-specific rules supported
- **OAuth authentication**: Secure browser-based authentication
- **Project-based**: Inherits rules from your REST Lens projects

## Installation

Install from the VS Code Marketplace or download the latest `.vsix` from [Releases](https://github.com/Edthing/restlens-ide/releases) and install:

```bash
code --install-extension restlens-x.x.x.vsix
```

## Quick Start

1. Run `REST Lens: Sign In` from the command palette (Ctrl+Shift+P / Cmd+Shift+P)
2. Authorize in browser and select a project
3. Open an OpenAPI file (YAML/JSON)
4. Violations appear in the Problems panel

## Requirements

- VS Code 1.85.0+
- REST Lens account ([restlens.com](https://restlens.com))

## Configuration

Project settings are stored in `.vscode/settings.json` (auto-configured when selecting a project):

```json
{
  "restlens.organization": "my-org",
  "restlens.project": "my-api"
}
```

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `restlens.evaluateOnSave` | `true` | Evaluate on save |
| `restlens.evaluateOnType` | `false` | Evaluate while typing |
| `restlens.debounceMs` | `1000` | Debounce delay (ms) |
| `restlens.includeInfoSeverity` | `false` | Show info-level violations |

## Commands

| Command | Description |
|---------|-------------|
| `REST Lens: Sign In` | Authenticate with REST Lens |
| `REST Lens: Sign Out` | Sign out |
| `REST Lens: Evaluate` | Manual evaluation |
| `REST Lens: Select Project` | Change project |
| `REST Lens: Clear Cache` | Clear cached results |

## Links

- [REST Lens Website](https://restlens.com)
- [Documentation](https://restlens.com/docs)
- [GitHub Repository](https://github.com/Edthing/restlens-ide)
- [Report Issues](https://github.com/Edthing/restlens-ide/issues)

## License

GPL-3.0 - See [LICENSE](LICENSE)

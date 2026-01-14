# Noetect

Noetect is a desktop application for macOS that helps you work with notes, tasks, and AI agents. Built with Bun, React, and Swift, it provides a fast, native experience for managing your workspace.

## Installation

### Download Release (Users)

1. Download the latest `.app` file from the [Releases page](https://github.com/firstloophq/noetect/releases)
2. Move `Noetect.app` to your `/Applications` folder
3. Open Noetect from Applications or Spotlight

On first launch, macOS may show a security warning. To allow the app:
- Go to System Settings → Privacy & Security
- Click "Open Anyway" next to the Noetect warning

## Development Setup

### Prerequisites

- macOS 12.0 or later
- [Bun](https://bun.sh) v1.1 or later
- Xcode Command Line Tools: `xcode-select --install`

### Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/firstloophq/noetect.git
   cd noetect
   ```

2. **Install dependencies**
   ```bash
   cd bun-sidecar
   bun install
   ```

3. **Run development server**
   ```bash
   bun run dev
   ```
   The server will start at `http://localhost:1234`

### Building the App

To build and install Noetect locally:

```bash
# Build and install to /Applications/Noetect.app
./build-install.sh

# Or install as dev version (no .sh extension)
./build-install-dev
```

The build process:
1. Compiles the Bun sidecar (React + TypeScript)
2. Builds the Swift macOS host application
3. Packages everything into a `.app` bundle

### Development Commands

From the `bun-sidecar` directory:

- `bun run dev` - Start development server with hot reload
- `bun run build` - Run full validation (Tailwind CSS, ESLint, TypeScript)
- `bun run build:css` - Compile Tailwind CSS only

### Project Structure

```
noetect/
├── bun-sidecar/       # React app built with Bun
│   ├── src/           # Application source code
│   └── package.json   # Dependencies and scripts
├── mac-app/           # macOS Swift wrapper
│   └── macos-host/    # Native macOS host application
├── build-install.sh   # Build and install script
└── README.md          # This file
```

## Architecture

Noetect uses a unique architecture:
- **Swift Host**: Native macOS app that provides the window and menu bar
- **Bun Sidecar**: React application served by Bun's built-in HTTP server
- **WKWebView**: Bridge between Swift and the web-based UI

For more details, see [CLAUDE.md](CLAUDE.md) for comprehensive development documentation.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

See [LICENSE.md](LICENSE.md) for licensing information.

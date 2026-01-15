# Nomendex

A modular workspace application built with Bun, React, and a plugin architecture for extensible functionality.

## Quick Start

To install dependencies:

```bash
bun install
```

To start a development server:

```bash
bun dev
```

To run for production:

```bash
bun start
```

## Features

- **Plugin Architecture** - Modular system for extending functionality
- **Multiple Views** - Each plugin can provide browser, editor, and custom views  
- **Type Safety** - Full TypeScript with Zod schemas for runtime validation
- **MCP Integration** - Connect external tools via Model Context Protocol servers
- **Workspace Management** - Tabbed interface with persistent state

## Built-in Plugins

### Notes
File-based markdown note management with browser and editor interfaces.
- Create, edit, and manage `.md` files
- Auto-save functionality
- File system storage in `notes/` directory

### Workflows  
GitHub Actions workflow management with full lifecycle support.
- Browse, create, and edit workflow files
- Execute workflows with custom inputs
- Monitor execution status and logs
- MCP server integration for GitHub API access

### Tldraw
Canvas drawing and diagramming with local persistence.
- Create and manage drawing boards
- Local storage with cross-tab synchronization
- Export capabilities
- Reset functionality for troubleshooting

## Documentation

- **[Plugin Architecture](docs/plugin-architecture/README.md)** - Technical overview of the plugin system
- **[Plugin Development Guide](docs/plugin-development-guide.md)** - Step-by-step guide for creating plugins
- **[Notes Plugin](docs/notes-plugin.md)** - Notes plugin documentation
- **[Workflows Plugin](docs/workflows-plugin.md)** - Workflows plugin documentation  
- **[Tldraw Plugin](docs/tldraw-plugin.md)** - Tldraw plugin documentation

## Tech Stack

- **Runtime:** [Bun](https://bun.com) - Fast all-in-one JavaScript runtime
- **Frontend:** React 18 with TypeScript
- **Styling:** Tailwind CSS with shadcn/ui components
- **Validation:** Zod schemas for type-safe data handling
- **Architecture:** Plugin-based modular system
